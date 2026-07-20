/**
 * CLI d'amorçage de l'historique de justesse E2E (issue #241). Exécuté par la chaîne `webServer`
 * de `playwright.config.ts` (`tsx e2e/seed-accuracy-history.cli.ts`), APRÈS `db:migrate` (tables
 * présentes) et AVANT `next dev` → **même contexte** (cwd + `DATABASE_PATH`) que le serveur, comme
 * `seed-collection.cli.ts`. Séparé de `seed-accuracy-history.ts` (aucun effet de bord à l'import)
 * pour que `e2e/auth.spec.ts` puisse importer les constantes sans déclencher l'écriture.
 */
import { seedAccuracyHistory, ACCURACY_HISTORY_PROFILE_NAME } from "./seed-accuracy-history";

seedAccuracyHistory()
  .then((id) => {
    console.log(`[seed-accuracy-history] ${ACCURACY_HISTORY_PROFILE_NAME} amorcé (id=${id})`);
  })
  .catch((error) => {
    console.error("[seed-accuracy-history] échec:", error);
    process.exit(1);
  });
