/**
 * CLI d'amorçage de la collection E2E (story 8.2b, #266). Exécuté par la chaîne `webServer` de
 * `playwright.config.ts` (`tsx e2e/seed-collection.cli.ts`), APRÈS `db:migrate` (tables présentes)
 * et AVANT `next dev` → **même contexte** (cwd + `DATABASE_PATH`) que le serveur, comme
 * `seed-sibling.cli.ts`. Séparé de `seed-collection.ts` (aucun effet de bord à l'import) pour que
 * `e2e/auth.spec.ts` puisse importer les constantes sans déclencher l'écriture.
 */
import { seedCollection, COLLECTION_PROFILE_NAME } from "./seed-collection";

seedCollection()
  .then((id) => {
    console.log(`[seed-collection] ${COLLECTION_PROFILE_NAME} amorcé (id=${id})`);
  })
  .catch((error) => {
    console.error("[seed-collection] échec:", error);
    process.exit(1);
  });
