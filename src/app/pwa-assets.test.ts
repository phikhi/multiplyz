import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import sharp from "sharp";
import manifest from "./manifest";
import {
  APPLE_SPLASH_DEVICES,
  appleSplashPixels,
  appleSplashUrl,
  appleStartupImages,
  PWA_BG_COLOR,
  PWA_THEME_COLOR,
} from "@/config/pwa";

/**
 * **Gate d'intégrité des LIVRABLES icône/splash PWA (#362)** — double-garde artefact (patron
 * #329/#338/#360) : le manifest, le layout et `config/pwa` peuvent référencer des `.png` — mais un
 * `.png` **placeholder** (violet uni 546 o, l'état AVANT cette story) OU un `maskable` **rogné**
 * (sans zone de sécurité → Teddy coupé par le masque Android) passerait toute assertion structurelle
 * à l'identique (classe #239 : assertion permissive qui matche la sortie boguée). Ce test décode les
 * **VRAIS pixels** des fichiers committés et rougit si :
 *  - une icône redevient une couleur unie / un placeholder (aucun Teddy) ;
 *  - une icône `maskable` PERD sa zone de sécurité (Teddy déborde du cercle 80 % → rogné) ;
 *  - une icône `any` devient sur-margée (Teddy minuscule) ;
 *  - un fichier référencé par le manifest/les startup-images est absent ou aux mauvaises dimensions.
 *
 * `sharp` (devDependency, aligné Next) sert ici + dans les CLI `scripts/*` — jamais au runtime app.
 */
const PUBLIC = resolve(process.cwd(), "public");

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Un pixel est "fond" s'il est proche (≤ tol/canal) de la couleur de toile. */
function isBackground(
  r: number,
  g: number,
  b: number,
  bg: readonly [number, number, number],
  tol = 24,
): boolean {
  return Math.abs(r - bg[0]) <= tol && Math.abs(g - bg[1]) <= tol && Math.abs(b - bg[2]) <= tol;
}

interface Metrics {
  readonly width: number;
  readonly height: number;
  readonly format: string;
  /** Fraction de pixels OPAQUES qui ne sont PAS le fond (= surface de Teddy peinte). */
  readonly subjectFraction: number;
  /** Rayon max (depuis le centre) d'un pixel-sujet, en fraction de la demi-taille (0..~1.41). */
  readonly maxSubjectRadiusRatio: number;
  /** Pixel central : opaque ET non-fond (Teddy présent au centre) ? */
  readonly centerIsSubject: boolean;
}

async function metrics(relPath: string, bgHex: string): Promise<Metrics> {
  const abs = resolve(PUBLIC, relPath);
  const meta = await sharp(abs).metadata();
  const { data, info } = await sharp(abs).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const bg = hexToRgb(bgHex);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const half = Math.min(w, h) / 2;

  let subject = 0;
  let maxR = 0;
  const total = w * h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      if (data[i + 3] > 200 && !isBackground(data[i], data[i + 1], data[i + 2], bg)) {
        subject++;
        const r = Math.hypot(x - cx, y - cy);
        if (r > maxR) maxR = r;
      }
    }
  }
  const centerI = (Math.round(cy) * w + Math.round(cx)) * ch;
  return {
    width: w,
    height: h,
    format: meta.format ?? "",
    subjectFraction: subject / total,
    maxSubjectRadiusRatio: maxR / half,
    centerIsSubject:
      data[centerI + 3] > 200 &&
      !isBackground(data[centerI], data[centerI + 1], data[centerI + 2], hexToRgb(bgHex)),
  };
}

