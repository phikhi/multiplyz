import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { renewalBabies } from "../../../scripts/worldgen-renewal";
import { loadRenewalPlan } from "./creature-renewal";
import { testCreatureDesign } from "./creature-design.test-helper";
import { createWorldAssetStore, reserveRequest } from "./runtime-assets";
import { readPilotReservedUnits, readPilotTrace } from "./pilot-status";
import type { AssetInspection } from "./qa";
import { loadRenewalGrowth } from "./renewal-growth";
import { prepareRenewalGrowthRecovery } from "./renewal-growth-recovery";

vi.mock("./creature-renewal", () => ({ loadRenewalPlan: vi.fn() }));
vi.mock("./creature-design-runtime", async (original) => ({
  ...(await original<typeof import("./creature-design-runtime")>()),
  creatureHistory: () => [],
}));

let app: string, directory: string, family: Buffer, copy: Buffer;
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const pixels = (r: number) =>
  sharp({
    create: { width: 16, height: 16, channels: 4, background: { r, g: 170, b: 150, alpha: 1 } },
  })
    .extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
const preflight = vi.fn(async () => {}),
  release = vi.fn(),
  lock = vi.fn(() => release);
const run = (
  planOnly = false,
  repair = false,
  growth = false,
  resumeGrowth = false,
  faceRepair = false,
  faceRepairPass: 1 | 2 = 1,
) =>
  renewalBabies({
    app,
    worldIndex: 0,
    qaModel: "gemini-3.8-flash",
    planOnly,
    repair,
    growth,
    resumeGrowth,
    faceRepair,
    faceRepairPass,
    preflight,
    lock,
  });
const files = (suffix: string) =>
  readdirSync(join(directory, "renewal/0")).filter((f) => f.endsWith(suffix));
const result = () =>
  JSON.parse(readFileSync(join(directory, "renewal/0", files("-result.json")[0]), "utf8"));
beforeEach(async () => {
  app = mkdtempSync(join(realpathSync(tmpdir()), "teddy-renewal-run-"));
  directory = join(app, "data/teddy-world-pilot");
  mkdirSync(join(directory, "storage/worldgen/raw"), { recursive: true });
  for (const path of [join(app, "data/multiplyz.sqlite"), join(directory, "multiplyz.sqlite")]) {
    const db = new Database(path);
    db.exec("CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('preserved')");
    db.close();
  }
  family = readFileSync(join(app, "data/multiplyz.sqlite"));
  copy = readFileSync(join(directory, "multiplyz.sqlite"));
  for (const [file, previous, ceiling] of [
    ["budget-authorization.json", 5, 10],
    ["budget-authorization-30.json", 10, 30],
    ["budget-authorization-40.json", 30, 40],
  ] as const)
    json(join(directory, file), {
      version: 1,
      previousCeilingEur: previous,
      ceilingEur: ceiling,
      scope: "cumulative-pilot",
      authorizedByUser: true,
    });
  reserveRequest(join(directory, "storage/worldgen/budget"), 14, 40, new Date());
  const ref = await createWorldAssetStore(join(directory, "storage/generated")).write(
    6,
    "legendary.png",
    await pixels(200),
  );
  const plan = testCreatureDesign();
  plan.creatures.forEach((c, i) => {
    c.name = `Pilot${i}`;
  });
  vi.mocked(loadRenewalPlan).mockReturnValue({
    plan: testCreatureDesign(0, "forest"),
    recipeSha256: "recipe",
    inventoryAt: new Date().toISOString(),
    mapping: [],
    validated: {
      approvalSha256: "approved",
      inspectionRun: "inspection",
      draft: {
        plan,
        artRefs: plan.creatures.map(() => ref),
        stageArt: plan.creatures.map(() => ({ 2: ref, 3: ref })),
      },
    },
  });
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  preflight.mockClear();
  lock.mockClear();
  release.mockClear();
});
afterEach(() => {
  expect(readFileSync(join(app, "data/multiplyz.sqlite"))).toEqual(family);
  expect(readFileSync(join(directory, "multiplyz.sqlite"))).toEqual(copy);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.exitCode = 0;
  rmSync(app, { recursive: true, force: true });
});

