import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { testCreatureDesign } from "./creature-design.test-helper";
import { previewCastGrowth } from "./creature-cast-growth";
import type { CastDraft } from "./creature-cast-preview";
import type { AssetInspection, InspectableAsset } from "./qa";
import type { GenerateImageInput } from "./image-client";
import { createWorldAssetStore } from "./runtime-assets";
import { loadWorldGenConfig } from "@/config/server-config";

let storage: string, cast: CastDraft, originals: Buffer[];
const pixels = (colour: number) =>
  sharp({
    create: {
      width: 8,
      height: 8,
      channels: 4,
      background: { r: colour, g: 170, b: 150, alpha: 1 },
    },
  })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
beforeEach(async () => {
  storage = mkdtempSync(join(realpathSync(tmpdir()), "teddy-cast-growth-"));
  const store = createWorldAssetStore(storage);
  originals = await Promise.all(Array.from({ length: 6 }, (_, i) => pixels(i + 5)));
  cast = { plan: testCreatureDesign(), artRefs: [] };
  for (const [i, bytes] of originals.entries())
    cast.artRefs.push(await store.write(6, `creature-${i}.png`, bytes));
});
afterEach(() => rmSync(storage, { recursive: true, force: true }));
function deps() {
  let colour = 30;
  return {
    config: loadWorldGenConfig({}),
    remainingUnits: () => 5_800_000,
    generate: vi.fn<(input: GenerateImageInput) => Promise<Buffer>>(async () => pixels(++colour)),
    inspect: vi.fn<(asset: InspectableAsset) => Promise<AssetInspection>>(async () => ({
      detectedText: "",
      unsafeScore: 0,
      styleScore: 1,
      habitatMatches: true,
      visuallyDistinct: true,
      identityMatches: true,
      growthVisible: true,
    })),
    onDraft: vi.fn(),
    onCheck: vi.fn(),
  };
}
it("reuses exact babies, anchors both older ages and inspects all eighteen with correct references", async () => {
  const handlers = deps();
  const result = await previewCastGrowth(cast, storage, handlers);
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    generatedImages: 12,
    reusedBabies: 6,
    images: 18,
    published: false,
  });
  expect(handlers.generate).toHaveBeenCalledTimes(12);
  expect(handlers.inspect).toHaveBeenCalledTimes(18);
  expect(handlers.onDraft).toHaveBeenCalledTimes(13);
  expect(handlers.onCheck).toHaveBeenCalledTimes(18);
  const store = createWorldAssetStore(storage);
  for (let slot = 0; slot < 6; slot++) {
    expect(store.read(cast.artRefs[slot])).toEqual(originals[slot]);
    expect(handlers.generate.mock.calls[slot * 2][0].refImages?.map((r) => r.data)).toEqual([
      originals[slot],
    ]);
    const ado = handlers.inspect.mock.calls[slot * 3 + 1][0];
    const adult = handlers.inspect.mock.calls[slot * 3 + 2][0];
    expect(ado).toMatchObject({ babyRef: cast.artRefs[slot], stage: 2 });
    expect(adult).toMatchObject({ babyRef: cast.artRefs[slot], previousRef: ado.ref, stage: 3 });
    expect(handlers.generate.mock.calls[slot * 2 + 1][0].refImages?.map((r) => r.data)).toEqual([
      originals[slot],
      store.read(ado.ref),
    ]);
  }
});
it("requires the full twelve images and eighteen inspections budget before sending anything", async () => {
  const handlers = deps();
  handlers.remainingUnits = () => 2_099_999;
  await expect(previewCastGrowth(cast, storage, handlers)).rejects.toThrow(/Budget insuffisant/);
  expect(handlers.generate).not.toHaveBeenCalled();
  expect(handlers.inspect).not.toHaveBeenCalled();
});
it.each(["identityMatches", "growthVisible", "habitatMatches", "visuallyDistinct"] as const)(
  "keeps a false %s rejection without retries while completing the eighteen diagnostics",
  async (signal) => {
    const handlers = deps();
    handlers.inspect.mockImplementation(async () => ({
      detectedText: "",
      unsafeScore: 0,
      styleScore: 1,
      habitatMatches: true,
      visuallyDistinct: true,
      identityMatches: true,
      growthVisible: true,
      [signal]: false,
    }));
    const result = await previewCastGrowth(cast, storage, handlers);
    expect(result.outcome).toBe("rejected");
    expect(handlers.inspect).toHaveBeenCalledTimes(18);
    expect(handlers.generate).toHaveBeenCalledTimes(12);
  },
);
it("refuses missing growth signals rather than treating style alone as approval", async () => {
  const handlers = deps();
  handlers.inspect.mockResolvedValue({
    detectedText: "",
    unsafeScore: 0,
    styleScore: 1,
    habitatMatches: true,
    visuallyDistinct: true,
  });
  await expect(previewCastGrowth(cast, storage, handlers)).rejects.toThrow(/Signaux/);
});
it("journals an adolescent before an interrupted adult call and preserves all babies", async () => {
  const handlers = deps();
  handlers.generate
    .mockImplementationOnce(async () => pixels(100))
    .mockImplementationOnce(async () => {
      throw new Error("interrupted");
    });
  await expect(previewCastGrowth(cast, storage, handlers)).rejects.toThrow("interrupted");
  const saved = handlers.onDraft.mock.calls.at(-1)?.[0];
  expect(saved.stageArt[0][2]).toBeTruthy();
  expect(saved.stageArt[0][3]).toBeUndefined();
  expect(handlers.inspect).not.toHaveBeenCalled();
});
it("refuses an exact copy of another baby's pixels before inspecting or producing later stages", async () => {
  const handlers = deps();
  handlers.generate.mockResolvedValue(Buffer.from(originals[1]));
  await expect(previewCastGrowth(cast, storage, handlers)).rejects.toThrow(/recopie/);
  expect(handlers.generate).toHaveBeenCalledTimes(1);
  expect(handlers.inspect).not.toHaveBeenCalled();
});
it("redraws all twelve with the reviewed instructions, including former QA passes, without recycling a rejected art", async () => {
  const old = await pixels(120);
  const oldRef = await createWorldAssetStore(storage).write(6, "creature-0-ado.png", old);
  const handlers = deps();
  const instructions = (slot: number, stage: 2 | 3) =>
    `Reviewed anatomy for species ${slot} and age ${stage}: a substantially developed long body with a small face.`;
  const result = await previewCastGrowth(cast, storage, {
    ...handlers,
    stageInstructions: instructions,
    excludedArts: [oldRef],
  });
  expect(result.generatedImages).toBe(12);
  for (let i = 0; i < 12; i++) {
    const prompt = handlers.generate.mock.calls[i][0].prompt;
    expect(prompt).toContain(instructions(Math.floor(i / 2), i % 2 === 0 ? 2 : 3));
    expect(prompt).not.toContain(
      i % 2 === 0
        ? cast.plan.creatures[Math.floor(i / 2)].adolescent
        : cast.plan.creatures[Math.floor(i / 2)].adult,
    );
  }
  expect(createWorldAssetStore(storage).read(oldRef)).toEqual(old);
  const copied = deps();
  copied.generate.mockResolvedValue(Buffer.from(old));
  await expect(
    previewCastGrowth(cast, storage, {
      ...copied,
      stageInstructions: instructions,
      excludedArts: [oldRef],
    }),
  ).rejects.toThrow(/recopie/);
  expect(copied.generate).toHaveBeenCalledTimes(1);
});
