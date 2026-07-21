/**
 * **Génère les icônes PWA + écrans de démarrage iOS RÉELS de multiplyz depuis le master Teddy**
 * (story R2.3, #362, ART §2 « master = source de Teddy »). Remplace les placeholders génériques
 * (`icon-192.png` violet uni 546 o, `icon-512.png` 1.8 Ko) par de VRAIES icônes à l'effigie de
 * Teddy (le Steiff 80s de sa fille), pour que l'app installée sur l'écran d'accueil montre la
 * mascotte, pas un carré de couleur.
 *
 * **Pipeline** (réutilise la logique PURE testée #329/#338) :
 *  1. `storage/reference/teddy/teddy-master.png` (master validé #158, **owner-local gitignoré** —
 *     même statut owner-run que la dérivation des sprites R2.2 et l'outil Stage A) →
 *  2. `floodFillTransparency` (fuzz=40, depuis les bords, `src/lib/image/`) retire le fond blanc
 *     RÉSIDUEL du master (il conserve un patch blanc OPAQUE en haut-gauche → sinon carré blanc, #329) →
 *  3. `trim` recadre serré sur Teddy →
 *  4. composition centrée sur une toile de fond de la couleur de marque.
 *
 * **Couleurs depuis `src/config/pwa.ts`** (jamais de hex en dur — règle tokens) :
 *  - icônes  : fond `PWA_THEME_COLOR` (#7A5AF8 violet) — OPAQUE (obligatoire pour `maskable`) et
 *    contrasté, Teddy (brun/crème) y ressort. `any` = Teddy large ; `maskable` = Teddy réduit DANS
 *    la zone de sécurité (cercle 80 %) pour que le masque Android (cercle/squircle) ne le rogne pas.
 *  - splash iOS : fond `PWA_BG_COLOR` (#FAF7FF lavande) = même valeur que `background_color` du
 *    manifest (convention splash).
 *
 * **Reproductible & committé** (AC #362 : pas de binaire opaque sans source) — les PNG écrits sous
 * `public/` sont trackés (contrairement à `public/generated/` gitignoré) ; leur INTÉGRITÉ (vrai
 * Teddy, pas placeholder ; maskable non rogné ; splash aux bonnes dims) est verrouillée par
 * `src/app/pwa-assets.test.ts` (décode les VRAIS pixels — un `.png` opaque/placeholder rougirait).
 *
 * Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors du résolveur de paths Next —
 * même contrainte que `scripts/regen-teddy-cutout.ts` / `db-migrate.ts`. Wiring I/O `sharp` pur,
 * hors du scope coverage `src/**` (patron `scripts/db-migrate.ts`) ; la logique pure (cutout,
 * dérivation des chemins splash) vit sous `src/` et EST couverte.
 *
 * Usage (owner, master en place) : `pnpm exec tsx scripts/gen-app-icons.ts`
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { floodFillTransparency } from "../src/lib/image/flood-fill-transparency";
import {
  APPLE_SPLASH_DEVICES,
  appleSplashPixels,
  appleSplashUrl,
  PWA_BG_COLOR,
  PWA_THEME_COLOR,
} from "../src/config/pwa";

/** Master Teddy owner-local (gitignoré `/storage/`, défaut `referenceDir` de server-config). */
const MASTER = "storage/reference/teddy/teddy-master.png";
/** Racine publique servie par Next/Nginx — `public/` (les icônes/splash y sont TRACKÉS, hors `generated/`). */
const PUBLIC_ROOT = "public";
/** Même calibrage que `regen-teddy-cutout` (#338) : pas de falaise d'ingestion de fourrure crème. */
const FUZZ = 40;

/**
 * ⚙️ Fractions de contenu (part de la toile occupée par la bbox de Teddy, centré). Calibrables.
 * `MASKABLE` ≤ ~0.66 garantit que les extrémités de Teddy (pattes/oreilles, à r≈0.33·taille du
 * centre) restent DANS le cercle de sécurité maskable (rayon 0.40·taille) → jamais rognées.
 */
