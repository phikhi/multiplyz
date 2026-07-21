// CLI de régénération du fixture Teddy **avec alpha** (fix #329, story #338) : lit la source JPEG
// opaque committée (`teddy-source.jpg`, fond blanc — conservée pour provenance/reproductibilité,
// jamais servie par `seedRealWorldFixture`) et écrit `teddy.png` (RGBA, fond transparent) via
// flood-fill DEPUIS LES BORDS (`floodFillTransparency`, jamais un white-key global qui mangerait
// le torse/museau crème de Teddy — cf. commentaire de tête du module).
//
// Hors `src/` (pas de coverage, même patron que `scripts/db-migrate.ts`) — outil de build ponctuel,
// rejouable si la source `teddy-source.jpg` change (nouvelle photo/génération du monde emprunté,
// cf. `BORROWED_SLOT` dans `scripts/lib/seed-real-world-fixture.ts`). `sharp` (devDependency) sert
// UNIQUEMENT ici : décodage JPEG → buffer RGB brut, ré-encodage RGBA → PNG.
//
// Usage : `pnpm exec tsx scripts/regen-teddy-cutout.ts`
import sharp from "sharp";
import { floodFillTransparency } from "./lib/flood-fill-transparency";

const SOURCE = "test-fixtures/world/socle-sample/teddy-source.jpg";
const OUTPUT = "test-fixtures/world/socle-sample/teddy.png";
// Calibré empiriquement (rétro build #338) : le fond JPEG bruite jusqu'à ~14 de distance de son
// point moyen (253,253,253) ; la fourrure crème la plus proche du blanc (torse/coussinets) en est
// à ~80. Fuzz=40 laisse une marge large des deux côtés — vérifié qu'il ne mange aucune fourrure en
// comparant les pixels de fond détectés à fuzz=25/40/60/100 (delta < 0.5 % du total, pas de saut).
const FUZZ = 40;

async function main(): Promise<void> {
  const { data, info } = await sharp(SOURCE).raw().toBuffer({ resolveWithObject: true });
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
  console.log(`[regen-teddy-cutout] ${SOURCE} → ${OUTPUT} (fuzz=${FUZZ})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