function provider(
  failCall = 0,
  refuse = false,
  colour = 10,
  refuseAt = 0,
  signals: (call: number) => Partial<AssetInspection> = () => ({}),
  replacement?: { call: number; bytes: Buffer },
  generationReferences = 0,
) {
  let count = 0;
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
    count++;
    if (count === failCall) throw new Error("interrupted");
    const request = JSON.parse(String(init?.body));
    const image = !!request.generationConfig.responseModalities;
    if (image)
      expect(
        request.contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData),
      ).toHaveLength(generationReferences);
    else {
      const required: string[] = request.generationConfig.responseSchema.required;
      const expected = required.includes("faceReadable")
        ? required.includes("identityMatches")
          ? 8
          : 6
        : 4;
      expect(
        request.contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData),
      ).toHaveLength(expected); // target, optional endpoints/thumbnail, complete history and final peers
    }
    const part = image
      ? {
          inlineData: {
            mimeType: "image/png",
            data: (replacement?.call === count
              ? replacement.bytes
              : await pixels(colour + count)
            ).toString("base64"),
          },
        }
      : {
          text: JSON.stringify({
            detectedText: "",
            unsafeScore: 0,
            styleScore: 0.95,
            habitatMatches: true,
            visuallyDistinct: !refuse && count !== refuseAt,
            identityMatches: true,
            growthVisible: true,
            faceReadable: true,
            ...signals(count),
          }),
        };
    return new Response(
      JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [part] } }] }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it("runs seven babies plus seven real inspection requests, checkpoints all work and blocks a second launch", async () => {
  const fetcher = provider();
  await run();
  expect(fetcher).toHaveBeenCalledTimes(14);
  expect(result()).toMatchObject({
    outcome: "passed-for-visual-review",
    images: 7,
    published: false,
    databaseWritten: false,
    growthGenerated: false,
    reservedEur: 15.05,
  });
  expect(files(".json").filter((f) => /-draft-\d/.test(f))).toHaveLength(7);
  expect(files(".json").filter((f) => /-check-\d/.test(f))).toHaveLength(7);
  expect(readdirSync(join(directory, "storage/worldgen/raw"))).toHaveLength(7);
  expect(readPilotReservedUnits(directory)).toBe(15_050_000);
  await expect(run()).rejects.toThrow(/déjà été engag/);
  expect(fetcher).toHaveBeenCalledTimes(14);
  expect(release).toHaveBeenCalledTimes(2);
});
it.each([
  [2, 1, 0, 14_200_000],
  [9, 7, 1, 14_800_000],
])(
  "keeps partial images, diagnostics and reservations when request %i fails",
  async (call, images, checks, units) => {
    const fetcher = provider(call);
    await expect(run()).rejects.toThrow("interrupted");
    expect(fetcher).toHaveBeenCalledTimes(call);
    expect(result()).toMatchObject({
      outcome: "stopped",
      imagesSaved: images,
      inspectionsSaved: checks,
      published: false,
      databaseWritten: false,
    });
    expect(readPilotReservedUnits(directory)).toBe(units);
    expect(readPilotTrace(directory).filter((e) => e.type)).toHaveLength(call);
    expect(files("-check-1.json")).toHaveLength(checks);
    expect(release).toHaveBeenCalledOnce();
  },
);
it("retains a visual originality rejection instead of publishing or retrying", async () => {
  const fetcher = provider(0, true);
  await run();
  expect(result()).toMatchObject({ outcome: "rejected", published: false });
  expect(fetcher).toHaveBeenCalledTimes(14);
  expect(process.exitCode).toBe(1);
});
it("plans without API or lock and rejects insufficient cumulative funds before any request", async () => {
  const fetcher = provider();
  await run(true);
  expect(lock).not.toHaveBeenCalled();
  expect(preflight).not.toHaveBeenCalled();
  reserveRequest(join(directory, "storage/worldgen/budget"), 25, 40, new Date());
  await expect(run()).rejects.toThrow(/Budget insuffisant/);
  expect(fetcher).not.toHaveBeenCalled();
  expect(preflight).not.toHaveBeenCalled();
  expect(existsSync(join(directory, "renewal/0/babies-started.json"))).toBe(false);
});

