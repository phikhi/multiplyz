import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_BUSY_TIMEOUT_MS, resolveDatabasePath } from "./config";
import * as schema from "./schema";

/** Type de la connexion Drizzle applicative (source de vérité serveur). */
export type AppDatabase = ReturnType<typeof createDatabase>;

/**
 * Ouvre une connexion SQLite via better-sqlite3 et applique les PRAGMA requis :
 * - `journal_mode = WAL` : lectures concurrentes pendant une écriture
 *   (daemon web + worker IA partagent le fichier — cf. STACK.md).
 * - `busy_timeout` : attendre au lieu d'échouer sur `SQLITE_BUSY` (⚙️ config).
 *
 * `:memory:` sert aux tests (base éphémère, pas de fichier ni de dossier).
 */
export function createDatabase(databasePath: string = resolveDatabasePath()) {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
  return drizzle(sqlite, { schema });
}

// Singleton paresseux pour le runtime applicatif (route handlers / server actions).
let dbSingleton: AppDatabase | undefined;

/** Renvoie la connexion applicative partagée (ouverte à la première demande). */
export function getDb(): AppDatabase {
  dbSingleton ??= createDatabase();
  return dbSingleton;
}
