/**
 * CLI d'amorçage du profil canari E2E (issue #326). Exécuté par la chaîne `webServer` de
 * `playwright.config.ts` (`tsx e2e/seed-canari.cli.ts`), APRÈS `db:migrate` (tables présentes) et
 * AVANT `next dev` → **même contexte** (cwd + `DATABASE_PATH`) que le serveur, comme
 * `seed-collection.cli.ts`. Séparé de `seed-canari.ts` (aucun effet de bord à l'import) pour que
 * `e2e/auth.spec.ts` puisse importer les constantes sans déclencher l'écriture.
 */
import { seedCanariProfile, CANARI_PROFILE_NAME } from "./seed-canari";

seedCanariProfile()
  .then((id) => {
    console.log(`[seed-canari] ${CANARI_PROFILE_NAME} amorcé (id=${id})`);
  })
  .catch((error) => {
    console.error("[seed-canari] échec:", error);
    process.exit(1);
  });
