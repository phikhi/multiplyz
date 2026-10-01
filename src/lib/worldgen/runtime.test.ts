import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { characters, profiles, progress, worlds, jobs, adventureSessions } from "@/lib/db/schema";
import { CONFIG_DEFAULTS, loadWorldGenConfig } from "@/config/server-config";
import { upsertCandidate, approveAsset, MASTER_ASSET_ID } from "./reference-assets";
import { createWorldRuntime, type RuntimeOptions } from "./runtime";
import { reserveRequest, createWorldAssetStore } from "./runtime-assets";
import { parseInspection, createVisionInspector } from "./vision-inspector";
import { reinspectPilotWorld } from "./pilot-inspection";
import { lastReservedWorld } from "./future-worlds";
import { approveWorld } from "./worker";
import { writeHouseholdSettings } from "@/lib/parent/settings";
import { listPendingWorlds } from "@/lib/parent/world-approval";
import { buildWorldTheme } from "@/lib/game/world-theme";
import { resolveWorld } from "./socle";
import { worldSceneKind } from "@/strings/world-scenes";
import { startAdventure } from "@/lib/game/adventure";
import { GET } from "@/app/generated/world/[world]/[file]/route";
import { stageAssetsReady } from "@/lib/game/evolution";
import { stageArtRefs } from "@/lib/game/creature-stage-art";
import { readRuntimeCatalogue } from "./runtime-catalogue";
import { loadRefinablePilot, refinePilotWorld, type RefinementDeps } from "./pilot-refinement";
import { collectInspectableAssets } from "./qa";
import { testCreatureDesign } from "./creature-design.test-helper";
import { readPilotReservedUnits } from "./pilot-status";
import { creatureHistory } from "./creature-design-runtime";

let db: AppDatabase, cwd: string, pixels: Buffer, profileId: number;
const now = () => new Date("2026-09-11T10:00:00Z");
const vision = (
  signals: unknown = {
    detectedText: "",
    unsafeScore: 0,
    styleScore: 1,
    identityMatches: true,
    growthVisible: true,
    habitatMatches: true,
    visuallyDistinct: true,
  },
) => ({
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(signals) }] } }],
});
beforeEach(async () => {
  cwd = mkdtempSync(join(realpathSync(tmpdir()), "teddy-runtime-"));
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = db
    .insert(profiles)
    .values({ name: "Voyage", nameKey: "voyage", pinHash: "unit", avatar: "cat" })
    .returning()
    .get().id;
  pixels = await sharp({ create: { width: 16, height: 16, channels: 4, background: "#99bbdd" } })
    .png()
    .toBuffer();
  const ref = "storage/reference/teddy/master.png";
  mkdirSync(join(cwd, "storage/reference/teddy"), { recursive: true });
  writeFileSync(join(cwd, ref), pixels);
  upsertCandidate(db, {
    id: MASTER_ASSET_ID,
    kind: "master",
    expression: null,
    assetRef: ref,
    backgroundStrategy: "post-cutout",
    transparent: true,
    sourcePhotosHash: "unit",
  });
  approveAsset(db, MASTER_ASSET_ID, "owner");
});
afterEach(() => {
  db.$client.close();
  rmSync(cwd, { recursive: true, force: true });
});

