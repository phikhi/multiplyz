import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { loadWorldGenConfig } from "@/config/server-config";
import { testCreatureDesign } from "./creature-design.test-helper";
import type { CastGrowthDraft } from "./creature-cast-growth";
import type { AssetInspection, InspectableAsset } from "./qa";
import type { GenerateImageInput } from "./image-client";
import { createWorldAssetStore } from "./runtime-assets";
import { loadGrowthProof, previewAdultGrowthProof } from "./pilot-growth-proof";
import {
  loadAdolescentProof,
  loadClarifiedAdolescentProof,
  previewAdolescentGrowthProof,
} from "./pilot-growth-adolescent";
import {
  loadArbeluneRepair,
  previewArbeluneRepair,
  loadArbeluneAdolescent,
  previewArbeluneAdolescent,
} from "./pilot-arbelune-repair";
import {
  loadArbeluneStudy,
  loadArbeluneStudyAnatomy,
  previewArbeluneStudy,
} from "./pilot-arbelune-study";
import {
  extractStudyStage,
  prepareStudyStages,
  loadStudyStages,
  inspectStudyStages,
} from "./pilot-study-stages";
import { createVisionInspector } from "./vision-inspector";
import { prepareCastRecovery, loadCastRecovery, inspectRecoveredCast } from "./pilot-cast-recovery";
import { loadCastCompletion, previewCastCompletion } from "./pilot-cast-completion";

let directory: string, storage: string, cast: CastGrowthDraft;
const run = "00000000-0000-0000-0000-000000000000";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const pixels = (r: number) =>
  sharp({
    create: { width: 8, height: 8, channels: 4, background: { r, g: 150, b: 120, alpha: 1 } },
  })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

beforeEach(async () => {
  directory = mkdtempSync(join(realpathSync(tmpdir()), "teddy-growth-proof-"));
  storage = join(directory, "storage/generated");
  mkdirSync(join(directory, "cast-redesigns"));
  const store = createWorldAssetStore(storage);
  cast = { plan: testCreatureDesign(), artRefs: [], stageArt: [] };
  for (let i = 0; i < 6; i++) {
    cast.artRefs.push(await store.write(6, `creature-${i}.png`, await pixels(i * 3 + 1)));
    cast.stageArt.push({
      2: await store.write(6, `creature-${i}-ado.png`, await pixels(i * 3 + 2)),
      3: await store.write(6, `creature-${i}-adulte.png`, await pixels(i * 3 + 3)),
    });
  }
  const refs = cast.artRefs.flatMap((ref, i) => [ref, cast.stageArt[i][2]!, cast.stageArt[i][3]!]);
  const draftPath = join(directory, "cast-redesigns", `${run}-draft-12.json`);
  const resultPath = join(directory, "cast-redesigns", `${run}-result.json`);
  save(draftPath, cast);
  save(resultPath, {
    outcome: "rejected",
    checks: refs.map((ref, i) => ({ ref, slot: Math.floor(i / 3), stage: (i % 3) + 1 })),
  });
  save(join(directory, "growth-proof-plan.json"), {
    version: 1,
    method: "description-only-adult",
    name: cast.plan.creatures[0].name,
    slot: 0,
    sourceRun: run,
    draftSha256: hash(readFileSync(draftPath)),
    resultSha256: hash(readFileSync(resultPath)),
    sourceArts: refs.map((ref) => ({ ref, sha256: hash(store.read(ref)) })),
    prompt:
      "A mature climbing creature, long developed body, leaf feet and a split slender tail, warm colours and a welcoming friendly expression.",
  });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function deps() {
  return {
    config: loadWorldGenConfig({}),
    remainingUnits: () => 150_000,
    generate: vi.fn<(input: GenerateImageInput) => Promise<Buffer>>(async () => pixels(120)),
    inspect: vi.fn<(asset: InspectableAsset, draft: CastGrowthDraft) => Promise<AssetInspection>>(
      async () => ({
        identityMatches: true,
        growthVisible: true,
        habitatMatches: true,
        visuallyDistinct: true,
        detectedText: "",
        unsafeScore: 0,
        styleScore: 0.95,
      }),
    ),
    onDraft: vi.fn(),
    onCheck: vi.fn(),
  };
}
it("limits the experiment to one text-only adult, but retains real references and all peers for fresh QA", async () => {
  const proof = loadGrowthProof(directory, cast),
    handlers = deps();
  const before = JSON.stringify(proof.source);
  const store = createWorldAssetStore(storage);
  const oldPixels = proof.source.artRefs.map(store.read);
  const result = await previewAdultGrowthProof(proof, storage, handlers);
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    generatedImages: 1,
    published: false,
    growthGenerated: false,
  });
  expect(handlers.generate).toHaveBeenCalledExactlyOnceWith({ prompt: proof.prompt });
  expect(handlers.inspect).toHaveBeenCalledTimes(1);
  const [asset, inspected] = handlers.inspect.mock.calls[0];
  expect(asset).toMatchObject({
    stage: 3,
    babyRef: cast.artRefs[0],
    previousRef: cast.stageArt[0][2],
  });
  expect(asset.ref).not.toBe(cast.stageArt[0][3]);
  expect(inspected.stageArt.slice(1)).toEqual(cast.stageArt.slice(1));
  expect(inspected.artRefs).toEqual(cast.artRefs);
  expect(JSON.stringify(proof.source)).toBe(before);
  expect(proof.source.artRefs.map(store.read)).toEqual(oldPixels);
});
it.each(["identityMatches", "growthVisible", "habitatMatches", "visuallyDistinct"] as const)(
  "rejects %s=false even with a perfect style score; never generates again",
  async (signal) => {
    const handlers = deps();
    handlers.inspect.mockResolvedValue({
      detectedText: "",
      unsafeScore: 0,
      styleScore: 1,
      identityMatches: true,
      growthVisible: true,
      habitatMatches: true,
      visuallyDistinct: true,
      [signal]: false,
    });
    const result = await previewAdultGrowthProof(
      loadGrowthProof(directory, cast),
      storage,
      handlers,
    );
    expect(result.outcome).toBe("rejected");
    expect(handlers.generate).toHaveBeenCalledTimes(1);
  },
);
it("requires both requests' budget before generating", async () => {
  const handlers = deps();
  handlers.remainingUnits = () => 149_999;
  await expect(
    previewAdultGrowthProof(loadGrowthProof(directory, cast), storage, handlers),
  ).rejects.toThrow(/Budget insuffisant/);
  expect(handlers.generate).not.toHaveBeenCalled();
});
it("keeps the new pixels checkpointed if QA fails, with no retry or publication", async () => {
  const handlers = deps();
  handlers.inspect.mockRejectedValue(new Error("HTTP 503"));
  await expect(
    previewAdultGrowthProof(loadGrowthProof(directory, cast), storage, handlers),
  ).rejects.toThrow("HTTP 503");
  expect(handlers.onDraft).toHaveBeenCalledTimes(1);
  expect(handlers.generate).toHaveBeenCalledTimes(1);
  expect(
    createWorldAssetStore(storage).read(handlers.onDraft.mock.calls[0][0].stageArt[0][3]),
  ).toBeInstanceOf(Buffer);
});
it("refuses edited source pixels before any request", () => {
  writeFileSync(join(storage, cast.stageArt[1][3]!), "changed");
  expect(() => loadGrowthProof(directory, cast)).toThrow(/Art source/);
});
it("refuses a modified source result or a different approved cast", () => {
  expect(() =>
    loadGrowthProof(directory, { ...cast, artRefs: [...cast.artRefs].reverse() }),
  ).toThrow(/Identités/);
  save(join(directory, "cast-redesigns", `${run}-result.json`), {
    outcome: "passed-for-visual-review",
  });
  expect(() => loadGrowthProof(directory, cast)).toThrow(/Source/);
});

