/**
 * **Copie des sprites d'expression de Teddy sous un chemin rendable Next/Nginx** (story R2.2, #360)
 * — même patron que `seed-real-world-fixture.ts` : la fixture RÉELLE dé-échantillonnée committée
 * (`test-fixtures/teddy/<expr>.png`, chemin **non-gitignoré** — un vrai sprite du master Teddy
 * validé #158, Stage A, ART §2) est copiée vers `public/generated/socle/teddy/<expr>.png`
 * (`public/generated/` = gitignoré, réservé aux assets de rendu, populé au runtime) → servie à
 * `/generated/socle/teddy/<expr>.png`, ref `socle/teddy/<expr>.png` que `isRenderableAssetRef`
 * accepte **à l'identique** (namespace `socle`, aucune modification de la garde de sécurité).
 *
 * **Config-driven (anti-drift #164)** : la liste des sprites vient de `TEDDY_EXPRESSION_REF` (source
 * unique) — le nom de fichier + le chemin public se DÉRIVENT du ref, jamais dupliqués. Ajouter une
 * expression au config suffit à la faire copier ici.
 *
 * Câblé dans le seed **dev** (`scripts/seed-dev-world-assets.ts`) ET la commande `webServer` **E2E**
 * (`e2e/seed-world-assets.ts`) — donc Teddy est servi (VRAI art) en dev/CI. Production = owner place
 * les sprites sur le VPS (même modèle owner-run que les assets per-monde, WORLDGEN §5). Un sprite
 * absent → repli no-fail de `<AssetImage>` (jamais un blocage).
 *
 * Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors du résolveur de paths Next —
 * même contrainte que `scripts/db-migrate.ts` / `seed-real-world-fixture.ts`. Hors `src/` (wiring
 * I/O pur, pas de coverage — même patron que `scripts/db-migrate.ts`). Idempotent (copie de fichiers).
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { TEDDY_EXPRESSION_REF } from "../../src/config/teddy";

/** Source committée des sprites dé-échantillonnés (non-gitignoré). */
const FIXTURE_DIR = "test-fixtures/teddy";
/** Racine publique servie par Next/Nginx (`/generated/` = `public/generated/`, gitignoré). */
const PUBLIC_ROOT = "public/generated";

/**
 * Copie chaque sprite d'expression du config vers son chemin public rendable. `logPrefix` identifie
 * l'appelant (dev vs E2E) dans les logs.
 */
export function seedTeddyExpressionSprites(logPrefix: string): void {
  const refs = Object.values(TEDDY_EXPRESSION_REF);
  for (const ref of refs) {
    // Nom de fichier = dernier segment du ref (`socle/teddy/content.png` → `content.png`).
    const name = ref.slice(ref.lastIndexOf("/") + 1);
    const dest = `${PUBLIC_ROOT}/${ref}`;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(`${FIXTURE_DIR}/${name}`, dest);
  }
  console.log(`[${logPrefix}] ${refs.length} sprites Teddy → ${PUBLIC_ROOT}/socle/teddy`);
}
