import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import sharp from "sharp";
import { TEDDY_EXPRESSION_REF, type TeddyExpression } from "@/config/teddy";

/**
 * **Gate d'intégrité du LIVRABLE #360** (story R2.2) : les sprites d'expression de Teddy servis
 * en dev/CI/playthrough (`test-fixtures/teddy/<expr>.png`, dé-échantillonnés du master validé #158,
 * copiés par `seed-teddy-sprites.ts`) DOIVENT être du **VRAI art transparent** — un fond opaque
 * (patch carré derrière l'avatar) ou un fichier vide passerait l'assertion E2E « l'<img> est
 * visible » à l'identique (classe #239 : assertion permissive qui matche la sortie boguée). Ce
 * test décode les **VRAIS pixels** des fichiers committés et rougit si un sprite redevient opaque,
 * change de dimensions, ou perd son sujet.
 *
 * `sharp` (devDependency, aligné sur la version transitive de Next) — jamais dans le runtime de
 * l'app (même contrainte que `teddy-fixture-transparency.test.ts`).
 */
const EXPRESSIONS: readonly TeddyExpression[] = [
  "neutre",
  "content",
  "oups",
  "acclame",
  "intrepide",
];

/** Chemin committé d'un sprite (dérivé du ref config → source unique, anti-drift). */
function fixturePath(expr: TeddyExpression): string {
  const name = TEDDY_EXPRESSION_REF[expr].slice(TEDDY_EXPRESSION_REF[expr].lastIndexOf("/") + 1);
  return resolve(process.cwd(), "test-fixtures/teddy", name);
}

describe("sprites Teddy — intégrité de l'art transparent (#360)", () => {
  it.each(EXPRESSIONS)(
    "« %s » : RGBA, dimensions stables, coins TRANSPARENTS et sujet OPAQUE",
    async (expr) => {
      const { data, info } = await sharp(fixturePath(expr))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const { width, height, channels } = info;

      // Dimensions committées stables (262×359, dé-échantillon du master 864×1184) : un changement
      // ferait tomber l'échantillonnage ci-dessous sur du fond → échec LOUD plutôt que silencieux.
      expect(width).toBe(262);
      expect(height).toBe(359);
      expect(channels).toBe(4);

      const alphaAt = (x: number, y: number): number => data[(y * width + x) * channels + 3];

      // (a) 3 coins universellement fond → TRANSPARENTS (alpha 0). Rougit si un fond opaque revient.
      // (Le coin haut-GAUCHE varie : `intrepide` y tend un poing → non asserté.)
      expect(alphaAt(width - 1, 0)).toBe(0); // haut-droit
      expect(alphaAt(0, height - 1)).toBe(0); // bas-gauche
      expect(alphaAt(width - 1, height - 1)).toBe(0); // bas-droit

      // (b) Sujet (corps de Teddy) OPAQUE au centre ET au bas-du-tronc : le sprite porte bien un
      // ourson, pas un fichier transparent vide.
      expect(alphaAt(Math.floor(width / 2), Math.floor(height / 2))).toBe(255);
      expect(alphaAt(Math.floor(width / 2), Math.floor(height * 0.6))).toBe(255);
    },
  );
});
