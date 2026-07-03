import { beforeEach, describe, expect, it } from "vitest";
import {
  accuracyOf,
  advance,
  applyAnswer,
  beginRetry,
  buildSubmission,
  initGameState,
  randomAttemptId,
  type GameState,
} from "./session";
import type { LevelQuestion } from "@/lib/engine/service";

function question(overrides: Partial<LevelQuestion> = {}): LevelQuestion {
  return {
    factKey: "add_3+8",
    skill: "add",
    operands: [3, 8],
    format: "qcm",
    choices: [11, 12, 10, 21],
    isReask: false,
    ...overrides,
  };
}

let idCounter = 0;
function fakeId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

beforeEach(() => {
  idCounter = 0;
});

describe("randomAttemptId", () => {
  it("délègue à crypto.randomUUID (contrat par défaut)", () => {
    const id = randomAttemptId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});

describe("initGameState", () => {
  it("initialise sur la 1re question, phase asking, aucun crédit", () => {
    const q1 = question({ factKey: "add_1+2" });
    const q2 = question({ factKey: "add_2+3" });
    const state = initGameState([q1, q2], 1000, fakeId);

    expect(state.currentIndex).toBe(0);
    expect(state.current.question).toBe(q1);
    expect(state.current.phase).toBe("asking");
    expect(state.current.isRetrying).toBe(false);
    expect(state.firstCorrectCount).toBe(0);
    expect(state.finished).toBe(false);
    expect(state.askedAt).toBe(1000);
  });

  it("génère un clientAttemptId via la fabrique injectée", () => {
    const state = initGameState([question()], 0, fakeId);
    expect(state.current.clientAttemptId).toBe("id-1");
  });

  it("utilise randomAttemptId par défaut si aucune fabrique fournie", () => {
    const state = initGameState([question()], 0);
    expect(typeof state.current.clientAttemptId).toBe("string");
    expect(state.current.clientAttemptId.length).toBeGreaterThan(0);
  });
});

describe("buildSubmission", () => {
  it("construit le payload avec responseMs = now - askedAt", () => {
    const state = initGameState([question({ factKey: "mult_6x8", skill: "mult" })], 1000, fakeId);
    const submission = buildSubmission(state, { correct: true }, 1500);

    expect(submission).toEqual({
      factKey: "mult_6x8",
      skill: "mult",
      correct: true,
      responseMs: 500,
      isRetry: false,
      clientAttemptId: "id-1",
    });
  });

  it("marque isRetry=true quand la question est en re-essai", () => {
    const state0 = initGameState([question()], 0, fakeId);
    const wrong = applyAnswer(state0, { correct: false });
    const retrying = beginRetry(wrong, 100);
    const submission = buildSubmission(retrying, { correct: true }, 300);

    expect(submission.isRetry).toBe(true);
    // Même clientAttemptId entre 1re tentative et re-essai (idempotence, contrat 3.7).
    expect(submission.clientAttemptId).toBe(state0.current.clientAttemptId);
  });

  it("borne responseMs à 0 si now < askedAt (horloge défensive, jamais négatif)", () => {
    const state = initGameState([question()], 1000, fakeId);
    const submission = buildSubmission(state, { correct: true }, 500);
    expect(submission.responseMs).toBe(0);
  });

  it("arrondit responseMs à l'entier (mutation Math.round supprimé détectable)", () => {
    const state = initGameState([question()], 0, fakeId);
    const submission = buildSubmission(state, { correct: true }, 100.6);
    expect(submission.responseMs).toBe(101);
    expect(Number.isInteger(submission.responseMs)).toBe(true);
  });
});

describe("applyAnswer — no-fail (ENGINE §9)", () => {
  it("1re réponse juste → phase correct + firstCorrectCount incrémenté", () => {
    const state = initGameState([question()], 0, fakeId);
    const next = applyAnswer(state, { correct: true });

    expect(next.current.phase).toBe("correct");
    expect(next.firstCorrectCount).toBe(1);
  });

  it("1re réponse fausse → phase retry, AUCUN crédit, pas de blocage", () => {
    const state = initGameState([question()], 0, fakeId);
    const next = applyAnswer(state, { correct: false });

    expect(next.current.phase).toBe("retry");
    expect(next.firstCorrectCount).toBe(0);
    expect(next.current.isRetrying).toBe(false); // isRetrying passe true seulement via beginRetry
  });

  it("re-essai juste → phase correct, NE recompte PAS firstCorrectCount", () => {
    const state0 = initGameState([question()], 0, fakeId);
    const wrong = applyAnswer(state0, { correct: false });
    const retrying = beginRetry(wrong, 50);
    const rightOnRetry = applyAnswer(retrying, { correct: true });

    expect(rightOnRetry.current.phase).toBe("correct");
    expect(rightOnRetry.firstCorrectCount).toBe(0); // toujours 0 : le re-essai ne compte pas
  });

  it("re-essai encore faux → avance quand même (jamais de 2e re-essai, no-fail)", () => {
    const state0 = initGameState([question()], 0, fakeId);
    const wrong = applyAnswer(state0, { correct: false });
    const retrying = beginRetry(wrong, 50);
    const stillWrong = applyAnswer(retrying, { correct: false });

    // Effet observable : la question est résolue (phase correct), pas un 2e "retry" —
    // sans cette branche, la question resterait bloquée en "retry" indéfiniment.
    expect(stillWrong.current.phase).toBe("correct");
    expect(stillWrong.firstCorrectCount).toBe(0);
  });

  it("« je ne sais pas » est un outcome faux (même chemin que faux) — no-shame", () => {
    const state = initGameState([question()], 0, fakeId);
    const dontKnow = applyAnswer(state, { correct: false });
    expect(dontKnow.current.phase).toBe("retry");
  });
});

describe("beginRetry", () => {
  it("repasse en asking, isRetrying=true, réamorce l'horloge (now)", () => {
    const state0 = initGameState([question()], 0, fakeId);
    const wrong = applyAnswer(state0, { correct: false });
    const retrying = beginRetry(wrong, 777);

    expect(retrying.current.phase).toBe("asking");
    expect(retrying.current.isRetrying).toBe(true);
    expect(retrying.askedAt).toBe(777);
    // clientAttemptId inchangé (même intention de réponse).
    expect(retrying.current.clientAttemptId).toBe(state0.current.clientAttemptId);
  });
});

describe("advance", () => {
  it("passe à la question suivante avec une horloge fraîche et un nouvel id", () => {
    const q1 = question({ factKey: "add_1+1" });
    const q2 = question({ factKey: "add_2+2" });
    const state0 = initGameState([q1, q2], 0, fakeId);
    const answered = applyAnswer(state0, { correct: true });
    const next = advance(answered, 999, fakeId);

    expect(next.finished).toBe(false);
    expect(next.currentIndex).toBe(1);
    expect(next.current.question).toBe(q2);
    expect(next.current.phase).toBe("asking");
    expect(next.current.isRetrying).toBe(false);
    expect(next.askedAt).toBe(999);
    expect(next.current.clientAttemptId).toBe("id-2");
  });

  it("marque finished=true après la dernière question (fin de niveau, jamais d'échec)", () => {
    const state0 = initGameState([question()], 0, fakeId);
    const answered = applyAnswer(state0, { correct: true });
    const next = advance(answered, 100, fakeId);

    expect(next.finished).toBe(true);
    // L'état de la dernière question reste préservé (pour l'affichage du dernier feedback).
    expect(next.current.phase).toBe("correct");
  });

  it("utilise randomAttemptId par défaut si aucune fabrique fournie", () => {
    const q1 = question({ factKey: "add_1+1" });
    const q2 = question({ factKey: "add_2+2" });
    const state0 = initGameState([q1, q2], 0, fakeId);
    const answered = applyAnswer(state0, { correct: true });
    const next = advance(answered, 100);
    expect(typeof next.current.clientAttemptId).toBe("string");
  });
});

describe("accuracyOf", () => {
  it("calcule le ratio 1re-réponse-juste / total, cohérent avec computeAccuracy", () => {
    const questions = [
      question({ factKey: "a" }),
      question({ factKey: "b" }),
      question({ factKey: "c" }),
    ];
    let state: GameState = initGameState(questions, 0, fakeId);
    state = applyAnswer(state, { correct: true }); // 1/3
    state = advance(state, 10, fakeId);
    state = applyAnswer(state, { correct: false }); // reste 1/3 (retry)
    state = beginRetry(state, 20);
    state = applyAnswer(state, { correct: true }); // re-essai : ne compte pas → toujours 1/3
    state = advance(state, 30, fakeId);
    state = applyAnswer(state, { correct: true }); // 2/3
    state = advance(state, 40, fakeId);

    expect(state.finished).toBe(true);
    expect(accuracyOf(state)).toBeCloseTo(2 / 3);
  });

  it("niveau vide (défensif) renvoie 0, jamais NaN", () => {
    const state: GameState = { ...initGameState([question()], 0, fakeId), questions: [] };
    expect(accuracyOf(state)).toBe(0);
  });
});

describe("déterminisme", () => {
  it("deux runs avec la même fabrique d'id + horloge produisent le même état", () => {
    const run = () => {
      const s = initGameState([question()], 0, fakeId);
      return applyAnswer(s, { correct: true });
    };
    const a = run();
    idCounter = 0; // ré-amorce pour rejouer la même séquence d'ids
    const b = run();
    expect(a).toEqual(b);
  });
});