const ANY_CONTENT = 0.86;
const MASKABLE_CONTENT = 0.66;
const APPLE_CONTENT = 0.82;
/** Splash : largeur de Teddy = 42 % de la largeur de l'écran (logo centré aéré). */
const SPLASH_WIDTH_FRACTION = 0.42;

/** Tailles d'icônes (px). `apple-touch-icon` = 180 (défaut iOS). */
const ICON_SIZES = { any: [192, 512] as const, maskable: [192, 512] as const, apple: 180 };

/** Master → Teddy détouré et recadré serré (RGBA). Une seule décode/cutout, réutilisé partout. */
async function teddyCutout(): Promise<Buffer> {
  const { data, info } = await sharp(MASTER)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = floodFillTransparency({
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
    fuzz: FUZZ,
  });
  // `trim` retire les marges transparentes → centrage précis ensuite (bbox serrée sur Teddy).
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 1 })
    .png()
    .toBuffer();
}

/** Compose Teddy centré sur une toile carrée `size` de fond `bg`, écrit `PUBLIC_ROOT/<name>`. */
async function writeSquare(
  teddy: Buffer,
  size: number,
  contentFraction: number,
  bg: string,
  name: string,
): Promise<void> {
  const box = Math.round(size * contentFraction);
  const sprite = await sharp(teddy)
    .resize(box, box, { fit: "inside" })
    .toBuffer({ resolveWithObject: true });
  const left = Math.round((size - sprite.info.width) / 2);
  const top = Math.round((size - sprite.info.height) / 2);
  await compose(size, size, bg, sprite.data, left, top, name);
}

/** Compose Teddy centré sur une toile portrait `pxWidth×pxHeight` de fond `bg`. */
async function writeSplash(
  teddy: Buffer,
  pxWidth: number,
  pxHeight: number,
  bg: string,
  name: string,
): Promise<void> {
  const sprite = await sharp(teddy)
    .resize({ width: Math.round(pxWidth * SPLASH_WIDTH_FRACTION) })
    .toBuffer({ resolveWithObject: true });
  const left = Math.round((pxWidth - sprite.info.width) / 2);
  const top = Math.round((pxHeight - sprite.info.height) / 2);
  await compose(pxWidth, pxHeight, bg, sprite.data, left, top, name);
}

/** Toile de fond opaque + sprite composité à (left, top) → PNG committé. */
async function compose(
  width: number,
  height: number,
  bg: string,
  sprite: Buffer,
  left: number,
  top: number,
  name: string,
): Promise<void> {
  const out = resolve(PUBLIC_ROOT, name);
  mkdirSync(dirname(out), { recursive: true });
  await sharp({ create: { width, height, channels: 4, background: bg } })
    .composite([{ input: sprite, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(out);
}

async function main(): Promise<void> {
  const teddy = await teddyCutout();

  // Icônes PWA (fond accent violet, opaque).
  for (const size of ICON_SIZES.any) {
    await writeSquare(teddy, size, ANY_CONTENT, PWA_THEME_COLOR, `icon-${size}.png`);
  }
  for (const size of ICON_SIZES.maskable) {
    await writeSquare(teddy, size, MASKABLE_CONTENT, PWA_THEME_COLOR, `icon-${size}-maskable.png`);
  }
  await writeSquare(
    teddy,
    ICON_SIZES.apple,
    APPLE_CONTENT,
    PWA_THEME_COLOR,
    "apple-touch-icon.png",
  );

  // Splash iOS (fond lavande = background_color du manifest).
  for (const device of APPLE_SPLASH_DEVICES) {
    const { pxWidth, pxHeight } = appleSplashPixels(device);
    const name = appleSplashUrl(device).replace(/^\//, "");
    await writeSplash(teddy, pxWidth, pxHeight, PWA_BG_COLOR, name);
  }

  console.log(
    `[gen-app-icons] ${ICON_SIZES.any.length + ICON_SIZES.maskable.length + 1} icônes + ${APPLE_SPLASH_DEVICES.length} splash → ${PUBLIC_ROOT}/`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
