/**
 * CLI d'amorçage du frère/sœur E2E (story 7.5). Exécuté par la chaîne `webServer` de
 * `playwright.config.ts` (`tsx e2e/seed-sibling.cli.ts`), APRÈS `db:migrate` (tables présentes) et
 * AVANT `next dev` → **même contexte** (cwd + `DATABASE_PATH`) que le serveur, comme
 * `seed-world-assets.ts`. Séparé de `seed-sibling.ts` (aucun effet de bord à l'import) pour que
 * `e2e/auth.spec.ts` puisse importer les constantes sans déclencher l'écriture.
 */
import { seedSibling, SIBLING_NAME } from "./seed-sibling";

seedSibling()
  .then((id) => {
    console.log(`[seed-sibling] ${SIBLING_NAME} amorcé (id=${id})`);
  })
  .catch((error) => {
    console.error("[seed-sibling] échec:", error);
    process.exit(1);
  });
