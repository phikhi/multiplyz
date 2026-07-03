import { describe, expect, it } from "vitest";
import { resolveAnswer } from "./answer";

describe("resolveAnswer", () => {
  it("résout la réponse depuis une factKey valide, par compétence", () => {
    expect(resolveAnswer("mult_6x8")).toBe(48);
    expect(resolveAnswer("add_3+8")).toBe(11);
    expect(resolveAnswer("sub_15-6")).toBe(9);
    expect(resolveAnswer("comp10_3")).toBe(7);
  });

  it("clé corrompue/hors-domaine → NaN (jamais un faux positif silencieux)", () => {
    expect(Number.isNaN(resolveAnswer("comp10_999"))).toBe(true);
    expect(Number.isNaN(resolveAnswer("n'importe quoi"))).toBe(true);
  });

  it("NaN n'égale jamais une réponse client valide (garantie de sûreté du jugement)", () => {
    const answer = resolveAnswer("clé invalide");
    expect(answer === 0).toBe(false);
    expect(answer === answer).toBe(false); // NaN !== NaN, propriété exploitée par le jugement
  });
});
