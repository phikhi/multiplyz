/** Rebuild derived cutouts from retained raw art, never touches existing baby sprites. */
import sharp from "sharp";
import { readdirSync, existsSync } from "node:fs";
import { floodFillTransparency } from "../src/lib/image/flood-fill-transparency";
async function main() {
  for (const file of readdirSync("storage/creature-stages").filter((name) =>
    name.endsWith(".png"),
  )) {
    // The pilot already published to the isolated playthrough retains its reviewed bytes.
    if (file.startsWith("creature_world_0_0-") && existsSync(`assets/creature-stages/${file}`))
      continue;
    const { data, info } = await sharp(`storage/creature-stages/${file}`)
      .flatten({ background: "#ffffff" })
      .resize(768, 768, { fit: "contain", background: "#ffffff" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Neutral near-white background, with coloured pastel regions kept intact.
    // For magenta rerenders the existing edge-connected cutout is unambiguous.
    let rgba: Buffer;
    if (data[0] > 180 && data[1] < 140 && data[2] > 100) {
      rgba = floodFillTransparency({
        data,
        width: info.width,
        height: info.height,
        channels: info.channels,
        fuzz: 38,
      });
    } else {
      const mask = Buffer.alloc(data.length);
      for (let i = 0; i < data.length; i += 3) {
        const lo = Math.min(data[i], data[i + 1], data[i + 2]);
        const hi = Math.max(data[i], data[i + 1], data[i + 2]);
        const bg = lo >= 236 && hi - lo <= 16;
        mask[i] = mask[i + 1] = mask[i + 2] = bg ? 255 : 0;
      }
      rgba = floodFillTransparency({
        data: mask,
        width: info.width,
        height: info.height,
        channels: 3,
        fuzz: 2,
      });
      for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
        rgba[j] = data[i];
        rgba[j + 1] = data[i + 1];
        rgba[j + 2] = data[i + 2];
      }
    }
    await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toFile(`assets/creature-stages/${file}`);
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
