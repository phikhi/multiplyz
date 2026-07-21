import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import sharp from "sharp";

/**
 * **Gate d'intégrité du LIVRABLE #329** (story #338) : le fixture Teddy servi en dev/CI/playthrough
 * (`test-fixtures/world/socle-sample/teddy.png`, copié par `seedRealWorldFixture`) DOIT avoir un fond
 * transparent. L'assertion E2E « l'URL de l'avatar contient `.png` » (`e2e/auth.spec.ts`) est
 * **VACUOUSE** — un `.png` **OPAQUE** la passerait à l'identique (classe #239 : assertion permissive
 * qui matche la sortie boguée). Ce test décode les **VRAIS pixels** du fichier committé et rougit si
 * le cutout redevient opaque (le carré blanc de #329) OU si la fourrure crème interne est mangée.
 *
 * `sharp` (devDependency, aligné sur la version transitive de Next) sert ici + dans le CLI
 * `scripts/regen-teddy-cutout.ts` — jamais dans le runtime de l'app.
 */
// vitest tourne depuis la racine du projet (cwd) → chemin relatif stable vers le fixture committé.
const FIXTURE = resolve(process.cwd(), "test-fixtures/world/socle-sample/teddy.png");

describe("fixture Teddy socle — intégrité de la transparence (#329)", () => {
  it("a un canal alpha, des coins TRANSPARENTS et un sujet + torse crème OPAQUES", async () => {
    const { data, info } = await sharp(FIXTURE)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    // Dimensions committées stables (262×360) : un changement de taille ferait tomber les coordonnées
    // d'échantillonnage ci-dessous sur du fond → on l'échoue LOUD plutôt que silencieusement.
    expect(width).toBe(262);
    expect(height).toBe(360);
    expect(channels).toBe(4);

    const alphaAt = (x: number, y: number): number => data[(y * width + x) * channels + 3];

    // (a) Les 4 coins = fond → TRANSPARENT (alpha 0). Rougit si le fond blanc opaque revient (#329).
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(width - 1, 0)).toBe(0);
    expect(alphaAt(0, height - 1)).toBe(0);
    expect(alphaAt(width - 1, height - 1)).toBe(0);

    // (b) Tête (sujet brun) OPAQUE : le détourage n'a pas mangé l'ourson.
    expect(alphaAt(131, 110)).toBe(255);

    // (c) ▶▶ LE point #329 : torse CRÈME interne OPAQUE. ◀◀ Un white-key global (fuzz large) l'aurait
    // mangé (crème ≈ clair) ; le flood-fill depuis les bords le préserve. Rougit si la fourrure claire
    // interne devient transparente.
    expect(alphaAt(131, 210)).toBe(255);
  });
});
