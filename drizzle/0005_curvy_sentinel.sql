-- name_key ajouté NULLABLE (et non `NOT NULL`) : SQLite refuse d'ajouter une
-- colonne `NOT NULL` sans default sur une table `profiles` DÉJÀ peuplée
-- ("Cannot add a NOT NULL column with default value NULL", issue #105). La valeur
-- ne peut pas être backfillée en SQL — `nameKey()` = NFC + `toLocaleLowerCase("fr-FR")`,
-- et `lower()` SQLite est ASCII-only (ADR 0005). Le backfill applicatif accent-correct
-- vit dans `runMigrations` (src/lib/db/migrate.ts), qui remplit toute ligne
-- `name_key IS NULL` juste après cette migration. La colonne reste nullable côté
-- schema.ts + snapshot + SQL (cohérence anti-drift, doctrine LEARNINGS #411-419) ;
-- le non-null est un invariant APPLICATIF (validation + INSERT + backfill).
ALTER TABLE `profiles` ADD `name_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_name_key_unique` ON `profiles` (`name_key`);
