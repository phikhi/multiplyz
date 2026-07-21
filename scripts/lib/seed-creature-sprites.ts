/**
 * **Copie l'illustration de la créature de démo sous un chemin rendable Next/Nginx** (story R2.1,
 * #361) — même patron que `seed-teddy-sprites.ts` : la fixture RÉELLE dé-échantillonnée + détourée
 * committée (`test-fixtures/creature/cloudfox.png`, chemin **non-gitignoré** — le renard des brumes
 * kawaii du spike, RGBA transparent, cf. `scripts/regen-creature-cutout.ts`) est copiée vers
 * `public/generated/socle/creature/cloudfox.png` (`public/generated/` = gitignoré, réservé aux
 * assets de rendu, populé au runtime) → servie à `/generated/socle/creature/cloudfox.png`, ref
 * `socle/creature/cloudfox.png` que `isRenderableAssetRef` accepte **à l'identique** (namespace
 * `socle`, aucune modification de la garde de sécurité).
 *
 * **Config-driven (anti-drift #164)** : le ref vient de `DEMO_CREATURE_ART_REF` (source unique,
 * `src/config/creatures.ts`) — le nom de fichier + le chemin public se DÉRIVENT du ref, jamais
 * dupliqués. C'est la MÊME ref que le seed de collection E2E (`e2e/seed-collection.ts`) pose en
 * `art_ref` → l'écran Collection rend cette créature en VRAI art (les autres restent placeholder).
 *
 * Câblé dans le seed **dev** (`scripts/seed-dev-world-assets.ts`) ET la commande `webServer` **E2E**
 * (`e2e/seed-world-assets.ts`) — comme les sprites Teddy. **Honnêteté #180** : le consommateur DEV
 * (une collection peuplée avec cette ref) arrive avec R3.1 (la collection dev ne se peuple qu'au
 * boss, `grantLegendaryInTx`, dont les grants passeront des refs réelles à R3.1) ; le consommateur
 * E2E (le profil `Nino` amorcé) rend la créature dès aujourd'hui → capture observable. Un asset
 * absent/non servi → repli no-fail de `<AssetImage>` (jamais un blocage).
 *
 * Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors du résolveur de paths Next —
 * même contrainte que `scripts/db-migrate.ts` / `seed-teddy-sprites.ts`. Hors `src/` (wiring I/O
 * pur, pas de coverage). Idempotent (copie de fichier).
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CREATURE_ASSET_DIR, DEMO_CREATURE_ART_REF } from "../../src/config/creatures";

/** Source committée de la fixture créature (non-gitignoré). */
const FIXTURE_DIR = "test-fixtures/creature";
/** Racine publique servie par Next/Nginx (`/generated/` = `public/generated/`, gitignoré). */
const PUBLIC_ROOT = "public/generated";

/**
 * Copie l'illustration de la créature de démo vers son chemin public rendable. `logPrefix`
 * identifie l'appelant (dev vs E2E) dans les logs.
 */
export function seedCreatureSprites(logPrefix: string): void {
  const ref = DEMO_CREATURE_ART_REF;
  // Nom de fichier = dernier segment du ref (`socle/creature/cloudfox.png` → `cloudfox.png`).
  const name = ref.slice(ref.lastIndexOf("/") + 1);
  const dest = `${PUBLIC_ROOT}/${ref}`;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(`${FIXTURE_DIR}/${name}`, dest);
  console.log(`[${logPrefix}] 1 créature de démo → ${PUBLIC_ROOT}/${CREATURE_ASSET_DIR}`);
}
