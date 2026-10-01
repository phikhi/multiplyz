import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { cutoutNewCreature, generateCreatureGrowth } from "./creature-growth";
import { loadWorldGenConfig } from "@/config/server-config";
import type { GeneratedWorld } from "./generate-world";

async function sample(background = "white") {
  return sharp(
    Buffer.from(
      `<svg width="20" height="20"><rect width="20" height="20" fill="${background}"/><rect x="4" y="4" width="12" height="12" fill="#405080"/><rect x="8" y="8" width="4" height="4" fill="white"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
}

it("cuts only the white region connected to edges, preserving enclosed pale markings", async () => {
  const cutout = await cutoutNewCreature(await sample());
  const pixels = await sharp(cutout).raw().toBuffer();
  expect(pixels[3]).toBe(0);
  expect([...pixels.subarray((10 * 20 + 10) * 4, (10 * 20 + 10) * 4 + 4)]).toEqual([
    255, 255, 255, 255,
  ]);
  expect(await cutoutNewCreature(cutout)).toEqual(cutout);
});

it.each(["#387c89", "transparent", "white"])(
  "refuses an unrecognised matte or empty image (%s)",
  async (background) => {
    const bytes =
      background === "#387c89"
        ? await sample(background)
        : await sharp({ create: { width: 20, height: 20, channels: 4, background } })
            .png()
            .toBuffer();
    await expect(cutoutNewCreature(bytes)).rejects.toThrow(/Détourage/);
  },
);

it("refuses a byte-identical replacement before publishing any older-stage asset", async () => {
  const baby = await cutoutNewCreature(await sample());
  const writeAsset = vi.fn();
  const world: GeneratedWorld = {
    worldId: "world:6",
    worldIndex: 6,
    themeSlug: "magic",
    themeLabel: "Magie",
    palette: "{}",
    assetRefs: { background: "bg.png", tiles: "tiles.png", teddy: "teddy.png" },
    seed: "6",
    status: "buffered",
    creatures: [
      {
        id: "new",
        speciesKey: "new",
        nameDefault: "Nuage",
        rarity: "common",
        inEggPool: true,
        artRef: "baby.png",
        story: "Nuage.",
      },
    ],
    cost: { paidImageCalls: 9, estimatedEur: 1, monthlyBudgetEur: 5 },
  };
  await expect(
    generateCreatureGrowth(world, {
      config: loadWorldGenConfig({}),
      generate: async () => baby,
      writeAsset,
      readAsset: () => baby,
    }),
  ).rejects.toThrow(/recopie/);
  expect(writeAsset).not.toHaveBeenCalled();
});
