import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { MIGRATIONS_FOLDER } from "./config";
import type { AppDatabase } from "./index";

/**
 * Applique les migrations versionnées sur la connexion fournie.
 *
 * Idempotent : Drizzle journalise les migrations déjà jouées
 * (`__drizzle_migrations`) → un second appel est un no-op sans erreur.
 */
export function runMigrations(db: AppDatabase, migrationsFolder: string = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder });
}