function reached(worldIndex = 4, levelIndex = 0) {
  db.insert(progress)
    .values({ id: `${profileId}:${worldIndex}:${levelIndex}`, profileId, worldIndex, levelIndex })
    .onConflictDoNothing()
    .run();
}
function runtime(
  options: Partial<RuntimeOptions> = {},
  signal: unknown = undefined,
  onRequest?: (body: string) => void,
  inspectionStatus = 200,
) {
  const requests: string[] = [];
  let imageCount = 0;
  const fetchImpl: typeof fetch = vi.fn(async (_url, init) => {
    const body = String(init?.body);
    requests.push(body);
    onRequest?.(body);
    const input = JSON.parse(body);
    const designRequest = input.generationConfig.responseSchema?.properties?.creatures;
    const planningContext = designRequest
      ? input.contents[0].parts.at(-1).text.match(/WORLD (\d+), THEME (\w+)\./)
      : undefined;
    const generated = input.generationConfig.responseModalities
      ? await sharp({
          create: {
            width: 8,
            height: 8,
            channels: 4,
            background: { r: ++imageCount, g: 100, b: 200, alpha: 1 },
          },
        })
          .extend({
            top: 4,
            bottom: 4,
            left: 4,
            right: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer()
      : pixels;
    return new Response(
      JSON.stringify(
        input.generationConfig.responseModalities
          ? {
              candidates: [
                {
                  finishReason: "STOP",
                  content: {
                    parts: [
                      { inlineData: { mimeType: "image/png", data: generated.toString("base64") } },
                    ],
                  },
                },
              ],
            }
          : designRequest
            ? vision(testCreatureDesign(Number(planningContext[1]), planningContext[2]))
            : vision(
                signal && typeof signal === "object"
                  ? { habitatMatches: true, visuallyDistinct: true, ...signal }
                  : signal,
              ),
      ),
      { status: input.generationConfig.responseModalities ? 200 : inspectionStatus },
    );
  });
  const worker = createWorldRuntime(db, {
    cwd,
    apiKey: "unit-secret",
    imageModel: "unit-image",
    qaModel: "unit-vision",
    now,
    config: {
      ...loadWorldGenConfig({}),
      maxRetries: 0,
      qa: { ...loadWorldGenConfig({}).qa, maxAttempts: 0 },
    },
    imageReservationEur: 0.1,
    qaReservationEur: 0.05,
    fetchImpl,
    planCreatures: async ({ index, theme }) => testCreatureDesign(index, theme),
    readHistoricalArt: () => pixels,
    ...options,
  });
  return { worker, requests, fetchImpl };
}

describe("real world runtime with local image files and mocked HTTP only", () => {
  it("charges and saves one structural planning request before any image, preserving the new plan for recovery", async () => {
    reached();
    const { worker, requests } = runtime({ planCreatures: undefined }, undefined, (body) => {
      if (JSON.parse(body).generationConfig.responseModalities)
        expect(
          JSON.parse(readFileSync(join(cwd, "storage/worldgen/designs/world-6.json"), "utf8"))
            .version,
        ).toBe(1);
    });
    expect((await worker.tick()).processed.outcome).toBe("done");
    expect(
      JSON.parse(requests[0]).generationConfig.responseSchema.properties.creatures,
    ).toBeDefined();
    expect(requests).toHaveLength(43);
    expect(readPilotReservedUnits(cwd)).toBe(3_200_000);
    const previousForNextWorld = creatureHistory(db, join(cwd, "storage/generated"), 7);
    expect(previousForNextWorld.find((c) => c.id === "creature:6:0")?.design).toEqual(
      testCreatureDesign().creatures[0],
    );
  });
  it("rejects a reused creature name before spending on any image", async () => {
    reached();
    const original = db.select().from(characters).all();
    const { worker, requests } = runtime({
      planCreatures: async () => {
        const plan = testCreatureDesign();
        plan.creatures[0].name = "Pistache";
        return plan;
      },
    });
    expect((await worker.tick()).processed.outcome).toBe("failed");
    expect(requests).toHaveLength(0);
    expect(db.select().from(worlds).all()).toEqual([]);
    expect(db.select().from(characters).all()).toEqual(original);
  });
  it.each([{ visuallyDistinct: false }, { habitatMatches: false }])(
    "refuses a newly drawn duplicate or habitat mismatch: %j",
    async (failure) => {
      reached();
      const { worker } = runtime(
        {},
        {
          detectedText: "",
          unsafeScore: 0,
          styleScore: 1,
          identityMatches: true,
          growthVisible: true,
          ...failure,
        },
      );
      expect((await worker.tick()).processed.outcome).toBe("failed");
      expect(db.select().from(worlds).get()!.status).toBe("buffered");
      expect(db.select().from(characters).all()).toHaveLength(41);
      expect(() => approveWorld(db, "world:6", "parent")).toThrow();
    },
  );
  it("prevents the legacy pilot commands from bypassing modern catalogue comparisons", async () => {
    reached();
    writeHouseholdSettings(db, { parentWorldValidation: true });
    await runtime(
      {},
      {
        detectedText: "",
        unsafeScore: 0,
        styleScore: 1,
        identityMatches: true,
        growthVisible: false,
      },
    ).worker.tick();
    const storage = join(cwd, "storage/generated");
    const inspect = vi.fn(() => ({ detectedText: "", unsafeScore: 0, styleScore: 1 }));
    await expect(
      reinspectPilotWorld(db, 6, storage, inspect, loadWorldGenConfig({}).qa),
    ).rejects.toThrow(/ancienne reprise/);
    expect(() => loadRefinablePilot(db, 6, storage)).toThrow(/ancienne correction/);
    expect(inspect).not.toHaveBeenCalled();
  });
  it("requires a new comparison if another catalogue entry appears during final QA", async () => {
    reached();
    let inspections = 0;
    const { worker } = runtime({}, undefined, (body) => {
      if (JSON.parse(body).generationConfig.responseMimeType && ++inspections === 21)
        db.insert(characters)
          .values({
            id: "late",
            speciesKey: "late",
            nameDefault: "Lanternis",
            rarity: "common",
            artRef: "socle/creature/late.png",
            story: "Compagnon tardif",
            worldIndex: 99,
          })
          .run();
    });
    await expect(worker.tick()).rejects.toThrow(/catalogue a changé/);
    expect(db.select().from(worlds).get()!.status).toBe("buffered");
    expect(db.select().from(characters).where(eq(characters.worldIndex, 6)).all()).toEqual([]);
  });
  it("preserves all 41 socle companions and queues nothing during the early worlds", async () => {
    const before = db.select().from(characters).all();
    const { worker, requests } = runtime();
    const result = await worker.tick(true);
    expect(result.buffer.enqueued).toEqual([]);
    expect(requests).toEqual([]);
    expect(db.select().from(characters).all()).toEqual(before);
  });
  it("writes real images, inspects each, activates a future world and renders its theme without restart", async () => {
    reached();
    const before = db.select().from(characters).all();
    const { worker, requests } = runtime();
    const result = await worker.tick(true);
    expect(result.buffer.enqueued).toEqual([6]);
    expect(result.processed.outcome, db.select().from(jobs).get()?.lastError ?? "").toBe("done");
    const world = db.select().from(worlds).get()!;
    expect(world.status).toBe("active");
    const theme = buildWorldTheme(resolveWorld(db, 6));
    expect(worldSceneKind(theme.slug, 6)).toBe("magic");
    for (const row of before)
      expect(db.select().from(characters).where(eq(characters.id, row.id)).get()).toEqual(row);
    const inputs = requests.map((r) => JSON.parse(r));
    const inspections = inputs.filter((i) => i.generationConfig.responseMimeType);
    expect(inspections.length).toBe(inputs.length / 2);
    expect(inspections).toHaveLength(21);
    const adult = inspections.find((i) =>
      i.contents[0].parts.at(-1).text.includes("FIRST image is the ADULT"),
    );
    expect(
      adult.contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData),
    ).toHaveLength(9);
    const teddy = inspections.find((i) => i.contents[0].parts.at(-1).text.includes("as a teddy"));
    expect(
      teddy.contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData),
    ).toHaveLength(2);
    const reference: string = JSON.parse(world.assetRefs).background;
    expect(
      readFileSync(join(cwd, "storage/generated", reference))
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const newCreatures = db.select().from(characters).where(eq(characters.worldIndex, 6)).all();
    for (const c of newCreatures) {
      expect(c.maxStage).toBe(3);
      expect(stageArtRefs(c)).toHaveLength(3);
      expect(stageAssetsReady(stageArtRefs(c))).toBe(true);
    }
    const stageRef = stageArtRefs(newCreatures[0])[2];
    expect(
      (
        await GET(new Request("http://unit"), {
          params: Promise.resolve({ world: "6", file: stageRef.split("/")[2] }),
        })
      ).status,
    ).toBe(200);
    rmSync(join(cwd, "storage/generated", stageRef));
    expect(stageAssetsReady(stageArtRefs(newCreatures[0]))).toBe(false);
    const response = await GET(new Request("http://unit"), {
      params: Promise.resolve({ world: "6", file: reference.split("/")[2] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      readFileSync(join(cwd, "storage/generated", reference)),
    );
    const paid = requests.length;
    await worker.tick();
    expect(requests).toHaveLength(paid);
  });
  it.each([
    { detectedText: "BUY", unsafeScore: 0, styleScore: 1 },
    { detectedText: "", unsafeScore: 1, styleScore: 1 },
    { detectedText: "", unsafeScore: 0, styleScore: 0 },
    { detectedText: "", unsafeScore: -1, styleScore: 1 },
    { styleScore: 1 },
  ])("never activates rejected or malformed vision signals: %j", async (signals) => {
    reached();
    const { worker, requests } = runtime({}, signals);
    expect((await worker.tick()).processed.outcome).toBe("failed");
    expect(db.select().from(worlds).get()!.status).toBe("buffered");
    expect(db.select().from(characters).all()).toHaveLength(41);
    expect(() => approveWorld(db, "world:6", "parent")).toThrow();
    const calls = requests.length;
    await worker.tick();
    expect(requests).toHaveLength(calls);
  });
  it("keeps the parental approval toggle and refuses approval after fallback is reached", async () => {
    reached();
    writeHouseholdSettings(db, { parentWorldValidation: true });
    const { worker } = runtime();
    await worker.tick();
    expect(db.select().from(worlds).get()!.status).toBe("buffered");
    expect(db.select().from(characters).all()).toHaveLength(41);
    reached(6);
    expect(() => approveWorld(db, "world:6", "parent")).toThrow(/préservé/);
    expect(db.select().from(worlds).get()!.status).toBe("buffered");
  });
  it("allows a parent to approve a QA-passed world still ahead", async () => {
    reached();
    writeHouseholdSettings(db, { parentWorldValidation: true });
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    await runtime().worker.tick();
    expect(listPendingWorlds(db)[0].creatures!.length).toBeGreaterThanOrEqual(6);
    expect(listPendingWorlds(db)[0].creatures!.every((c) => c.stageArt?.[2] && c.stageArt[3])).toBe(
      true,
    );
    expect(db.select().from(characters).all()).toHaveLength(41);
    approveWorld(db, "world:6", "parent");
    expect(db.select().from(worlds).get()!.status).toBe("active");
    expect(db.select().from(characters).all().length).toBeGreaterThan(41);
    expect(
      db
        .select()
        .from(characters)
        .where(eq(characters.worldIndex, 6))
        .all()
        .every((c) => c.maxStage === 3),
    ).toBe(true);
  });
  it.each([
    { identityMatches: false, growthVisible: true },
    { identityMatches: true, growthVisible: false },
    {},
  ])("rejects absent or failed growth comparison %j", async (growth) => {
    reached();
    const { worker } = runtime({}, { detectedText: "", unsafeScore: 0, styleScore: 1, ...growth });
    expect((await worker.tick()).processed.outcome).toBe("failed");
    expect(db.select().from(characters).all()).toHaveLength(41);
    expect(db.select().from(worlds).get()!.status).toBe("buffered");
  });
  it("rejects a damaged stage manifest before parent publication", async () => {
    reached();
    writeHouseholdSettings(db, { parentWorldValidation: true });
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    await runtime().worker.tick();
    const world = db.select().from(worlds).get()!;
    const manifest = readRuntimeCatalogue(6, world.assetRefs);
    const path = join(
      cwd,
      "storage/generated",
      manifest.assetRefs.background.replace("-background.png", "-manifest.json"),
    );
    const damaged = JSON.parse(readFileSync(path, "utf8"));
    damaged.creatures[0].stageArt[3] = damaged.creatures[0].artRef;
    writeFileSync(path, JSON.stringify(damaged));
    expect(listPendingWorlds(db)).toEqual([]);
    expect(() => approveWorld(db, "world:6", "parent")).toThrow();
    expect(db.select().from(characters).all()).toHaveLength(41);
  });
  it("fills two worlds ahead without repeating the actual previous themes", async () => {
    reached(5);
    const { worker } = runtime();
    expect((await worker.tick()).buffer.enqueued).toEqual([6, 7]);
    await worker.tick();
    const generated = db.select().from(worlds).orderBy(worlds.index).all();
    expect(generated.map((w) => w.status)).toEqual(["active", "active"]);
    expect(
      generated.map((w) =>
        worldSceneKind(buildWorldTheme(resolveWorld(db, w.index)).slug, w.index),
      ),
    ).toEqual(["magic", "grove"]);
    expect((await worker.tick()).processed.outcome).toBe("idle");
  });
  it("reuses completed pilot images without charging again, but inspects them with every new stage", async () => {
    reached();
    const ledger = join(cwd, "storage/worldgen/budget");
    // The interrupted HTTP attempt is still reserved alongside two successful images.
    for (let i = 0; i < 3; i++) reserveRequest(ledger, 0.1, 5, now());
    let index = 0;
    const config = {
      ...loadWorldGenConfig({}),
      monthlyBudgetEur: 5,
      maxRetries: 0,
      qa: { ...loadWorldGenConfig({}).qa, maxAttempts: 0 },
    };
    const { worker, requests } = runtime({
      config,
      reuseImage: () => (++index <= 2 ? pixels : undefined),
    });
    expect((await worker.tick()).processed.outcome).toBe("done");
    const inputs = requests.map((body) => JSON.parse(body));
    expect(inputs.filter((i) => i.generationConfig.responseModalities)).toHaveLength(19);
    expect(inputs.filter((i) => i.generationConfig.responseMimeType)).toHaveLength(21);
    // Total is 0.30 + 19×0.10 + 21×0.05 = 3.25; no refund of the unanswered call.
    reserveRequest(ledger, 1.75, 5, now());
    expect(() => reserveRequest(ledger, 0.01, 5, now())).toThrow(/Plafond/);
  });
  it("recovers a crashed job once without duplicating its world or catalogue", async () => {
    reached();
    db.insert(jobs)
      .values({ type: "generate_world", payload: '{"worldIndex":6}', status: "running" })
      .run();
    const { worker } = runtime();
    const result = await worker.tick(true);
    expect(result.recovered).toBe(1);
    expect(result.processed.outcome).toBe("done");
    const before = db.select().from(characters).all();
    await worker.tick();
    expect(db.select().from(worlds).all()).toHaveLength(1);
    expect(db.select().from(jobs).all()).toHaveLength(1);
    expect(db.select().from(characters).all()).toEqual(before);
  });
  it("rolls activation back if a companion identity already exists", async () => {
    reached();
    writeHouseholdSettings(db, { parentWorldValidation: true });
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    await runtime().worker.tick();
    db.insert(characters)
      .values({
        id: "creature:6:0",
        speciesKey: "preserved",
        nameDefault: "Existant",
        worldIndex: 6,
        rarity: "common",
        inEggPool: true,
        artRef: "preserved.png",
        story: "préservée",
      })
      .run();
    const before = db.select().from(characters).all();
    expect(() => approveWorld(db, "world:6", "parent")).toThrow();
    expect(db.select().from(worlds).get()!.status).toBe("buffered");
    expect(db.select().from(characters).all()).toEqual(before);
  });
  it("aborts publication if the child reaches the world during the last image call", async () => {
    reached();
    let calls = 0;
    const { worker } = runtime({}, undefined, (body) => {
      if (JSON.parse(body).generationConfig.responseModalities && ++calls === 9) reached(6);
    });
    await worker.tick();
    expect(db.select().from(worlds).all()).toEqual([]);
    expect(db.select().from(characters).all()).toHaveLength(41);
  });
  it("aborts activation if the child reaches fallback during vision inspection", async () => {
    reached();
    const { worker } = runtime({}, undefined, (body) => {
      if (JSON.parse(body).generationConfig.responseMimeType) reached(6);
    });
    await expect(worker.tick()).rejects.toThrow(/préservé/);
    expect(db.select().from(worlds).get()!.status).toBe("buffered");
    expect(db.select().from(jobs).get()!.status).toBe("failed");
    expect(db.select().from(characters).all()).toHaveLength(41);
  });
  it("bounds paid attempts durably across a runtime restart", async () => {
    reached();
    const config = { ...loadWorldGenConfig({}), monthlyBudgetEur: 0.45, maxRetries: 0 };
    const first = runtime({ config });
    await first.worker.tick();
    expect(first.requests).toHaveLength(4);
    expect(db.select().from(worlds).all()).toEqual([]);
    const second = runtime({ config });
    await second.worker.tick(true);
    expect(second.requests).toEqual([]);
  });
  it("protects an open map after a boss and a saved adventure without progress", () => {
    reached(4, CONFIG_DEFAULTS.map.levelsPerWorld);
    expect(lastReservedWorld(db)).toBe(5);
    const state = startAdventure(db, profileId, CONFIG_DEFAULTS.engine, CONFIG_DEFAULTS.map, 1000)!;
    db.update(adventureSessions)
      .set({ state: { ...state, worldIndex: 9, paused: true } })
      .run();
    expect(lastReservedWorld(db)).toBe(9);
  });
});

function retainLegacyPilotManifest(storage: string) {
  const row = db.select().from(worlds).get()!;
  const world = readRuntimeCatalogue(row.index, row.assetRefs, storage);
  // These tests reproduce the existing, pre-design pilot, not a modern-world QA bypass.
  const legacy = {
    ...world,
    designVersion: undefined,
    habitat: undefined,
    creatures: world.creatures.map((c) => ({ ...c, design: undefined })),
  };
  writeFileSync(
    join(storage, world.assetRefs.background.replace("-background.png", "-manifest.json")),
    JSON.stringify(legacy),
  );
}

describe("inspection-only recovery after the recorded Gemini 404", () => {
  async function failedInspection() {
    reached();
    writeHouseholdSettings(db, { parentWorldValidation: true });
    expect((await runtime({}, undefined, undefined, 404).worker.tick()).processed.outcome).toBe(
      "failed",
    );
    expect(db.select().from(jobs).get()!.lastError).toContain("HTTP 404");
    const storage = join(cwd, "storage/generated");
    retainLegacyPilotManifest(storage);
    return storage;
  }
  it("inspects the same 21 saved images with no image generation or publication", async () => {
    const storage = await failedInspection();
    const beforeWorld = db.select().from(worlds).all();
    const beforeCharacters = db.select().from(characters).all();
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body));
      expect(input.generationConfig.responseModalities).toBeUndefined();
      expect(input.generationConfig.temperature).toBeUndefined();
      expect(input.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
      expect(input.generationConfig.maxOutputTokens).toBe(8192);
      return new Response(JSON.stringify(vision()));
    });
    const inspector = createVisionInspector({
      apiKey: "unit-secret",
      model: "gemini-3.8-flash",
      style: "unit",
      readAsset: createWorldAssetStore(storage).read,
      readMaster: () => pixels,
      fetchImpl,
    });
    expect(
      (await reinspectPilotWorld(db, 6, storage, inspector, loadWorldGenConfig({}).qa)).outcome,
    ).toBe("done");
    expect(fetchImpl).toHaveBeenCalledTimes(21);
    expect(db.select().from(worlds).all()).toEqual(beforeWorld);
    expect(db.select().from(characters).all()).toEqual(beforeCharacters);
    expect(db.select().from(jobs).get()).toMatchObject({ status: "done", qaAttempts: 1 });
  });
  it("keeps a negative content verdict and refuses a second inspection attempt", async () => {
    const storage = await failedInspection();
    const inspect = vi.fn(() => ({
      detectedText: "unwanted label",
      unsafeScore: 0,
      styleScore: 1,
    }));
    expect(
      (await reinspectPilotWorld(db, 6, storage, inspect, loadWorldGenConfig({}).qa)).outcome,
    ).toBe("failed");
    await expect(
      reinspectPilotWorld(db, 6, storage, inspect, loadWorldGenConfig({}).qa),
    ).rejects.toThrow(/refus de contenu/);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(db.select().from(worlds).get()!.status).toBe("buffered");
  });
  it("preserves a world reached during inspection without validating the candidate", async () => {
    const storage = await failedInspection();
    await expect(
      reinspectPilotWorld(
        db,
        6,
        storage,
        () => {
          reached(6);
          return { detectedText: "", unsafeScore: 0, styleScore: 1 };
        },
        loadWorldGenConfig({}).qa,
      ),
    ).rejects.toThrow(/préservé/);
    expect(db.select().from(jobs).get()!.status).toBe("failed");
  });
});

describe("bounded pilot refinement after a genuine growth rejection", () => {
  async function setupRefinement() {
    reached();
    writeHouseholdSettings(db, { parentWorldValidation: true });
    await runtime(
      {},
      {
        detectedText: "",
        unsafeScore: 0.2,
        styleScore: 0.72,
        identityMatches: true,
        growthVisible: false,
      },
    ).worker.tick();
    const storage = join(cwd, "storage/generated");
    retainLegacyPilotManifest(storage);
    const before = loadRefinablePilot(db, 6, storage);
    const failedRef = before.world.creatures[0].stageArt![2];
    const good = {
      detectedText: "",
      unsafeScore: 0,
      styleScore: 1,
      identityMatches: true,
      growthVisible: true,
    };
    const updated = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#cc7788" },
    })
      .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const deps = {
      config: loadWorldGenConfig({}),
      diagnose: vi.fn((asset) =>
        asset.ref === failedRef ? { ...good, styleScore: 0, growthVisible: false } : good,
      ),
      inspectFresh: vi.fn(() => good),
      generate: vi.fn(async () => updated),
      remainingUnits: () => 2_450_000,
      onDiagnostic: vi.fn(),
      onCandidate: vi.fn(),
      onValidation: vi.fn(),
    } satisfies RefinementDeps;
    return { storage, before, deps, good };
  }
  it("replaces only failed stages in an immutable revision, freshly checks all 21 and keeps parent approval pending", async () => {
    const { storage, before, deps } = await setupRefinement();
    const charactersBefore = db.select().from(characters).all();
    const files = collectInspectableAssets(before.world).map(
      (a) => [a.ref, readFileSync(join(storage, a.ref))] as const,
    );
    const result = await refinePilotWorld(db, 6, storage, deps);
    expect(result).toMatchObject({
      outcome: "done",
      correctedImages: 1,
      inspectedImages: 21,
      published: false,
    });
    expect(deps.diagnose).toHaveBeenCalledTimes(21);
    expect(deps.inspectFresh).toHaveBeenCalledTimes(21);
    expect(deps.generate).toHaveBeenCalledTimes(1);
    for (const [ref, bytes] of files) expect(readFileSync(join(storage, ref))).toEqual(bytes);
    const row = db.select().from(worlds).get()!;
    expect(row.status).toBe("buffered");
    expect(row.assetRefs).not.toBe(before.assetRefs);
    const revised = readRuntimeCatalogue(6, row.assetRefs, storage);
    const old = readRuntimeCatalogue(6, before.assetRefs, storage);
    expect(old).toEqual(before.world);
    expect(revised.creatures.slice(1)).toEqual(old.creatures.slice(1));
    expect(revised.creatures[0].artRef).toBe(old.creatures[0].artRef);
    expect(revised.creatures[0].stageArt![3]).toBe(old.creatures[0].stageArt![3]);
    expect(revised.creatures[0].stageArt![2]).not.toBe(old.creatures[0].stageArt![2]);
    expect(deps.inspectFresh).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 3,
        ref: old.creatures[0].stageArt![3],
        previousRef: revised.creatures[0].stageArt![2],
      }),
    );
    expect(db.select().from(characters).all()).toEqual(charactersBefore);
    expect(db.select().from(jobs).get()).toMatchObject({
      status: "done",
      qaAttempts: before.job.qaAttempts + 1,
    });
    await expect(refinePilotWorld(db, 6, storage, deps)).rejects.toThrow();
  });
  it("stops before any regeneration unless the remaining budget covers the complete final QA", async () => {
    const { storage, before, deps } = await setupRefinement();
    deps.remainingUnits = () => 1_149_999;
    await expect(refinePilotWorld(db, 6, storage, deps)).rejects.toThrow(/Budget insuffisant/);
    expect(deps.diagnose).toHaveBeenCalledTimes(21);
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.inspectFresh).not.toHaveBeenCalled();
    expect(db.select().from(jobs).get()).toEqual(before.job);
  });
  it("does not automatically repair an unsafe or textual rejection revealed by the diagnostic", async () => {
    const { storage, deps, good } = await setupRefinement();
    deps.diagnose.mockImplementation(() => ({ ...good, detectedText: "label" }));
    await expect(refinePilotWorld(db, 6, storage, deps)).rejects.toThrow(/uniquement les stades/);
    expect(deps.diagnose).toHaveBeenCalledTimes(21);
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it("keeps the original failure and candidate if the fresh validation rejects any image", async () => {
    const { storage, before, deps, good } = await setupRefinement();
    deps.inspectFresh.mockImplementation(() => ({ ...good, styleScore: 0 }));
    expect((await refinePilotWorld(db, 6, storage, deps)).outcome).toBe("failed");
    expect(deps.inspectFresh).toHaveBeenCalledTimes(21);
    expect(deps.generate).toHaveBeenCalledTimes(1);
    expect(db.select().from(worlds).get()!.assetRefs).toBe(before.assetRefs);
    expect(db.select().from(jobs).get()).toEqual(before.job);
    expect(deps.onCandidate).toHaveBeenCalledTimes(1);
  });
  it("anchors a corrected adult on the corrected adolescent, preserving its canonical baby", async () => {
    const { storage, before, deps, good } = await setupRefinement();
    deps.diagnose.mockImplementation((asset) =>
      asset.babyRef === before.world.creatures[0].artRef
        ? { ...good, styleScore: 0, growthVisible: false }
        : good,
    );
    let number = 0;
    const generate = vi.fn<RefinementDeps["generate"]>(async () =>
      sharp(await deps.generate())
        .modulate({ brightness: ++number === 1 ? 0.8 : 1.1 })
        .png()
        .toBuffer(),
    );
    expect((await refinePilotWorld(db, 6, storage, { ...deps, generate })).outcome).toBe("done");
    const revised = readRuntimeCatalogue(6, db.select().from(worlds).get()!.assetRefs, storage);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].refImages?.map((r) => r.data)).toEqual([
      readFileSync(join(storage, before.world.creatures[0].artRef)),
      readFileSync(join(storage, revised.creatures[0].stageArt![2])),
    ]);
  });
  it.each([1, 21])(
    "preserves the failure if progression reaches the world at fresh inspection %i",
    async (at) => {
      const { storage, before, deps, good } = await setupRefinement();
      let calls = 0;
      deps.inspectFresh.mockImplementation(() => {
        if (++calls === at) reached(6);
        return good;
      });
      await expect(refinePilotWorld(db, 6, storage, deps)).rejects.toThrow(/préservé/);
      expect(deps.inspectFresh).toHaveBeenCalledTimes(at);
      expect(db.select().from(jobs).get()).toEqual(before.job);
      expect(db.select().from(worlds).get()!.assetRefs).toBe(before.assetRefs);
    },
  );
});