async function approveAdult() {
  const initial = loadGrowthProof(directory, cast),
    handlers = deps();
  const result = await previewAdultGrowthProof(initial, storage, handlers);
  const source: CastGrowthDraft = handlers.onDraft.mock.calls[0][0];
  const prefix = join(directory, "growth-proofs", run);
  mkdirSync(join(directory, "growth-proofs"));
  save(`${prefix}-draft-0.json`, source);
  save(`${prefix}-result.json`, result);
  save(join(directory, "growth-adolescent-approval.json"), {
    version: 1,
    authorizedByUser: true,
    method: "description-only-adolescent",
    slot: 0,
    adultRun: run,
    initialRecipeSha256: initial.recipeSha256,
    draftSha256: hash(readFileSync(`${prefix}-draft-0.json`)),
    resultSha256: hash(readFileSync(`${prefix}-result.json`)),
    adultRef: source.stageArt[0][3],
    adultSha256: hash(createWorldAssetStore(storage).read(source.stageArt[0][3]!)),
    prompt:
      "A youthful intermediate climbing creature, a shorter neck than the adult, moderately elongated body, medium head and green leaf feet with pale tips.",
  });
  return loadAdolescentProof(directory, cast);
}
function adolescentDeps() {
  return { ...deps(), remainingUnits: () => 250_000, generate: vi.fn(async () => pixels(180)) };
}
it("creates only the middle age, preserves both accepted endpoints and freshly checks all three ages", async () => {
  const proof = await approveAdult(),
    handlers = adolescentDeps();
  const original = JSON.stringify(proof.source),
    store = createWorldAssetStore(storage);
  const baby = store.read(proof.source.artRefs[0]),
    adult = store.read(proof.source.stageArt[0][3]!);
  const result = await previewAdolescentGrowthProof(proof, storage, handlers);
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    scope: "single-creature-three-ages",
    generatedImages: 1,
    reusedBabies: 1,
    reusedAdults: 1,
    published: false,
  });
  expect(handlers.generate).toHaveBeenCalledExactlyOnceWith({ prompt: proof.prompt });
  expect(handlers.inspect).toHaveBeenCalledTimes(3);
  const assets = handlers.inspect.mock.calls.map(([asset]) => asset);
  expect(assets[0]).toEqual({ kind: "creature", ref: proof.source.artRefs[0] });
  expect(assets[1]).toMatchObject({ stage: 2, babyRef: assets[0].ref, adultRef: assets[2].ref });
  expect(assets[1].previousRef).toBeUndefined();
  expect(assets[2]).toMatchObject({ stage: 3, babyRef: assets[0].ref, previousRef: assets[1].ref });
  expect(JSON.stringify(proof.source)).toBe(original);
  expect(store.read(assets[0].ref)).toEqual(baby);
  expect(store.read(assets[2].ref)).toEqual(adult);
});
it.each([2, 3])(
  "rejects the lineage when stage %s fails the new comparison, without regenerating accepted endpoints",
  async (stage) => {
    const proof = await approveAdult(),
      handlers = adolescentDeps();
    const success = await handlers.inspect({ kind: "creature", ref: "unused" }, proof.source);
    handlers.inspect.mockClear();
    handlers.inspect.mockImplementation(async (asset) => ({
      ...success,
      growthVisible: asset.stage !== stage,
    }));
    const result = await previewAdolescentGrowthProof(proof, storage, handlers);
    expect(result.outcome).toBe("rejected");
    expect(handlers.generate).toHaveBeenCalledTimes(1);
    expect(handlers.inspect).toHaveBeenCalledTimes(3);
  },
);
it("budgets one image and all three fresh inspections before starting the adolescent", async () => {
  const proof = await approveAdult(),
    handlers = adolescentDeps();
  handlers.remainingUnits = () => 249_999;
  await expect(previewAdolescentGrowthProof(proof, storage, handlers)).rejects.toThrow(
    /Budget insuffisant/,
  );
  expect(handlers.generate).not.toHaveBeenCalled();
});
it("requires explicit artistic approval of the adult, beyond a positive model verdict", async () => {
  await approveAdult();
  const path = join(directory, "growth-adolescent-approval.json");
  const agreement = JSON.parse(readFileSync(path, "utf8"));
  save(path, { ...agreement, authorizedByUser: false });
  expect(() => loadAdolescentProof(directory, cast)).toThrow(/Accord/);
});
it("refuses changed accepted adult pixels before generating the adolescent", async () => {
  const proof = await approveAdult();
  writeFileSync(join(storage, proof.source.stageArt[0][3]!), "changed");
  expect(() => loadAdolescentProof(directory, cast)).toThrow(/Adulte différent/);
});
it("sends the adolescent target, baby and approved adult in the correct order with BETWEEN age instructions", async () => {
  const proof = await approveAdult(),
    store = createWorldAssetStore(storage);
  const target = proof.source.stageArt[0][2]!,
    baby = proof.source.artRefs[0],
    adult = proof.source.stageArt[0][3]!;
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      detectedText: "",
                      unsafeScore: 0,
                      styleScore: 0.95,
                      identityMatches: true,
                      growthVisible: false,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  const inspector = createVisionInspector({
    apiKey: "test",
    model: "test",
    style: "gentle",
    readAsset: store.read,
    readMaster: () => {
      throw new Error("No Teddy");
    },
    fetchImpl,
  });
  const result = await inspector({
    kind: "creature",
    ref: target,
    stage: 2,
    babyRef: baby,
    adultRef: adult,
  });
  expect(result.growthVisible).toBe(false);
  expect(result.styleScore).toBe(0);
  const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  const parts = body.contents[0].parts;
  for (const [i, ref] of [target, baby, adult].entries()) {
    const expected = await sharp(store.read(ref))
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    expect(Buffer.from(parts[i].inlineData.data, "base64")).toEqual(expected);
  }
  expect(parts[3].text).toContain("visibly BETWEEN the two references");
  expect(parts[3].text).toContain("substantially less mature than the ADULT");
  expect(parts[3].text).not.toContain("older anatomy/proportions than EVERY reference");
});
it("rejects an adult endpoint mislabelled as a previous adolescent before sending QA", async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  const inspector = createVisionInspector({
    apiKey: "test",
    model: "test",
    style: "gentle",
    readAsset: () => {
      throw new Error("Must reject first");
    },
    readMaster: () => {
      throw new Error("No Teddy");
    },
    fetchImpl,
  });
  await expect(
    inspector({ kind: "creature", ref: "target", stage: 3, babyRef: "baby", adultRef: "adult" }),
  ).rejects.toThrow(/Référence adulte/);
  await expect(
    inspector({
      kind: "creature",
      ref: "target",
      stage: 2,
      babyRef: "baby",
      previousRef: "ado",
      adultRef: "adult",
    }),
  ).rejects.toThrow(/Référence adulte/);
  expect(fetchImpl).not.toHaveBeenCalled();
});

