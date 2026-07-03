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
 * l'identique de l'app, matérialisant l'invariant non-null promis par le schéma.
 *
 * Idempotent : ne touche que les lignes `name_key IS NULL` → no-op au rejeu et
 * sur toute base « fraîche » (les INSERT applicatifs posent déjà la clé).
 *
 * **Collision** : une base antérieure à #37 (index UNIQUE sur `name` BINARY) a pu
 * stocker deux prénoms distincts convergeant vers la **même** clé (`Élodie` /
 * `élodie`). On la détecte AVANT toute écriture et on lève une erreur explicite
 * (l'owner renomme un profil, puis relance) plutôt que de laisser l'index UNIQUE
 * échouer en plein `UPDATE`. Les écritures sont enveloppées dans une transaction
 * → **atomiques** : aucun état à demi-migré, rejeu déterministe.
 */
export function backfillNameKeys(db: AppDatabase): void {
  const pending = db.all<{ id: number; name: string }>(
    sql`SELECT id, name FROM profiles WHERE name_key IS NULL`,
  );
  if (pending.length === 0) return;

  // Clés déjà posées (lignes non-NULL) : une nouvelle clé ne doit collisionner ni
  // avec elles, ni avec une autre ligne du même backfill.
  const claimedBy = new Map<string, number>();
  for (const row of db.all<{ id: number; key: string }>(
    sql`SELECT id, name_key AS key FROM profiles WHERE name_key IS NOT NULL`,
  )) {
    claimedBy.set(row.key, row.id);
  }

  const updates = pending.map((row) => {
    const key = nameKey(row.name);
    const clashId = claimedBy.get(key);
    if (clashId !== undefined) {
      throw new Error(
        `backfillNameKeys: les profils #${clashId} et #${row.id} produisent la même ` +
          `clé d'unicité "${key}" (prénoms distincts avant #37, identiques à la casse ` +
          `Unicode près). Renomme l'un d'eux avant de migrer (issue #105).`,
      );
    }
    claimedBy.set(key, row.id);
    return { id: row.id, key };
  });

  db.transaction((tx) => {
    for (const { id, key } of updates) {
      tx.run(sql`UPDATE profiles SET name_key = ${key} WHERE id = ${id}`);
    }
  });
}
