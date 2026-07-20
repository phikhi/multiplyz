/**
 * **Pré-amorçage E2E des assets RÉELS d'un monde** (story #189 fond-image + #190 tuiles/Teddy,
 * story R0.1 #323 — fin du fixture rayé) — exécuté DANS la commande `webServer`
 * (playwright.config), APRÈS `db:migrate` et AVANT `next dev`, donc dans le **MÊME contexte** (cwd +
 * `DATABASE_PATH`, via `resolveDatabasePath`) que le serveur qui lira la base : aucune divergence de
 * chemin possible (contrairement à un seed depuis le worker de test, dont le cwd peut différer).
 * Câble le chemin `background/tiles/teddy !== null` **SANS dépendre des assets gitignorés**
 * (`public/generated/` est absent en CI → le socle y est seedé avec des refs `placeholder://…` →
 * tout `null`) en s'appuyant sur `seedRealWorldFixture` (logique partagée avec le seed **dev**,
 * `scripts/seed-dev-world-assets.ts` — même fixture committée `test-fixtures/world/socle-sample/`,
 * un VRAI monde socle dé-échantillonné, plus le fixture de test rayé violet/orange).
 *
 * `resolveWorld(0)` → `buildWorldTheme` produit alors `background`/`tiles`/`teddy` NON-NULL → le
 * **scrim `--world-surface`** + le **tint per-monde** (#189) ET la **bande de décor thématisée** +
 * l'**avatar Teddy per-monde** (#190) s'activent en **vrai navigateur** sur du **vrai art** (preuves
 * géométrie #170 + dérivation #184, `e2e/auth.spec.ts`).
 *
 * Idempotent (copie + `UPDATE`). Import relatif (pas l'alias `@`) : tourne sous `tsx`, hors du
 * résolveur de paths Next — même contrainte que `scripts/db-migrate.ts`.
 */
import { resolveDatabasePath } from "../src/lib/db/config";
import { seedRealWorldFixture } from "../scripts/lib/seed-real-world-fixture";

seedRealWorldFixture({
  databasePath: resolveDatabasePath(),
  // Namespace de test, **jamais un vrai slot de socle** → zéro clobber des assets owner.
  publicDir: "public/generated/world/e2e",
  assetNamespace: "world/e2e",
  logPrefix: "seed-world-assets",
});