async function clarifyAfterRefusal(finishReason = "PROHIBITED_CONTENT") {
  const original = await approveAdult();
  mkdirSync(join(directory, "growth-adolescents"));
  const resultPath = join(directory, "growth-adolescents", `${run}-result.json`);
  save(resultPath, {
    outcome: "stopped",
    preview: null,
    reason: "réponse sans image (aucune inlineData)",
  });
  const trace = [
    {
      call: 119,
      runId: run,
      type: "image",
      phase: "growth-adolescent",
      referenceSha256: [],
      prompts: [original.prompt],
    },
    { call: 119, runId: run, status: 200, finishReason },
  ];
  writeFileSync(
    join(directory, "requests.jsonl"),
    trace.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  save(join(directory, "growth-adolescent-clarification.json"), {
    version: 1,
    failedRun: run,
    originalAgreementSha256: original.recipeSha256,
    resultSha256: hash(readFileSync(resultPath)),
    traceSha256: hash(Buffer.from(JSON.stringify(trace))),
    prompt:
      "One friendly fictional plant gecko for a children's maths game. The juvenile animal has a medium rounded head, short neck, four legs with leaf pads and a forked vine tail.",
  });
  return original;
}
it("binds a clarified animal brief to the exact refusal and preserves both approved endpoints", async () => {
  const original = await clarifyAfterRefusal();
  const clarified = loadClarifiedAdolescentProof(directory, cast);
  expect(clarified.source).toEqual(original.source);
  expect(clarified.prompt).not.toBe(original.prompt);
  expect(clarified.recipeSha256).not.toBe(original.recipeSha256);
  const handlers = adolescentDeps();
  const result = await previewAdolescentGrowthProof(clarified, storage, handlers);
  expect(handlers.generate).toHaveBeenCalledExactlyOnceWith({ prompt: clarified.prompt });
  expect(result.generatedImages).toBe(1);
  expect(result.published).toBe(false);
  expect(handlers.inspect).toHaveBeenCalledTimes(3);
});
it("does not use this clarification to restart a completed or different failed response", async () => {
  await clarifyAfterRefusal("STOP");
  expect(() => loadClarifiedAdolescentProof(directory, cast)).toThrow(/diagnostic source/);
});
it("refuses a modified refusal trace or result", async () => {
  await clarifyAfterRefusal();
  const tracePath = join(directory, "requests.jsonl"),
    before = readFileSync(tracePath);
  writeFileSync(tracePath, before.toString().replace("119", "120"));
  expect(() => loadClarifiedAdolescentProof(directory, cast)).toThrow(/diagnostic source/);
  writeFileSync(tracePath, before);
  save(join(directory, "growth-adolescents", `${run}-result.json`), {
    outcome: "rejected",
    preview: null,
  });
  expect(() => loadClarifiedAdolescentProof(directory, cast)).toThrow(/diagnostic source/);
});
it("refuses to treat an existing image checkpoint as an empty generation", async () => {
  await clarifyAfterRefusal();
  save(join(directory, "growth-adolescents", `${run}-draft-0.json`), cast);
  expect(() => loadClarifiedAdolescentProof(directory, cast)).toThrow(/diagnostic source/);
});

async function approveLineage() {
  await clarifyAfterRefusal();
  const basis = loadClarifiedAdolescentProof(directory, cast),
    handlers = adolescentDeps();
  const result = await previewAdolescentGrowthProof(basis, storage, handlers);
  const source: CastGrowthDraft = handlers.onDraft.mock.calls[0][0];
  const prefix = join(directory, "growth-adolescent-clarifications", run);
  mkdirSync(join(directory, "growth-adolescent-clarifications"));
  save(`${prefix}-draft-0.json`, source);
  save(`${prefix}-result.json`, result);
  const store = createWorldAssetStore(storage);
  const refs = source.artRefs.flatMap((ref, i) => [
    ref,
    source.stageArt[i][2]!,
    source.stageArt[i][3]!,
  ]);
  save(join(directory, "cast-completion-plan.json"), {
    version: 1,
    method: "description-only-growth",
    lineageApprovedByUser: true,
    lineageRun: run,
    basisSha256: basis.recipeSha256,
    draftSha256: hash(readFileSync(`${prefix}-draft-0.json`)),
    resultSha256: hash(readFileSync(`${prefix}-result.json`)),
    sourceArts: refs.map((ref) => ({ ref, sha256: hash(store.read(ref)) })),
    creatures: source.plan.creatures.slice(1).map((design, i) => ({
      slot: i + 1,
      name: design.name,
      adult: `A mature ${design.name}, with a long developed body, small friendly face, distinctive grown appendages and welcoming warm natural colours.`,
      adolescent: `A juvenile ${design.name}, with intermediate body proportions and moderately developed appendages, clearly between the compact baby and the mature form.`,
    })),
  });
  return loadCastCompletion(directory, cast);
}
function completionDeps() {
  let colour = 200;
  return {
    ...deps(),
    remainingUnits: () => 1_900_000,
    generate: vi.fn<(input: GenerateImageInput) => Promise<Buffer>>(async () => pixels(colour++)),
  };
}
it("generates exactly ten text-only stages, preserves Vrillou and the six babies, then freshly checks all eighteen with final peers", async () => {
  const completion = await approveLineage(),
    handlers = completionDeps();
  const before = JSON.stringify(completion.source),
    store = createWorldAssetStore(storage);
  const oldRefs = completion.source.artRefs.flatMap((ref, i) => [
    ref,
    completion.source.stageArt[i][2]!,
    completion.source.stageArt[i][3]!,
  ]);
  const oldPixels = oldRefs.map(store.read);
  const result = await previewCastCompletion(completion, storage, handlers);
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    generatedImages: 10,
    reusedBabies: 6,
    reusedOlderStages: 2,
    images: 18,
    published: false,
  });
  expect(handlers.generate).toHaveBeenCalledTimes(10);
  expect(handlers.generate.mock.calls.map(([input]) => input)).toEqual([
    ...completion.prompts.map((entry) => ({ prompt: entry.adult })),
    ...completion.prompts.map((entry) => ({ prompt: entry.adolescent })),
  ]);
  expect(handlers.inspect).toHaveBeenCalledTimes(18);
  expect(handlers.onDraft).toHaveBeenCalledTimes(11);
  expect(JSON.stringify(completion.source)).toBe(before);
  expect(oldRefs.map(store.read)).toEqual(oldPixels);
  for (let slot = 0; slot < 6; slot++) {
    const [baby, ado, adult] = handlers.inspect.mock.calls
      .slice(slot * 3, slot * 3 + 3)
      .map(([asset]) => asset);
    expect(baby.ref).toBe(completion.source.artRefs[slot]);
    expect(ado).toMatchObject({ stage: 2, babyRef: baby.ref, adultRef: adult.ref });
    expect(adult).toMatchObject({ stage: 3, babyRef: baby.ref, previousRef: ado.ref });
    if (slot === 0) {
      expect(ado.ref).toBe(completion.source.stageArt[0][2]);
      expect(adult.ref).toBe(completion.source.stageArt[0][3]);
    } else {
      expect(ado.ref).not.toBe(completion.source.stageArt[slot][2]);
      expect(adult.ref).not.toBe(completion.source.stageArt[slot][3]);
    }
  }
  expect(
    handlers.inspect.mock.calls.every(([, draft]) =>
      draft.stageArt.every((stages) => stages[2] && stages[3]),
    ),
  ).toBe(true);
});
it("requires the complete ten-image and eighteen-inspection budget before starting", async () => {
  const completion = await approveLineage(),
    handlers = completionDeps();
  handlers.remainingUnits = () => 1_899_999;
  await expect(previewCastCompletion(completion, storage, handlers)).rejects.toThrow(
    /Budget insuffisant/,
  );
  expect(handlers.generate).not.toHaveBeenCalled();
});
it("rejects a negative final comparison without further generation or publication", async () => {
  const completion = await approveLineage(),
    handlers = completionDeps();
  handlers.inspect.mockResolvedValue({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 1,
    habitatMatches: true,
    visuallyDistinct: true,
    identityMatches: true,
    growthVisible: false,
  });
  const result = await previewCastCompletion(completion, storage, handlers);
  expect(result.outcome).toBe("rejected");
  expect(result.published).toBe(false);
  expect(handlers.generate).toHaveBeenCalledTimes(10);
  expect(handlers.inspect).toHaveBeenCalledTimes(18);
});
it("requires actual user approval of the lineage before widening the run", async () => {
  await approveLineage();
  const path = join(directory, "cast-completion-plan.json");
  save(path, { ...JSON.parse(readFileSync(path, "utf8")), lineageApprovedByUser: false });
  expect(() => loadCastCompletion(directory, cast)).toThrow(/Accord/);
});
it("refuses a plan attempting to regenerate the accepted first creature", async () => {
  await approveLineage();
  const path = join(directory, "cast-completion-plan.json");
  const plan = JSON.parse(readFileSync(path, "utf8"));
  plan.creatures[0].slot = 0;
  save(path, plan);
  expect(() => loadCastCompletion(directory, cast)).toThrow(/cinq créatures/);
});
it("refuses modified accepted juvenile pixels and never treats approval as an editable pointer", async () => {
  const completion = await approveLineage();
  writeFileSync(join(storage, completion.source.stageArt[0][2]!), "changed");
  expect(() => loadCastCompletion(directory, cast)).toThrow(/Pixels sources modifiés/);
});
it("checkpoints completed images and stops immediately if a later generation fails", async () => {
  const completion = await approveLineage(),
    handlers = completionDeps();
  handlers.generate
    .mockImplementationOnce(async () => pixels(230))
    .mockRejectedValue(new Error("PROHIBITED_CONTENT"));
  await expect(previewCastCompletion(completion, storage, handlers)).rejects.toThrow(
    "PROHIBITED_CONTENT",
  );
  expect(handlers.generate).toHaveBeenCalledTimes(2);
  expect(handlers.onDraft).toHaveBeenCalledTimes(2);
  expect(handlers.inspect).not.toHaveBeenCalled();
});

