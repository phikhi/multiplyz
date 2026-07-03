import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nameKey } from "../auth/validation";
import { MIGRATIONS_FOLDER } from "./config";
import type { AppDatabase } from "./index";

/**
 * Applique les migrations versionnées sur la connexion fournie, puis backfille
 * la colonne dérivée `profiles.name_key`.
 *
 * Idempotent : Drizzle journalise les migrations déjà jouées
 * (`__drizzle_migrations`) → un second appel est un no-op sans erreur.
 */
export function runMigrations(db: AppDatabase, migrationsFolder: string = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder });
  backfillNameKeys(db);
}

/**
 * Renseigne `profiles.name_key` pour toute ligne où il est encore `NULL` (issue
 * #105). La migration 0005 ajoute la colonne **nullable** (SQLite refuse un
 * `NOT NULL` sans default sur une table peuplée) ; la clé ne peut pas être
 * calculée en SQL (`nameKey()` = NFC + `toLocaleLowerCase("fr-FR")`, alors que
 * `lower()` SQLite est ASCII-only — ADR 0005). On la calcule donc ici, à
 * l'identique de l'app, garantissant la valeur non-null promise par le schéma.
 *
 * Idempotent : ne touche que les lignes `name_key IS NULL` → no-op au rejeu et
 * sur toute base « fraîche » (les INSERT applicatifs posent déjà la clé).
 */
export function backfillNameKeys(db: AppDatabase): void {
  const rows = db.all<{ id: number; name: string }>(
    sql`SELECT id, name FROM profiles WHERE name_key IS NULL`,
  );
  for (const row of rows) {
    db.run(sql`UPDATE profiles SET name_key = ${nameKey(row.name)} WHERE id = ${row.id}`);
  }
}
