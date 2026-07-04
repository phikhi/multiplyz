import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
// Import RELATIF (pas l'alias `@`) : drizzle-kit + le script tsx `db:migrate`
// chargent ce module HORS du résolveur de paths de Next (même contrainte que
// `config.ts`). `import type` = erased au build, mais on garde le relatif par
// cohérence et robustesse du résolveur outillage.
import type { Skill } from "../engine/domain";

// Schéma métier auth-lite (epic #2) + Moteur math (epic #3 : `mastery`/`attempts`)
// + table technique de wiring (#12).
// Le reste du schéma métier appartient à ses stories dédiées (économie, mondes, …)
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
 * - **Unicité du prénom insensible à la casse Unicode** (ADR 0005, #37) : portée
 *   par la colonne dérivée **`name_key`** (`nameKey(name)` = NFC + minuscule
 *   locale-aware, cf. `auth/validation.ts`) sous **index UNIQUE**. Le `lower()`
 *   SQLite étant ASCII-only (`lower('Élodie') ≠ 'élodie'`), la casse accentuée est
 *   normalisée **côté application** : l'onboarding (#2.2) et le login (#2.3)
 *   écrivent/matchent sur `name_key`, jamais sur `lower(name)`. L'index UNIQUE sur
 *   `name` (BINARY) reste un garde-fou secondaire. L'unicité de `name_key` est
 *   déclarée via la **méthode chaînée `.unique()` de la colonne** (drizzle
 *   sérialise l'index dans le snapshot + le SQL ; `db:generate` = no-op car
 *   schema.ts == snapshot). C'est le **callback d'extras 3ᵉ-arg** `(t) => [...]`
 *   qui casse le gate 100 % fonctions (LEARNINGS #34/#46), PAS le `.unique()` de
 *   colonne — ce dernier n'ajoute aucune fonction non couverte. La colonne est
 *   **nullable** (pas de `.notNull()`) : SQLite refuse d'ajouter un `NOT NULL`
 *   sans default sur une table peuplée (issue #105), et la valeur n'est pas
 *   calculable en SQL. On garde donc schema.ts ↔ snapshot ↔ SQL réel ↔ base
 *   **tous cohérents** en nullable (doctrine anti-drift snapshot/SQL, LEARNINGS
 *   #411-419, ADR 0005) ; le **non-null est garanti côté application** (validation
 *   + INSERT `createHousehold` + backfill `runMigrations`).
 */
export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  /**
   * Clé d'unicité dérivée du prénom, insensible à la casse Unicode
   * (`nameKey(name)` — cf. `auth/validation.ts`). Index UNIQUE déclaré via
   * `.unique()` (nom explicite = même index que la migration). Écrite à
   * l'insertion du profil (et à tout renommage éventuel).
   *
   * **Nullable** (volontairement, pas de `.notNull()`) : la migration 0005 ne
   * peut ajouter la colonne en `NOT NULL` sur une table `profiles` déjà peuplée
   * (SQLite l'interdit sans default, issue #105) et la clé n'est pas calculable
   * en SQL. Rester nullable garde schema.ts ↔ snapshot ↔ SQL ↔ base **cohérents**
   * (`db:generate` no-op, aucun drift). Le **non-null est un invariant applicatif**,
   * garanti par : la validation, l'INSERT `createHousehold` (fournit toujours la
   * clé) et le backfill `runMigrations` → `backfillNameKeys`. L'index UNIQUE
   * enforce l'unicité sur toute valeur non-null.
   */
  nameKey: text("name_key").unique("profiles_name_key_unique"),
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

// ============================================================================
// Moteur math (epic #3) — état de maîtrise + journal des tentatives
// (ENGINE.md §2/§7/§10, PLAN.md §Modèle de données). Source de vérité SERVEUR
// (online-first) : la logique maîtrise/sélection vit côté serveur (CLAUDE.md).
// ============================================================================

/**
 * Assemble la **PK texte** d'une ligne `mastery` : une seule ligne par
 * `(profil, fact)`. L'unicité composite est **encodée dans la PK** — pas de
 * callback `sqliteTable` d'extras (uniqueIndex / PK composite) qui, n'étant jamais
 * invoqué au runtime, casserait le gate 100 % fonctions (LEARNINGS #34/#46, même
 * pattern que `pin_attempts`). Fonction pure → couvrable, et l'upsert
 * `onConflictDoUpdate` (consommé par 3.3+) cible ce PK simple.
 *
 * Séparateur `:` (comme `pin_attempts`) : le `fact_id` (clé de faits 3.1) utilise
 * `_`/`x`/`+`/`-` mais **jamais** `:` → clé sans ambiguïté. Le `profileId` est un
 * entier (autoincrement) → pas de `:` non plus.
 */
export function masteryKey(profileId: number, factId: string): string {
  return `${profileId}:${factId}`;
}

/**
 * État de maîtrise **par (profil, fact)** — modèle Leitner + fluence (ENGINE §2).
 * Une ligne par fait déjà rencontré par un profil, mise à jour sur la **1ʳᵉ
 * réponse** d'un fait dans un niveau (ENGINE §2/§10). Données **enfant** → FK
 * `profile_id` `ON DELETE CASCADE` (purge à la suppression du profil, RGPD).
 *
 * Unicité `(profil, fact)` portée par la **PK texte encodée** (`masteryKey`) — cf.
 * ci-dessus. `profile_id` / `fact_id` / `skill` restent des colonnes normales pour
 * les requêtes de sélection (dus/faibles par compétence) sans dépendre du décodage
 * de la PK.
 *
 * Invariants (honorés par les stories consommatrices 3.3+) :
 * - `strength` = **boîte Leitner 0..5** (ENGINE §2) : 0 = à apprendre/raté …
 *   5 = maîtrisé (entretien). Transitions juste+rapide → +1, faux → −2 (ENGINE §11).
 * - `next_due` = instant de réapparition dérivé de la boîte (délais ENGINE §2/§11).
 * - `avg_response_ms` = moyenne glissante du temps de réponse (fluence, ENGINE §2).
 * - Fact **maîtrisé** = `strength ≥ 4` ; maîtrise d'une compétence = % de ses facts
 *   à `strength ≥ 4` (ENGINE §2). Pas d'index secondaire (single-tenant, premature ;
 *   ajout via migration si le dashboard #7 le justifie — évite le callback extras).
 */
export const mastery = sqliteTable("mastery", {
  /** `"<profileId>:<factId>"` — une ligne par (profil, fact) (cf. `masteryKey`). */
  id: text("id").primaryKey(),
  /** Profil propriétaire — données enfant, purge en cascade (RGPD). */
  profileId: integer("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  /** Clé stable du fait (ex. `comp10_7`, `mult_6x8`) — contrat de faits 3.1. */
  factId: text("fact_id").notNull(),
  /** Compétence du fait (comp10 / add / sub / mult) — requête par compétence. */
  skill: text("skill").$type<Skill>().notNull(),
  /** Boîte Leitner 0..5 (force). Défaut 0 = à apprendre (ENGINE §2). */
  strength: integer("strength").notNull().default(0),
  /** Nombre cumulé de réponses justes sur ce fait. */
  correctCount: integer("correct_count").notNull().default(0),
  /** Nombre cumulé de réponses fausses / « je ne sais pas » sur ce fait. */
  wrongCount: integer("wrong_count").notNull().default(0),
  /** Temps de réponse moyen (ms) — fluence (moyenne glissante, ENGINE §2). */
  avgResponseMs: integer("avg_response_ms").notNull().default(0),
  /** Dernière rencontre du fait (base de la révision espacée). */
  lastSeen: integer("last_seen", { mode: "timestamp" }),
  /** Prochaine échéance de réapparition (dérivée de la boîte, ENGINE §2). */
  nextDue: integer("next_due", { mode: "timestamp" }),
});

/**
 * Journal **append-only** des réponses — une ligne par réponse (ENGINE §10).
 * Matière première de l'espace parent (justesse, rapidité, régularité, tendances,
 * PLAN §Modèle de données). Données **enfant** → FK `profile_id` `ON DELETE
 * CASCADE` (purge RGPD).
 *
 * PK `id` autoincrement simple : append-only → pas de callback extras. Pas d'index
 * secondaire pour l'instant (single-tenant ; l'agrégation dashboard #7 en ajoutera
 * un via migration si le volume le justifie).
 *
 * **Idempotence (SYNC §2)** : chaque écriture de réponse porte un `client_attempt_id`
 * (id opaque **fourni par le client**) → un rejeu réseau (retry après coupure, SYNC
 * §3) portant le même id **ne crée pas de doublon** et **ne recompte pas** la maîtrise.
 * SYNC.md est la spec **la plus précise** sur l'idempotence (« chaque écriture porte
 * un id client ») → colonne **in-contract** (même précédent que `is_retry`, absent de
 * PLAN §data mais requis par ENGINE §10, cf. LEARNINGS #58). L'unicité `(profil, id
 * client)` est vérifiée **au niveau requête dans la transaction synchrone** (pas de
 * callback `sqliteTable` d'extras qui casserait le gate 100 % fonctions, LEARNINGS
 * #34/#46 ; table single-tenant → scan filtré suffit, index différé). Nullable : le
 * diagnostic (3.6) amorce `mastery` sans passer par ce journal de réponse client.
 */
export const attempts = sqliteTable("attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Profil auteur — données enfant, purge en cascade (RGPD). */
  profileId: integer("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  /** Clé stable du fait répondu (contrat de faits 3.1). */
  factId: text("fact_id").notNull(),
  /** Compétence du fait (comp10 / add / sub / mult). */
  skill: text("skill").$type<Skill>().notNull(),
  /** Réponse juste ? (mode boolean drizzle → stocké 0/1). */
  correct: integer("correct", { mode: "boolean" }).notNull(),
  /** Temps de réponse (ms) — matière de la fluence. */
  responseMs: integer("response_ms").notNull(),
  /** Reprise après une erreur (« refait une fois », ENGINE §9 / PLAN). */
  isRetry: integer("is_retry", { mode: "boolean" }).notNull().default(false),
  /**
   * Id opaque **fourni par le client** pour l'idempotence (SYNC §2). Un rejeu portant
   * le même `(profile_id, client_attempt_id)` est ignoré (aucune 2ᵉ mutation). Unicité
   * portée par la requête (dans la transaction sync), pas par un index (single-tenant).
   */
  clientAttemptId: text("client_attempt_id"),
  /** Instant de la réponse (régularité / tendances). */
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ============================================================================
// Boucle jouer → récompense (epic #5) — progression + portefeuille + journal
// (MAP.md §4, ECONOMY.md §3, PLAN.md §Modèle de données). Source de vérité
// SERVEUR (online-first) : gains/dépenses tranchés côté serveur (CLAUDE.md).
//
// Note contrat : ECONOMY §3 note `profile_id` en `text (FK)` (« types
// indicatifs »), mais la clé réelle `profiles.id` est un **integer autoincrement**.
// On suit la clé réelle + la convention des tables existantes (`mastery`,
// `attempts`, `sessions` référencent toutes `profiles.id` en `integer`) — c'est
// le HOW dans le WHAT, pas un écart de contrat. Données **enfant** →
// FK `ON DELETE CASCADE` partout (purge à la suppression du profil, RGPD).
// ============================================================================

/**
 * Nombre d'étoiles d'un niveau (0..3, MAP §4 / ENGINE §5). Miroir local du type
 * `StarCount` de `engine/stars.ts`, **redéclaré ici** pour ne pas faire dépendre
 * `schema.ts` (chargé hors résolveur Next par drizzle-kit/tsx) d'un module qui
 * référence l'alias `@` (`stars.ts` importe `@/config/server-config`). Même
 * discipline « relatif only » que l'import de `Skill` depuis `../engine/domain`.
 */
export type Stars = 0 | 1 | 2 | 3;

/**
 * Assemble la **PK texte** d'une ligne `progress` : une seule ligne par
 * `(profil, monde, niveau)`. L'unicité composite est **encodée dans la PK** — pas
 * de callback `sqliteTable` d'extras (uniqueIndex / PK composite) qui, n'étant
 * jamais invoqué au runtime, casserait le gate 100 % fonctions (LEARNINGS #34/#46,
 * même pattern que `pin_attempts` / `mastery`). Fonction pure → couvrable, et
 * l'upsert `onConflictDoUpdate` (progression monotone) cible ce PK simple.
 *
 * Séparateur `:` (comme `pin_attempts` / `mastery`) : `profileId`, `worldIndex` et
 * `levelIndex` sont tous des entiers → aucun `:` possible dans les composantes,
 * clé sans ambiguïté.
 */
export function progressKey(profileId: number, worldIndex: number, levelIndex: number): string {
  return `${profileId}:${worldIndex}:${levelIndex}`;
}

/**
 * Progression par niveau **(profil, monde, niveau)** — étoiles obtenues (MAP §4).
 * Une ligne par niveau atteint. La somme des étoiles sert à l'**affichage /
 * collection**, **jamais** au déblocage (MAP §4). Données **enfant** → FK cascade.
 *
 * Unicité `(profil, monde, niveau)` portée par la **PK texte encodée**
 * (`progressKey`). `profileId` / `worldIndex` / `levelIndex` restent des colonnes
 * normales pour les requêtes (total d'étoiles d'un profil, progression d'un monde).
 *
 * Invariants (honorés par la couche `game/progress.ts` + stories consommatrices) :
 * - `stars` = **0..3** (MAP §4 / ENGINE §5). Défaut 0.
 * - Progression **MONOTONE** : une reprise ne baisse jamais les étoiles (SYNC —
 *   `stars = MAX(existant, nouveau)`). L'upsert applique ce max côté SQL.
 * - `world_index` croît à l'infini (jeu sans fin, MAP §1).
 */
export const progress = sqliteTable("progress", {
  /** `"<profileId>:<worldIndex>:<levelIndex>"` — une ligne par niveau (cf. `progressKey`). */
  id: text("id").primaryKey(),
  /** Profil propriétaire — données enfant, purge en cascade (RGPD). */
  profileId: integer("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  /** Index du monde (croît à l'infini, MAP §1). */
  worldIndex: integer("world_index").notNull(),
  /** Index du niveau dans le monde. */
  levelIndex: integer("level_index").notNull(),
  /** Étoiles obtenues 0..3 (MAP §4 / ENGINE §5). Défaut 0, monotone à la reprise. */
  stars: integer("stars").$type<Stars>().notNull().default(0),
  /** Dernière mise à jour de la progression (dernière rejoue du niveau). */
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Portefeuille **par profil** — pièces + éclats (ECONOMY §3.1). **Une seule ligne
 * par profil** → la PK est directement le `profile_id` (FK cascade), pas de colonne
 * clé encodée. Données **enfant** → purge en cascade (RGPD).
 *
 * Invariants (honorés par `game/wallet.ts`) :
 * - `coins ≥ 0`, `shards ≥ 0` (ECONOMY §1/§3.1) — garantis côté application
 *   (crédit borné, pas de dépense qui descende sous 0). Les dépenses arriveront en
 *   5.6+ (boutique/gacha) ; 5.1 ne pose que le **earn-side** (crédit).
 * - `updated_at` = instant serveur du dernier mouvement.
 */
export const wallet = sqliteTable("wallet", {
  /** Profil propriétaire = PK (1 ligne / profil). FK cascade (données enfant, RGPD). */
  profileId: integer("profile_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  /** Pièces 🪙 (≥ 0). Défaut 0. */
  coins: integer("coins").notNull().default(0),
  /** Éclats ✨ (≥ 0). Défaut 0. */
  shards: integer("shards").notNull().default(0),
  /** Instant serveur du dernier mouvement. */
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Sens d'un mouvement du journal (ECONOMY §3.7). */
export type LedgerDirection = "earn" | "spend";
/** Monnaie / nature d'un mouvement du journal (ECONOMY §3.7). */
export type LedgerCurrency = "coins" | "shards" | "item";

/**
 * Journal **append-only** des mouvements d'économie (ECONOMY §3.7) — traçabilité,
 * transparence parent, anti-triche. Une ligne par earn/spend. Données **enfant** →
 * FK cascade (RGPD).
 *
 * PK `id` autoincrement simple : append-only → pas de callback extras (même pattern
 * que `attempts`). Pas d'index secondaire pour l'instant (single-tenant ; l'espace
 * parent #7 en ajoutera un via migration si le volume le justifie).
 *
 * **Idempotence du crédit** (progression idempotente, CLAUDE.md) : un gain porte une
 * **clé de rejeu** stockée dans `ref_id` (ex. `level:<world>:<level>`). Un rejeu
 * réseau portant le même `(profile_id, reason, ref_id)` **ne recrédite pas** : la
 * garde (dans la transaction synchrone) détecte la ligne déjà journalisée. Unicité
 * vérifiée **au niveau requête** (pas de callback `sqliteTable` d'extras qui
 * casserait le gate 100 % fonctions ; table single-tenant → scan filtré suffit).
 */
export const ledger = sqliteTable("ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Profil concerné — données enfant, purge en cascade (RGPD). */
  profileId: integer("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  /** `earn` | `spend` (ECONOMY §3.7). */
  direction: text("direction").$type<LedgerDirection>().notNull(),
  /** `coins` | `shards` | `item` (ECONOMY §3.7). */
  currency: text("currency").$type<LedgerCurrency>().notNull(),
  /** Montant du mouvement (entier, ≥ 0 côté application). */
  amount: integer("amount").notNull(),
  /** Raison (`level`, `star_bonus`, `boss`, `daily_chest`, … — ECONOMY §3.7). */
  reason: text("reason").notNull(),
  /**
   * Id de l'objet lié / **clé de rejeu** pour l'idempotence (nullable, ECONOMY §3.7).
   * Un crédit rejoué portant le même `(profile_id, reason, ref_id)` est ignoré.
   */
  refId: text("ref_id"),
  /** Instant serveur du mouvement (régularité / transparence parent). */
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ============================================================================
// Collection (epic #5, story 5.6) — catalogue de créatures + possession
// (ECONOMY §3.2/§3.3, PLAN §Modèle de données, MAP §6, PRODUCT §2.3).
// Source de vérité SERVEUR : la légendaire du boss est ajoutée côté serveur
// (déterministe, hors œufs) ; le renommage enfant est persisté serveur.
// ============================================================================

/** Rareté d'une créature (ECONOMY §3.2 / §2). Les légendaires ne sont pas dans le pool d'œufs. */
export type Rarity = "common" | "rare" | "legendary";

/**
 * **Catalogue** des créatures collectionnables (ECONOMY §3.2). Une ligne par espèce
 * (partagée entre profils, comme `worlds`). Généré/amorcé côté serveur : la **légendaire
 * d'un monde** est amorcée de façon **déterministe** (une par `world_index`, `in_egg_pool =
 * false`, boss only — MAP §6) ; l'art réel est branché par l'épic #6 (ici un **placeholder**).
 *
 * PK `id` **texte** (clé stable, ex. `legendary:0`) : pas d'autoincrement (l'id est
 * déterministe pour permettre l'amorçage idempotent + le seed reproductible). Aucun callback
 * `sqliteTable` d'extras (index/PK composite) qui casserait le gate 100 % fonctions (LEARNINGS
 * #34/#46). Pas de FK vers `worlds` (les mondes IA arrivent épic #6) : `world_index` est un
 * entier (même seed que la carte procédurale, MAP §3) → couplage par valeur, pas par FK.
 *
 * Table **neuve** (jamais peuplée avant cette migration) → colonnes `NOT NULL` + `default`
 * sans le piège « ADD NOT NULL sur table peuplée » (issue #105). `art_ref_stages` / `story`
 * sont **nullable** (art réel + histoire enrichis par l'épic #6 ; le placeholder n'en pose pas).
 */
export const characters = sqliteTable("characters", {
  /** Clé stable (ex. `legendary:0`) — déterministe, permet l'amorçage idempotent. */
  id: text("id").primaryKey(),
  /** Index du monde d'appartenance (même seed que la carte, MAP §3). */
  worldIndex: integer("world_index").notNull(),
  /** Clé stable d'espèce (ex. `legendary_world_0`) — contrat de génération épic #6. */
  speciesKey: text("species_key").notNull(),
  /** Nom mignon par défaut (avant renommage enfant) — FR, voix douce (COPY §5). */
  nameDefault: text("name_default").notNull(),
  /** Rareté (`common` | `rare` | `legendary`). La légendaire = boss only (hors œufs). */
  rarity: text("rarity").$type<Rarity>().notNull(),
  /** Nombre de stades d'évolution (1..3, ECONOMY §2). Défaut 1 (placeholder). */
  maxStage: integer("max_stage").notNull().default(1),
  /**
   * Dans le **pool d'œufs** ? (ECONOMY §4.2). Les **légendaires = `false`** (boss only,
   * jamais tirées d'un œuf — garde d'exclusion testée à effet observable). Défaut `true`
   * (communes/rares). Mode boolean drizzle → stocké 0/1.
   */
  inEggPool: integer("in_egg_pool", { mode: "boolean" }).notNull().default(true),
  /** URL de l'asset (stade de base) — **placeholder** ici, art réel branché par l'épic #6. */
  artRef: text("art_ref").notNull(),
  /** URLs par stade (json) — nullable (branché par l'épic #6 avec l'évolution). */
  artRefStages: text("art_ref_stages"),
  /** Ligne d'histoire (COPY §4) — nullable (enrichie par l'épic #6, placeholder court sinon). */
  story: text("story"),
});

/**
 * Assemble la **PK texte** d'une ligne `collection` : une seule ligne par
 * `(profil, créature)`. L'unicité composite est **encodée dans la PK** — pas de callback
 * `sqliteTable` d'extras (uniqueIndex / PK composite) qui, n'étant jamais invoqué au runtime,
 * casserait le gate 100 % fonctions (LEARNINGS #34/#46, même pattern que `masteryKey` /
 * `progressKey`). Fonction pure → couvrable ; l'upsert `onConflictDoUpdate` (idempotence de
 * l'ajout légendaire) cible ce PK simple.
 *
 * Séparateur `:` : le `characterId` (clé de catalogue) utilise `:`/`_` en interne — mais on
 * borne la 1ʳᵉ composante au `profileId` (entier, aucun `:`) et on ne **découpe jamais** la
 * clé (aucun décodage : `profile_id`/`character_id` restent des colonnes normales). La clé est
 * donc sans ambiguïté même si `characterId` contient un `:` (on la concatène telle quelle,
 * jamais on ne la re-splitte).
 */
export function collectionKey(profileId: number, characterId: string): string {
  return `${profileId}:${characterId}`;
}

/**
 * **Possession** d'une créature par un profil (ECONOMY §3.3, « Pokédex » PRODUCT §2.3).
 * Une ligne par `(profil, créature)` possédée. La **légendaire du boss** y est ajoutée
 * directement (déterministe, hors œufs, MAP §6). Données **enfant** → FK cascade (RGPD).
 *
 * Unicité `(profil, créature)` portée par la **PK texte encodée** (`collectionKey`).
 * `profileId` / `characterId` restent des colonnes normales pour les requêtes (collection
 * d'un profil, possession d'une créature). Table **neuve** → `NOT NULL` + default sans piège.
 *
 * Invariants (honorés par `game/collection.ts` + stories consommatrices) :
 * - `count` = nb d'exemplaires obtenus (doublons inclus, ECONOMY §3.3). Défaut 1 (1ʳᵉ obtention).
 * - `stage` = stade d'évolution courant (≤ `characters.max_stage`, ECONOMY §3.3). Défaut 1 (bébé).
 * - `nickname` = **renommage enfant** (nullable = nom par défaut du catalogue, PRODUCT §2.3).
 * - **Idempotence de l'ajout** : re-gagner le boss n'ajoute **jamais** une 2ᵉ ligne (upsert par
 *   PK encodée). La légendaire étant garantie **hors œufs**, elle n'incrémente pas `count` au
 *   rejeu (pas de doublon parasite — garde testée à effet observable).
 */
export const collection = sqliteTable("collection", {
  /** `"<profileId>:<characterId>"` — une ligne par (profil, créature) (cf. `collectionKey`). */
  id: text("id").primaryKey(),
  /** Profil propriétaire — données enfant, purge en cascade (RGPD). */
  profileId: integer("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  /** Créature possédée (clé de catalogue `characters.id`). FK cascade au catalogue. */
  characterId: text("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  /** Nb d'exemplaires obtenus (doublons inclus, ECONOMY §3.3). Défaut 1. */
  count: integer("count").notNull().default(1),
  /** Stade d'évolution courant (≤ `max_stage`, ECONOMY §3.3). Défaut 1 (bébé). */
  stage: integer("stage").notNull().default(1),
  /** Renommage par l'enfant (nullable = nom par défaut, PRODUCT §2.3). */
  nickname: text("nickname"),
  /** Instant de la 1ʳᵉ obtention (affichage / tri collection). */
  unlockedAt: integer("unlocked_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
