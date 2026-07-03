/**
 * Persistance du moteur — pont **DB ↔ moteur pur** (ENGINE §10, SYNC §1/§2).
 *
 * Le cœur pédagogique (`mastery.ts`, `level.ts`, `diagnostic.ts`) est **pur** et
 * agnostique du stockage : il manipule des `MasteryState` (instants en **epoch ms**).
 * Ce module traduit dans les deux sens entre ces états purs et les lignes Drizzle de
 * la table `mastery` (instants en `Date`/timestamp), et lit/écrit les lignes
 * `attempts`. Il ne porte **aucune** logique pédagogique (Leitner, sélection,
 * fluence) — uniquement le mapping + les requêtes.
 *
 * **SERVER-ONLY par transitivité** (importe la couche DB) — jamais dans un composant
 * client. Les fonctions prennent la connexion (`AppDatabase`) ou un handle de
 * transaction en paramètre → testables sur une base réelle, et utilisables **dans**
 * une transaction synchrone better-sqlite3 (anti-TOCTOU, LEARNINGS #36).
 */

import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { attempts, mastery, masteryKey } from "@/lib/db/schema";
import type { Skill } from "./domain";
import { generateAllFacts, parseFactKey, type Fact } from "./facts";
import type { MasteryState } from "./mastery";
import type { ScopeEntry } from "./level";

/**
 * Handle accepté par les écritures : la connexion applicative **ou** le handle de
 * transaction passé par `db.transaction((tx) => …)`. Les deux exposent la même API
 * Drizzle (`select`/`insert`/`update`) → une écriture peut tourner indifféremment
 * hors ou dans une transaction. `AppDatabase` porte en plus `.transaction(...)`.
 */
export type DbHandle = Pick<AppDatabase, "select" | "insert" | "update">;

/**
 * Convertit une ligne `mastery` (instants `Date` nullable) en `MasteryState` pur
 * (instants **epoch ms** nullable) attendu par le moteur. Une seule source de
 * conversion Date→ms → aucune divergence de format entre lecture et logique.
 */
function rowToState(row: {
  strength: number;
  correctCount: number;
  wrongCount: number;
  avgResponseMs: number;
  lastSeen: Date | null;
  nextDue: Date | null;
}): MasteryState {
  return {
    box: row.strength,
    correctCount: row.correctCount,
    wrongCount: row.wrongCount,
    avgResponseMs: row.avgResponseMs,
    lastSeen: row.lastSeen === null ? null : row.lastSeen.getTime(),
    nextDue: row.nextDue === null ? null : row.nextDue.getTime(),
  };
}

/** Convertit un instant epoch ms (ou `null`) en `Date` (ou `null`) pour la colonne. */
function msToDate(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}

/**
 * Charge l'**état de maîtrise d'un fait** pour un profil, ou `null` si le fait n'a
 * jamais été rencontré (aucune ligne = « nouveau », ENGINE §2/§3). Ciblé par la **PK
 * texte encodée** (`masteryKey`) → lookup direct, pas de scan.
 */
export function loadMasteryState(
  db: DbHandle,
  profileId: number,
  factKey: string,
): MasteryState | null {
  const row = db
    .select()
    .from(mastery)
    .where(eq(mastery.id, masteryKey(profileId, factKey)))
    .limit(1)
    .get();
  return row === undefined ? null : rowToState(row);
}

/**
 * Charge le **périmètre complet** du profil : **tous** les faits du domaine Tier 1
 * (`generateAllFacts`) joints à leur `MasteryState` persisté (ou `null` si neuf). C'est
 * l'entrée de `buildLevel` (3.4) : le moteur voit l'univers entier + l'état du profil.
 *
 * Une seule requête (toutes les lignes `mastery` du profil), indexée en mémoire par
 * `fact_id` → O(faits) sans N+1. Les lignes `mastery` dont le `fact_id` **ne
 * correspond à aucun fait Tier 1** (clé orpheline après un rétrécissement de domaine)
 * sont **ignorées** : le périmètre reste la vérité du domaine courant.
 */
