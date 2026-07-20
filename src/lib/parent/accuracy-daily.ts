/**
 * **Justesse QUOTIDIENNE** de l'espace parent — agrégat dérivé ADDITIONNEL (issue #241, ADR 0018),
 * cœur read-only. Réalise honnêtement la métaphore « sparkline » du wireframe (WIREFRAMES §7
 * `▁▃▅▆▇`) avec de VRAIES données journalières — le contrat ADR 0012 (`stats.ts`, `AccuracyStats`)
 * n'expose qu'un point **courant** + un point **précédent** (semaine glissante), jamais une série
 * par jour ; 7.7 avait honnêtement substitué la sparkline par un delta signé texte (« +5 % »,
 * PR #239). Ce module **AJOUTE une série à côté**, il ne touche **ni ne modifie** `AccuracyStats`/
 * `computeAccuracyStats` (ADR 0012 reste figé) — même patron d'ajout que la régularité
 * journalière (story 7.4, ADR 0014, `regularity.ts`) : fonction **pure, isolée, substituable**
 * sans toucher les consommateurs.
 *
 * **Fidélité au modèle (ADR 0012, réaffirmée ici — PAS réinventée)** : la justesse ne compte que
 * les **1ʳᵉˢ réponses** (`isRetry = false`, ENGINE §9) — ce module réutilise `accuracyOf`
 * (`stats.ts`, exportée pour cette réutilisation) plutôt que de recalculer un second ratio.
 *
 * **Jour calendaire** : réutilise `makeDayOrdinal` (`regularity.ts`, ADR 0014) — EXACTEMENT le
 * même découpage de jour (fuseau ⚙️ `RegularityConfig.dayTimeZone`) que la régularité et la
 * progression du jour (`progression.ts`) — jamais un second découpage de jour inventé (CLAUDE.md :
 * la logique n'est jamais dupliquée).
 *
 * **Un jour n'apparaît dans la série QUE s'il porte au moins une 1ʳᵉ réponse** (même discipline que
 * `regularity.days`, qui n'inclut que les jours avec au moins une réponse) : un jour sans aucune
 * 1ʳᵉ réponse (même s'il porte des re-essais) n'a rien à montrer côté justesse — l'`accuracy` d'un
 * point de la série n'est donc **jamais** `null` (garanti par construction : une entrée n'existe
 * dans le regroupement par jour que parce qu'au moins une 1ʳᵉ réponse y a été poussée — pas une
 * branche défensive supplémentaire, CLAUDE.md « correct ≠ testable ≠ nécessaire », rétro #143).
 *
 * **Aucune horloge (`now`) requise** : contrairement à `regularity.ts` (série courante/aujourd'hui,
 * comparée à l'instant présent), cette série est un simple regroupement HISTORIQUE par jour — rien
 * n'y est comparé à « maintenant ». La fenêtre d'affichage (derniers N jours) est appliquée par le
 * CONSOMMATEUR (`ParentDashboard.tsx`, même séparation que `regularity.days` → `RegularitySection`
 * qui tranche elle-même les derniers jours), pas ici.
 */

import { accuracyOf, type AttemptRecord } from "./stats";
import { makeDayOrdinal } from "./regularity";

/** Justesse d'UN jour calendaire (jour portant au moins une 1ʳᵉ réponse, cf. en-tête). */
export interface AccuracyDayPoint {
  /** Ordinal du jour calendaire — même notion que `regularity.ts` (jours consécutifs = +1). */
  readonly dayOrdinal: number;
  /** Justesse du jour `[0,1]` (1ʳᵉˢ réponses seules, ENGINE §9) — jamais `null` (cf. en-tête). */
  readonly accuracy: number;
}

/**
 * **Série quotidienne de justesse**, triée par ordinal **croissant** (matière brute pour la
 * sparkline du dashboard, issue #241) — même discipline que `regularity.days`. Ne compte que les
 * **1ʳᵉˢ réponses** (`isRetry = false`), EXACTEMENT le même filtre que `computeAccuracyStats`
 * (ADR 0012) : un jour où l'enfant n'a fait QUE des re-essais (aucune 1ʳᵉ réponse ce jour-là)
 * n'apparaît PAS dans la série.
 */
export function computeAccuracyDailySeries(
  attempts: readonly AttemptRecord[],
  timeZone: string,
): readonly AccuracyDayPoint[] {
  const toDayOrdinal = makeDayOrdinal(timeZone);
  const graded = attempts.filter((a) => !a.isRetry);

  const byDay = new Map<number, AttemptRecord[]>();
  for (const a of graded) {
    const ordinal = toDayOrdinal(a.createdAt);
    const list = byDay.get(ordinal);
    if (list) {
      list.push(a);
    } else {
      byDay.set(ordinal, [a]);
    }
  }

  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayOrdinal, records]) => ({
      dayOrdinal,
      // `records` est TOUJOURS non vide ici : une entrée n'existe dans `byDay` QUE parce qu'au
      // moins une 1ʳᵉ réponse y a été poussée juste au-dessus → `accuracyOf` ne peut PAS retourner
      // `null` pour cette entrée précise (son cas `records.length === 0` reste utile pour l'appel
      // général de `computeAccuracyStats`, mais est structurellement inatteignable ici).
      accuracy: accuracyOf(records)!,
    }));
}