async function prepareRepair() {
  provider(0, false, 10, 13); // Seven images, then only the sixth baby fails originality.
  await run();
  process.exitCode = 0;
  const folder = join(directory, "renewal/0");
  const marker = JSON.parse(readFileSync(join(folder, "babies-started.json"), "utf8"));
  const sourceRun = marker.runId;
  const draft = JSON.parse(readFileSync(join(folder, `${sourceRun}-draft.json`), "utf8"));
  const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
  const sha = (name: string) => hash(readFileSync(join(folder, name)));
  json(join(folder, "baby-visual-review.json"), {
    sourceRun,
    visualApproved: true,
    qaPassed: false,
  });
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  json(join(folder, "baby-repair-plan.json"), {
    version: 1,
    worldIndex: 0,
    sourceRun,
    slot: 5,
    sourceRecipeSha256: "recipe",
    markerSha256: sha("babies-started.json"),
    draftSha256: sha(`${sourceRun}-draft.json`),
    resultSha256: sha(`${sourceRun}-result.json`),
    visualReviewSha256: sha("baby-visual-review.json"),
    traceSha256: hash(JSON.stringify(trace)),
    arts: draft.artRefs.map((ref: string) => ({
      ref,
      sha256: hash(readFileSync(join(directory, "storage/generated", ref))),
    })),
    creature: {
      ...draft.plan.creatures[5],
      anatomy:
        "A compact flattened wingless ground hopper with an integrated small cream face and a broad amber tail fan",
    },
  });
  return { sourceRun, draft, folder };
}
const repairResult = () => {
  const folder = join(directory, "renewal/0");
  const { runId } = JSON.parse(readFileSync(join(folder, "baby-repair-started.json"), "utf8"));
  return JSON.parse(readFileSync(join(folder, `${runId}-result.json`), "utf8"));
};
it("repairs one baby, retains six exact refs, inspects the repaired baby first and rechecks its peers", async () => {
  const { draft, folder, sourceRun } = await prepareRepair();
  const before = draft.artRefs.map((ref: string) =>
    readFileSync(join(directory, "storage/generated", ref)),
  );
  const fetcher = provider(0, false, 40);
  await run(false, true);
  const result = repairResult();
  expect(fetcher).toHaveBeenCalledTimes(8);
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    generatedImages: 1,
    reusedImages: 6,
    inspectedImages: 7,
    fullValidation: true,
    reservedEur: 15.5,
    published: false,
    databaseWritten: false,
    sourceRun,
  });
  const { runId } = JSON.parse(readFileSync(join(folder, "baby-repair-started.json"), "utf8"));
  const updated = JSON.parse(readFileSync(join(folder, `${runId}-draft.json`), "utf8"));
  expect(updated.artRefs[5]).not.toBe(draft.artRefs[5]);
  for (let i = 0; i < 7; i++) {
    expect(readFileSync(join(directory, "storage/generated", draft.artRefs[i]))).toEqual(before[i]);
    if (i !== 5) expect(updated.artRefs[i]).toBe(draft.artRefs[i]);
  }
  const first = JSON.parse(readFileSync(join(folder, `${runId}-check-1.json`), "utf8"));
  expect(first.ref).toBe(updated.artRefs[5]);
  await expect(run(false, true)).rejects.toThrow(/déjà été engag/);
  expect(fetcher).toHaveBeenCalledTimes(8);
});
it("stops after the repaired baby's refusal, preserves the attempt and never spends on the other six inspections", async () => {
  await prepareRepair();
  const fetcher = provider(0, true, 40);
  await run(false, true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(repairResult()).toMatchObject({
    outcome: "rejected",
    inspectedImages: 1,
    fullValidation: false,
    reusedImages: 6,
    reservedEur: 15.2,
    published: false,
  });
});
it("does not label the cast validated when an unchanged peer rejects its new neighbour", async () => {
  await prepareRepair();
  provider(0, false, 40, 3); // Target passes, next peer rejects.
  await run(false, true);
  expect(repairResult()).toMatchObject({
    outcome: "rejected",
    inspectedImages: 7,
    fullValidation: false,
    published: false,
  });
});
it("checks all correction funds and source pixels before any API request", async () => {
  const { draft } = await prepareRepair();
  const fetcher = provider(0, false, 40);
  await run(true, true);
  expect(fetcher).not.toHaveBeenCalled();
  reserveRequest(join(directory, "storage/worldgen/budget"), 24.55, 40, new Date());
  await expect(run(false, true)).rejects.toThrow(/Budget insuffisant/);
  writeFileSync(join(directory, "storage/generated", draft.artRefs[0]), "changed");
  await expect(run(false, true)).rejects.toThrow(/arts conservés/);
  expect(fetcher).not.toHaveBeenCalled();
  expect(existsSync(join(directory, "renewal/0/baby-repair-started.json"))).toBe(false);
});

async function prepareGrowth() {
  const { folder } = await prepareRepair();
  provider(0, false, 40);
  await run(false, true);
  const sourceRun = JSON.parse(
    readFileSync(join(folder, "baby-repair-started.json"), "utf8"),
  ).runId;
  const draft = JSON.parse(readFileSync(join(folder, `${sourceRun}-draft.json`), "utf8"));
  const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
  const sha = (file: string) => hash(readFileSync(join(folder, file)));
  json(join(folder, "babies-approved.json"), {
    visualApproved: true,
    scope: "world-babies",
    sourceRun,
  });
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s))
    .filter((e) => e.runId === sourceRun);
  json(join(folder, "growth-plan.json"), {
    version: 1,
    worldIndex: 0,
    method: "description-only-growth",
    sourceRun,
    correctionRecipeSha256: sha("baby-repair-plan.json"),
    approvalSha256: sha("babies-approved.json"),
    markerSha256: sha("baby-repair-started.json"),
    draftSha256: sha(`${sourceRun}-draft.json`),
    resultSha256: sha(`${sourceRun}-result.json`),
    traceSha256: hash(JSON.stringify(trace)),
    arts: draft.artRefs.map((ref: string) => ({
      ref,
      sha256: hash(readFileSync(join(directory, "storage/generated", ref))),
    })),
    creatures: draft.plan.creatures.map((c: { name: string }, slot: number) => ({
      slot,
      name: c.name,
      adolescent: `JUVENILE ${c.name}: ${"Intermediate proportions, unfolded existing structures, friendly cream face. ".repeat(3)}`,
      adult: `MATURE ${c.name}: ${"Very long mature torso, small readable face, fully developed existing structures. ".repeat(3)}`,
    })),
  });
  return { folder, sourceRun, draft };
}
const growthResult = () => {
  const folder = join(directory, "renewal/0");
  const { runId } = JSON.parse(readFileSync(join(folder, "growth-started.json"), "utf8"));
  return { runId, result: JSON.parse(readFileSync(join(folder, `${runId}-result.json`), "utf8")) };
};
it("generates fourteen text-only older forms, preserves seven babies and validates all 21 final images with both endpoints", async () => {
  const { folder, draft } = await prepareGrowth();
  const saved = draft.artRefs.map((ref: string) =>
    readFileSync(join(directory, "storage/generated", ref)),
  );
  const fetcher = provider(0, false, 60);
  await run(true, false, true);
  expect(fetcher).not.toHaveBeenCalled();
  await run(false, false, true);
  expect(fetcher).toHaveBeenCalledTimes(35);
  const { runId, result } = growthResult();
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    images: 21,
    inspectedImages: 21,
    fullValidation: true,
    generatedImages: 14,
    reusedBabies: 7,
    published: false,
    databaseWritten: false,
    reservedEur: 17.95,
  });
  const grown = JSON.parse(readFileSync(join(folder, `${runId}-draft.json`), "utf8"));
  expect(grown.artRefs).toEqual(draft.artRefs);
  draft.artRefs.forEach((ref: string, i: number) =>
    expect(readFileSync(join(directory, "storage/generated", ref))).toEqual(saved[i]),
  );
  expect(result.checks).toHaveLength(21);
  expect(new Set(result.checks.map((c: { ref: string }) => c.ref)).size).toBe(21);
  expect(files(".json").filter((f) => f.startsWith(runId) && /-draft-\d/.test(f))).toHaveLength(15);
  const html = readFileSync(result.preview, "utf8");
  expect(html.match(/<img /g)).toHaveLength(21);
  expect(html).not.toContain('class="pending"');
  await expect(run(false, false, true)).rejects.toThrow(/déjà été engag/);
  expect(fetcher).toHaveBeenCalledTimes(35);
});
it.each(["growthVisible", "faceReadable"] as const)(
  "keeps a %s refusal despite all the other positive signals",
  async (field) => {
    await prepareGrowth();
    const fetcher = provider(0, false, 60, 0, (call) => (call === 16 ? { [field]: false } : {}));
    await run(false, false, true);
    expect(fetcher).toHaveBeenCalledTimes(35);
    expect(growthResult().result).toMatchObject({
      outcome: "rejected",
      inspectedImages: 21,
      fullValidation: false,
      published: false,
    });
  },
);
it("checkpoints completed adults and retains charged failed requests when growth is interrupted", async () => {
  const { folder } = await prepareGrowth();
  const fetcher = provider(3, false, 60);
  await expect(run(false, false, true)).rejects.toThrow("interrupted");
  expect(fetcher).toHaveBeenCalledTimes(3);
  const { runId, result } = growthResult();
  expect(result).toMatchObject({
    outcome: "stopped",
    imagesSaved: 2,
    inspectionsSaved: 0,
    published: false,
    reservedEur: 15.8,
  });
  expect(existsSync(join(folder, `${runId}-draft-2.json`))).toBe(true);
  expect(existsSync(join(folder, `${runId}-draft.json`))).toBe(false);
});
it("blocks growth before any API if full funds are missing or an approved baby was changed", async () => {
  const { draft } = await prepareGrowth();
  const fetcher = provider(0, false, 60);
  reserveRequest(join(directory, "storage/worldgen/budget"), 22.06, 40, new Date());
  await expect(run(false, false, true)).rejects.toThrow(/Budget insuffisant/);
  writeFileSync(join(directory, "storage/generated", draft.artRefs[5]), "changed");
  await expect(run(false, false, true)).rejects.toThrow(/Pixels ou verdicts des bébés modifiés/);
  expect(fetcher).not.toHaveBeenCalled();
  expect(existsSync(join(directory, "renewal/0/growth-started.json"))).toBe(false);
});

