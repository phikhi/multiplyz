/**
 * **Pré-amorçage E2E d'un fond-image de monde réel** (story #189) — exécuté DANS la commande
 * `webServer` (playwright.config), APRÈS `db:migrate` et AVANT `next dev`, donc dans le **MÊME
 * contexte** (cwd + `DATABASE_PATH`, via `resolveDatabasePath`) que le serveur qui lira la base :
 * aucune divergence de chemin possible (contrairement à un seed depuis le worker de test, dont le
 * cwd peut différer). Câble le chemin `background !== null` **SANS dépendre des assets gitignorés**
 * (`public/generated/` est absent en CI → le socle y est seedé avec des refs `placeholder://…` →
 * `background: null`) :
 *
 * 1. copie une **fixture PNG committée** (`e2e/fixtures/world-bg.png`) sous un chemin **RENDABLE**
 *    servi par Next/Nginx (`public/generated/world/e2e/…` — namespace de test, **jamais un vrai slot
 *    de socle** → zéro clobber des assets owner) ;
 * 2. pointe le monde résolu pour un profil frais (socle[0], `worldIndex 0`) dessus via son
 *    `asset_refs`. `resolveWorld(0)` → `buildWorldTheme` produit alors un `background` NON-NULL → le
 *    **scrim `--world-surface`** + le **tint per-monde** s'activent en **vrai navigateur** (preuve
 *    géométrie #170 + preuve dérivation #184, `e2e/auth.spec.ts`).
 *
 * Idempotent (copie + `UPDATE`). Import relatif (pas l'alias `@`) : tourne sous `tsx`, hors du
 * résolveur de paths Next — même contrainte que `scripts/db-migrate.ts`.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { resolveDatabasePath } from "../src/lib/db/config";

const PUBLIC_DIR = "public/generated/world/e2e";
mkdirSync(PUBLIC_DIR, { recursive: true });
copyFileSync("e2e/fixtures/world-bg.png", `${PUBLIC_DIR}/background.png`);

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
  console.log(`[seed-world-bg] ${databasePath} slot 0 → fixture (changes=${info.changes})`);
} finally {
  db.close();
}
