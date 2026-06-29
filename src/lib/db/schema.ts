import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Schéma technique uniquement (story #12 = wiring de la couche données).
// Le schéma métier (`profiles`, `mastery`, `attempts`, …) appartient aux
// epics Auth (#2) et Moteur (#3) — NE PAS l'ajouter ici (cf. PLAN.md §Modèle de données).

/**
 * Table meta technique : canari de wiring DB + porte la version applicative du
 * schéma. Paire clé/valeur volontairement minimale.
 */
export const schemaMeta = sqliteTable("schema_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
