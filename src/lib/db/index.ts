import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getDatabaseConfig } from "./config";
import * as schema from "./schema";

/** Type de la connexion Drizzle applicative (source de vérité serveur). */
export type AppDatabase = ReturnType<typeof createDatabase>;

/**
 * Ouvre une connexion SQLite via better-sqlite3 et applique les PRAGMA requis,
 * dérivés de la config centrale (ADR 0002) :
 * - `journal_mode` (WAL) : lectures concurrentes pendant une écriture
 *   (daemon web + worker IA partagent le fichier — cf. STACK.md).
 * - `busy_timeout` (`SQLITE_BUSY_TIMEOUT_MS`) : attendre au lieu d'échouer sur
 *   `SQLITE_BUSY`.
 *
 * `databasePath` surcharge uniquement le chemin (tests). `:memory:` = base
 * éphémère (pas de fichier ni de dossier).
 */
export function createDatabase(databasePath?: string) {
  const { path, busyTimeoutMs, journalMode } = getDatabaseConfig();
  const file = databasePath ?? path;
  if (file !== ":memory:") {
    mkdirSync(dirname(file), { recursive: true });
  }
  const sqlite = new Database(file);
  sqlite.pragma(`journal_mode = ${journalMode}`);
  sqlite.pragma(`busy_timeout = ${busyTimeoutMs}`);
  return drizzle(sqlite, { schema });
}

// Singleton paresseux pour le runtime applicatif (route handlers / server actions).
let dbSingleton: AppDatabase | undefined;

/** Renvoie la connexion applicative partagée (ouverte à la première demande). */
export function getDb(): AppDatabase {
  dbSingleton ??= createDatabase();
  return dbSingleton;
}