async function prepareInterruptedGrowth() {
  const { folder } = await prepareGrowth();
  const framed = await sharp(
    Buffer.from(
      '<svg width="256" height="256"><rect width="256" height="256" fill="white"/><rect x="2" y="2" width="252" height="252" rx="8" fill="white" stroke="#999" stroke-width="1"/><ellipse cx="130" cy="130" rx="65" ry="40" fill="#b27248"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  provider(0, false, 60, 0, () => ({}), { call: 6, bytes: framed });
  await expect(run(false, false, true)).rejects.toThrow(/Détourage non fiable/);
  const stopped = growthResult();
  const renewal = vi.mocked(loadRenewalPlan).mock.results[0].value as ReturnType<
    typeof loadRenewalPlan
  >;
  const recovered = await prepareRenewalGrowthRecovery(
    directory,
    loadRenewalGrowth(directory, renewal),
    {
      left: 16,
      top: 16,
      width: 224,
      height: 224,
    },
  );
  expect(readPilotReservedUnits(directory)).toBe(16_100_000);
  return { folder, stopped, recovered };
}
it("resumes only eight missing ages, preserves the six recovered adults and validates all 21 images", async () => {
  const { folder, stopped, recovered } = await prepareInterruptedGrowth();
  const originalFiles = Object.fromEntries(
    readdirSync(folder)
      .filter((f) => f.startsWith(stopped.runId) || f === "growth-started.json")
      .map((f) => [f, readFileSync(join(folder, f))]),
  );
  const savedRefs = [
    ...recovered.draft.artRefs,
    ...recovered.draft.stageArt.flatMap((ages) => Object.values(ages)),
  ];
  const savedPixels = savedRefs.map((ref) =>
    readFileSync(join(directory, "storage/generated", ref)),
  );
  const fetcher = provider(0, false, 90);
  preflight.mockClear();
  await run(true, false, true, true);
  expect(fetcher).not.toHaveBeenCalled();
  expect(preflight).not.toHaveBeenCalled();
  expect(existsSync(join(folder, "growth-resume-started.json"))).toBe(false);
  // Enough for the remaining work only: a restart of all fourteen would exceed this budget.
  reserveRequest(join(directory, "storage/worldgen/budget"), 22.05, 40, new Date());
  await run(false, false, true, true);
  expect(fetcher).toHaveBeenCalledTimes(29);
  const { runId } = JSON.parse(readFileSync(join(folder, "growth-resume-started.json"), "utf8"));
  const result = JSON.parse(readFileSync(join(folder, `${runId}-result.json`), "utf8"));
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    generatedImages: 8,
    reusedBabies: 7,
    reusedOlderStages: 6,
    fullValidation: true,
    inspectedImages: 21,
    published: false,
    databaseWritten: false,
    reservedEur: 40,
    interruptedRun: stopped.runId,
  });
  const final = JSON.parse(readFileSync(join(folder, `${runId}-draft.json`), "utf8"));
  expect(final.artRefs).toEqual(recovered.draft.artRefs);
  recovered.draft.stageArt.forEach((ages, i) => {
    if (ages[3]) expect(final.stageArt[i][3]).toBe(ages[3]);
  });
  expect(
    readdirSync(folder).filter((f) => f.startsWith(runId) && /-draft-\d/.test(f)),
  ).toHaveLength(9);
  expect(readFileSync(result.preview, "utf8").match(/<img /g)).toHaveLength(21);
  savedRefs.forEach((ref, i) =>
    expect(readFileSync(join(directory, "storage/generated", ref))).toEqual(savedPixels[i]),
  );
  Object.entries(originalFiles).forEach(([file, bytes]) =>
    expect(readFileSync(join(folder, file))).toEqual(bytes),
  );
  await expect(run(false, false, true, true)).rejects.toThrow(/déjà été engag/);
  expect(fetcher).toHaveBeenCalledTimes(29);
});
it("blocks a resume with changed recovered pixels before spending, then checkpoints a new interruption", async () => {
  const { folder, recovered } = await prepareInterruptedGrowth();
  const path = join(directory, "storage/generated", recovered.draft.stageArt[5][3]!);
  const bytes = readFileSync(path);
  writeFileSync(path, "changed");
  const fetcher = provider(2, false, 90);
  preflight.mockClear();
  await expect(run(false, false, true, true)).rejects.toThrow(/Pixels du groupe récupéré modifiés/);
  expect(fetcher).not.toHaveBeenCalled();
  expect(preflight).not.toHaveBeenCalled();
  expect(existsSync(join(folder, "growth-resume-started.json"))).toBe(false);
  writeFileSync(path, bytes);
  await expect(run(false, false, true, true)).rejects.toThrow("interrupted");
  expect(fetcher).toHaveBeenCalledTimes(2);
  const { runId } = JSON.parse(readFileSync(join(folder, "growth-resume-started.json"), "utf8"));
  const result = JSON.parse(readFileSync(join(folder, `${runId}-result.json`), "utf8"));
  expect(result).toMatchObject({
    outcome: "stopped",
    imagesSaved: 7,
    newlySavedImages: 1,
    reusedOlderStages: 6,
    inspectionsSaved: 0,
    reservedEur: 16.3,
    published: false,
  });
  expect(existsSync(join(folder, `${runId}-draft-7.json`))).toBe(true);
  expect(existsSync(join(folder, `${runId}-draft.json`))).toBe(false);
});

