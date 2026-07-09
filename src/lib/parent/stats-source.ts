/**
 * Pont **DB → agrégats parent** (story 7.2, PLAN §Espace parent). Charge la matière première du
 * moteur — `attempts` + `mastery` (via `loadScope`, PLAN :77/:113) — et délègue aux fonctions
 * **pures** de `stats.ts`. C'est la seule couche qui touche la DB, et elle est **strictement en
 * LECTURE SEULE** : l'espace parent **observe** l'état de l'enfant, il ne le modifie **jamais**
 * (aucune écriture, aucun impact runtime enfant — cf. issue #215).
 *
 * **Read-only garanti à deux niveaux** :
 * - **compile-time** : la lecture des `attempts` prend un handle `Pick<AppDatabase, "select">` — le
 *   type n'expose ni `insert`/`update`/`delete` (ajouter une écriture **ne compilerait pas**) ;
 * - **runtime observable** : `stats-source.test.ts` espionne `insert`/`update`/`delete` et vérifie
 *   qu'aucune n'est appelée + que les comptes de lignes sont **inchangés** (la garde **rougit** si
 *   une écriture est introduite).
 *
 * **SERVER-ONLY par transitivité** (importe la couche DB + le moteur). Le `profileId` vient
 * **toujours** de la session parent (jamais du client) — résolu par l'appelant (server action de
 * l'écran parent, story 7.7), jamais ici (ce module reste un pont pur, testable sur base réelle).
 */

import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { attempts } from "@/lib/db/schema";
import { loadScope } from "@/lib/engine/persistence";
import {
  computeAccuracyStats,
  computeMasteryMap,
  computeReviewList,
  computeSpeedStats,
  type AttemptRecord,
  type ParentStats,
  type StatsConfig,
} from "./stats";

/**
 * Handle DB **lecture seule** : seule la méthode `select` est exposée. Le type exclut
 * `insert`/`update`/`delete` → une écriture accidentelle dans la couche stats **casse la
 * compilation** (garde read-only compile-time, cf. doc du module).
 */
type ReadonlyStatsDb = Pick<AppDatabase, "select">;

/**
 * Charge les **réponses** d'un profil (journal `attempts`, append-only) en `AttemptRecord` purs.
 * Ne sélectionne que les colonnes utiles aux agrégats ; convertit `created_at` (`Date`) en epoch ms
 * (format de l'horloge du moteur). Le filtrage `isRetry` (1ʳᵉˢ réponses seules) est fait dans la
 * couche **pure** testée (`stats.ts`), pas ici — la lecture ramène tout le journal du profil.
 */
function loadAttemptRecords(db: ReadonlyStatsDb, profileId: number): AttemptRecord[] {
  const rows = db
    .select({
      skill: attempts.skill,
      correct: attempts.correct,
      responseMs: attempts.responseMs,
      isRetry: attempts.isRetry,
      createdAt: attempts.createdAt,
    })
    .from(attempts)
    .where(eq(attempts.profileId, profileId))
    .all();
  return rows.map((row) => ({
    skill: row.skill,
    correct: row.correct,
    responseMs: row.responseMs,
    isRetry: row.isRetry,
    createdAt: row.createdAt.getTime(),
  }));
}

/**
 * **Agrégats complets de l'espace parent** pour un profil (justesse, rapidité, carte de maîtrise, à
 * revoir). Lit `attempts` + le périmètre de maîtrise (`loadScope`, réutilisé — la définition de
 * maîtrise n'est jamais réinventée), puis compose les fonctions pures de `stats.ts`. **Lecture
 * seule** : aucune écriture DB.
 *
 * @param db connexion applicative (source de vérité serveur).
 * @param profileId profil **de la session parent** (jamais un profil client).
 * @param config `⚙️` combinés (`EngineConfig` moteur + `ReportingConfig` reporting, ADR 0012).
 * @param now instant serveur injecté (epoch ms, jamais un `Date.now()` interne).
 */
export function loadParentStats(
  db: AppDatabase,
  profileId: number,
  config: StatsConfig,
  now: number,
): ParentStats {
  const records = loadAttemptRecords(db, profileId);
  const scope = loadScope(db, profileId);
  return {
    accuracy: computeAccuracyStats(records, config, now),
    speed: computeSpeedStats(records, config, now),
    masteryMap: computeMasteryMap(scope, config),
    reviewList: computeReviewList(scope, config),
  };
}
