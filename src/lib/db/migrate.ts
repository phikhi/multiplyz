import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nameKey } from "../auth/validation";
import { backfillPlaceholderCreatureArt, seedSocleCreatures } from "../worldgen/creature-catalog";
import { seedSocleWorlds } from "../worldgen/socle";
import { MIGRATIONS_FOLDER } from "./config";
import type { AppDatabase } from "./index";

/**
 * Applique les migrations versionnées sur la connexion fournie, puis exécute les
 * amorçages **applicatifs idempotents** : backfill de la colonne dérivée
 * `profiles.name_key` (#105) + amorçage du **socle de mondes de secours**
 * (WORLDGEN §7, story 6.6 → 1er lancement instantané, hors réseau) + amorçage du
 * **catalogue de créatures socle** (communes/rares + légendaires, story R4.2 #382/#393)
 * + **backfill de l'art réel** des lignes `characters` restées `placeholder://` (bug #401 :
 * une créature gagnée AVANT que R3.1 committe le vrai art garde son placeholder, que le seed
 * `onConflictDoNothing` ne réécrit jamais → `backfillPlaceholderCreatureArt` la répare).
 *
 * Idempotent : Drizzle journalise les migrations déjà jouées
 * (`__drizzle_migrations`) → un second appel est un no-op sans erreur ; le backfill
 * (`WHERE name_key IS NULL`), l'amorçage du socle (`onConflictDoNothing`), celui du
 * catalogue de créatures (`onConflictDoNothing` par PK) et le backfill d'art placeholder
 * (`WHERE !isRenderableAssetRef(art_ref)`) sont eux-mêmes idempotents.
 * `seedSocleWorlds` / `seedSocleCreatures` tournent **après** `migrate` (les tables
 * `socle_worlds` / `characters` existent alors) ; `backfillPlaceholderCreatureArt` tourne
 * **après** `seedSocleCreatures` (répare ce qui existe déjà, une fois les manquantes insérées).
 *
 * **Câblage R4.2 (#382, « déclaré ≠ vécu » #180)** : `seedSocleCreatures` était **prêt** depuis
 * R3.1 (#378) mais **non appelé** — le peupler seul aurait été invisible (le Pokédex lit les
 * possessions, pas le catalogue). C'est R4.2 (tirage d'œuf) qui **consomme** ce catalogue : les
 * communes/rares doivent EXISTER dans `characters` pour être tirables → on câble l'amorçage **ici**,
 * avec le draw (#155/#127 : fondation posée en R3.1, consommateur en R4.2). Le catalogue est
 * **partagé** (comme `worlds`/légendaires), non enfant-spécifique → seedé une fois, hors cascade RGPD.
 */
export function runMigrations(db: AppDatabase, migrationsFolder: string = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder });
  backfillNameKeys(db);
  seedSocleWorlds(db);
  seedSocleCreatures(db);
  backfillPlaceholderCreatureArt(db);
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
