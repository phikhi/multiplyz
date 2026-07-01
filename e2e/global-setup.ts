import { rmSync } from "node:fs";

/**
 * Setup global E2E : repart d'un **foyer vide** à chaque run. Supprime la base
 * SQLite dédiée E2E (+ fichiers WAL/SHM) avant le boot du serveur, qui la
 * (re)migre ensuite. Indispensable au gating 1er usage (#2.2) : l'écran
 * d'onboarding ne s'affiche que si aucun propriétaire n'existe.
 *
 * Cible une base **séparée** de la dev (`data/e2e.sqlite`) — cf. playwright.config.
 */
const E2E_DB_FILES = ["data/e2e.sqlite", "data/e2e.sqlite-wal", "data/e2e.sqlite-shm"];

export default function globalSetup() {
  for (const file of E2E_DB_FILES) {
    rmSync(file, { force: true });
  }
}
