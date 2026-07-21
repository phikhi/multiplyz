// CLI de génération du fixture créature **dé-échantillonné + avec alpha** (story R2.1, #361) — même
// patron que `scripts/regen-teddy-cutout.ts` (fix #329). Lit l'illustration de créature générée du
// spike (`docs/spike/nano-banana/03-creature-cloudfox.png`, RGB opaque, fond blanc) et écrit
// `test-fixtures/creature/cloudfox.png` (RGBA, fond transparent, **256px**) : une vraie créature
// pour rendre l'écran Collection OBSERVABLE avec du VRAI art (une créature réelle, les autres restent
// en placeholder emoji) — la génération du SET COMPLET de créatures arrive à R3.1 (pipeline).
//
// **Détourage flood-fill DEPUIS LES BORDS** (`floodFillTransparency`, jamais un white-key global qui
// mangerait le poitrail/museau crème INTERNE de la créature — kawaii vert/crème, cf. le spike) → le
// thumbnail flotte proprement sur le fond de carte (light ET dark theme), pas un carré blanc opaque.
//
// **Séparation logique/I-O** (patron `scripts/db-migrate.ts` ↔ `src/lib/…`) : la logique PURE de
// détourage vit dans `src/lib/image/flood-fill-transparency.ts` (scope coverage 100 %, testée à effet
// observable #329) ; ce CLI n'est que le wiring I/O `sharp` (hors coverage) — resize 256px + décodage
// → buffer RGB brut, ré-encodage RGBA → PNG. Outil de build ponctuel (rejouable si le spike change).
//
// Usage : `pnpm exec tsx scripts/regen-creature-cutout.ts`
import sharp from "sharp";
import { floodFillTransparency } from "../src/lib/image/flood-fill-transparency";

const SOURCE = "docs/spike/nano-banana/03-creature-cloudfox.png";
const OUTPUT = "test-fixtures/creature/cloudfox.png";
/** Taille cible du thumbnail (px) — aligné sur l'ordre de grandeur des sprites Teddy (~262px). */
const SIZE = 256;
// Le fond blanc du spike est ~254 (quasi pur) ; le poitrail crème le plus clair en est à ~20 de
// distance MAIS reste INTERNE (enclos par le corps vert, jamais connecté au bord) → le flood-fill
// 4-connexe depuis les bords ne l'atteint pas. Fuzz=38 retire le fond + le halo d'anti-aliasing du
// resize sans « falaise » d'ingestion (vérifié visuellement, rétro build #338).
const FUZZ = 38;

async function main(): Promise<void> {
  const { data, info } = await sharp(SOURCE)
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
    .toFile(OUTPUT);
  console.log(
    `[regen-creature-cutout] ${SOURCE} → ${OUTPUT} (${info.width}×${info.height}, fuzz=${FUZZ})`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
