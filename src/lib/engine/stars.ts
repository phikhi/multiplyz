/**
 * Étoiles de fin de niveau (ENGINE.md §5) — logique **pure**, aucune I/O.
 *
 * Les étoiles se calculent sur la **justesse de la 1ʳᵉ réponse** (jamais la vitesse,
 * ENGINE §5) : sur les questions nominales d'un niveau (hors re-ask, cf. `computeAccuracy`),
 * la proportion de 1ʳᵉˢ réponses justes détermine 0 à 3 étoiles via `config.starThresholds`
 * (⚙️ 60 / 85 / 100 %, ENGINE §11). **No-fail** : il n'existe **aucun** résultat « échec »
 * — même `0` étoile termine le niveau normalement (ENGINE §5/§9, PRODUCT §2.2/§5).
 */

import type { EngineConfig } from "@/config/server-config";

/** Nombre d'étoiles gagnées à la fin d'un niveau (ENGINE §5) : `0` à `3`. */
export type StarCount = 0 | 1 | 2 | 3;

/**
 * Calcule le nombre d'étoiles à partir d'un ratio de justesse `accuracy` (`[0, 1]`) et des
 * seuils ⚙️ `[seuil1★, seuil2★, seuil3★]` (croissants, ENGINE §5/§11 : ex. `[0.6, 0.85, 1]`).
 *
 * Comparaison **large** (`>=`) à chaque seuil : atteindre **exactement** un seuil suffit
 * (ex. `accuracy = 0.6` avec seuil `0.6` → 1 étoile, pas 0 — un niveau parfait `accuracy = 1`
 * avec seuil 3★ `= 1` doit obtenir 3 étoiles). On teste les seuils du **plus haut au plus
 * bas** : le premier atteint fixe le résultat (les seuils sont croissants par contrat de
 * `EngineConfig`, donc au plus un seul « palier » peut matcher en descendant ainsi).
 */
export function computeStars(
  accuracy: number,
  starThresholds: EngineConfig["starThresholds"],
): StarCount {
  const [oneStar, twoStars, threeStars] = starThresholds;
  if (accuracy >= threeStars) {
    return 3;
  }
  if (accuracy >= twoStars) {
    return 2;
  }
  if (accuracy >= oneStar) {
    return 1;
  }
  return 0;
}

/**
 * Ratio de justesse `[0, 1]` de la **1ʳᵉ réponse** sur `total` questions nominales
 * (ENGINE §5 : les re-ask, non comptés pour la maîtrise, ne comptent pas non plus pour les
 * étoiles). `total = 0` (niveau vide, cas défensif structurellement improbable, cf. brief
 * #64) renvoie `0` plutôt qu'un `NaN` — un niveau sans question nominale ne peut pas
 * afficher un ratio indéfini.
 */
export function computeAccuracy(firstCorrectCount: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return firstCorrectCount / total;
}
