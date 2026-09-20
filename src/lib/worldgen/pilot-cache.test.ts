import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { loadPilotImageCache } from "./pilot-cache";

let directory: string, pixels: Buffer;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "teddy-pilot-cache-"));
  mkdirSync(join(directory, "storage/worldgen/raw"), { recursive: true });
  pixels = await sharp({ create: { width: 4, height: 4, channels: 4, background: "red" } })
    .png()
    .toBuffer();
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it("reuses only a completed image with the same prompt and exact reference bytes", async () => {
  const reference = Buffer.from("master-reference");
  writeFileSync(
    join(directory, "requests.jsonl"),
    [
      {
        call: 1,
        type: "image",
        prompts: ["same prompt"],
        referenceSha256: [createHash("sha256").update(reference).digest("hex")],
      },
      { call: 1, status: 200 },
      { call: 2, type: "image", prompts: ["interrupted"], referenceSha256: [] },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );
  for (const call of [1, 2])
    writeFileSync(join(directory, `storage/worldgen/raw/${call}-0.png`), pixels);
  const cache = await loadPilotImageCache(directory);
  expect(cache.size).toBe(1);
  expect(
    cache.read({ prompt: "same prompt", refImages: [{ data: reference, mimeType: "image/png" }] }),
  ).toEqual(pixels);
  expect(
    cache.read({
      prompt: "changed prompt",
      refImages: [{ data: reference, mimeType: "image/png" }],
    }),
  ).toBeUndefined();
  expect(
    cache.read({
      prompt: "same prompt",
      refImages: [{ data: Buffer.from("different master"), mimeType: "image/png" }],
    }),
  ).toBeUndefined();
  expect(cache.read({ prompt: "interrupted" })).toBeUndefined();
});

it("fails before a resume can make any call if a completed cached image is corrupt", async () => {
  writeFileSync(
    join(directory, "requests.jsonl"),
    '{"call":1,"type":"image","prompts":["background"],"referenceSha256":[]}\n{"call":1,"status":200}\n',
  );
  writeFileSync(join(directory, "storage/worldgen/raw/1-0.png"), "corrupted");
  await expect(loadPilotImageCache(directory)).rejects.toThrow();
});
