import { expect, it } from "vitest";
import sharp from "sharp";
import { cutoutNewCreature } from "./creature-growth";
import { cropFramedCreature } from "./pilot-cast-recovery";

const crop = { left: 20, top: 20, width: 80, height: 80 };
async function framed(touching = false) {
  return sharp(
    Buffer.from(
      `<svg width="120" height="120"><rect width="120" height="120" fill="black"/><rect x="10" y="10" width="100" height="100" fill="white"/><rect x="${touching ? 20 : 40}" y="40" width="40" height="40" fill="#ab6633"/><rect x="50" y="50" width="10" height="10" fill="white"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
}
it("recovers a reviewed white interior, keeping subject RGB and enclosed pale markings", async () => {
  const original = await framed();
  await expect(cutoutNewCreature(original)).rejects.toThrow(/fond doit être blanc/);
  const result = await cropFramedCreature(original, crop);
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(80);
  expect([...data.subarray((25 * 80 + 25) * 4, (25 * 80 + 25) * 4 + 4)]).toEqual([
    171, 102, 51, 255,
  ]);
  expect([...data.subarray((35 * 80 + 35) * 4, (35 * 80 + 35) * 4 + 4)]).toEqual([
    255, 255, 255, 255,
  ]);
  expect(data[3]).toBe(0);
  // No global fallback: an unreviewed framed image still fails the original guard.
  await expect(cutoutNewCreature(original)).rejects.toThrow(/fond doit être blanc/);
});
it("refuses a crop touching the creature", async () => {
  await expect(cropFramedCreature(await framed(true), crop)).rejects.toThrow(/marge blanche/);
});
it("refuses a crop still containing the dark frame", async () => {
  await expect(
    cropFramedCreature(await framed(), { left: 0, top: 0, width: 120, height: 120 }),
  ).rejects.toThrow(/marge blanche/);
});
