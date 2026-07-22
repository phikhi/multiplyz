/**
 * CLI d'amorçage de la progression boss E2E (story R3.3, #381). Exécuté par la chaîne
 * `webServer` de `playwright.config.ts` (`tsx e2e/seed-boss-progress.cli.ts`), APRÈS
 * `db:migrate` (tables présentes) et AVANT `next dev` → **même contexte** (cwd +
 * `DATABASE_PATH`) que le serveur, comme `seed-map-progress.cli.ts`. Séparé de
 * `seed-boss-progress.ts` (aucun effet de bord à l'import) pour que `e2e/auth.spec.ts` puisse
 * importer les constantes sans déclencher l'écriture.
 */
import { seedBossProgress, BOSS_PROGRESS_PROFILE_NAME } from "./seed-boss-progress";

seedBossProgress()
  .then((id) => {
    console.log(`[seed-boss-progress] ${BOSS_PROGRESS_PROFILE_NAME} amorcé (id=${id})`);
  })
  .catch((error) => {
    console.error("[seed-boss-progress] échec:", error);
    process.exit(1);
  });
