import { describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS, type EngineConfig } from "../../config/server-config";
import {
  applyAttempt,
  INITIAL_BOX,
  isFactMastered,
  skillMasteryRatio,
  type Attempt,
  type MasteryState,
} from "./mastery";

/**
 * Config moteur réelle (les valeurs ⚙️ par défaut de 3.2) → on teste la logique
 * contre le contrat effectif, pas contre des constantes ad hoc. `loadEngineConfig`
 * clone `CONFIG_DEFAULTS.engine` en type mutable (readonly `as const` sinon).
 */
const CONFIG: EngineConfig = {
  ...CONFIG_DEFAULTS.engine,
  leitnerDelaysDays: [...CONFIG_DEFAULTS.engine.leitnerDelaysDays],
  fluenceThresholdsMs: { ...CONFIG_DEFAULTS.engine.fluenceThresholdsMs },
  starThresholds: [...CONFIG_DEFAULTS.engine.starThresholds] as [number, number, number],
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Instant injecté déterministe (2026-07-02T00:00:00Z, epoch ms) — jamais Date.now(). */
const NOW = 1_751_414_400_000;

/** Délai (ms) attendu pour une boîte donnée, dérivé de la config testée. */
function delayMs(box: number): number {
  return CONFIG.leitnerDelaysDays[box] * MS_PER_DAY;
}

/** Construit un état de maîtrise partiel (le reste = valeurs neutres). */
function state(overrides: Partial<MasteryState> = {}): MasteryState {
  return {
    box: 2,
    correctCount: 3,
    wrongCount: 1,
    avgResponseMs: 2_000,
    lastSeen: NOW - MS_PER_DAY,
    nextDue: NOW - 1,
    ...overrides,
  };
}

/** Construit une réponse (par défaut : add, juste, dans la fenêtre fluente). */
function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return { skill: "add", correct: true, responseMs: 1_500, ...overrides };
}

describe("applyAttempt — transitions Leitner (ENGINE §2)", () => {
  it("juste + rapide → promotion box+promoteBoxes, next_due = now + délai(box promue)", () => {
    const result = applyAttempt(state({ box: 2 }), attempt({ responseMs: 1_500 }), CONFIG, NOW);
    expect(result).not.toBeNull();
    expect(result!.box).toBe(3); // 2 + promoteBoxes(1)
    expect(result!.nextDue).toBe(NOW + delayMs(3));
    expect(result!.lastSeen).toBe(NOW);
  });

  it("juste + rapide plafonne la boîte à maxBox (pas de dépassement)", () => {
    const result = applyAttempt(state({ box: CONFIG.maxBox }), attempt(), CONFIG, NOW);
    expect(result!.box).toBe(CONFIG.maxBox); // min(maxBox, 5+1) = 5
    expect(result!.nextDue).toBe(NOW + delayMs(CONFIG.maxBox));
  });

  it("juste mais lent → boîte inchangée, next_due = délai(box courante) (court)", () => {
    // response_ms > seuil fluence add (3 s) → juste mais lent.
    const result = applyAttempt(state({ box: 2 }), attempt({ responseMs: 5_000 }), CONFIG, NOW);
    expect(result!.box).toBe(2); // inchangée
    expect(result!.nextDue).toBe(NOW + delayMs(2));
  });

  it("réponse pile au seuil de fluence compte comme rapide (≤, borne incluse)", () => {
    const result = applyAttempt(
      state({ box: 1 }),
      attempt({ skill: "add", responseMs: CONFIG.fluenceThresholdsMs.add }),
      CONFIG,
      NOW,
    );
    expect(result!.box).toBe(2); // promotion : le seuil est inclus (≤)
  });

  it("faux → rétrograde box−demoteBoxes, next_due = délai(box rétrogradée)", () => {
    const result = applyAttempt(state({ box: 4 }), attempt({ correct: false }), CONFIG, NOW);
    expect(result!.box).toBe(2); // max(0, 4−2)
    expect(result!.nextDue).toBe(NOW + delayMs(2));
  });

  it("faux plancher la boîte à 0 (pas de boîte négative)", () => {
    const result = applyAttempt(state({ box: 1 }), attempt({ correct: false }), CONFIG, NOW);
    expect(result!.box).toBe(0); // max(0, 1−2)
    expect(result!.nextDue).toBe(NOW + delayMs(0)); // boîte 0 = même session (0 j)
  });
});

