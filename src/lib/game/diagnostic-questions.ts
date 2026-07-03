/**
 * Adapte le plan de diagnostic (`DiagnosticItem[]`, 3.6) en `LevelQuestion[]` (3.7) pour
 * réutiliser **le même** `QuestionCard`/`gameReducer` que le niveau normal (story #64) —
 * aucune UI/logique dupliquée entre diagnostic et niveau.
 *
 * **Format** : un fait de diagnostic n'a **jamais** de `MasteryState` préalable (c'est
 * justement son but : amorcer la 1ʳᵉ boîte). C'est l'équivalent exact d'un fait `NEW`
 * (`state === null`) du niveau normal → même règle ENGINE §6 (« nouveau/faible → QCM »),
 * appliquée via `chooseFormat` avec la boîte plancher (`formatBoxOf(null) = 0`, même
 * convention que `service.ts`) : **QCM systématique** pour tout le diagnostic. Décision
 * **in-contract** (application littérale de la règle de format existante à un fait sans
 * état, pas une nouvelle règle) — cf. brief #64.
 *
 * `isReask` est toujours `false` (le diagnostic n'a pas de notion de re-ask intra-niveau,
 * ENGINE §4 ne s'applique qu'à la composition d'un niveau normal).
 */

import type { DiagnosticItem } from "@/lib/engine/diagnostic";
import { buildQuestionChoices, chooseFormat, type Rng } from "@/lib/engine/distractors";
import type { LevelQuestion } from "@/lib/engine/service";

/** Boîte conventionnelle d'un fait jamais vu (miroir de `formatBoxOf(null)`, service.ts). */
const NEW_FACT_BOX = 0;

/**
 * Convertit le plan de diagnostic en questions jouables (mêmes types que le niveau
 * normal). `rng` injecté pour le mélange déterministe des choix QCM (LEARNINGS aléa/#34).
 */
export function diagnosticToQuestions(items: readonly DiagnosticItem[], rng: Rng): LevelQuestion[] {
  // `chooseFormat(NEW_FACT_BOX)` est **toujours** "qcm" (QCM_MAX_BOX ≥ 0, ENGINE §6) —
  // constante figée par contrat, pas une branche à réévaluer par item (pas de ternaire
  // "qcm"/"pave" mort sous gate 100 %, LEARNINGS #75).
  const format = chooseFormat(NEW_FACT_BOX);
  return items.map((item) => ({
    factKey: item.fact.key,
    skill: item.fact.skill,
    operands: item.fact.operands,
    format,
    choices: buildQuestionChoices(item.fact, rng),
    isReask: false,
  }));
}
