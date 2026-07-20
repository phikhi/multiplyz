/**
 * CLI d'amorçage de la progression carte E2E (story #268). Exécuté par la chaîne `webServer` de
 * `playwright.config.ts` (`tsx e2e/seed-map-progress.cli.ts`), APRÈS `db:migrate` (tables
 * présentes) et AVANT `next dev` → **même contexte** (cwd + `DATABASE_PATH`) que le serveur,
 * comme `seed-collection.cli.ts`. Séparé de `seed-map-progress.ts` (aucun effet de bord à
 * l'import) pour que `e2e/auth.spec.ts` puisse importer les constantes sans déclencher l'écriture.
 */
import { seedMapProgress, MAP_PROGRESS_PROFILE_NAME } from "./seed-map-progress";

seedMapProgress()
  .then((id) => {
    console.log(`[seed-map-progress] ${MAP_PROGRESS_PROFILE_NAME} amorcé (id=${id})`);
  })
  .catch((error) => {
    console.error("[seed-map-progress] échec:", error);
    process.exit(1);
  });