async function prepareFaceRepair() {
  const { folder, recovered } = await prepareInterruptedGrowth();
  provider(0, false, 90, 0, (call) => (call === 14 ? { faceReadable: false } : {}));
  await run(false, false, true, true);
  const { runId } = JSON.parse(readFileSync(join(folder, "growth-resume-started.json"), "utf8"));
  const draft = JSON.parse(readFileSync(join(folder, `${runId}-draft.json`), "utf8"));
  const result = JSON.parse(readFileSync(join(folder, `${runId}-result.json`), "utf8"));
  expect(result.fullValidation).toBe(false);
  expect(result.checks.filter((c: { verdict: { ok: boolean } }) => !c.verdict.ok)).toHaveLength(1);
  const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
  const sha = (file: string) => hash(readFileSync(join(folder, file)));
  json(join(folder, "growth-visual-review.json"), {
    sourceRun: runId,
    visualApproved: true,
    qaPassed: false,
  });
  const refs: string[] = draft.artRefs.flatMap((ref: string, i: number) => [
    ref,
    draft.stageArt[i][2],
    draft.stageArt[i][3],
  ]);
  json(join(folder, "face-repair-plan.json"), {
    version: 1,
    worldIndex: 0,
    method: "adult-face-edit",
    slot: 1,
    stage: 3,
    sourceRun: runId,
    recoveryRecipeSha256: recovered.recipeSha256,
    prompt:
      "Edit only the adult face: turn toward the viewer, show two expressive brown eyes and a readable mouth at 128px. Preserve its developed body, shell, legs and colours.",
    markerSha256: sha("growth-resume-started.json"),
    draftSha256: sha(`${runId}-draft.json`),
    resultSha256: sha(`${runId}-result.json`),
    visualReviewSha256: sha("growth-visual-review.json"),
    traceSha256: hash(
      JSON.stringify(readPilotTrace(directory).filter((e) => "runId" in e && e.runId === runId)),
    ),
    arts: refs.map((ref) => ({
      ref,
      sha256: hash(readFileSync(join(directory, "storage/generated", ref))),
    })),
  });
  return { folder, sourceRun: runId, draft, refs };
}
it("edits only the refused adult, inspects its three ages first, then validates all 21 and preserves twenty refs", async () => {
  const { folder, sourceRun, refs, draft } = await prepareFaceRepair();
  const oldResult = readFileSync(join(folder, `${sourceRun}-result.json`));
  const before = refs.map((ref) => readFileSync(join(directory, "storage/generated", ref)));
  const fetcher = provider(0, false, 150, 0, () => ({}), undefined, 1);
  preflight.mockClear();
  await run(true, false, true, false, true);
  expect(fetcher).not.toHaveBeenCalled();
  expect(preflight).not.toHaveBeenCalled();
  await run(false, false, true, false, true);
  expect(fetcher).toHaveBeenCalledTimes(22);
  const { runId } = JSON.parse(readFileSync(join(folder, "face-repair-started.json"), "utf8"));
  const result = JSON.parse(readFileSync(join(folder, `${runId}-result.json`), "utf8"));
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    generatedImages: 1,
    reusedImages: 20,
    inspectedImages: 21,
    fullValidation: true,
    reservedEur: 19.1,
    published: false,
    databaseWritten: false,
    sourceRun,
  });
  for (let n = 1; n <= 3; n++)
    expect(JSON.parse(readFileSync(join(folder, `${runId}-check-${n}.json`), "utf8")).slot).toBe(1);
  const final = JSON.parse(readFileSync(join(folder, `${runId}-draft.json`), "utf8"));
  expect(final.stageArt[1][3]).not.toBe(draft.stageArt[1][3]);
  final.stageArt[1][3] = draft.stageArt[1][3];
  expect(final).toEqual(draft);
  refs.forEach((ref, i) =>
    expect(readFileSync(join(directory, "storage/generated", ref))).toEqual(before[i]),
  );
  expect(readFileSync(join(folder, `${sourceRun}-result.json`))).toEqual(oldResult);
  await expect(run(false, false, true, false, true)).rejects.toThrow(/déjà été engag/);
  expect(fetcher).toHaveBeenCalledTimes(22);
}, 15000);
it("retains a second face refusal and stops after the three priority inspections", async () => {
  const { folder } = await prepareFaceRepair();
  const fetcher = provider(
    0,
    false,
    150,
    0,
    (call) => (call === 4 ? { faceReadable: false } : {}),
    undefined,
    1,
  );
  await run(false, false, true, false, true);
  expect(fetcher).toHaveBeenCalledTimes(4);
  const { runId } = JSON.parse(readFileSync(join(folder, "face-repair-started.json"), "utf8"));
  expect(JSON.parse(readFileSync(join(folder, `${runId}-result.json`), "utf8"))).toMatchObject({
    outcome: "rejected",
    inspectedImages: 3,
    fullValidation: false,
    reservedEur: 18.2,
    published: false,
  });
});
it("blocks face repair before any API if its complete budget is absent or a source stage changes", async () => {
  const { folder, refs } = await prepareFaceRepair();
  const fetcher = provider(0, false, 150, 0, () => ({}), undefined, 1);
  preflight.mockClear();
  reserveRequest(join(directory, "storage/worldgen/budget"), 20.91, 40, new Date());
  await expect(run(false, false, true, false, true)).rejects.toThrow(/Budget insuffisant/);
  writeFileSync(join(directory, "storage/generated", refs[4]), "changed");
  await expect(run(false, false, true, false, true)).rejects.toThrow(/visage refusé/);
  expect(fetcher).not.toHaveBeenCalled();
  expect(preflight).not.toHaveBeenCalled();
  expect(existsSync(join(folder, "face-repair-started.json"))).toBe(false);
});

