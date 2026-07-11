-- recalibration_requested (drapeau de recalibrage, story 7.6, ADR 0016) ajouté en
-- NOT NULL DEFAULT false : SQLite n'interdit `ADD col NOT NULL` que **sans** default
-- ("Cannot add a NOT NULL column with default value NULL", issue #105). Ici la valeur
-- par défaut `0`/false remplit les lignes `profiles` existantes → aucun backfill applicatif
-- requis (contrairement à `name_key`, non calculable en SQL, ADR 0005/migration 0005). La
-- colonne reste cohérente schema.ts <-> snapshot <-> SQL <-> base (`db:generate` no-op).
ALTER TABLE `profiles` ADD `recalibration_requested` integer DEFAULT false NOT NULL;