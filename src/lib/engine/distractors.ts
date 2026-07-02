/**
 * Format QCM ↔ pavé + distracteurs typiques (ENGINE.md §6).
 *
 * Deux responsabilités **pures**, aucune I/O :
 * 1. `chooseFormat` : format d'affichage d'une question selon la maîtrise (boîte
 *    Leitner). Le garde-fou anti-devinette (« la maîtrise n'est jamais acquise via
 *    QCM seul ») vit côté 3.3/3.7 (sélection) — ici on n'expose que le **format**.
 * 2. `buildDistractors` : 3 distracteurs **plausibles** (erreurs typiques par
 *    compétence, jamais aléatoires) + la bonne réponse, **mélangés** de façon
 *    **déterministe** (RNG injecté — LEARNINGS aléa/#34 : jamais de `Math.random`
 *    interne, jamais de branche probabiliste sous gate coverage 100 %).
 */

import type { Fact } from "./facts";

/**
 * Boîte plancher ⚙️ du format QCM (ENGINE §6 : `box ≤ 1` → QCM, `box ≥ 2` → pavé).
 * Aucun champ dédié dans `EngineConfig` (3.2) à ce jour — constante locale
 * commentée ⚙️, réutilisant le vocabulaire de boîte déjà posé par 3.2/3.3
 * (`consolidationMaxBox` couvre un concept voisin mais distinct : la
 * consolidation, pas le format d'affichage). À faire migrer vers `EngineConfig`
 * si une story ultérieure a besoin de la calibrer indépendamment.
 */
const QCM_MAX_BOX = 1;

/** Nombre de choix affichés en format QCM (1 bonne réponse + 3 distracteurs, ENGINE §6). */
export const QCM_CHOICE_COUNT = 4;

/** Format d'affichage d'une question (ENGINE §6). */
export type QuestionFormat = "qcm" | "pave";

/**
 * Choisit le format d'affichage selon la boîte de maîtrise du fait (ENGINE §6) :
 * `box ≤ QCM_MAX_BOX` → QCM 4 choix (soutien fort, fait encore fragile) ; sinon
 * → pavé (rappel libre, seul format qui peut faire progresser vers la maîtrise —
 * garde-fou anti-devinette porté par 3.3/3.7, hors scope ici).
 */
export function chooseFormat(box: number): QuestionFormat {
  return box <= QCM_MAX_BOX ? "qcm" : "pave";
}

/**
 * Générateur RNG injecté : renvoie un flottant déterministe dans `[0, 1)`, même
 * contrat que `Math.random()`. Jamais d'aléa interne (LEARNINGS aléa/#34) — le
 * mélange des distracteurs doit être **reproductible** en test (coverage 100 %
 * stable, pas de flaky). En production, injecter `Math.random` ou un
 * `crypto.randomInt`-based RNG ; en test, une séquence fixe.
 */
export type Rng = () => number;

/**
 * Mélange de Fisher-Yates **déterministe** (RNG injecté) — aucune mutation de
 * `items` (retourne une copie). Chaque tirage consomme exactement `n-1` appels à
 * `rng`, dans un ordre stable, donc testable avec une séquence figée.
 */
function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Candidats de distracteurs **typiques** par compétence (ENGINE §6, table §6) —
 * dans l'ordre littéral de la spec (priorité de plausibilité pédagogique). Peut
 * contenir des doublons entre eux ou avec la réponse : `buildDistractors` filtre.
 * Fonction totale sur les 4 compétences.
 */
function typicalCandidates(fact: Fact): number[] {
  const { skill, operands, answer } = fact;
  switch (skill) {
    case "mult": {
      const [a, b] = operands;
      return [
        a * (b + 1), // ligne voisine (au-dessus)
        a * (b - 1), // ligne voisine (en dessous)
        a + b, // confusion d'opération
        reverseDigits(answer), // chiffres inversés du résultat
        a * (b + 2), // table voisine (repli si les 2 lignes voisines collisionnent)
      ];
    }
    case "add": {
      const [a, b] = operands;
      return [
        answer + 1,
        answer - 1,
        answer + 10,
        answer - 10,
        Math.abs(a - b), // confusion d'opération (soustraction)
        reverseDigits(answer), // résultat aux chiffres inversés
      ];
    }
    case "sub": {
      const [a, b] = operands;
      return [
        a + b, // confusion d'opération (addition)
        answer + 1,
        answer - 1,
        b - a, // inversion des opérandes (peut être négatif → filtré)
      ];
    }
    case "comp10": {
      // Compléments à 10 : un nombre qui ne fait pas 10 avec `a`, + ±1 autour de
      // la vraie réponse. `a` lui-même (confusion opérande/réponse) est le
      // distracteur le plus typique pour cette compétence à un seul opérande.
      const [a] = operands;
      return [a, answer + 1, answer - 1, answer + 2];
    }
  }
}

/** Inverse les chiffres d'un entier ≥ 0 (ex. `12` → `21`, `7` → `7`). */
function reverseDigits(value: number): number {
  return Number(Math.abs(value).toString().split("").reverse().join(""));
}

