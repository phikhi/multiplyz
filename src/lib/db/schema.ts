import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Schéma métier auth-lite (epic #2) + table technique de wiring (#12).
// Le reste du schéma métier (`mastery`, `attempts`, …) appartient au Moteur (#3)
// — NE PAS l'ajouter ici avant sa story (cf. PLAN.md §Modèle de données).

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

/**
 * Profils du foyer (AUTH.md §1, PLAN.md §Modèle de données). Single-tenant : un
 * seul foyer, prénoms uniques. Le `parent_pin_hash` + `recovery_code_hash`
 * (accès espace parent + récupération) sont portés par le profil **propriétaire**
 * (posés au 1er usage, #2.2) — nullable sur les autres profils enfants (§1
 * multi-profils frères/sœurs). Aucun PIN en clair : seuls les **hash** argon2id.
 *
 * Invariants (à honorer par les stories consommatrices) :
 * - **Owner** = l'unique ligne où `parent_pin_hash IS NOT NULL` (#2.2 le pose sur
 *   le 1er profil créé).
 * - **Unicité du prénom insensible à la casse** : l'index UNIQUE est BINARY ici ;
 *   le check d'onboarding (#2.2) et le lookup de login (#2.3) matchent sur
 *   `lower(name)` (une enfant tape sa casse au hasard).
 */
export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  pinHash: text("pin_hash").notNull(),
  avatar: text("avatar").notNull(),
  /** Hash du PIN parent (espace parent) — porté par le profil propriétaire. */
  parentPinHash: text("parent_pin_hash"),
  /** Hash du code de secours (réinit PIN parent sans email, AUTH.md §5). */
  recoveryCodeHash: text("recovery_code_hash"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Nature d'une session : enfant (longue) ou parent (courte) — AUTH.md §3. */
export type SessionKind = "child" | "parent";

/**
 * Sessions serveur (source de vérité). Le `token` opaque (aléa CSPRNG) est
 * l'unique référence côté cookie httpOnly ; rien n'est signé côté client. La
 * suppression d'un profil purge ses sessions (ON DELETE CASCADE, RGPD §6).
 */
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  profileId: integer("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  kind: text("kind").$type<SessionKind>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});
// Pas d'index secondaire : table minuscule (single-tenant, quelques sessions).
// À ajouter via migration si le volume le justifie un jour.

/**
 * Compteurs de tentatives de PIN échouées (rate-limit + backoff, AUTH.md §4).
 * Source de vérité **serveur** : le ralentissement est calculé côté serveur, pas
 * confié au client. Une ligne par **cible** (`id` = `"<scope>:<clé>"`, ex.
 * `"profile:5"` / `"ip:1.2.3.4"`) : la clé composite est **encodée dans une seule
 * colonne PK** — pas de callback `sqliteTable` d'extras (index/PK composite) qui,
 * n'étant jamais invoqué au runtime, casserait le gate 100 % fonctions (LEARNINGS
 * #34). Réinitialisée (ligne supprimée) au succès. Générique → réutilisable par la
 * vérif du code de secours (#2.5). Compteurs non-personnels (pas de FK profil).
 */
export const pinAttempts = sqliteTable("pin_attempts", {
  /** `"<scope>:<clé>"` — cible du compteur (profil ou IP). */
  id: text("id").primaryKey(),
  /** Nombre d'échecs consécutifs (remis à 0 = ligne supprimée au succès). */
  failures: integer("failures").notNull().default(0),
  /** Instant du dernier échec — base du calcul de backoff. */
  lastFailureAt: integer("last_failure_at", { mode: "timestamp" }).notNull(),
});
