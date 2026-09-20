import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { testCreatureDesign } from "./creature-design.test-helper";
import { previewCreatureCast } from "./creature-cast-preview";
import { createWorldAssetStore } from "./runtime-assets";
import { loadWorldGenConfig } from "@/config/server-config";

let storage: string, oldRef: string, oldBytes: Buffer;
beforeEach(async () => {
  storage = mkdtempSync(join(realpathSync(tmpdir()), "teddy-cast-"));
  oldBytes = await pixels(90);
  oldRef = await createWorldAssetStore(storage).write(6, "creature-0.png", oldBytes);
});
afterEach(() => rmSync(storage, { recursive: true, force: true }));
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
function deps() {
  let colour = 10;
  return {
    config: loadWorldGenConfig({}),
    remainingUnits: () => 1_700_000,
    generate: vi.fn(async () => pixels(++colour)),
    inspect: vi.fn(async () => ({
      detectedText: "",
      unsafeScore: 0,
      styleScore: 1,
      habitatMatches: true,
      visuallyDistinct: true,
    })),
    onDraft: vi.fn(),
  };
}
it("creates only six babies, inspects all of them and preserves the previous pilot's images", async () => {
  const handlers = deps();
  const result = await previewCreatureCast(testCreatureDesign(), storage, handlers);
  expect(result).toMatchObject({
    outcome: "passed-for-visual-review",
    images: 6,
    published: false,
    growthGenerated: false,
  });
  expect(handlers.generate).toHaveBeenCalledTimes(6);
  expect(handlers.inspect).toHaveBeenCalledTimes(6);
  expect(handlers.onDraft).toHaveBeenCalledTimes(1);
  expect(readFileSync(join(storage, oldRef))).toEqual(oldBytes);
});
it("does not start spending unless every baby and its QA fit the remaining budget", async () => {
  const handlers = deps();
  handlers.remainingUnits = () => 899_999;
  await expect(previewCreatureCast(testCreatureDesign(), storage, handlers)).rejects.toThrow(
    /Budget insuffisant/,
  );
  expect(handlers.generate).not.toHaveBeenCalled();
  expect(handlers.inspect).not.toHaveBeenCalled();
});
it("detects identical baby pixels before paying for any inspection", async () => {
  const handlers = deps();
  handlers.generate.mockImplementation(async () => pixels(25));
  await expect(previewCreatureCast(testCreatureDesign(), storage, handlers)).rejects.toThrow(
    /mêmes pixels/,
  );
  expect(handlers.generate).toHaveBeenCalledTimes(2);
  expect(handlers.inspect).not.toHaveBeenCalled();
});
it.each(["habitatMatches", "visuallyDistinct"] as const)(
  "retains a refusal of %s even when the raw style score is high",
  async (field) => {
    const handlers = deps();
    handlers.inspect.mockResolvedValue({
      detectedText: "",
      unsafeScore: 0,
      styleScore: 1,
      habitatMatches: true,
      visuallyDistinct: true,
      [field]: false,
    });
    const result = await previewCreatureCast(testCreatureDesign(), storage, handlers);
    expect(result.outcome).toBe("rejected");
    expect(handlers.inspect).toHaveBeenCalledTimes(6);
  },
);

it("saves each new image before a later interruption", async () => {
  const handlers = deps(),
    onImage = vi.fn(),
    onCheck = vi.fn();
  handlers.generate
    .mockImplementationOnce(async () => pixels(20))
    .mockRejectedValueOnce(new Error("interrupted"));
  await expect(
    previewCreatureCast(testCreatureDesign(), storage, { ...handlers, onImage, onCheck }),
  ).rejects.toThrow("interrupted");
  expect(onImage).toHaveBeenCalledTimes(1);
  expect(onImage.mock.calls[0][0].artRefs).toHaveLength(1);
  expect(handlers.inspect).not.toHaveBeenCalled();
  expect(readFileSync(join(storage, oldRef))).toEqual(oldBytes);
});
