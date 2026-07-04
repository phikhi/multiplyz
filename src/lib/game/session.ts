/**
 * Machine d'état **pure** de l'écran de jeu (ENGINE.md §5/§9, PRODUCT.md §2.2, story #64).
 *
 * Le composant client (`PlayScreen`) ne fait que **dispatcher** des événements UI
 * (réponse choisie/saisie, « je ne sais pas », continuer) vers `gameReducer` et rendre
 * l'état résultant — toute la logique (progression, no-fail/re-essai, comptage 1ʳᵉ
 * réponse, étoiles) vit ici, **testable à 100 % sans DOM** (LEARNINGS : extraire la
 * logique en modules purs plutôt que la noyer dans le composant).
 *
 * **No-fail (ENGINE §9)** : une réponse fausse (ou « je ne sais pas ») affiche la bonne
 * réponse puis propose un **re-essai** — cette 2ᵉ tentative n'est **jamais** comptée
 * (ni pour la maîtrise serveur, ni pour les étoiles côté client, ni pour l'idempotence :
 * elle porte `isRetry: true` avec le **même** `clientAttemptId`, cf. contrat
 * `SubmitAttemptInput` de `@/lib/engine/service`). Un fait ne peut être **re-essayé
 * qu'une fois** : après le re-essai (juste ou faux), on avance — jamais de boucle
 * infinie sur une question, jamais de blocage (no-fail).
 *
 * **Horloge** : `now` (typiquement `performance.now()`, mesuré **en silence** —
 * aucun chrono visible, ENGINE §9) est **injecté** à chaque action temporelle → pur et
 * déterministe en test (LEARNINGS : tout comportement temporel = horloge injectée).
 */

import type { LevelQuestion } from "@/lib/engine/service";

/** Étape affichée à l'enfant pour la question courante. */
export type QuestionPhase =
  /** Question posée, en attente d'une réponse (chrono silencieux démarré). */
  | "asking"
  /** Réponse juste donnée (1ʳᵉ tentative ou re-essai) — feedback positif bref. */
  | "correct"
  /** Réponse fausse/« je ne sais pas » à la **1ʳᵉ** tentative — bonne réponse montrée, propose un re-essai. */
  | "retry";

/** Une question en cours de jeu : le contenu (3.7) + son état de progression local. */
export interface GameQuestion {
  readonly question: LevelQuestion;
  readonly phase: QuestionPhase;
  /** `true` dès que la question en est à sa **2ᵉ** tentative (re-essai en cours/fait). */
  readonly isRetrying: boolean;
  /** Id opaque stable pour cette **intention de réponse** (idempotence, SYNC §2). Généré une
   *  fois à l'arrivée sur la question, réutilisé identique pour la 1ʳᵉ tentative ET le re-essai
   *  (même `clientAttemptId` : le service ne compte que la 1ʳᵉ écriture, `isRetry` distingue). */
  readonly clientAttemptId: string;
}

/** État complet de la partie en cours (une session `/jouer`). */
export interface GameState {
  readonly questions: readonly LevelQuestion[];
  /** Index de la question courante dans `questions`. */
  readonly currentIndex: number;
  /** État de progression de la question courante. */
  readonly current: GameQuestion;
  /** Nombre de **1ʳᵉˢ réponses** justes (hors re-ask), base du calcul d'étoiles (ENGINE §5). */
  readonly firstCorrectCount: number;
  /** `true` une fois la dernière question résolue (niveau terminé, jamais d'échec). */
  readonly finished: boolean;
  /** Horodatage (`now` injecté) auquel la question courante a été affichée — base de `responseMs`. */
  readonly askedAt: number;
}

/** Fabrique un `clientAttemptId` opaque (UUID v4, idempotence SYNC §2). Isolé pour le test (stub). */
export type IdFactory = () => string;

/** `IdFactory` par défaut : `crypto.randomUUID()` (disponible navigateur + Node ≥ 19). */
export const randomAttemptId: IdFactory = () => crypto.randomUUID();

/** `askedAt` (horloge silencieuse) est porté par `GameState`, pas par la question elle-même. */
function makeGameQuestion(question: LevelQuestion, makeId: IdFactory): GameQuestion {
  return {
    question,
    phase: "asking",
    isRetrying: false,
    clientAttemptId: makeId(),
  };
}

/**
 * Initialise l'état de jeu pour un niveau (~10 questions ; un **boss** en a plus,
 * `bossQuestionCount` ~12-15, MAP §6 — la taille vient du serveur, ce module est agnostique :
 * il travaille sur `questions.length`, jamais une constante) — **jamais** appelée sur un
 * niveau vide (cf. `PlayScreen`, cas défensif « niveau vide » routé en amont : un niveau
 * sans question ne peut pas produire de 1ʳᵉ `GameQuestion`).
 *
 * @param questions questions du niveau (`Level.questions`, déjà ordonnées par 3.7).
 * @param now horodatage **injecté** (`performance.now()`) de l'affichage de la 1ʳᵉ question.
 * @param makeId fabrique d'id injectée (déterministe en test).
 */
export function initGameState(
  questions: readonly LevelQuestion[],
  now: number,
  makeId: IdFactory = randomAttemptId,
): GameState {
  return {
    questions,
    currentIndex: 0,
    current: makeGameQuestion(questions[0], makeId),
    firstCorrectCount: 0,
    finished: false,
    askedAt: now,
  };
}

