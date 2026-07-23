/**
 * CLI d'amorçage de la boutique E2E (story R4.2 #393). Exécuté par la chaîne `webServer` de
 * `playwright.config.ts` (`tsx e2e/seed-boutique.cli.ts`), APRÈS `db:migrate` (tables + catalogue
 * présents) et AVANT `next dev` → **même contexte** (cwd + `DATABASE_PATH`) que le serveur. Séparé de
 * `seed-boutique.ts` (aucun effet de bord à l'import) pour que `e2e/auth.spec.ts` importe les
 * constantes sans déclencher l'écriture.
 */
import { seedBoutique, BOUTIQUE_PROFILE_NAME } from "./seed-boutique";

seedBoutique()
  .then((id) => {
    console.log(`[seed-boutique] ${BOUTIQUE_PROFILE_NAME} amorcé (id=${id})`);
  })
  .catch((error) => {
    console.error("[seed-boutique] échec:", error);
    process.exit(1);
  });
