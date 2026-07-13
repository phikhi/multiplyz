import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
  /**
   * **Drapeau de recalibrage** (story 7.6, ADR 0016, ENGINE §3 « re-diagnostic monotone ») :
   * `true` = le parent a demandé de **relancer le mini-diagnostic**. Armé par l'action parent
   * (`reglages/actions.ts`), il fait re-présenter le diagnostic à l'enfant à la prochaine partie
   * (`diagnosticPlanAction`) MÊME quand `mastery` est non vide ; il est **effacé** dans la MÊME
   * transaction que la fusion monotone du re-diagnostic (`seedRecalibration`, atomicité).
   *
   * Bool SQLite (0/1). **NOT NULL DEFAULT false** — sûr en ajout de colonne sur une table
   * `profiles` DÉJÀ peuplée (SQLite n'interdit `ADD col NOT NULL` que **sans** default ; ici la
   * valeur par défaut `0` remplit les lignes existantes, issue #105 respectée) → aucun backfill
   * applicatif requis (contrairement à `name_key`, non calculable en SQL, ADR 0005). schema.ts ↔
   * snapshot ↔ SQL ↔ base restent cohérents (`db:generate` no-op), garde PRAGMA `notnull=1`/`dflt=0`.
   */
  recalibrationRequested: integer("recalibration_requested", { mode: "boolean" })
    .notNull()
    .default(false),
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
 * PLAN §data mais requis par ENGINE §10, cf. LEARNINGS #58). Nullable : le diagnostic
 * (3.6) amorce `mastery` sans passer par ce journal de réponse client.
 *
 * **Idempotence en défense en profondeur (#82)** : l'unicité `(profil, id client)` est
 * portée par DEUX couches. (1) La garde applicative `attemptExists` (dans la transaction
 * synchrone) reste la barrière **primaire** : elle transforme un rejeu en **no-op propre**
 * (aucune 2ᵉ écriture tentée) — correcte et atomique en **mono-process** (le daemon Node
 * actuel, STACK.md). (2) L'**index UNIQUE composite** `(profile_id, client_attempt_id)`
 * (déclaré via le callback table 3ᵉ-arg `(t) => [...]`) garantit le dédoublonnage **au
 * niveau moteur DB** — filet forward-looking pour un futur multi-process/cluster où le
 * check applicatif seul ne sérialiserait plus. **Index composite SIMPLE (pas partiel)** :
 * SQLite traite déjà chaque `NULL` comme **distinct** dans un index UNIQUE ordinaire → les
 * lignes **sans id client** (diagnostic, rejeux nus, `client_attempt_id NULL`) coexistent
 * librement, sans clause `WHERE ... IS NOT NULL`. Un prédicat partiel serait **behaviorally
 * redundant** ici (même dédoublonnage, même coexistence des NULL) et **non-testable** (aucun
 * test ne distinguerait partiel de simple, cf. rétro #124) → on ne le pose pas. **Pas de
 * piège coverage** (#34/#46) : le callback 3ᵉ-arg **retournant un tableau** est invoqué par
 * drizzle **à la définition de la table** (chargement de module) → v8 le compte comme couvert
 * (vérifié empiriquement, `schema.ts` 100 % fonctions). `db:generate` reste **no-op**
 * (schema.ts ↔ snapshot ↔ SQL cohérents ; index sérialisé par drizzle-kit, jamais de SQL à la main).
 */
export const attempts = sqliteTable(
  "attempts",
  {
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
     * portée par la garde applicative `attemptExists` (dans la transaction sync) **et** par
     * l'index UNIQUE composite du callback table (#82, défense en profondeur DB). Les lignes
     * `client_attempt_id NULL` coexistent librement (NULL distincts en SQLite).
     */
    clientAttemptId: text("client_attempt_id"),
    /** Instant de la réponse (régularité / tendances). */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    // Index UNIQUE composite SIMPLE (#82) : dédoublonnage `(profil, id client)` garanti par
    // le moteur DB (défense en profondeur, cf. doc de la table). Pas de prédicat partiel :
    // SQLite traite déjà chaque `NULL` comme distinct → les lignes sans id client (diagnostic,
    // rejeux nus) coexistent librement. Un `WHERE ... IS NOT NULL` serait redondant + non-testable.
    uniqueIndex("attempts_profile_client_attempt_unique").on(t.profileId, t.clientAttemptId),
  ],
);

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
 * **clé de rejeu** stockée dans `ref_id` (ex. `level:<world>:<level>`). Un rejeu réseau
 * portant le même `(profile_id, reason, ref_id)` **ne recrédite pas**.
 *
 * **Défense en profondeur (#82)** — même doctrine que `attempts`. (1) La garde applicative
 * `creditExists` (dans la transaction synchrone) reste la barrière **primaire** : elle
 * transforme un rejeu de `finishLevel` en no-op (`applied: false`, aucune 2ᵉ ligne ledger,
 * aucun 2ᵉ crédit) — correcte en **mono-process**. (2) L'**index UNIQUE composite**
 * `(profile_id, reason, ref_id)` (callback table 3ᵉ-arg) garantit le dédoublonnage **au
 * niveau moteur DB** — filet forward-looking multi-process. **Index composite SIMPLE (pas
 * partiel)** : SQLite traite déjà chaque `NULL` comme **distinct** dans un index UNIQUE
 * ordinaire → un mouvement **sans clé de rejeu** (`ref_id NULL` — ex. un mouvement
 * non-idempotent futur) reste **append-only libre** (jamais contraint), sans clause `WHERE
 * ... IS NOT NULL` ; seuls les mouvements **porteurs d'une clé de rejeu** sont dédoublonnés.
 * Un prédicat partiel serait **behaviorally redundant** ici (même dédoublonnage, même
 * coexistence des NULL) et **non-testable** (cf. rétro #124) → on ne le pose pas. Pas de piège
 * coverage (#34/#46, callback retournant un tableau = couvert), `db:generate` no-op.
 */
export const ledger = sqliteTable(
  "ledger",
  {
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
  },
  (t) => [
    // Index UNIQUE composite SIMPLE (#82) : dédoublonnage du crédit `(profil, raison, clé de
    // rejeu)` garanti par le moteur DB (défense en profondeur, cf. doc de la table). Pas de
    // prédicat partiel : SQLite traite déjà chaque `NULL` comme distinct → un mouvement sans
    // clé de rejeu (`ref_id NULL`) reste append-only libre. Un `WHERE ref_id IS NOT NULL`
    // serait redondant + non-testable.
    uniqueIndex("ledger_profile_reason_ref_unique").on(t.profileId, t.reason, t.refId),
  ],
);

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

// ============================================================================
// Pipeline mondes IA (epic #6, story 6.1) — mondes générés + file de jobs
// (WORLDGEN.md §3/§5, PLAN.md §Modèle de données, ADR 0008). Source de vérité
// SERVEUR : les mondes sont générés côté serveur (worker daemon), partagés entre
// profils du foyer (assets « mis en cache pour toujours », WORLDGEN §1 → PAS de FK
// profil, pas de cascade RGPD : ce ne sont pas des données enfant).
// ============================================================================

/**
 * Statut d'un monde généré (WORLDGEN §3/§6) : en tampon (QA) | actif (jouable) | **rejeté par un
 * parent** (`rejected`, story 7.9, ADR 0015). `rejected` est un état **terminal** (jamais
 * réactivé) — additif pur au contrat TS, **zéro migration** (`status` est une colonne `text` SANS
 * contrainte `CHECK` SQL : `$type<>` n'est qu'un contrat TypeScript, jamais sérialisé dans le
 * snapshot/SQL généré par drizzle-kit, `db:generate` reste un no-op). `resolveWorld` (socle.ts)
 * filtre déjà strictement `status = active` → un monde `rejected` retombe automatiquement sur le
 * socle de secours, exactement comme un monde resté `buffered` indéfiniment (aucune branche neuve).
 */
export type WorldStatus = "buffered" | "active" | "rejected";

/**
 * **Mondes générés** (WORLDGEN §5, PLAN §Modèle de données). Une ligne par monde,
 * **partagé** entre profils du foyer (pas de FK profil ni de cascade : asset partagé
 * « mis en cache pour toujours », WORLDGEN §1, non enfant-spécifique). Amorcé/rempli
 * par le worker daemon (épic #6). L'`index` = position sur la carte infinie (même seed
 * que la carte procédurale, MAP §3), **unique** (un seul monde par index).
 *
 * PK `id` **texte** (clé stable, ex. `world:0`) : déterministe pour l'amorçage
 * idempotent du socle pré-généré + le seed reproductible (WORLDGEN §7). Aucun callback
 * `sqliteTable` d'extras (uniqueIndex composite) qui casserait le gate 100 % fonctions
 * (LEARNINGS #34/#46) : l'unicité de l'index est déclarée via la **méthode chaînée
 * `.unique()` de la colonne** (drizzle la sérialise dans le snapshot ET le SQL ;
 * `db:generate` = no-op car schema.ts == snapshot ; le `.unique()` de colonne n'ajoute
 * **aucune** fonction non couverte, contrairement au callback 3ᵉ-arg — même patron
 * éprouvé que `profiles.name_key`, LEARNINGS #411-419).
 *
 * Table **neuve** (jamais peuplée avant cette migration) → colonnes `NOT NULL` +
 * `default` sans le piège « ADD NOT NULL sur table peuplée » (issue #105). `approved_by`
 * est **nullable** : renseigné seulement si la validation parent est activée et qu'un
 * parent a approuvé (WORLDGEN §6 ; un monde auto-validé n'a pas d'approbateur).
 */
export const worlds = sqliteTable("worlds", {
  /** Clé stable (ex. `world:0`) — déterministe, permet l'amorçage idempotent du socle. */
  id: text("id").primaryKey(),
  /**
   * Position du monde sur la carte infinie (croît à l'infini, MAP §1). **Unique**
   * (un seul monde par index) via `.unique()` de colonne — pas de callback extras
   * (LEARNINGS #34/#46). `index` est un mot réservé SQL → nom de colonne physique
   * `world_index` (jamais `index`) pour éviter toute ambiguïté avec les index DB.
   */
  index: integer("world_index").notNull().unique("worlds_index_unique"),
  /** Thème du monde (pool kid-safe, WORLDGEN §4) — ex. `forêt enchantée`. */
  theme: text("theme").notNull(),
  /** Palette dérivée (json) → pose `--world-accent` (DESIGN_TOKENS, WORLDGEN §4). */
  palette: text("palette").notNull(),
  /** Références d'assets (json : fond/tuiles servis par Nginx, WORLDGEN §5). */
  assetRefs: text("asset_refs").notNull(),
  /** Prompt de génération complet (reproductibilité à l'identique, WORLDGEN §7). */
  prompt: text("prompt").notNull(),
  /** Seed du modèle (reproductibilité à l'identique, WORLDGEN §5/§7). */
  seed: text("seed").notNull(),
  /**
   * `buffered` (en QA) | `active` (jouable après QA + validation parent) | `rejected` (refusé
   * par un parent, story 7.9, ADR 0015 — terminal, jamais réactivé). Défaut `buffered`.
   */
  status: text("status").$type<WorldStatus>().notNull().default("buffered"),
  /**
   * Identité de l'approbateur parent (nullable) — renseigné **uniquement** si la
   * validation parent est activée et qu'un parent a approuvé le monde (WORLDGEN §6).
   * Un monde auto-validé (toggle off) OU **rejeté** (7.9 — aucune identité stockée pour un
   * rejet, ADR 0015) reste `NULL`.
   */
  approvedBy: text("approved_by"),
  /** Instant serveur de la génération. */
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Statut d'un job de la file de génération (WORLDGEN §3). */
export type JobStatus = "pending" | "running" | "done" | "failed";

/**
 * **File de jobs** de génération de mondes (WORLDGEN §3 : « une file de jobs — table
 * `jobs` SQLite — consommée par un worker daemon »). Une ligne par job enqueue quand
 * l'enfant avance (buffer d'avance, WORLDGEN §3). Pas une donnée enfant (asset partagé)
 * → pas de FK profil ni de cascade RGPD.
 *
 * PK `id` autoincrement simple : pas de callback `sqliteTable` d'extras qui casserait le
 * gate 100 % fonctions (LEARNINGS #34/#46, même pattern que `attempts`/`ledger`). Pas
 * d'index secondaire pour l'instant (single-tenant, file courte ; à ajouter via migration
 * si le volume le justifie).
 *
 * Table **neuve** → colonnes `NOT NULL` + `default` sans le piège #105. `last_error` est
 * **nullable** (renseigné seulement quand `status = failed`). **Deux compteurs d'essais
 * DISTINCTS et indépendants** (le worker traverse deux phases séquentielles par job) :
 * - `attempts` borne les échecs du **générateur** (réseau/gen transitoire) vs `maxRetries`
 *   (ADR 0008 contrainte 1) ;
 * - `qa_attempts` borne les **régénérations après rejet QA kid-safe** vs `qa.maxAttempts`
 *   (WORLDGEN §6 « jusqu'à N essais », story 6.5).
 *
 * Séparés pour que **chaque budget soit exact** : un échec réseau antérieur n'ampute PAS le
 * budget de régénération QA (et inversement). `qa_attempts` est un **ajout additif** sur une
 * table existante — `NOT NULL DEFAULT 0` (jamais `NOT NULL` sans default sur table peuplée,
 * CLAUDE.md migrations) ; migration 0011 régénérée par drizzle-kit (`db:generate` no-op après).
 */
export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Type de job (ex. `generate_world`) — extensible (Stage A/B, QA). */
  type: text("type").notNull(),
  /** Charge utile (json : `world_index`, thème, seed…). */
  payload: text("payload").notNull(),
  /** `pending` | `running` | `done` | `failed`. Défaut `pending`. */
  status: text("status").$type<JobStatus>().notNull().default("pending"),
  /** Échecs du **générateur** (réseau/gen) consommés — borne `maxRetries` (ADR 0008). Défaut 0. */
  attempts: integer("attempts").notNull().default(0),
  /**
   * Régénérations après **rejet QA kid-safe** consommées (WORLDGEN §6, story 6.5) — borne
   * `qa.maxAttempts`. **Compteur DISTINCT** de `attempts` : un échec générateur antérieur
   * n'ampute pas ce budget (bornes exactes). Défaut 0.
   */
  qaAttempts: integer("qa_attempts").notNull().default(0),
  /** Dernier message d'erreur (nullable) — renseigné quand `status = failed`. */
  lastError: text("last_error"),
  /** Instant de création du job. */
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  /** Instant de la dernière mise à jour (changement de statut / nouvel essai). */
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Nature d'un asset de référence Teddy (WORLDGEN §8) : le **master** kawaii canonique, ou
 * une **expression** du model sheet (neutre · content · oups · acclame · intrépide — COPY
 * réactions). Le master ancre le Stage B (par monde) ; les expressions servent de sprites de
 * réaction en jeu (double usage, WORLDGEN §8).
 */
export type TeddyAssetKind = "master" | "expression";

/**
 * Statut de validation d'un asset de référence (WORLDGEN §8 « validé à la main »). Un asset
 * est produit **candidat** par l'outil Stage A ; le figeage du Teddy canonique (`approved`)
 * est un **sign-off propriétaire** (action manuelle, jamais automatique — checkpoint owner,
 * ADR 0008). Voir `lib/worldgen/reference-assets.ts`.
 */
export type ReferenceAssetStatus = "candidate" | "approved";

/**
 * **Assets de référence Teddy** (WORLDGEN §8, story 6.2) — master kawaii + model sheet
 * d'expressions produits par l'outil Stage A depuis les photos réelles (une seule fois). Ce
 * sont des **assets partagés du foyer** (pas de FK profil, pas de cascade RGPD : non
 * enfant-spécifiques, comme `worlds`). Le Stage B (par monde) ancre sur le **master** approuvé,
 * plus jamais les photos (WORLDGEN §8).
 *
 * PK `id` **texte** (clé stable, ex. `teddy:master`, `teddy:expression:neutre`) :
 * déterministe → amorçage/upsert idempotent des candidats par l'outil (rejouer Stage A
 * remplace le candidat au même id sans doublon). Aucun callback `sqliteTable` d'extras
 * (index/PK composite) qui casserait le gate 100 % fonctions (LEARNINGS #34/#46) — même
 * patron que `worlds`/`jobs`.
 *
 * Table **neuve** (jamais peuplée avant cette migration) → colonnes `NOT NULL` + `default`
 * sans le piège « ADD NOT NULL sur table peuplée » (issue #105). `expression` est **nullable**
 * (renseigné seulement pour `kind = expression` ; le master n'a pas d'expression). `approvedBy`
 * est **nullable** (renseigné uniquement au sign-off owner ; un candidat non figé reste `NULL`).
 *
 * `source_photos_hash` matérialise la **garde « photos consommées uniquement au Stage A »**
 * (WORLDGEN §8) : c'est une empreinte du lot de photos figée à la génération ; le Stage B lit
 * `master_ref` (l'asset dérivé), jamais les photos. `transparent` (bool 0/1) et
 * `background_strategy` tracent la **stratégie de fond** appliquée (⚙️ story 6.2) → lisibilité
 * Pokédex vérifiable (PRODUCT §2.3).
 */
export const teddyReferenceAssets = sqliteTable("teddy_reference_assets", {
  /** Clé stable (ex. `teddy:master`, `teddy:expression:neutre`) — upsert idempotent. */
  id: text("id").primaryKey(),
  /** `master` (Teddy canonique) | `expression` (sprite du model sheet). */
  kind: text("kind").$type<TeddyAssetKind>().notNull(),
  /**
   * Slug d'expression (`neutre`/`content`/`oups`/`acclame`/`intrepide`) — **nullable**,
   * renseigné uniquement pour `kind = expression` (le master n'a pas d'expression).
   */
  expression: text("expression"),
  /** Référence de l'asset dérivé (chemin/URL servi par Nginx, WORLDGEN §5). */
  assetRef: text("asset_ref").notNull(),
  /** Stratégie de fond appliquée (⚙️ story 6.2) — `post-cutout` | `full-card`. */
  backgroundStrategy: text("background_strategy").notNull(),
  /** Fond transparent ? (1 = détouré/transparent, 0 = carte pleine). Bool SQLite (0/1). */
  transparent: integer("transparent").notNull(),
  /**
   * Empreinte du lot de **photos réelles** figée au Stage A (garde « photos jamais
   * re-consommées après A », WORLDGEN §8). Le Stage B lit `master_ref`, jamais les photos.
   */
  sourcePhotosHash: text("source_photos_hash").notNull(),
  /** `candidate` (produit par l'outil) | `approved` (figé au sign-off owner). Défaut `candidate`. */
  status: text("status").$type<ReferenceAssetStatus>().notNull().default("candidate"),
  /**
   * Identité du propriétaire qui a **approuvé** l'asset (nullable) — renseigné uniquement au
   * sign-off manuel (WORLDGEN §8, ADR 0008). Un candidat non figé reste `NULL`.
   */
  approvedBy: text("approved_by"),
  /** Instant serveur de la génération du candidat. */
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ============================================================================
// Socle de fallback (epic #6, story 6.6) — pool de mondes pré-générés embarqués
// (WORLDGEN §1 « socle de ~5-8 mondes pré-générés et validés » + §7 « fallback &
// reproductibilité »). Source de vérité SERVEUR ; **assets partagés** du foyer
// (pas de FK profil, pas de cascade RGPD — non enfant-spécifiques, comme `worlds`).
// ============================================================================

/**
 * **Socle de mondes de secours** (WORLDGEN §1/§7, story 6.6). Pool **fixe** de ~5-8 mondes
 * pré-générés **embarqués** (amorcés au 1er lancement, hors réseau) : sert de **fallback** quand
 * aucun monde généré `active` n'existe encore à un index de carte (base fraîche = démarrage
 * instantané ; IA indispo / hors buffer = secours — WORLDGEN §7). Le résolveur (`resolveWorld`,
 * `lib/worldgen/socle.ts`) pioche `socle[worldIndex % taille_du_pool]` — le socle est un pool
 * **réutilisable** (non lié à une position de carte), **distinct** du `worlds` indexé par position :
 * le worker (6.4) **ignore** cette table (il ne lit/écrit que `worlds`), donc l'amorçage du socle
 * n'entrave **jamais** la génération paresseuse (le worker génère toujours depuis l'index 0).
 *
 * PK `id` **texte** (`socle:<slot>`) : déterministe → **amorçage idempotent** (`onConflictDoNothing`
 * par id, `seedSocleWorlds`). Aucun callback `sqliteTable` d'extras (index/PK composite) qui
 * casserait le gate 100 % fonctions (LEARNINGS #34/#46) — même patron que `worlds`/`jobs`. `slot`
 * reste une colonne normale (ordre stable + mapping modulo) : son unicité **découle** du PK
 * (`id = socle:<slot>`), une contrainte `.unique()` séparée serait **redondante + non-testable**
 * (rétro #143) → non posée.
 *
 * Table **neuve** (jamais peuplée avant cette migration) → colonnes `NOT NULL` **sans** le piège
 * « ADD NOT NULL sur table peuplée » (issue #105). `prompt` + `seed` sont stockés (reproductibilité
 * à l'identique, WORLDGEN §7). `asset_refs` porte des refs **placeholder** (`placeholder://socle/…`,
 * même signal que la légendaire 5.6) tant que le proprio n'a pas généré+validé les assets réels
 * (**gate owner**, WORLDGEN §1 « validés » — cf. runbook `needs-owner`).
 */
export const socleWorlds = sqliteTable("socle_worlds", {
  /** Clé stable (`socle:<slot>`) — déterministe, permet l'amorçage idempotent. */
  id: text("id").primaryKey(),
  /** Slot du monde dans le pool (0..taille-1) — ordre stable + mapping modulo du résolveur. */
  slot: integer("slot").notNull(),
  /** Thème du monde (label d'un thème curaté kid-safe, WORLDGEN §4.1). */
  theme: text("theme").notNull(),
  /** Palette dérivée (json) → pose `--world-accent` (DESIGN_TOKENS, WORLDGEN §4.2). */
  palette: text("palette").notNull(),
  /** Références d'assets (json : fond/tuiles/Teddy — **placeholder** jusqu'au gate owner). */
  assetRefs: text("asset_refs").notNull(),
  /** Prompt de génération complet (reproductibilité à l'identique, WORLDGEN §7). */
  prompt: text("prompt").notNull(),
  /** Seed du modèle (reproductibilité à l'identique, WORLDGEN §5/§7). */
  seed: text("seed").notNull(),
});

// ============================================================================
// Réglages du foyer (epic #7, story 7.3) — préférences parent persistées
// (DETAILS.md §3 (Espace parent) liste VERROUILLÉE, PRODUCT.md §1.4, ADR 0013). Source de
// vérité SERVEUR : le worker lit `parent_world_validation` (câblage 6.5), la carte
// lit le thème. **Portée FOYER** (single-tenant, AUTH.md §1) : réglages **partagés**
// du foyer (thème app-wide, validation des mondes, temps d'écran), pas des données
// enfant → **pas de FK profil, pas de cascade RGPD** (comme `worlds`/`socle_worlds`).
// ============================================================================

/**
 * **Préférence de thème** du foyer (DETAILS §3 « Thème clair/sombre »). Trois états
 * alignés sur l'architecture de `tokens.css` (blocs `[data-theme="dark"]` /
 * `:root:not([data-theme="light"])` sous `@media (prefers-color-scheme: dark)`) :
 * - `system` (défaut) → **aucun** attribut `data-theme` (le média-query système décide) ;
 * - `light` → `data-theme="light"` (force clair, bloque l'auto-sombre système) ;
 * - `dark` → `data-theme="dark"` (force sombre).
 *
 * Défini **ici** (pas dans `settings.ts`) car `schema.ts` est chargé HORS résolveur de
 * paths Next (drizzle-kit / `db:migrate` tsx) et ne peut importer aucun module qui
 * référence l'alias `@` (même contrainte que `SessionKind` / `WorldStatus`). `settings.ts`
 * importe **ce type** (`import type` erased au build).
 */
export type ThemePreference = "system" | "light" | "dark";

/** PK singleton de l'unique ligne de réglages du foyer (single-tenant). */
export const HOUSEHOLD_SETTINGS_ID = "household";

/**
 * **Réglages du foyer** (DETAILS §3 (Espace parent), story 7.3). **Une seule ligne** (single-tenant,
 * AUTH.md §1) : PK **texte constante** `HOUSEHOLD_SETTINGS_ID` (`"household"`) → upsert
 * idempotent (`onConflictDoUpdate` par id, `writeHouseholdSettings`). Aucun callback
 * `sqliteTable` d'extras (index/PK composite) qui casserait le gate 100 % fonctions (LEARNINGS
 * #34/#46) — même patron `worlds`/`socle_worlds`.
 *
 * Table **neuve** (jamais peuplée avant cette migration) → colonnes `NOT NULL` + `default`
 * **sans** le piège « ADD NOT NULL sur table peuplée » (issue #105). Les défauts de colonne sont
 * un filet SQLite (le NOT NULL l'exige) ; l'app **écrit toujours la ligne complète** (upsert) et
 * la **source ⚙️ autoritaire** des défauts vit dans `server-config.ts` (`parentControls`) +
 * `worldgen.qa.parentValidationEnabled` (défaut de bascule) — cf. `settings.ts` / ADR 0013.
 *
 * **Ce qui AGIT (câblé, story 7.3)** : `theme` (appliqué app-wide par `app/layout.tsx` → `<html
 * data-theme>`) et `parent_world_validation` (lu par le worker `processNextJob` → un monde
 * QA-validé reste `buffered` en attente d'approbation parent si `true`, `active` sinon — câblage
 * du ⚙️ 6.5). **Ce qui est STOCKÉ seulement (consommé en story 7.8 #229)** : les trois colonnes
 * `screen_time_*` (nudge + verrou dur optionnel) — **posées + validées + persistées ici**, jamais
 * **enforced** en 7.3 (l'enforcement dépend du temps-joué persisté 7.4 #217, hors scope).
 *
 * **Colonnes son (story 8.3, DETAILS §3, migration 0015)** : `sound_enabled`, `music_enabled`,
 * `volume` — **contrat DÉCLARÉ + VALIDÉ + PERSISTÉ seulement** (#155 : pas de sur-revendication).
 * Le **moteur sonore** (bruitages/musique réellement joués/mutés selon ces valeurs) est consommé en
 * **story 8.4** — aucun câblage de lecture audio n'existe encore ici. Ajoutées `NOT NULL DEFAULT` sur
 * table **déjà peuplée** (foyer réglé depuis 7.3) : booléens/entier avec défaut = filet SQLite sûr
 * (CLAUDE.md §Migrations — jamais `ADD col NOT NULL` sans default ; mirror migration 0014 §7.6, PAS
 * le patron nullable+backfill de `name_key`).
 */
export const householdSettings = sqliteTable("household_settings", {
  /** PK singleton (`HOUSEHOLD_SETTINGS_ID`) — une seule ligne de réglages du foyer. */
  id: text("id").primaryKey(),
  /** Préférence de thème (`system` | `light` | `dark`) — AGIT app-wide (DETAILS §3). Défaut `system`. */
  theme: text("theme").$type<ThemePreference>().notNull().default("system"),
  /**
   * **Validation des mondes** (DETAILS §3 (Validation des mondes), WORLDGEN §6) : `true` = approbation parent avant
   * affichage (monde QA-validé reste `buffered`), `false` = auto (`active`). **AGIT** : lu par le
   * worker (câblage du ⚙️ `qa.parentValidationEnabled` 6.5). Défaut `false` (auto, ADR 0008 « aucune
   * sur-censure »). Bool SQLite (0/1).
   */
  parentWorldValidation: integer("parent_world_validation", { mode: "boolean" })
    .notNull()
    .default(false),
  /**
   * **Temps d'écran — nudge doux** (min) : durée de session avant le nudge « fais une pause »
   * (DETAILS §3 (Temps d'écran) « 15-20 min », PRODUCT §1.4). **STOCKÉ seulement** (consommé en 7.8 #229). Défaut 20.
   */
  screenTimeNudgeMinutes: integer("screen_time_nudge_minutes").notNull().default(20),
  /**
   * **Verrou dur optionnel** activé ? (DETAILS §3 (Temps d'écran) « + verrou dur optionnel »). **STOCKÉ seulement**
   * (l'enforcement = 7.8 #229). Défaut `false` (opt-in parent). Bool SQLite (0/1).
   */
  screenTimeHardLockEnabled: integer("screen_time_hard_lock_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  /**
   * **Seuil du verrou dur** ⚙️ (min/jour) : au-delà, l'app se verrouille en douceur jusqu'au
   * lendemain (DETAILS §3 (Temps d'écran)). **STOCKÉ + validé seulement** (borne ⚙️ `parentControls`) — **jamais
   * enforced en 7.3** (consommé en 7.8 #229). Défaut 45.
   */
  screenTimeHardLockMinutes: integer("screen_time_hard_lock_minutes").notNull().default(45),
  /**
   * **Bruitages** activés ? (DETAILS §3 « son on/off » ; **ADR 0017** : parent = source de vérité,
   * édité ici — l'enfant a un quick-mute son/musique no-PIN in-game en story 8.6 #282). **STOCKÉ + validé
   * seulement (story 8.3)** — la lecture/coupure réelle des bruitages est consommée en **story 8.4**.
   * Défaut `true` (audio v1 = bruitages + musique, PRODUCT §2/§137 — activé par défaut, opt-out).
   * Bool SQLite (0/1).
   */
  soundEnabled: integer("sound_enabled", { mode: "boolean" }).notNull().default(true),
  /**
   * **Musique** activée ? (DETAILS §3 « musique on/off »). **STOCKÉ + validé seulement (story
   * 8.3)** — consommé en **story 8.4**. Défaut `true` (même registre que `soundEnabled`, opt-out).
   * Bool SQLite (0/1).
   */
  musicEnabled: integer("music_enabled", { mode: "boolean" }).notNull().default(true),
  /**
   * **Volume** (DETAILS §3 (volume — côté parent, ADR 0017)) — entier `[0, 100]` (pourcentage), cohérent avec les
   * autres colonnes numériques de cette table (entiers, jamais de `real`/flottant SQLite). **STOCKÉ
   * + validé seulement (story 8.3)** — consommé en **story 8.4**. Défaut ⚙️ `sound.volumeDefault`
   * (`server-config.ts`), valeur de repli **70** si l'env ne le précise pas.
   */
  volume: integer("volume").notNull().default(70),
  /** Instant serveur de la dernière modification des réglages. */
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
