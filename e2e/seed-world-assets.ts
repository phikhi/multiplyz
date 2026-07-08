/**
 * **Pré-amorçage E2E des assets réels d'un monde** (story #189 fond-image + #190 tuiles/Teddy) —
 * exécuté DANS la commande `webServer` (playwright.config), APRÈS `db:migrate` et AVANT `next dev`,
 * donc dans le **MÊME contexte** (cwd + `DATABASE_PATH`, via `resolveDatabasePath`) que le serveur
 * qui lira la base : aucune divergence de chemin possible (contrairement à un seed depuis le worker
 * de test, dont le cwd peut différer). Câble le chemin `background/tiles/teddy !== null` **SANS
 * dépendre des assets gitignorés** (`public/generated/` est absent en CI → le socle y est seedé avec
 * des refs `placeholder://…` → tout `null`) :
 *
 * 1. copie des **fixtures PNG committées** (`e2e/fixtures/world-{bg,tiles,teddy}.png`) sous des
 *    chemins **RENDABLES** servis par Next/Nginx (`public/generated/world/e2e/…` — namespace de
 *    test, **jamais un vrai slot de socle** → zéro clobber des assets owner) ;
 * 2. pointe le monde résolu pour un profil frais (socle[0], `worldIndex 0`) dessus via son
 *    `asset_refs`. `resolveWorld(0)` → `buildWorldTheme` produit alors `background`/`tiles`/`teddy`
 *    NON-NULL → le **scrim `--world-surface`** + le **tint per-monde** (#189) ET la **bande de décor
 *    thématisée** + l'**avatar Teddy per-monde** (#190) s'activent en **vrai navigateur** (preuves
 *    géométrie #170 + dérivation #184, `e2e/auth.spec.ts`).
 *
 * Idempotent (copie + `UPDATE`). Import relatif (pas l'alias `@`) : tourne sous `tsx`, hors du
 * résolveur de paths Next — même contrainte que `scripts/db-migrate.ts`.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { resolveDatabasePath } from "../src/lib/db/config";

const PUBLIC_DIR = "public/generated/world/e2e";
mkdirSync(PUBLIC_DIR, { recursive: true });
// Les trois assets du monde (fond-image #189 + tuiles/Teddy #190) — chacun sous une ref RENDABLE
// (`world/e2e/<name>.png`) que `isRenderableAssetRef` accepte (relatif, namespace `world`).
copyFileSync("e2e/fixtures/world-bg.png", `${PUBLIC_DIR}/background.png`);
copyFileSync("e2e/fixtures/world-tiles.png", `${PUBLIC_DIR}/tiles.png`);
copyFileSync("e2e/fixtures/world-teddy.png", `${PUBLIC_DIR}/teddy.png`);

const databasePath = resolveDatabasePath();
const db = new Database(databasePath);
try {
  db.pragma("busy_timeout = 5000");
  const assetRefs = JSON.stringify({
    background: "world/e2e/background.png",
    tiles: "world/e2e/tiles.png",
    teddy: "world/e2e/teddy.png",
  });
  // `slot = 0` ↔ monde résolu pour un profil frais : `resolveWorld(0)` sert `pool[0 % length]` avec
  // `pool` trié `orderBy(asc(socle_worlds.slot))` (cf. `src/lib/worldgen/socle.ts`) → `pool[0]` = le
  // slot MINIMAL. Couplage implicite à garder en sync : si l'indexation des slots socle changeait
  // (slot min ≠ 0), ce `WHERE slot = 0` ne pointerait plus le monde de départ → cibler le slot min.
  const info = db.prepare("UPDATE socle_worlds SET asset_refs = ? WHERE slot = 0").run(assetRefs);
  console.log(`[seed-world-assets] ${databasePath} slot 0 → fixtures (changes=${info.changes})`);
} finally {
  db.close();
}
