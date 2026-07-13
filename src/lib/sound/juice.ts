/**
 * Résolution PURE du SFX de réponse (bonne réponse / combo, AC #1 — story 8.4, #257).
 * `PRODUCT.md:60` « Bonne réponse → juice : étincelles, étoile, compagnon content, petit son.
 * Combo si série. » / `PLAN.md:66` « Juice sans pression : combo d'étincelles sur série de
 * bonnes réponses ». Aucune dépendance React/DOM — testable à 100 % sans rendu (même convention
 * que `@/lib/game/session` : la logique vit hors composant, `PlayingGame` ne fait que dispatcher).
 *
 * Consomme directement le `QuestionPhase`/`isRetrying` de `@/lib/game/session` — **jamais** de
 * notion de justesse propre : un re-essai faux est **déjà** affiché comme `"correct"` par
 * `applyAnswer` (no-fail, ENGINE.md), le son doit refléter EXACTEMENT ce que l'enfant voit, pas
 * réinventer une vérité que le moteur d'état ne trace pas.
 */

import type { QuestionPhase } from "@/lib/game/session";
import type { SfxKey } from "@/lib/sound/manifest";

export interface AnswerSfxResolution {
  /** Compteur de série (bonnes réponses consécutives en 1ʳᵉ tentative) APRÈS cette réponse. */
  readonly comboCount: number;
  /** SFX à jouer, ou `null` (1ʳᵉ tentative fausse → re-essai proposé, jamais de son négatif). */
  readonly sfx: Extract<SfxKey, "correct" | "combo"> | null;
}

/**
 * Résout le SFX pour une transition de phase `"correct"`/`"retry"` (jamais `"asking"` — narrowé
 * par le type, même patron que `FeedbackPanelProps.phase`).
 *
 * - `phase === "retry"` (1ʳᵉ tentative fausse) → série cassée (`comboCount: 0`), **aucun son**
 *   (posture no-fail : jamais de son négatif/sanction) ;
 * - `isRetrying === true` (réponse resolue APRÈS un re-essai, juste ou fausse — `applyAnswer` les
 *   affiche toutes deux `"correct"`) → série déjà cassée par le 1ʳᵉ échec, reste à `0`, SFX
 *   `"correct"` (encouragement, jamais `"combo"` même si la série d'AVANT dépassait le seuil) ;
 * - sinon (1ʳᵉ tentative juste) → `comboCount` incrémenté ; `"combo"` dès que le seuil est
 *   atteint/dépassé, sinon `"correct"`.
 *
 * @param comboCountBefore série courante avant cette réponse.
 * @param comboThreshold ⚙️ `SOUND_COMBO_THRESHOLD` (config.ts), injecté (jamais lu ici).
 */
export function resolveAnswerSfx(
  comboCountBefore: number,
  phase: Exclude<QuestionPhase, "asking">,
  isRetrying: boolean,
  comboThreshold: number,
): AnswerSfxResolution {
  if (phase === "retry") {
    return { comboCount: 0, sfx: null };
  }
  // Garde `isRetrying` : DÉFENSIVE dans le câblage composite actuel (dans `PlayScreen.tsx`, la
  // branche `phase === "retry"` ci-dessus a déjà remis `comboRef` à 0 AVANT le re-essai, donc
  // `comboCountBefore` vaut toujours 0 quand `isRetrying === true` → le repli sortirait déjà
  // "correct"). MAIS elle reste NÉCESSAIRE et MUTATION-PROUVÉE au niveau de la fonction pure : son
  // contrat isolé est « un re-essai n'ouvre jamais un combo, quel que soit `comboCountBefore` » —
  // `juice.test.ts` (« MUTATION-PROOF (garde isRetrying) », `comboCountBefore > seuil`) rougit si
  // on la retire. Ne pas supprimer (elle change la sortie de la fonction pure). Honnêteté #164/#206
  // (story hardening #289) : la mutation-preuve vit ICI au niveau unitaire, PAS dans le test
  // composite `PlayScreen.test.tsx` (que le SCOPE `phase="retry"` épingle indépendamment).
  if (isRetrying) {
    return { comboCount: 0, sfx: "correct" };
  }
  const comboCount = comboCountBefore + 1;
  return { comboCount, sfx: comboCount >= comboThreshold ? "combo" : "correct" };
}