/** Nombre de distracteurs requis (ENGINE §6 : 1 bonne réponse + 3 distracteurs). */
const DISTRACTOR_COUNT = QCM_CHOICE_COUNT - 1;

/**
 * Amplitude maximale ⚙️ des offsets de repli `±k` (ENGINE §6 : complétion des
 * distracteurs manquants). Littéral ENGINE = `±1/±2` ; poussé à `±3` pour couvrir
 * l'unique fait limite du domaine Tier 1 (`sub_1-1`, réponse=0) où `±1/±2`
 * collisionnent tous ou tombent `<0`. Calibrable : élargir cette borne étend le
 * repli. Les offsets sont générés `+1, -1, +2, -2, …` (positif d'abord à chaque
 * amplitude) → privilégie le voisin le plus proche puis alterne les signes.
 */
const MAX_FILL_OFFSET = 3;

/**
 * Offsets de repli ordonnés `[+1, -1, +2, -2, +3, -3]` (dérivés de
 * `MAX_FILL_OFFSET`) — chaque amplitude `k` est proposée `+k` **avant** `−k`, et
 * les amplitudes croissent de 1 à `MAX_FILL_OFFSET` : on privilégie le voisin le
 * plus proche, côté positif d'abord (plus plausible qu'un négatif proche de 0).
 * Ordre **verrouillé par test** (mutation de l'ordre attrapée).
 */
export const FILL_OFFSETS: readonly number[] = Array.from(
  { length: MAX_FILL_OFFSET },
  (_, i) => i + 1,
).flatMap((k) => [k, -k]);

/**
 * `true` si `value` est un candidat **valide** (ENGINE §6 : `≠` bonne réponse,
 * `≥ 0`, pas déjà retenu). `taken` est l'ensemble des valeurs déjà acceptées
 * (bonne réponse incluse) — garantit l'unicité stricte du résultat final.
 */
function isValidCandidate(value: number, answer: number, taken: ReadonlySet<number>): boolean {
  return Number.isInteger(value) && value >= 0 && value !== answer && !taken.has(value);
}

/**
 * Complète jusqu'à `DISTRACTOR_COUNT` distracteurs avec des offsets valides
 * autour de la bonne réponse (ENGINE §6 : « compléter si < 3 avec ±1/±2
 * valides »), quand les candidats typiques n'ont pas suffi (épuisés ou
 * collisionnant tous). Parcourt `FILL_OFFSETS` (`+1, -1, +2, -2, +3, -3`) : les
 * offsets les plus proches et plausibles d'abord, côté positif avant négatif.
 *
 * **Repli `±3` (`MAX_FILL_OFFSET`)** : l'ENGINE §6 littéral ne prévoit que
 * `±1/±2`, mais au bord du domaine `sub` (`a=b`, réponse `0` — ex. `sub_1-1`) les
 * 4 offsets `±1/±2` collisionnent ou tombent `<0` (réponse `0` = pas de marge
 * côté négatif) et **aucun** distracteur typique de secours n'existe (`a+b` seul
 * est valide). `±3` est le **seul** cas de tout le domaine Tier 1 qui l'exige
 * (vérifié par balayage exhaustif des ~330 faits) : repli minimal et conservateur
 * (même famille « petit offset entier proche »), pas une nouvelle règle. Non
 * verrouillant (réversible via `MAX_FILL_OFFSET`, ⚙️-adjacent) — confirmé
 * in-contract par game-design + PO en review de #61.
 */
function fillWithOffsets(distractors: number[], answer: number, taken: Set<number>): void {
  for (const offset of FILL_OFFSETS) {
    if (distractors.length >= DISTRACTOR_COUNT) {
      break;
    }
    const candidate = answer + offset;
    if (isValidCandidate(candidate, answer, taken)) {
      distractors.push(candidate);
      taken.add(candidate);
    }
  }
}

/**
 * Construit les 3 distracteurs d'un fait (ENGINE §6) : erreurs **typiques** par
 * compétence en priorité, puis complétion `±1/±2` si moins de 3 candidats
 * typiques valides (uniques, `≥0`, `≠` réponse). Fonction pure — ne mélange pas
 * (cf. `buildQuestionChoices` pour le tirage final mélangé).
 */
export function buildDistractors(fact: Fact): number[] {
  const { answer } = fact;
  const distractors: number[] = [];
  const taken = new Set<number>([answer]);

  for (const candidate of typicalCandidates(fact)) {
    if (distractors.length >= DISTRACTOR_COUNT) {
      break;
    }
    if (isValidCandidate(candidate, answer, taken)) {
      distractors.push(candidate);
      taken.add(candidate);
    }
  }

  fillWithOffsets(distractors, answer, taken);

  return distractors;
}

/**
 * Construit les **choix QCM** complets d'un fait (ENGINE §6, format `pseudo-code`
 * de la spec) : bonne réponse + 3 distracteurs typiques, **mélangés** de façon
 * déterministe via le `rng` injecté. À n'appeler que pour `chooseFormat(box) ===
 * "qcm"` — le pavé n'a pas de choix (rappel libre).
 */
export function buildQuestionChoices(fact: Fact, rng: Rng): number[] {
  const choices = [fact.answer, ...buildDistractors(fact)];
  return shuffle(choices, rng);
}