export function loadScope(db: DbHandle, profileId: number): ScopeEntry[] {
  const rows = db.select().from(mastery).where(eq(mastery.profileId, profileId)).all();
  const stateByFact = new Map<string, MasteryState>();
  for (const row of rows) {
    stateByFact.set(row.factId, rowToState(row));
  }
  return generateAllFacts().map((fact) => ({
    fact,
    state: stateByFact.get(fact.key) ?? null,
  }));
}

/**
 * **Upsert** l'état de maîtrise d'un `(profil, fact)` (SYNC §1 : serveur source de
 * vérité). Insert la ligne si le fait est neuf, sinon met à jour les colonnes
 * dérivées de la transition (`applyAttempt`). Ciblé par la **PK encodée** via
 * `onConflictDoUpdate` → une seule requête atomique, réutilisable **dans** une
 * transaction synchrone. `skill` est écrit à l'insert (invariant du fait), figé ensuite.
 */
export function upsertMastery(
  db: DbHandle,
  profileId: number,
  fact: Fact,
  state: MasteryState,
): void {
  const id = masteryKey(profileId, fact.key);
  const lastSeen = msToDate(state.lastSeen);
  const nextDue = msToDate(state.nextDue);
  db.insert(mastery)
    .values({
      id,
      profileId,
      factId: fact.key,
      skill: fact.skill,
      strength: state.box,
      correctCount: state.correctCount,
      wrongCount: state.wrongCount,
      avgResponseMs: state.avgResponseMs,
      lastSeen,
      nextDue,
    })
    .onConflictDoUpdate({
      target: mastery.id,
      set: {
        strength: state.box,
        correctCount: state.correctCount,
        wrongCount: state.wrongCount,
        avgResponseMs: state.avgResponseMs,
        lastSeen,
        nextDue,
      },
    })
    .run();
}

/** Une ligne `attempts` à journaliser (miroir des colonnes écrites, ENGINE §10). */
export interface AttemptRow {
  readonly factId: string;
  readonly skill: Skill;
  readonly correct: boolean;
  readonly responseMs: number;
  readonly isRetry: boolean;
  /** Id opaque client pour l'idempotence (SYNC §2) ; `null` si non fourni. */
  readonly clientAttemptId: string | null;
}

/**
 * `true` si une réponse portant ce `(profil, clientAttemptId)` **existe déjà**
 * (SYNC §2 : garde d'idempotence). Un `clientAttemptId` `null` n'est **jamais**
 * considéré déjà présent (pas d'id = pas de dédoublonnage). Scan filtré (table
 * single-tenant, index différé, cf. schéma). À appeler **dans** la transaction
 * synchrone, avant le journal + l'upsert, pour sérialiser check-then-write (anti-TOCTOU).
 */
export function attemptExists(
  db: DbHandle,
  profileId: number,
  clientAttemptId: string | null,
): boolean {
  if (clientAttemptId === null) {
    return false;
  }
  const existing = db
    .select({ id: attempts.id })
    .from(attempts)
    .where(and(eq(attempts.profileId, profileId), eq(attempts.clientAttemptId, clientAttemptId)))
    .limit(1)
    .get();
  return existing !== undefined;
}

/**
 * Journalise **une** ligne `attempts` (append-only, ENGINE §10). `createdAt` est
 * l'instant serveur injecté (`now`) — jamais un `Date.now()` interne (horloge injectée,
 * LEARNINGS #46). À appeler **dans** la transaction synchrone.
 */
export function insertAttempt(db: DbHandle, profileId: number, row: AttemptRow, now: Date): void {
  db.insert(attempts)
    .values({
      profileId,
      factId: row.factId,
      skill: row.skill,
      correct: row.correct,
      responseMs: row.responseMs,
      isRetry: row.isRetry,
      clientAttemptId: row.clientAttemptId,
      createdAt: now,
    })
    .run();
}

/**
 * Résout un `factKey` **relu du client** en `Fact` canonique **valide** du domaine
 * Tier 1, ou `null` si la clé est corrompue / hors-domaine (`parseFactKey`, #57). Garde
 * de sécurité de la frontière serveur (note review PR #68 sur #63) : un `fact_id` forgé
 * ne peut pas empoisonner `mastery`/`attempts`. Simple ré-export nommé pour la lisibilité
 * du service (`resolveFact` exprime l'intention côté API).
 */
export function resolveFact(factKey: string): Fact | null {
  return parseFactKey(factKey);
}