async function stoppedCompletion() {
  const completion = await approveLineage();
  mkdirSync(join(directory, "cast-completions"));
  mkdirSync(join(directory, "storage/worldgen/raw"), { recursive: true });
  save(join(directory, "cast-completion-started.json"), {
    runId: run,
    completionRecipeSha256: completion.recipeSha256,
    approvedLineageRun: completion.sourceRun,
  });
  const draft = structuredClone(completion.source),
    store = createWorldAssetStore(storage);
  for (let slot = 1; slot < 6; slot++) draft.stageArt[slot] = {};
  save(join(directory, `cast-completions/${run}-draft-0.json`), draft);
  const trace = [];
  const steps = ([3, 2] as const).flatMap((stage) =>
    completion.prompts.map((entry) => ({ stage, ...entry })),
  );
  for (const [i, step] of steps.entries()) {
    const raw =
      i === 9
        ? await sharp(
            Buffer.from(
              '<svg width="120" height="120"><rect width="120" height="120" fill="black"/><rect x="10" y="10" width="100" height="100" fill="white"/><rect x="40" y="40" width="40" height="40" fill="#ab6633"/></svg>',
            ),
          )
            .png()
            .toBuffer()
        : await pixels(160 + i);
    writeFileSync(join(directory, `storage/worldgen/raw/${i + 201}-0.png`), raw);
    trace.push({
      runId: run,
      phase: "cast-completion",
      call: i + 201,
      type: "image",
      prompts: [step.stage === 3 ? step.adult : step.adolescent],
      referenceSha256: [],
    });
    trace.push({
      runId: run,
      phase: "cast-completion",
      call: i + 201,
      status: 200,
      finishReason: "STOP",
    });
    if (i < 9) {
      draft.stageArt[step.slot][step.stage] = await store.write(
        6,
        `${step.slot === 5 ? "legendary" : `creature-${step.slot}`}-${step.stage === 3 ? "adulte" : "ado"}.png`,
        raw,
      );
      save(join(directory, `cast-completions/${run}-draft-${i + 1}.json`), draft);
    }
  }
  writeFileSync(
    join(directory, "requests.jsonl"),
    trace.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  save(join(directory, `cast-completions/${run}-result.json`), {
    outcome: "stopped",
    reason: "Détourage non fiable : le fond doit être blanc et dégagé aux bords.",
    published: false,
    databaseWritten: false,
  });
  return { completion, draft };
}
const recoveryCrop = { left: 20, top: 20, width: 80, height: 80 };
it("recovers only the last framed image, preserves seventeen exact arts, then performs eighteen fresh QA with zero generation", async () => {
  const { completion, draft } = await stoppedCompletion();
  const store = createWorldAssetStore(storage);
  const before = draft.artRefs
    .flatMap((ref, i) => [ref, draft.stageArt[i][2], draft.stageArt[i][3]])
    .filter((ref): ref is string => !!ref);
  const originals = before.map(store.read);
  const raw = readFileSync(join(directory, "storage/worldgen/raw/210-0.png"));
  const recovery = await prepareCastRecovery(directory, completion, recoveryCrop);
  expect(before.map(store.read)).toEqual(originals);
  expect(readFileSync(join(directory, "storage/worldgen/raw/210-0.png"))).toEqual(raw);
  expect(recovery.draft.artRefs).toEqual(draft.artRefs);
  expect(recovery.draft.stageArt.slice(0, 5)).toEqual(draft.stageArt.slice(0, 5));
  expect(recovery.draft.stageArt[5][3]).toBe(draft.stageArt[5][3]);
  const handlers = completionDeps();
  const result = await inspectRecoveredCast(recovery, handlers);
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    generatedImages: 0,
    reusedImages: 18,
    published: false,
  });
  expect(handlers.generate).not.toHaveBeenCalled();
  expect(handlers.inspect).toHaveBeenCalledTimes(18);
  for (let slot = 0; slot < 6; slot++) {
    const [baby, ado, adult] = handlers.inspect.mock.calls
      .slice(slot * 3, slot * 3 + 3)
      .map(([asset]) => asset);
    expect(ado).toMatchObject({ babyRef: baby.ref, adultRef: adult.ref });
    expect(adult).toMatchObject({ babyRef: baby.ref, previousRef: ado.ref });
  }
  expect(
    handlers.inspect.mock.calls.every(([, group]) =>
      group.stageArt.every((ages) => ages[2] && ages[3]),
    ),
  ).toBe(true);
  await expect(prepareCastRecovery(directory, completion, recoveryCrop)).rejects.toThrow(
    /déjà préparée/,
  );
});
it("blocks recovery after QA has started or rejected content, instead of resetting its history", async () => {
  const { completion } = await stoppedCompletion();
  save(join(directory, `cast-completions/${run}-check-1.json`), { verdict: { ok: false } });
  await expect(prepareCastRecovery(directory, completion, recoveryCrop)).rejects.toThrow(
    /aucune QA engagée/,
  );
});
it("does not reuse a raw image whose recorded prompt is from a different request", async () => {
  const { completion } = await stoppedCompletion();
  const path = join(directory, "requests.jsonl");
  const trace = readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  trace[0].prompts = ["different prompt"];
  writeFileSync(path, trace.map((entry) => JSON.stringify(entry)).join("\n"));
  await expect(prepareCastRecovery(directory, completion, recoveryCrop)).rejects.toThrow(
    /descriptions acceptées/,
  );
});
it("requires saved pixels to match their recorded raw response before preparing a recovery", async () => {
  const { completion, draft } = await stoppedCompletion();
  writeFileSync(join(storage, draft.stageArt[1][3]!), await pixels(99));
  await expect(prepareCastRecovery(directory, completion, recoveryCrop)).rejects.toThrow(
    /réponse brute/,
  );
});
it("detects mutated raw history and recovered pixels before the next inspection", async () => {
  const { completion } = await stoppedCompletion();
  const recovery = await prepareCastRecovery(directory, completion, recoveryCrop);
  const rawPath = join(directory, "storage/worldgen/raw/210-0.png"),
    original = readFileSync(rawPath);
  writeFileSync(rawPath, "changed");
  expect(() => loadCastRecovery(directory, completion)).toThrow(/Source de récupération modifiée/);
  writeFileSync(rawPath, original);
  writeFileSync(join(storage, recovery.draft.stageArt[5][2]!), "changed");
  expect(() => loadCastRecovery(directory, completion)).toThrow(
    /Pixels du groupe récupéré modifiés/,
  );
});
it("checks the full inspection budget and retains negative comparisons without generating corrections", async () => {
  const { completion } = await stoppedCompletion();
  const recovery = await prepareCastRecovery(directory, completion, recoveryCrop);
  const handlers = completionDeps();
  handlers.remainingUnits = () => 899_999;
  await expect(inspectRecoveredCast(recovery, handlers)).rejects.toThrow(/Budget insuffisant/);
  expect(handlers.inspect).not.toHaveBeenCalled();
  handlers.remainingUnits = () => 900_000;
  handlers.inspect.mockResolvedValue({
    habitatMatches: true,
    visuallyDistinct: true,
    identityMatches: false,
    growthVisible: true,
    detectedText: "",
    unsafeScore: 0,
    styleScore: 0.95,
  });
  const result = await inspectRecoveredCast(recovery, handlers);
  expect(result.outcome).toBe("rejected");
  expect(handlers.inspect).toHaveBeenCalledTimes(18);
  expect(handlers.generate).not.toHaveBeenCalled();
});