async function prepareSecondFaceRepair() {
  const { folder } = await prepareFaceRepair();
  provider(0, false, 150, 0, (call) => (call === 13 ? { faceReadable: false } : {}), undefined, 1);
  await run(false, false, true, false, true);
  const { runId } = JSON.parse(readFileSync(join(folder, "face-repair-started.json"), "utf8"));
  const draft = JSON.parse(readFileSync(join(folder, `${runId}-draft.json`), "utf8"));
  const result = JSON.parse(readFileSync(join(folder, `${runId}-result.json`), "utf8"));
  expect(result.checks.filter((c: { verdict: { ok: boolean } }) => !c.verdict.ok)).toMatchObject([
    { slot: 3, stage: 3 },
  ]);
  const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
  const sha = (file: string) => hash(readFileSync(join(folder, file)));
  const first = JSON.parse(readFileSync(join(folder, "face-repair-plan.json"), "utf8"));
  json(join(folder, "face-repair-2-review.json"), {
    sourceRun: runId,
    visualApproved: true,
    qaPassed: false,
  });
  const refs: string[] = draft.artRefs.flatMap((ref: string, i: number) => [
    ref,
    draft.stageArt[i][2],
    draft.stageArt[i][3],
  ]);
  json(join(folder, "face-repair-2-plan.json"), {
    ...first,
    slot: 3,
    sourceRun: runId,
    previousRecipeSha256: sha("face-repair-plan.json"),
    prompt:
      "Edit only the bird's adult head: show both eyes and a friendly readable beak at 128px. Preserve its long neck, adult proportions and plumage. Never change the beetle already corrected.",
    markerSha256: sha("face-repair-started.json"),
    draftSha256: sha(`${runId}-draft.json`),
    resultSha256: sha(`${runId}-result.json`),
    visualReviewSha256: sha("face-repair-2-review.json"),
    traceSha256: hash(
      JSON.stringify(readPilotTrace(directory).filter((e) => "runId" in e && e.runId === runId)),
    ),
    arts: refs.map((ref) => ({
      ref,
      sha256: hash(readFileSync(join(directory, "storage/generated", ref))),
    })),
  });
  return { folder, runId, draft, refs };
}
it("chains a second distinct face correction, preserves the first corrected adult and checks the new target first", async () => {
  const { folder, runId: sourceRun, draft, refs } = await prepareSecondFaceRepair();
  const previous = readFileSync(join(folder, `${sourceRun}-result.json`));
  const pixels = refs.map((ref) => readFileSync(join(directory, "storage/generated", ref)));
  const fetcher = provider(0, false, 175, 0, () => ({}), undefined, 1);
  const recipePath = join(folder, "face-repair-2-plan.json"),
    bytes = readFileSync(recipePath);
  const recipe = JSON.parse(bytes.toString());
  json(recipePath, { ...recipe, previousRecipeSha256: "changed" });
  await expect(run(false, false, true, false, true, 2)).rejects.toThrow(
    /Plan de correction du visage invalide/,
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(existsSync(join(folder, "face-repair-2-started.json"))).toBe(false);
  writeFileSync(recipePath, bytes);
  await run(true, false, true, false, true, 2);
  expect(fetcher).not.toHaveBeenCalled();
  await run(false, false, true, false, true, 2);
  expect(fetcher).toHaveBeenCalledTimes(22);
  const { runId } = JSON.parse(readFileSync(join(folder, "face-repair-2-started.json"), "utf8"));
  const result = JSON.parse(readFileSync(join(folder, `${runId}-result.json`), "utf8"));
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    fullValidation: true,
    inspectedImages: 21,
    generatedImages: 1,
    reusedImages: 20,
    repairedSlot: 3,
    reservedEur: 20.25,
    sourceRun,
    published: false,
    databaseWritten: false,
  });
  const final = JSON.parse(readFileSync(join(folder, `${runId}-draft.json`), "utf8"));
  expect(final.stageArt[1][3]).toBe(draft.stageArt[1][3]);
  expect(final.stageArt[3][3]).not.toBe(draft.stageArt[3][3]);
  final.stageArt[3][3] = draft.stageArt[3][3];
  expect(final).toEqual(draft);
  for (let i = 1; i <= 3; i++)
    expect(JSON.parse(readFileSync(join(folder, `${runId}-check-${i}.json`), "utf8")).slot).toBe(3);
  refs.forEach((ref, i) =>
    expect(readFileSync(join(directory, "storage/generated", ref))).toEqual(pixels[i]),
  );
  expect(readFileSync(join(folder, `${sourceRun}-result.json`))).toEqual(previous);
  await expect(run(false, false, true, false, true, 2)).rejects.toThrow(/déjà été engag/);
  expect(fetcher).toHaveBeenCalledTimes(22);
}, 15000);
it("does not merge earlier positive QA into a new refused second correction", async () => {
  const { folder } = await prepareSecondFaceRepair();
  const fetcher = provider(
    0,
    false,
    175,
    0,
    (call) => (call === 4 ? { faceReadable: false } : {}),
    undefined,
    1,
  );
  await run(false, false, true, false, true, 2);
  expect(fetcher).toHaveBeenCalledTimes(4);
  const { runId } = JSON.parse(readFileSync(join(folder, "face-repair-2-started.json"), "utf8"));
  expect(JSON.parse(readFileSync(join(folder, `${runId}-result.json`), "utf8"))).toMatchObject({
    outcome: "rejected",
    inspectedImages: 3,
    fullValidation: false,
    reservedEur: 19.35,
    published: false,
  });
}, 15000);