/** Issue du jugement d'une réponse : juste, ou pas (fausse / « je ne sais pas »). */
export interface AnswerOutcome {
  readonly correct: boolean;
}

/**
 * Payload prêt à envoyer à `submitAttemptAction` (contrat `SubmitAttemptInput`, 3.7) pour la
 * tentative qui vient d'être jugée. `responseMs = now − askedAt` de l'état **avant**
 * transition (mesuré en silence, ENGINE §9) — l'appelant (`PlayScreen`) l'envoie au serveur
 * en parallèle de la transition locale (fire-and-forget côté rendu, résultat non bloquant :
 * le client a déjà tout ce qu'il faut pour l'affichage no-fail).
 */
export interface AttemptSubmission {
  readonly factKey: string;
  readonly skill: LevelQuestion["skill"];
  readonly correct: boolean;
  readonly responseMs: number;
  readonly isRetry: boolean;
  readonly clientAttemptId: string;
}

/** Construit le payload de soumission pour la question courante, avant transition d'état. */
export function buildSubmission(
  state: GameState,
  outcome: AnswerOutcome,
  now: number,
): AttemptSubmission {
  return {
    factKey: state.current.question.factKey,
    skill: state.current.question.skill,
    correct: outcome.correct,
    responseMs: Math.max(0, Math.round(now - state.askedAt)),
    isRetry: state.current.isRetrying,
    clientAttemptId: state.current.clientAttemptId,
  };
}

/**
 * Applique le jugement d'une réponse à la question **courante** (ENGINE §9, no-fail) :
 *
 * - **juste** → `phase: "correct"` ; si c'était la **1ʳᵉ** tentative, incrémente
 *   `firstCorrectCount` (compte pour les étoiles) — un re-essai juste **ne recompte pas** ;
 * - **faux / « je ne sais pas »**, encore en **1ʳᵉ** tentative → `phase: "retry"` (affiche la
 *   bonne réponse + propose un re-essai) — **ne compte jamais** dans `firstCorrectCount`
 *   (posture croissance : pas de pénalité additionnelle, juste pas de crédit) ;
 * - **faux au re-essai** (2ᵉ tentative) → `phase: "correct"` **quand même** affiché comme
 *   résolu (no-fail : on ne boucle jamais indéfiniment sur une question) — la question reste
 *   « faible » côté serveur (déjà rétrogradée par la 1ʳᵉ réponse fausse), mais l'enfant avance.
 *
 * Ne fait **aucune** I/O — l'appelant soumet séparément via `buildSubmission` avant/pendant
 * cette transition.
 */
export function applyAnswer(state: GameState, outcome: AnswerOutcome): GameState {
  const wasFirstAttempt = !state.current.isRetrying;

  if (outcome.correct) {
    return {
      ...state,
      current: { ...state.current, phase: "correct" },
      firstCorrectCount: wasFirstAttempt ? state.firstCorrectCount + 1 : state.firstCorrectCount,
    };
  }

  if (wasFirstAttempt) {
    // 1ʳᵉ tentative fausse → re-essai proposé (non compté), jamais de sanction/blocage.
    return {
      ...state,
      current: { ...state.current, phase: "retry" },
    };
  }

  // Re-essai (2ᵉ tentative) toujours faux → on avance quand même (no-fail : jamais de
  // boucle bloquante). Affiché comme résolu, sans crédit de justesse.
  return {
    ...state,
    current: { ...state.current, phase: "correct" },
  };
}

/**
 * Démarre le **re-essai** de la question courante (bouton « Je réessaie », ENGINE §9) :
 * repasse en `phase: "asking"` avec `isRetrying: true` (même `clientAttemptId` — la
 * soumission suivante portera `isRetry: true`) et réamorce l'horloge silencieuse
 * (`askedAt = now`, un re-essai ne doit pas hériter du temps écoulé sur la 1ʳᵉ tentative).
 * N'a d'effet que depuis `phase: "retry"` — appelée seulement quand ce bouton est affiché.
 */
export function beginRetry(state: GameState, now: number): GameState {
  return {
    ...state,
    current: { ...state.current, phase: "asking", isRetrying: true },
    askedAt: now,
  };
}

/**
 * Avance à la question suivante (bouton « Continuer », déclenché après feedback
 * `phase: "correct"`). Si c'était la **dernière** question, marque `finished: true`
 * (fin de niveau, ENGINE §5 — jamais d'échec, on termine toujours). Sinon initialise la
 * question suivante avec une horloge fraîche (`now`) et un nouveau `clientAttemptId`.
 */
export function advance(
  state: GameState,
  now: number,
  makeId: IdFactory = randomAttemptId,
): GameState {
  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.questions.length) {
    return { ...state, finished: true };
  }
  return {
    ...state,
    currentIndex: nextIndex,
    current: makeGameQuestion(state.questions[nextIndex], makeId),
    askedAt: now,
  };
}

/**
 * Ratio de justesse **1ʳᵉ réponse** du niveau en cours (ENGINE §5) — utilisable dès la fin
 * (`finished: true`) pour dériver les étoiles via `computeStars` (`@/lib/engine/stars`).
 * Le dénominateur est le nombre de questions **nominales** (`questions.length` : les re-ask
 * n'ajoutent pas d'entrée séparée, ils réutilisent la même question — cf. `LevelQuestion`).
 */
export function accuracyOf(state: GameState): number {
  return state.questions.length === 0 ? 0 : state.firstCorrectCount / state.questions.length;
}