async function rejectedArbelune() {
  const { completion } = await stoppedCompletion();
  const recovery = await prepareCastRecovery(directory, completion, recoveryCrop);
  const handlers = completionDeps();
  handlers.inspect.mockImplementation(async (asset) => ({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 0.95,
    habitatMatches: true,
    visuallyDistinct: true,
    identityMatches: asset.ref !== recovery.draft.stageArt[5][2],
    growthVisible: asset.ref !== recovery.draft.stageArt[5][2],
  }));
  const result = await inspectRecoveredCast(recovery, handlers);
  const qaRun = "00000000-0000-0000-0000-000000000001";
  const folder = join(directory, "cast-completion-inspections");
  mkdirSync(folder);
  const marker = join(directory, "cast-completion-inspect-started.json");
  save(marker, { runId: qaRun, recoveryRecipeSha256: recovery.recipeSha256 });
  save(join(folder, `${qaRun}-draft-0.json`), recovery.draft);
  save(join(folder, `${qaRun}-result.json`), { ...result, databaseWritten: false });
  const trace = Array.from({ length: 18 }, (_, i) => [
    { runId: qaRun, call: 301 + i, type: "vision", phase: "cast-completion-inspect" },
    {
      runId: qaRun,
      call: 301 + i,
      status: 200,
      finishReason: "STOP",
      phase: "cast-completion-inspect",
    },
  ]).flat();
  const tracePath = join(directory, "requests.jsonl");
  writeFileSync(
    tracePath,
    readFileSync(tracePath, "utf8") + trace.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  const reviewPath = join(directory, "arbelune-user-review.json");
  const ref = recovery.draft.stageArt[5][3]!;
  save(reviewPath, {
    rejectedByUser: true,
    reason: "adult-face-unreadable",
    ref,
    sha256: hash(createWorldAssetStore(storage).read(ref)),
    qaRun,
  });
  const recipe = {
    version: 1,
    slot: 5,
    name: recovery.draft.plan.creatures[5].name,
    sourceRecoverySha256: recovery.recipeSha256,
    method: "description-only-readable-face",
    qaRun,
    adult:
      "Create a mature living root guardian with an expressive clearly readable central face, two eyes and a friendly mouth, and a long developed body and six strong root legs.",
    adolescent:
      "Create a juvenile living root guardian with an expressive clearly readable central face, two eyes and a friendly mouth, with intermediate body and leg proportions.",
    qaMarkerSha256: hash(readFileSync(marker)),
    qaDraftSha256: hash(readFileSync(join(folder, `${qaRun}-draft-0.json`))),
    qaResultSha256: hash(readFileSync(join(folder, `${qaRun}-result.json`))),
    qaTraceSha256: hash(Buffer.from(JSON.stringify(trace))),
    reviewSha256: hash(readFileSync(reviewPath)),
  };
  save(join(directory, "arbelune-repair-plan.json"), recipe);
  return { completion, repair: loadArbeluneRepair(directory, completion) };
}
it("replaces only Arbélune's two older ages, despite the adult's old positive QA, and freshly inspects the whole cast", async () => {
  const { repair } = await rejectedArbelune(),
    handlers = completionDeps(),
    store = createWorldAssetStore(storage);
  const oldRefs = repair.source.artRefs.flatMap((ref, i) => [
    ref,
    repair.source.stageArt[i][2]!,
    repair.source.stageArt[i][3]!,
  ]);
  const oldPixels = oldRefs.map(store.read);
  handlers.inspect.mockResolvedValue({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 0.95,
    habitatMatches: true,
    visuallyDistinct: true,
    identityMatches: true,
    growthVisible: true,
    faceReadable: true,
  });
  const result = await previewArbeluneRepair(repair, storage, handlers);
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    generatedImages: 2,
    reusedImages: 16,
    published: false,
  });
  expect(handlers.generate.mock.calls.map(([input]) => input)).toEqual([
    { prompt: repair.adult },
    { prompt: repair.adolescent },
  ]);
  expect(handlers.inspect).toHaveBeenCalledTimes(18);
  expect(handlers.onDraft).toHaveBeenCalledTimes(3);
  expect(oldRefs.map(store.read)).toEqual(oldPixels);
  const final = handlers.inspect.mock.calls[0][1];
  expect(final.artRefs).toEqual(repair.source.artRefs);
  expect(final.stageArt.slice(0, 5)).toEqual(repair.source.stageArt.slice(0, 5));
  expect(final.stageArt[5][2]).not.toBe(repair.source.stageArt[5][2]);
  expect(final.stageArt[5][3]).not.toBe(repair.source.stageArt[5][3]);
  expect(
    handlers.inspect.mock.calls.slice(0, 15).every(([asset]) => !asset.requireReadableFace),
  ).toBe(true);
  expect(handlers.inspect.mock.calls.slice(15).every(([asset]) => asset.requireReadableFace)).toBe(
    true,
  );
  const ado = handlers.inspect.mock.calls[16][0],
    adult = handlers.inspect.mock.calls[17][0];
  expect(ado.adultRef).toBe(adult.ref);
  expect(adult.previousRef).toBe(ado.ref);
});
it("rejects an unreadable face even with positive growth and style, without further paid correction", async () => {
  const { repair } = await rejectedArbelune(),
    handlers = completionDeps();
  handlers.inspect.mockResolvedValue({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 0.95,
    habitatMatches: true,
    visuallyDistinct: true,
    identityMatches: true,
    growthVisible: true,
    faceReadable: false,
  });
  const result = await previewArbeluneRepair(repair, storage, handlers);
  expect(result.outcome).toBe("rejected");
  expect(handlers.generate).toHaveBeenCalledTimes(2);
});
it("requires all correction and validation budget before generating", async () => {
  const { repair } = await rejectedArbelune(),
    handlers = completionDeps();
  handlers.remainingUnits = () => 1_099_999;
  await expect(previewArbeluneRepair(repair, storage, handlers)).rejects.toThrow(
    /Budget insuffisant/,
  );
  expect(handlers.generate).not.toHaveBeenCalled();
});
it("pins the user's rejection independently of the unchanged machine verdict", async () => {
  const { completion } = await rejectedArbelune();
  const path = join(directory, "arbelune-user-review.json");
  save(path, { ...JSON.parse(readFileSync(path, "utf8")), rejectedByUser: false });
  expect(() => loadArbeluneRepair(directory, completion)).toThrow(/retour visuel/);
});
it("refuses a target-slot change and a changed terminal inspection result", async () => {
  const { completion, repair } = await rejectedArbelune();
  const path = join(directory, "arbelune-repair-plan.json"),
    old = readFileSync(path);
  save(path, { ...JSON.parse(old.toString()), slot: 0 });
  expect(() => loadArbeluneRepair(directory, completion)).toThrow(/Correction/);
  writeFileSync(path, old);
  writeFileSync(
    join(directory, `cast-completion-inspections/${repair.sourceRun}-result.json`),
    "{}",
  );
  expect(() => loadArbeluneRepair(directory, completion)).toThrow(/Bilan/);
});