describe("applyAttempt — anti-mash (ENGINE §9)", () => {
  it("juste mais TRÈS rapide (< antiMashMs) → PAS de promotion (boîte inchangée)", () => {
    const result = applyAttempt(
      state({ box: 2 }),
      attempt({ correct: true, responseMs: CONFIG.antiMashMs - 1 }),
      CONFIG,
      NOW,
    );
    expect(result!.box).toBe(2); // martèlement : ne promeut jamais
    expect(result!.correctCount).toBe(4); // reste comptée comme juste
  });

  it("réponse pile au seuil anti-mash (= antiMashMs) est fluente (borne incluse, ≥)", () => {
    const result = applyAttempt(
      state({ box: 2 }),
      attempt({ correct: true, responseMs: CONFIG.antiMashMs }),
      CONFIG,
      NOW,
    );
    expect(result!.box).toBe(3); // promotion : antiMashMs inclus dans la fenêtre
  });

  it("faux ET très rapide → reste faux (rétrograde), jamais de promotion", () => {
    const result = applyAttempt(
      state({ box: 3 }),
      attempt({ correct: false, responseMs: CONFIG.antiMashMs - 1 }),
      CONFIG,
      NOW,
    );
    expect(result!.box).toBe(1); // max(0, 3−2) : anti-mash ne change pas l'issue d'un faux
    expect(result!.wrongCount).toBe(2);
  });
});

describe("applyAttempt — re-essai (is_retry, ENGINE §9)", () => {
  it("is_retry=true sur une ligne existante → état STRICTEMENT inchangé", () => {
    const before = state({ box: 3, correctCount: 5, wrongCount: 2, avgResponseMs: 1_800 });
    const result = applyAttempt(before, attempt({ isRetry: true, correct: false }), CONFIG, NOW);
    expect(result).toBe(before); // même référence : rien n'est recalculé
  });

  it("is_retry=true sur un fait jamais vu (null) → reste null (aucune ligne créée)", () => {
    const result = applyAttempt(null, attempt({ isRetry: true }), CONFIG, NOW);
    expect(result).toBeNull();
  });

  it("is_retry=false (explicite) est compté normalement", () => {
    const result = applyAttempt(state({ box: 2 }), attempt({ isRetry: false }), CONFIG, NOW);
    expect(result!.box).toBe(3); // promotion normale
  });
});

describe("applyAttempt — fact jamais vu (null → init, ENGINE §2/§3)", () => {
  it("null + juste rapide → init box de départ puis promotion, compteurs à 1", () => {
    const result = applyAttempt(null, attempt({ correct: true, responseMs: 1_200 }), CONFIG, NOW);
    expect(result!.box).toBe(INITIAL_BOX + CONFIG.promoteBoxes); // 0 → 1
    expect(result!.correctCount).toBe(1);
    expect(result!.wrongCount).toBe(0);
    expect(result!.avgResponseMs).toBe(1_200); // 1ʳᵉ réponse : avg = response_ms
    expect(result!.lastSeen).toBe(NOW);
    expect(result!.nextDue).toBe(NOW + delayMs(1));
  });

  it("null + faux → reste box 0 (max(0, 0−2)), wrongCount à 1", () => {
    const result = applyAttempt(null, attempt({ correct: false, responseMs: 2_000 }), CONFIG, NOW);
    expect(result!.box).toBe(0);
    expect(result!.correctCount).toBe(0);
    expect(result!.wrongCount).toBe(1);
    expect(result!.avgResponseMs).toBe(2_000);
  });
});

