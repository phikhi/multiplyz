import { describe, expect, it } from "vitest";
import { resolveAnswerSfx } from "./juice";

const THRESHOLD = 3;

describe("resolveAnswerSfx (story 8.4, #257 AC #1 — combo si série)", () => {
  it("1ʳᵉ tentative juste (isRetrying=false) → comboCount incrémenté, SFX 'correct' sous le seuil", () => {
    expect(resolveAnswerSfx(0, "correct", false, THRESHOLD)).toEqual({
      comboCount: 1,
      sfx: "correct",
    });
    expect(resolveAnswerSfx(1, "correct", false, THRESHOLD)).toEqual({
      comboCount: 2,
      sfx: "correct",
    });
  });

  it("MUTATION-PROOF (seuil) : comboCount atteint EXACTEMENT le seuil → SFX 'combo' (pas 'correct') — rougit si `>=` mute en `>`", () => {
    expect(resolveAnswerSfx(THRESHOLD - 1, "correct", false, THRESHOLD)).toEqual({
      comboCount: THRESHOLD,
      sfx: "combo",
    });
  });

  it("un cran SOUS le seuil → reste 'correct' (borne exacte, pas 'combo' prématuré)", () => {
    expect(resolveAnswerSfx(THRESHOLD - 2, "correct", false, THRESHOLD)).toEqual({
      comboCount: THRESHOLD - 1,
      sfx: "correct",
    });
  });

  it("série déjà au-delà du seuil → continue à jouer 'combo' (pas seulement au franchissement)", () => {
    expect(resolveAnswerSfx(THRESHOLD + 5, "correct", false, THRESHOLD)).toEqual({
      comboCount: THRESHOLD + 6,
      sfx: "combo",
    });
  });

  it("MUTATION-PROOF (garde retry) : phase='retry' (1ʳᵉ tentative fausse) → série cassée à 0, AUCUN son (jamais de son négatif) — rougit si la garde est retirée (sfx non-null ou comboCount non remis à 0)", () => {
    expect(resolveAnswerSfx(7, "retry", false, THRESHOLD)).toEqual({
      comboCount: 0,
      sfx: null,
    });
  });

  it("MUTATION-PROOF (garde isRetrying) : phase='correct' APRÈS un re-essai (isRetrying=true) → série cassée à 0 ET SFX 'correct' (jamais 'combo', même si comboCountBefore dépassait le seuil) — rougit si la garde isRetrying est retirée", () => {
    expect(resolveAnswerSfx(THRESHOLD + 4, "correct", true, THRESHOLD)).toEqual({
      comboCount: 0,
      sfx: "correct",
    });
  });

  it("re-essai résolu depuis une série DÉJÀ à 0 → reste 'correct', comboCount reste 0", () => {
    expect(resolveAnswerSfx(0, "correct", true, THRESHOLD)).toEqual({
      comboCount: 0,
      sfx: "correct",
    });
  });
});