async function failedArbeluneMiddle() {
  const { completion, repair } = await rejectedArbelune(),
    handlers = completionDeps();
  handlers.inspect.mockImplementation(async (asset, draft) => ({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 0.95,
    habitatMatches: true,
    visuallyDistinct: true,
    identityMatches: asset.ref !== draft.stageArt[5][2],
    growthVisible: asset.ref !== draft.stageArt[5][2],
    faceReadable: true,
  }));
  const result = await previewArbeluneRepair(repair, storage, handlers);
  const source: CastGrowthDraft = handlers.onDraft.mock.calls.at(-1)![0];
  const sourceRun = "00000000-0000-0000-0000-000000000002";
  mkdirSync(join(directory, "arbelune-repairs"));
  const prefix = join(directory, "arbelune-repairs", sourceRun);
  save(`${prefix}-draft-2.json`, source);
  save(`${prefix}-result.json`, { ...result, databaseWritten: false });
  const marker = join(directory, "arbelune-repair-started.json");
  save(marker, { runId: sourceRun, repairRecipeSha256: repair.recipeSha256 });
  const trace = Array.from({ length: 20 }, (_, i) => [
    { runId: sourceRun, call: 401 + i, type: i < 2 ? "image" : "vision" },
    { runId: sourceRun, call: 401 + i, status: 200, finishReason: "STOP" },
  ]).flat();
  const tracePath = join(directory, "requests.jsonl");
  writeFileSync(
    tracePath,
    readFileSync(tracePath, "utf8") + trace.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  const store = createWorldAssetStore(storage),
    refs = source.artRefs.flatMap((ref, i) => [
      ref,
      source.stageArt[i][2]!,
      source.stageArt[i][3]!,
    ]);
  save(join(directory, "arbelune-adolescent-plan.json"), {
    version: 1,
    slot: 5,
    stage: 2,
    method: "two-endpoint-adolescent",
    basisSha256: repair.recipeSha256,
    sourceRun,
    referenceOrder: ["baby", "adult"],
    prompt:
      "Image 1 is the baby and Image 2 is the adult endpoint. Draw the juvenile middle form with an open inverted U body, no closed wooden slab, medium root legs and a clearly readable friendly face.",
    markerSha256: hash(readFileSync(marker)),
    draftSha256: hash(readFileSync(`${prefix}-draft-2.json`)),
    resultSha256: hash(readFileSync(`${prefix}-result.json`)),
    traceSha256: hash(Buffer.from(JSON.stringify(trace))),
    sourceArts: refs.map((ref) => ({ ref, sha256: hash(store.read(ref)) })),
  });
  return { completion, revision: loadArbeluneAdolescent(directory, completion) };
}
it("draws only the middle age with the exact baby/adult image references, preserving seventeen images and checking all final peers", async () => {
  const { revision } = await failedArbeluneMiddle(),
    handlers = completionDeps(),
    store = createWorldAssetStore(storage);
  const refs = revision.source.artRefs.flatMap((ref, i) => [
    ref,
    revision.source.stageArt[i][2]!,
    revision.source.stageArt[i][3]!,
  ]);
  const original = refs.map(store.read);
  handlers.generate.mockImplementation(async () => pixels(240));
  handlers.inspect.mockResolvedValue({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 0.95,
    habitatMatches: true,
    visuallyDistinct: true,
    identityMatches: true,
    growthVisible: true,
    faceReadable: true,
  });
  const result = await previewArbeluneAdolescent(revision, storage, handlers);
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    generatedImages: 1,
    reusedImages: 17,
    published: false,
  });
  expect(handlers.generate).toHaveBeenCalledExactlyOnceWith({
    prompt: revision.prompt,
    refImages: [
      { data: store.read(revision.source.artRefs[5]), mimeType: "image/png" },
      { data: store.read(revision.source.stageArt[5][3]!), mimeType: "image/png" },
    ],
  });
  const final = handlers.inspect.mock.calls[0][1];
  expect(final.artRefs).toEqual(revision.source.artRefs);
  expect(final.stageArt.slice(0, 5)).toEqual(revision.source.stageArt.slice(0, 5));
  expect(final.stageArt[5][3]).toBe(revision.source.stageArt[5][3]);
  expect(final.stageArt[5][2]).not.toBe(revision.source.stageArt[5][2]);
  expect(refs.map(store.read)).toEqual(original);
  expect(handlers.inspect).toHaveBeenCalledTimes(18);
  expect(
    handlers.inspect.mock.calls.every(([, draft]) =>
      draft.stageArt.every((ages) => ages[2] && ages[3]),
    ),
  ).toBe(true);
  const [baby, ado, adult] = handlers.inspect.mock.calls.slice(15).map(([asset]) => asset);
  expect([baby, ado, adult].every((asset) => asset.requireReadableFace)).toBe(true);
  expect(ado.adultRef).toBe(adult.ref);
  expect(adult.previousRef).toBe(ado.ref);
});
it("does not accept a byte-identical copy of either supplied endpoint", async () => {
  const { revision } = await failedArbeluneMiddle(),
    store = createWorldAssetStore(storage);
  for (const ref of [revision.source.artRefs[5], revision.source.stageArt[5][3]!]) {
    const handlers = completionDeps();
    handlers.generate.mockResolvedValue(store.read(ref));
    await expect(previewArbeluneAdolescent(revision, storage, handlers)).rejects.toThrow(/recopie/);
    expect(handlers.generate).toHaveBeenCalledTimes(1);
    expect(handlers.inspect).not.toHaveBeenCalled();
  }
});
it("requires the complete one-image and eighteen-QA budget before sending endpoint references", async () => {
  const { revision } = await failedArbeluneMiddle(),
    handlers = completionDeps();
  handlers.remainingUnits = () => 999_999;
  await expect(previewArbeluneAdolescent(revision, storage, handlers)).rejects.toThrow(
    /Budget insuffisant/,
  );
  expect(handlers.generate).not.toHaveBeenCalled();
});
it("detects a changed current adult image instead of reusing it under its old verdict", async () => {
  const { completion, revision } = await failedArbeluneMiddle();
  writeFileSync(join(storage, revision.source.stageArt[5][3]!), await pixels(88));
  expect(() => loadArbeluneAdolescent(directory, completion)).toThrow(/pixels ou verdicts/);
});
it("refuses widening the target and refuses an adult whose QA is negative even if source hashes were updated", async () => {
  const { completion, revision } = await failedArbeluneMiddle();
  const path = join(directory, "arbelune-adolescent-plan.json"),
    recipe = JSON.parse(readFileSync(path, "utf8"));
  save(path, { ...recipe, stage: 3 });
  expect(() => loadArbeluneAdolescent(directory, completion)).toThrow(/Plan/);
  const resultPath = join(directory, `arbelune-repairs/${revision.sourceRun}-result.json`);
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  result.checks[17].inspection.faceReadable = false;
  result.checks[17].verdict = { ok: false, failedRule: "style_coherence" };
  save(resultPath, result);
  save(path, { ...recipe, resultSha256: hash(readFileSync(resultPath)) });
  expect(() => loadArbeluneAdolescent(directory, completion)).toThrow(/pixels ou verdicts/);
});
it("keeps the group rejected on a negative middle-age comparison, with no retry generation", async () => {
  const { revision } = await failedArbeluneMiddle(),
    handlers = completionDeps();
  handlers.generate.mockImplementation(async () => pixels(240));
  handlers.inspect.mockResolvedValue({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 0.95,
    habitatMatches: true,
    visuallyDistinct: true,
    identityMatches: false,
    growthVisible: false,
    faceReadable: true,
  });
  const result = await previewArbeluneAdolescent(revision, storage, handlers);
  expect(result.outcome).toBe("rejected");
  expect(handlers.generate).toHaveBeenCalledTimes(1);
});