describe("applyAttempt — moyenne glissante avg_response_ms (fluence, ENGINE §2)", () => {
  it("moyenne cumulée correcte : (avg*priorCount + response) / (priorCount+1), arrondie", () => {
    // prior : 4 réponses (3 justes + 1 fausse), avg 2000 ; nouvelle réponse 1000 ms.
    // (2000*4 + 1000) / 5 = 9000/5 = 1800.
    const result = applyAttempt(
      state({ correctCount: 3, wrongCount: 1, avgResponseMs: 2_000 }),
      attempt({ responseMs: 1_000 }),
      CONFIG,
      NOW,
    );
    expect(result!.avgResponseMs).toBe(1_800);
  });

  it("arrondit à l'entier (colonne integer)", () => {
    // prior : 2 réponses avg 1000 ; nouvelle 1001 → (1000*2 + 1001)/3 = 1000.33 → 1000.
    const result = applyAttempt(
      state({ correctCount: 1, wrongCount: 1, avgResponseMs: 1_000 }),
      attempt({ responseMs: 1_001 }),
      CONFIG,
      NOW,
    );
    expect(result!.avgResponseMs).toBe(1_000);
  });
});

describe("applyAttempt — clamp défensif (config incohérente, LEARNINGS #58)", () => {
  it("boîte d'entrée > maxBox et lente → clampée à maxBox (jamais hors bornes)", () => {
    // box 7 (incohérent) + juste-mais-lent → min(maxBox, max(0, 7)) = 5.
    const result = applyAttempt(state({ box: 7 }), attempt({ responseMs: 9_000 }), CONFIG, NOW);
    expect(result!.box).toBe(CONFIG.maxBox);
  });

  it("maxBox > longueur des délais → next_due retombe sur le dernier délai défini", () => {
    // Délais tronqués à 3 entrées mais maxBox 5 : une boîte 5 lente doit clamper
    // l'index de délai sur le dernier (2) au lieu d'accéder hors tableau.
    const truncated: EngineConfig = { ...CONFIG, leitnerDelaysDays: [0, 1, 2] };
    const result = applyAttempt(state({ box: 5 }), attempt({ responseMs: 9_000 }), truncated, NOW);
    expect(result!.box).toBe(5); // inchangée (lente)
    expect(result!.nextDue).toBe(NOW + 2 * MS_PER_DAY); // dernier délai défini
  });
});

describe("isFactMastered (ENGINE §2 : box ≥ tierUnlockMinBox)", () => {
  it("box au plancher de maîtrise → maîtrisé", () => {
    expect(isFactMastered(state({ box: CONFIG.tierUnlockMinBox }), CONFIG)).toBe(true);
  });

  it("box sous le plancher → pas encore maîtrisé", () => {
    expect(isFactMastered(state({ box: CONFIG.tierUnlockMinBox - 1 }), CONFIG)).toBe(false);
  });

  it("box au-dessus du plancher → maîtrisé", () => {
    expect(isFactMastered(state({ box: CONFIG.maxBox }), CONFIG)).toBe(true);
  });
});

describe("skillMasteryRatio (ENGINE §2 : % de facts box ≥ 4)", () => {
  it("ensemble vide → 0 (pas de division par zéro)", () => {
    expect(skillMasteryRatio([], CONFIG)).toBe(0);
  });

  it("proportion de facts maîtrisés (mix maîtrisés / non maîtrisés)", () => {
    const states = [
      state({ box: 4 }), // maîtrisé
      state({ box: 5 }), // maîtrisé
      state({ box: 2 }), // non
      state({ box: 0 }), // non
    ];
    expect(skillMasteryRatio(states, CONFIG)).toBe(0.5); // 2/4
  });

  it("tous maîtrisés → 1 ; aucun → 0", () => {
    expect(skillMasteryRatio([state({ box: 4 }), state({ box: 5 })], CONFIG)).toBe(1);
    expect(skillMasteryRatio([state({ box: 1 }), state({ box: 3 })], CONFIG)).toBe(0);
  });
});
