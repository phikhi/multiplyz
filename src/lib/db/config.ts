// Couche SQLite : CONSOMME la config serveur centrale (source unique des ⚙️ DB).
// Cf. ADR 0002 — `src/config/server-config.ts` possède `busy_timeout` / chemin /
// journalMode ; ce module ne fait que les dériver (plus de constante en dur).
// Import relatif (pas l'alias `@`) : drizzle-kit + le script tsx tournent hors
// du résolveur de paths de Next.
import { loadDatabaseConfig, type DatabaseConfig } from "../../config/server-config";

/** Dossier des migrations versionnées (concern couche DB, pas un ⚙️ serveur). */
export const MIGRATIONS_FOLDER = "drizzle";

/**
 * Config DB effective dérivée de l'environnement via le module central :
 * honore `DATABASE_PATH` + `SQLITE_BUSY_TIMEOUT_MS`. Lue fraîche (pas de cache)
 * pour rester juste hors runtime Next (migration CLI, drizzle-kit) et testable.
 */
export function getDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  return loadDatabaseConfig(env);
}

/** Chemin du fichier SQLite résolu via la config centrale (`DATABASE_PATH` / défaut). */
export function resolveDatabasePath(env: Record<string, string | undefined> = process.env): string {
  return getDatabaseConfig(env).path;
}
