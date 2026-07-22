/**
 * **Copie les illustrations de créatures RÉELLES committées sous leur chemin rendable Next/Nginx**
 * (story R2.1 #361, étendu R3.1 #378) — même patron que `seed-teddy-sprites.ts` : chaque fixture
 * RÉELLE committée (`test-fixtures/creature/<species>.png`, chemin **non-gitignoré**, RGBA détouré)
 * est copiée vers `public/generated/socle/creature/<species>.png` (`public/generated/` = gitignoré,
 * réservé aux assets de rendu, populé au runtime) → servie à `/generated/socle/creature/<species>.png`,
 * ref `socle/creature/<species>.png` que `isRenderableAssetRef` accepte **à l'identique** (namespace
 * `socle`, aucune modification de la garde de sécurité).
 *
 * **Registre-piloté (déclaré ≠ vécu, #180 ; anti-drift #164)** : itère `COMMITTED_CREATURE_SPECIES`
 * (`src/config/creatures.ts`) — la **source unique** des espèces dont un vrai PNG est committé. En
 * **Phase 1 R3.1** : une seule entrée (`cloudfox`, la démo du spike) → un seul art réel copié, tout
 * le reste reste `placeholder://…` (repli emoji no-fail). En **Phase 2** (run payant #377), on commit
 * les vrais PNG des créatures socle puis on **appende** leurs `speciesKey` au registre → le seed les
 * rend observables **sans toucher à ce fichier** (le nom de fichier se DÉRIVE de l'espèce).
 *
 * Câblé dans le seed **dev** (`scripts/seed-dev-world-assets.ts`) ET la commande `webServer` **E2E**
 * (`e2e/seed-world-assets.ts`) — comme les sprites Teddy. Un asset absent/non servi → repli no-fail
 * de `<AssetImage>` (jamais un blocage).
 *
 * Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors du résolveur de paths Next —
 * même contrainte que `scripts/db-migrate.ts` / `seed-teddy-sprites.ts`. Hors `src/` (wiring I/O
 * pur, pas de coverage). Idempotent (copie de fichier).
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  COMMITTED_CREATURE_SPECIES,
  CREATURE_ASSET_DIR,
  creatureArtRef,
} from "../../src/config/creatures";

/** Source committée des fixtures créatures (non-gitignoré). */
const FIXTURE_DIR = "test-fixtures/creature";
/** Racine publique servie par Next/Nginx (`/generated/` = `public/generated/`, gitignoré). */
const PUBLIC_ROOT = "public/generated";

/**
 * Copie chaque illustration réelle committée (`COMMITTED_CREATURE_SPECIES`) vers son chemin public
 * rendable. `logPrefix` identifie l'appelant (dev vs E2E) dans les logs.
 */
export function seedCreatureSprites(logPrefix: string): void {
  for (const species of COMMITTED_CREATURE_SPECIES) {
    const ref = creatureArtRef(species); // socle/creature/<species>.png (source unique du ref).
    const name = `${species}.png`; // dernier segment du ref = nom de fichier fixture + public.
    const dest = `${PUBLIC_ROOT}/${ref}`;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(`${FIXTURE_DIR}/${name}`, dest);
  }
  console.log(
    `[${logPrefix}] ${COMMITTED_CREATURE_SPECIES.length} créature(s) réelle(s) → ${PUBLIC_ROOT}/${CREATURE_ASSET_DIR}`,
  );
}
