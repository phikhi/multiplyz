// CLI de dé-échantillonnage des fixtures créatures du SOCLE (story R3.1 #378, épic R3 #319) — même
// traitement EXACT que `scripts/regen-creature-cutout.ts` (cloudfox #361), appliqué aux 41 créatures
// réelles générées (run payant Phase 2, game-design signé ADR 0009). Lit chaque illustration RGB
// opaque (fond quasi-blanc) de `public/generated/socle/creature/<species>.png` (1024², gitignoré,
// produit par `gen-socle-creatures.local.ts`) et écrit `test-fixtures/creature/<species>.png`
// (RGBA, fond transparent, **256px**, PNG niveau 9) — la SOURCE committée (non-gitignorée) que
// `seedCreatureSprites` recopie vers `public/generated/` au démarrage dev/E2E.
//
// **Détourage flood-fill DEPUIS LES BORDS** (`floodFillTransparency`, fuzz=38, IDENTIQUE à cloudfox)
// → le thumbnail flotte proprement sur le fond de carte (light ET dark), jamais un carré blanc.
//
// **Séparation logique/I-O** (patron `scripts/db-migrate.ts` ↔ `src/lib/…`) : la logique PURE de
// détourage vit dans `src/lib/image/flood-fill-transparency.ts` (coverage 100 %) ; ce CLI n'est que
// le wiring `sharp` (hors coverage). Rejouable si le run payant est relancé.
//
// Usage : `pnpm exec tsx scripts/regen-socle-creature-cutouts.ts`
import { readdirSync, statSync } from "node:fs";
import sharp from "sharp";
import { floodFillTransparency } from "../src/lib/image/flood-fill-transparency";

/** Dossier des illustrations réelles générées (gitignoré, produit par le run payant). */
const GEN_DIR = "public/generated/socle/creature";
/** Dossier des fixtures committées (source de vérité recopiée par le seed). */
const OUT_DIR = "test-fixtures/creature";
/** Taille cible du thumbnail (px) — IDENTIQUE à cloudfox (`regen-creature-cutout.ts`). */
const SIZE = 256;
/** Fuzz du flood-fill — IDENTIQUE à cloudfox (fond ~239-255 quasi-uniforme, coins vérifiés). */
const FUZZ = 38;

/** Une espèce du socle = tout PNG généré SAUF la démo cloudfox (déjà traitée, non regénérée). */
function socleGeneratedSpecies(): string[] {
  return readdirSync(GEN_DIR)
    .filter((f) => f.endsWith(".png") && f !== "cloudfox.png")
    .map((f) => f.replace(/\.png$/, ""))
    .sort();
}

async function cutout(species: string): Promise<number> {
  const source = `${GEN_DIR}/${species}.png`;
  const output = `${OUT_DIR}/${species}.png`;
  const { data, info } = await sharp(source)
    .resize(SIZE, SIZE, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = floodFillTransparency({
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
    fuzz: FUZZ,
  });
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(output);
  return statSync(output).size;
}

async function main(): Promise<void> {
  const species = socleGeneratedSpecies();
  let totalBytes = 0;
  for (const s of species) {
    const bytes = await cutout(s);
    totalBytes += bytes;
    process.stdout.write(`${s} (${(bytes / 1024).toFixed(1)}KB) `);
  }
  console.log(
    `\n[regen-socle-creature-cutouts] ${species.length} fixtures → ${OUT_DIR} ` +
      `(${(totalBytes / 1024 / 1024).toFixed(2)}MB, 256², fuzz=${FUZZ})`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