describe("storage and fail-closed boundaries", () => {
  it("uses different immutable references for retries and refuses traversal", async () => {
    const root = join(cwd, "storage/generated");
    const a = await createWorldAssetStore(root).write(6, "teddy.png", pixels);
    const b = await createWorldAssetStore(root).write(6, "teddy.png", pixels);
    expect(a).not.toBe(b);
    expect(readFileSync(join(root, a))).toEqual(readFileSync(join(root, b)));
    await expect(createWorldAssetStore(root).write(6, "../teddy.png", pixels)).rejects.toThrow();
    expect(() => createWorldAssetStore(root).read("world/../secret.png")).toThrow();
    await expect(
      createWorldAssetStore(root).write(6, "teddy.png", Buffer.from("not an image")),
    ).rejects.toThrow();
  });
  it("reserves attempts before calls, persists across restarts and fails on a corrupt ledger", () => {
    const folder = join(cwd, "budget");
    reserveRequest(folder, 0.1, 0.2, now());
    reserveRequest(folder, 0.1, 0.2, now());
    expect(() => reserveRequest(folder, 0.01, 0.2, now())).toThrow(/Plafond/);
    writeFileSync(join(folder, "2026-09", "corrupt.json"), "{}");
    expect(() => reserveRequest(folder, 0.1, 10, now())).toThrow(/illisible/);
  });
  it.each([
    {},
    { candidates: [{ finishReason: "SAFETY" }] },
    { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hello" }] } }] },
  ])("rejects incomplete/blocked vision %j", (response) => {
    expect(() => parseInspection(response)).toThrow();
  });
  it("does not expose arbitrary storage through the image route", async () => {
    const response = await GET(new Request("http://unit"), {
      params: Promise.resolve({ world: "..", file: "secrets.png" }),
    });
    expect(response.status).toBe(404);
  });
});

it("returns 404 for a syntactically valid immutable reference whose file is missing", async () => {
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  const result = await GET(new Request("http://unit"), {
    params: Promise.resolve({
      world: "7",
      file: "runtime-00000000-0000-0000-0000-000000000000-creature-0.png",
    }),
  });
  expect(result.status).toBe(404);
  expect(await result.text()).toBe("");
});
