/**
 * CLI d'amorçage des mondes en attente E2E (story 7.9). Exécuté par la chaîne `webServer` de
 * `playwright.config.ts` (`tsx e2e/seed-pending-worlds.cli.ts`), APRÈS `db:migrate` (table `worlds`
 * présente) et AVANT `next dev` → **même contexte** (cwd + `DATABASE_PATH`) que le serveur, comme
 * `seed-sibling.cli.ts`/`seed-world-assets.ts`. Séparé de `seed-pending-worlds.ts` (aucun effet de
 * bord à l'import) pour que `e2e/auth.spec.ts` importe librement les constantes.
 */
import { seedPendingWorlds, PENDING_WORLD_A, PENDING_WORLD_B } from "./seed-pending-worlds";

try {
  seedPendingWorlds();
  console.log(`[seed-pending-worlds] amorcés : ${PENDING_WORLD_A.id}, ${PENDING_WORLD_B.id}`);
} catch (error) {
  console.error("[seed-pending-worlds] échec:", error);
  process.exit(1);
}
