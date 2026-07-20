/**
 * Pont **DB → agrégats parent** (story 7.2, PLAN §Espace parent). Charge la matière première du
 * moteur — `attempts` + `mastery` (via `loadScope`, PLAN :77/:113) — et délègue aux fonctions
 * **pures** de `stats.ts`. C'est la seule couche qui touche la DB, et elle est **strictement en
 * LECTURE SEULE** : l'espace parent **observe** l'état de l'enfant, il ne le modifie **jamais**
 * (aucune écriture, aucun impact runtime enfant — cf. issue #215).
 *
 * **Read-only garanti à deux niveaux** — la garde **runtime** est la barrière **primaire** (elle
 * couvre TOUT le chemin), le typage n'est qu'un filet **partiel** :
 * - **compile-time (partiel)** : la seule requête maison, `loadAttemptRecords`, prend un handle
 *   `Pick<AppDatabase, "select">` — ce sous-type n'expose ni `insert`/`update`/`delete`, donc une
 *   écriture ajoutée **dans cette fonction** ne compilerait pas. ⚠️ `loadParentStats` reçoit en
 *   revanche un `AppDatabase` **complet** (il le faut pour appeler `loadScope`) : un `db.insert(…)`
 *   ajouté **directement dans `loadParentStats`** compilerait — seule la garde runtime l'attrape ;
 * - **runtime observable (couvre tout)** : `stats-source.test.ts` espionne `insert`/`update`/
 *   `delete` sur le vrai `db` et vérifie qu'aucune n'est appelée + que les comptes de lignes sont
 *   **inchangés** (la garde **rougit** si une écriture est introduite N'IMPORTE OÙ dans le chemin).
 *
 * **SERVER-ONLY par transitivité** (importe la couche DB + le moteur). Le `profileId` vient
 * **toujours** de la session parent (jamais du client) — résolu par l'appelant (server action de
 * l'écran parent, story 7.7), jamais ici (ce module reste un pont pur, testable sur base réelle).
 */

import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { attempts } from "@/lib/db/schema";
import { loadScope } from "@/lib/engine/persistence";
import { computeRegularityStats } from "./regularity";
import { computeAccuracyDailySeries } from "./accuracy-daily";
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
 * `insert`/`update`/`delete` → une écriture ajoutée **dans `loadAttemptRecords`** casse la
 * compilation. Filet **partiel** (ne couvre que cette fonction, pas `loadParentStats` qui a besoin
 * du `AppDatabase` complet pour `loadScope`) : la garde runtime reste la barrière primaire.
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
 * revoir, **régularité**, **justesse quotidienne**). Lit `attempts` + le périmètre de maîtrise
 * (`loadScope`, réutilisé — la définition de maîtrise n'est jamais réinventée), puis compose les
 * fonctions pures de `stats.ts` (justesse/rapidité/maîtrise/à-revoir), `regularity.ts` (jours
 * joués/temps/série/respect) et `accuracy-daily.ts` (série quotidienne de justesse, issue #241,
 * ADR 0018). **Lecture seule** : aucune écriture DB.
 *
 * @param db connexion applicative (source de vérité serveur).
 * @param profileId profil **de la session parent** (jamais un profil client).
 * @param config `⚙️` combinés (`EngineConfig` moteur + `ReportingConfig` ADR 0012 + `RegularityConfig`
 *   ADR 0014).
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
    // Régularité (story 7.4, ADR 0014) : dérivée du MÊME journal `attempts`, mais compte TOUTES les
    // réponses (engagement, re-essais inclus) — la couche pure filtre ce dont elle a besoin.
    regularity: computeRegularityStats(records, config.regularity, now),
    // Justesse quotidienne (issue #241, ADR 0018) : série sœur d'`accuracy` ci-dessus, DÉRIVÉE du
    // MÊME journal `attempts` (records identiques threadés) — le fuseau du jour calendaire
    // (`dayTimeZone`) est celui de la régularité (ADR 0014), même découpage, jamais réinventé.
    accuracyDaily: computeAccuracyDailySeries(records, config.regularity.dayTimeZone),
  };
}