describe("icônes PWA — intégrité du VRAI Teddy (#362)", () => {
  // Fond violet (PWA_THEME_COLOR) pour toutes les icônes.
  const ICONS = [
    { file: "icon-192.png", size: 192, kind: "any" as const },
    { file: "icon-512.png", size: 512, kind: "any" as const },
    { file: "icon-192-maskable.png", size: 192, kind: "maskable" as const },
    { file: "icon-512-maskable.png", size: 512, kind: "maskable" as const },
    { file: "apple-touch-icon.png", size: 180, kind: "apple" as const },
  ];

  it.each(ICONS)(
    "$file : PNG carré $size×$size portant un vrai Teddy (pas un placeholder)",
    async ({ file, size }) => {
      const m = await metrics(file, PWA_THEME_COLOR);
      expect(m.format).toBe("png");
      expect(m.width).toBe(size);
      expect(m.height).toBe(size);
      // Le sujet occupe une part SUBSTANTIELLE mais NON-TOTALE : rougit si l'icône redevient une
      // couleur unie (placeholder 546 o → subjectFraction 0) OU un plein-cadre sans fond de marque.
      expect(m.subjectFraction).toBeGreaterThan(0.15);
      expect(m.subjectFraction).toBeLessThan(0.8);
      // Teddy est bien AU CENTRE (pas seulement du bruit en périphérie).
      expect(m.centerIsSubject).toBe(true);
    },
  );

  it.each(ICONS.filter((i) => i.kind === "maskable"))(
    "$file : Teddy DANS la zone de sécurité maskable (cercle 80 %) → jamais rogné",
    async ({ file }) => {
      const m = await metrics(file, PWA_THEME_COLOR);
      // Rayon max du sujet ≤ 0.80·demi-taille = le rayon du cercle de sécurité maskable (diamètre
      // 80 %). Rougit si le `maskable` est régénéré SANS marge (ex. avec la fraction `any` 0.86 →
      // ratio ~0.95) → Teddy déborderait du masque Android et serait coupé. C'EST la garde #362.
      expect(m.maxSubjectRadiusRatio).toBeLessThanOrEqual(0.8);
    },
  );

  it.each(ICONS.filter((i) => i.kind === "any"))(
    "$file : Teddy atteint les bords (icône any pleine, pas sur-margée)",
    async ({ file }) => {
      const m = await metrics(file, PWA_THEME_COLOR);
      // Rougit si une icône `any` est générée avec la marge `maskable` (Teddy minuscule au centre).
      expect(m.maxSubjectRadiusRatio).toBeGreaterThan(0.85);
    },
  );

  it("chaque icône du manifest pointe un PNG committé aux dimensions déclarées", async () => {
    const icons = manifest().icons ?? [];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      const rel = String(icon.src).replace(/^\//, "");
      const m = await metrics(rel, PWA_THEME_COLOR);
      expect(m.format).toBe("png");
      expect(`${m.width}x${m.height}`).toBe(icon.sizes);
      expect(m.subjectFraction).toBeGreaterThan(0.1); // vrai Teddy, pas un placeholder
    }
  });
});

describe("écrans de démarrage iOS — intégrité (#362)", () => {
  it("chaque device de la liste a un splash committé aux BONNES dimensions portant Teddy", async () => {
    for (const device of APPLE_SPLASH_DEVICES) {
      const { pxWidth, pxHeight } = appleSplashPixels(device);
      const rel = appleSplashUrl(device).replace(/^\//, "");
      const m = await metrics(rel, PWA_BG_COLOR);
      expect(m.format).toBe("png");
      expect(m.width).toBe(pxWidth);
      expect(m.height).toBe(pxHeight);
      // Teddy centré présent (rougit si le splash devient un fond vide) ET pas plein cadre.
      expect(m.centerIsSubject).toBe(true);
      expect(m.subjectFraction).toBeGreaterThan(0.02);
      expect(m.subjectFraction).toBeLessThan(0.5);
    }
  });

  it("startupImage du layout et fichiers committés sont alignés (anti-drift)", async () => {
    const images = appleStartupImages();
    for (const { url } of images) {
      const rel = url.replace(/^\//, "");
      // metrics() lève si le fichier est absent → prouve que chaque URL référencée existe.
      const m = await metrics(rel, PWA_BG_COLOR);
      expect(m.format).toBe("png");
    }
  });
});