async function duplicatedArbelunePair() {
  const { completion, revision } = await failedArbeluneMiddle(),
    handlers = completionDeps();
  handlers.generate.mockImplementation(async () => pixels(240));
  handlers.inspect.mockImplementation(async (asset, draft) => ({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 0.95,
    habitatMatches: true,
    visuallyDistinct: true,
    faceReadable: true,
    identityMatches: asset.ref !== draft.stageArt[5][2],
    growthVisible: asset.ref !== draft.stageArt[5][2] && asset.ref !== draft.stageArt[5][3],
  }));
  const result = await previewArbeluneAdolescent(revision, storage, handlers);
  const source: CastGrowthDraft = handlers.onDraft.mock.calls.at(-1)![0];
  const sourceRun = "00000000-0000-0000-0000-000000000003";
  mkdirSync(join(directory, "arbelune-adolescents"));
  const prefix = join(directory, "arbelune-adolescents", sourceRun);
  save(`${prefix}-draft-1.json`, source);
  save(`${prefix}-result.json`, { ...result, databaseWritten: false });
  const marker = join(directory, "arbelune-adolescent-started.json");
  save(marker, { runId: sourceRun, adolescentRecipeSha256: revision.recipeSha256 });
  const trace = Array.from({ length: 19 }, (_, i) => [
    { runId: sourceRun, call: 501 + i, type: i === 0 ? "image" : "vision" },
    { runId: sourceRun, call: 501 + i, status: 200, finishReason: "STOP" },
  ]).flat();
  const tracePath = join(directory, "requests.jsonl");
  writeFileSync(
    tracePath,
    readFileSync(tracePath, "utf8") + trace.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  const store = createWorldAssetStore(storage),
    refs = source.artRefs.flatMap((ref, i) => [
      ref,
      source.stageArt[i][2]!,
      source.stageArt[i][3]!,
    ]);
  const review = join(directory, "arbelune-ee150-user-review.json");
  save(review, {
    sourceRun,
    rejectedByUser: true,
    reason: "adolescent-copies-adult",
    refs: refs.slice(16),
    sha256: refs.slice(16).map((ref) => hash(store.read(ref))),
  });
  save(join(directory, "arbelune-study-plan.json"), {
    version: 1,
    slot: 5,
    method: "joint-two-stage-study",
    basisSha256: revision.recipeSha256,
    sourceRun,
    prompt:
      "Design two different stages together, juvenile left with a low supple open arch and slender root legs, mature right with a tall open vault and long substantial roots. Retain the baby species, six roots and expressive central face.",
    markerSha256: hash(readFileSync(marker)),
    draftSha256: hash(readFileSync(`${prefix}-draft-1.json`)),
    resultSha256: hash(readFileSync(`${prefix}-result.json`)),
    traceSha256: hash(Buffer.from(JSON.stringify(trace))),
    reviewSha256: hash(readFileSync(review)),
    sourceArts: refs.map((ref) => ({ ref, sha256: hash(store.read(ref)) })),
  });
  return { completion, study: loadArbeluneStudy(directory, completion) };
}
it("makes one joint study using only the exact baby, without changing runtime art, doing QA or claiming final stages", async () => {
  const { study } = await duplicatedArbelunePair(),
    handlers = completionDeps(),
    store = createWorldAssetStore(storage);
  const refs = study.source.artRefs.flatMap((ref, i) => [
    ref,
    study.source.stageArt[i][2]!,
    study.source.stageArt[i][3]!,
  ]);
  const original = refs.map(store.read),
    source = JSON.stringify(study.source),
    onStudy = vi.fn();
  handlers.generate.mockImplementation(async () => pixels(250));
  const result = await previewArbeluneStudy(study, storage, { ...handlers, onStudy });
  expect(result).toMatchObject({
    outcome: "study-ready-for-visual-review",
    generatedImages: 1,
    proposedStages: 2,
    inspections: 0,
    published: false,
    growthGenerated: false,
    qaPassed: false,
  });
  expect(handlers.generate).toHaveBeenCalledExactlyOnceWith({
    prompt: study.prompt,
    refImages: [{ data: store.read(study.source.artRefs[5]), mimeType: "image/png" }],
  });
  expect(handlers.inspect).not.toHaveBeenCalled();
  expect(handlers.onDraft).not.toHaveBeenCalled();
  expect(onStudy).toHaveBeenCalledTimes(1);
  expect(refs.map(store.read)).toEqual(original);
  expect(JSON.stringify(study.source)).toBe(source);
});
it("reserves only the single study cost before requesting an image", async () => {
  const { study } = await duplicatedArbelunePair(),
    handlers = completionDeps();
  handlers.remainingUnits = () => 99_999;
  await expect(
    previewArbeluneStudy(study, storage, { ...handlers, onStudy: vi.fn() }),
  ).rejects.toThrow(/Budget insuffisant/);
  expect(handlers.generate).not.toHaveBeenCalled();
});
it("pins the latest rejection and source art instead of treating another positive adult verdict as approval", async () => {
  const { completion, study } = await duplicatedArbelunePair();
  writeFileSync(join(storage, study.source.stageArt[5][3]!), await pixels(99));
  expect(() => loadArbeluneStudy(directory, completion)).toThrow(
    /pixels ou verdicts|Pixels ou verdicts/,
  );
});
it("does not retry or save a study when the provider returns invalid image bytes", async () => {
  const { study } = await duplicatedArbelunePair(),
    handlers = completionDeps(),
    onStudy = vi.fn();
  handlers.generate.mockResolvedValue(Buffer.from("no-image"));
  await expect(previewArbeluneStudy(study, storage, { ...handlers, onStudy })).rejects.toThrow();
  expect(handlers.generate).toHaveBeenCalledTimes(1);
  expect(onStudy).not.toHaveBeenCalled();
  expect(handlers.inspect).not.toHaveBeenCalled();
});

async function approvedArbeluneStudy() {
  const { completion, study } = await duplicatedArbelunePair();
  const sourceRun = "00000000-0000-0000-0000-000000000004";
  const audit = join(directory, "arbelune-studies");
  mkdirSync(audit);
  const marker = join(directory, "arbelune-study-started.json");
  save(marker, {
    runId: sourceRun,
    studyRecipeSha256: study.recipeSha256,
    studySourceRun: study.sourceRun,
  });
  const handlers = completionDeps();
  handlers.generate.mockImplementation(async () => pixels(240));
  const imagePath = join(audit, `${sourceRun}-study.png`);
  const result = await previewArbeluneStudy(study, storage, {
    ...handlers,
    onStudy: (bytes) => writeFileSync(imagePath, bytes),
  });
  const resultPath = join(audit, `${sourceRun}-result.json`);
  save(resultPath, { ...result, databaseWritten: false });
  const studySha256 = hash(readFileSync(imagePath));
  const approvalPath = join(directory, "arbelune-study-direction-approval.json");
  save(approvalPath, {
    sourceRun,
    studySha256,
    directionApproved: true,
    direction: "slender-juvenile-tall-mature",
    anatomyCorrectionRequired: true,
    finalStagesApproved: false,
    userMessage: "Garder cette direction et corriger l’anatomie",
  });
  const trace = [
    {
      runId: sourceRun,
      call: 600,
      type: "image",
      prompts: [study.prompt],
      referenceSha256: [hash(createWorldAssetStore(storage).read(study.source.artRefs[5]))],
    },
    { runId: sourceRun, call: 600, status: 200, finishReason: "STOP" },
  ];
  const tracePath = join(directory, "requests.jsonl");
  writeFileSync(
    tracePath,
    readFileSync(tracePath, "utf8") + trace.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  save(join(directory, "arbelune-study-anatomy-plan.json"), {
    version: 1,
    method: "edit-study-anatomy",
    sourceRun,
    studySha256,
    basisSha256: study.recipeSha256,
    markerSha256: hash(readFileSync(marker)),
    resultSha256: hash(readFileSync(resultPath)),
    approvalSha256: hash(readFileSync(approvalPath)),
    traceSha256: hash(Buffer.from(JSON.stringify(trace))),
    prompt:
      "Edit image one, the chosen two-stage study, correcting only the roots and openings. Image two is the unchanged baby identity reference. Preserve different silhouettes, the faces and palette. Four openings and six distinct roots per creature.",
  });
  return {
    completion,
    study: loadArbeluneStudyAnatomy(directory, completion),
    imagePath,
    approvalPath,
    resultPath,
  };
}
it("edits the chosen study with the exact baby as second reference, without replacing any of the eighteen arts or running QA", async () => {
  const { study, imagePath } = await approvedArbeluneStudy();
  const store = createWorldAssetStore(storage),
    handlers = completionDeps(),
    onStudy = vi.fn();
  const refs = study.source.artRefs.flatMap((ref, i) => [
    ref,
    study.source.stageArt[i][2]!,
    study.source.stageArt[i][3]!,
  ]);
  const original = refs.map(store.read),
    source = JSON.stringify(study.source),
    input = readFileSync(imagePath);
  handlers.generate.mockImplementation(async () => pixels(250));
  const result = await previewArbeluneStudy(study, storage, { ...handlers, onStudy });
  expect(handlers.generate).toHaveBeenCalledExactlyOnceWith({
    prompt: study.prompt,
    refImages: [
      { data: input, mimeType: "image/png" },
      { data: store.read(study.source.artRefs[5]), mimeType: "image/png" },
    ],
  });
  expect(result).toMatchObject({
    method: "edit-study-anatomy",
    inspections: 0,
    generatedImages: 1,
    qaPassed: false,
    growthGenerated: false,
    published: false,
  });
  expect(onStudy).toHaveBeenCalledTimes(1);
  expect(handlers.inspect).not.toHaveBeenCalled();
  expect(handlers.onDraft).not.toHaveBeenCalled();
  expect(refs.map(store.read)).toEqual(original);
  expect(JSON.stringify(study.source)).toBe(source);
  expect(readFileSync(imagePath)).toEqual(input);
});
it.each(["imagePath", "approvalPath", "resultPath"] as const)(
  "blocks the anatomy edit if its pinned %s changes",
  async (field) => {
    const prepared = await approvedArbeluneStudy();
    writeFileSync(prepared[field], field === "imagePath" ? await pixels(99) : "{}");
    expect(() => loadArbeluneStudyAnatomy(directory, prepared.completion)).toThrow(
      /Source ou accord|planche source/,
    );
  },
);
it("does not turn direction approval into final-stage approval", async () => {
  const { completion, approvalPath } = await approvedArbeluneStudy();
  const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
  writeFileSync(approvalPath, JSON.stringify({ ...approval, finalStagesApproved: true }));
  const recipePath = join(directory, "arbelune-study-anatomy-plan.json");
  const recipe = JSON.parse(readFileSync(recipePath, "utf8"));
  writeFileSync(
    recipePath,
    JSON.stringify({ ...recipe, approvalSha256: hash(readFileSync(approvalPath)) }),
  );
  expect(() => loadArbeluneStudyAnatomy(directory, completion)).toThrow(/accord sur la direction/);
});
it("requires the single edit budget before sending the study or baby", async () => {
  const { study } = await approvedArbeluneStudy(),
    handlers = completionDeps();
  handlers.remainingUnits = () => 99_999;
  await expect(
    previewArbeluneStudy(study, storage, { ...handlers, onStudy: vi.fn() }),
  ).rejects.toThrow(/Budget insuffisant/);
  expect(handlers.generate).not.toHaveBeenCalled();
});

async function acceptedAnatomyStudy() {
  const { completion, study } = await approvedArbeluneStudy();
  const sourceRun = "00000000-0000-0000-0000-000000000005";
  const folder = join(directory, "arbelune-study-anatomies");
  mkdirSync(folder);
  const imagePath = join(folder, `${sourceRun}-study.png`);
  const handlers = completionDeps();
  handlers.generate.mockImplementation(async () =>
    sharp(
      Buffer.from(
        '<svg width="256" height="128"><rect width="256" height="128" fill="white"/><rect x="20" y="24" width="74" height="78" rx="8" fill="#c17653"/><rect x="155" y="12" width="80" height="104" rx="12" fill="#b38754"/></svg>',
      ),
    )
      .png()
      .toBuffer(),
  );
  const result = await previewArbeluneStudy(study, storage, {
    ...handlers,
    onStudy: (bytes) => writeFileSync(imagePath, bytes),
  });
  const resultPath = join(folder, `${sourceRun}-result.json`);
  save(resultPath, { ...result, databaseWritten: false });
  const markerPath = join(directory, "arbelune-study-anatomy-started.json");
  save(markerPath, {
    runId: sourceRun,
    studyRecipeSha256: study.recipeSha256,
    studySourceRun: study.sourceRun,
  });
  const trace = [
    {
      runId: sourceRun,
      call: 602,
      type: "image",
      prompts: [study.prompt],
      referenceSha256: [
        hash(study.editImage),
        hash(createWorldAssetStore(storage).read(study.source.artRefs[5])),
      ],
    },
    { runId: sourceRun, call: 602, status: 200, finishReason: "STOP" },
  ];
  const tracePath = join(directory, "requests.jsonl");
  writeFileSync(
    tracePath,
    readFileSync(tracePath, "utf8") + trace.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  save(join(directory, "arbelune-study-visual-approval.json"), {
    version: 1,
    sourceRun,
    visualApproved: true,
    qaPassed: false,
    userMessage: "ok c'est bon",
    basisSha256: study.recipeSha256,
    studySha256: hash(readFileSync(imagePath)),
    markerSha256: hash(readFileSync(markerPath)),
    resultSha256: hash(readFileSync(resultPath)),
    traceSha256: hash(Buffer.from(JSON.stringify(trace))),
  });
  const crops: [Parameters<typeof extractStudyStage>[1], Parameters<typeof extractStudyStage>[1]] =
    [
      { left: 0, top: 0, width: 128, height: 128 },
      { left: 128, top: 0, width: 128, height: 128 },
    ];
  return { completion, study, imagePath, crops };
}
it("extracts two separate transparent stages from accepted pixels while preserving the other sixteen and the source", async () => {
  const { completion, study, imagePath, crops } = await acceptedAnatomyStudy();
  const original = readFileSync(imagePath),
    store = createWorldAssetStore(storage);
  const refs = study.source.artRefs.flatMap((ref, i) => [
    ref,
    study.source.stageArt[i][2]!,
    study.source.stageArt[i][3]!,
  ]);
  const old = refs.map(store.read);
  const stages = await prepareStudyStages(directory, completion, crops);
  const nextRefs = stages.draft.artRefs.flatMap((ref, i) => [
    ref,
    stages.draft.stageArt[i][2]!,
    stages.draft.stageArt[i][3]!,
  ]);
  expect(nextRefs.slice(0, 16)).toEqual(refs.slice(0, 16));
  expect(new Set(nextRefs).size).toBe(18);
  for (const i of [0, 1]) {
    const art = store.read(nextRefs[16 + i]);
    expect(art).toEqual(
      await sharp(await extractStudyStage(original, crops[i]))
        .png()
        .toBuffer(),
    );
    expect(await sharp(art).metadata()).toMatchObject({
      width: 1024,
      height: 1024,
      hasAlpha: true,
    });
  }
  expect(refs.map(store.read)).toEqual(old);
  expect(readFileSync(imagePath)).toEqual(original);
  await expect(prepareStudyStages(directory, completion, crops)).rejects.toThrow(/déjà préparés/);
});
it("refuses an extraction that crosses the creature instead of padding over a cut foot", async () => {
  const { imagePath } = await acceptedAnatomyStudy();
  await expect(
    extractStudyStage(readFileSync(imagePath), { left: 35, top: 0, width: 90, height: 128 }),
  ).rejects.toThrow(/marge blanche/);
});
it("rejects overlapping study regions before writing candidate stages", async () => {
  const { completion, crops } = await acceptedAnatomyStudy();
  await expect(
    prepareStudyStages(directory, completion, [crops[0], { ...crops[1], left: 100 }]),
  ).rejects.toThrow(/zones d’étude/);
});
it("pins the derived files before any later inspection", async () => {
  const { completion, crops } = await acceptedAnatomyStudy();
  const stages = await prepareStudyStages(directory, completion, crops);
  writeFileSync(join(storage, stages.draft.stageArt[5][2]!), await pixels(12));
  expect(() => loadStudyStages(directory, completion)).toThrow(/Pixels extraits/);
});
it("stops after three priority-age diagnostics on rejection, even with visual approval, without inspecting other species or generating", async () => {
  const { completion, crops } = await acceptedAnatomyStudy();
  const stages = await prepareStudyStages(directory, completion, crops),
    handlers = completionDeps();
  handlers.inspect.mockImplementation(async (asset) => ({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 0.95,
    habitatMatches: true,
    visuallyDistinct: true,
    identityMatches: asset.stage !== 3,
    growthVisible: true,
    faceReadable: true,
  }));
  const result = await inspectStudyStages(stages, handlers);
  expect(result).toMatchObject({
    outcome: "rejected",
    fullValidation: false,
    inspectedImages: 3,
    generatedImages: 0,
    published: false,
  });
  expect(result.checks.map((c) => c.slot)).toEqual([5, 5, 5]);
  expect(handlers.inspect).toHaveBeenCalledTimes(3);
  expect(handlers.generate).not.toHaveBeenCalled();
});
it("validates all eighteen final images once, Arbélune first, with face and both growth endpoints", async () => {
  const { completion, crops } = await acceptedAnatomyStudy();
  const stages = await prepareStudyStages(directory, completion, crops),
    handlers = completionDeps();
  handlers.inspect.mockResolvedValue({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 0.95,
    habitatMatches: true,
    visuallyDistinct: true,
    identityMatches: true,
    growthVisible: true,
    faceReadable: true,
  });
  const result = await inspectStudyStages(stages, handlers);
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    fullValidation: true,
    inspectedImages: 18,
    generatedImages: 0,
    published: false,
  });
  const calls = handlers.inspect.mock.calls;
  expect(calls).toHaveLength(18);
  expect(new Set(calls.map(([asset]) => asset.ref)).size).toBe(18);
  expect(
    calls
      .slice(0, 3)
      .every(([asset, draft]) => asset.requireReadableFace && draft === stages.draft),
  ).toBe(true);
  expect(calls[1][0]).toMatchObject({
    stage: 2,
    babyRef: stages.draft.artRefs[5],
    adultRef: stages.draft.stageArt[5][3],
  });
  expect(calls[2][0]).toMatchObject({ stage: 3, previousRef: stages.draft.stageArt[5][2] });
  expect(handlers.generate).not.toHaveBeenCalled();
});
it("requires the full inspection ceiling before beginning the three priority checks", async () => {
  const { completion, crops } = await acceptedAnatomyStudy();
  const stages = await prepareStudyStages(directory, completion, crops),
    handlers = completionDeps();
  handlers.remainingUnits = () => 899_999;
  await expect(inspectStudyStages(stages, handlers)).rejects.toThrow(/Budget insuffisant/);
  expect(handlers.inspect).not.toHaveBeenCalled();
});

it("rejects full validation when a later peer fails despite a passing priority lineage", async () => {
  const { completion, crops } = await acceptedAnatomyStudy();
  const stages = await prepareStudyStages(directory, completion, crops),
    handlers = completionDeps();
  handlers.inspect.mockImplementation(async (asset) => ({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 0.95,
    habitatMatches: true,
    visuallyDistinct: asset.ref !== stages.draft.artRefs[1],
    identityMatches: true,
    growthVisible: true,
    faceReadable: true,
  }));
  const result = await inspectStudyStages(stages, handlers);
  expect(result).toMatchObject({
    outcome: "rejected",
    inspectedImages: 18,
    fullValidation: false,
    published: false,
  });
});
