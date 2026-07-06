import { describe, expect, it } from "vitest";
import { EXPRESSION_COUNT, TEDDY_EXPRESSIONS } from "./expressions";

describe("model sheet d'expressions Teddy (WORLDGEN §8 + COPY §3)", () => {
  it("porte exactement les 5 expressions canoniques dans l'ordre WORLDGEN §8", () => {
    expect(TEDDY_EXPRESSIONS.map((e) => e.slug)).toEqual([
      "neutre",
      "content",
      "oups",
      "acclame",
      "intrepide",
    ]);
    expect(EXPRESSION_COUNT).toBe(5);
  });

  it("chaque expression a un slug ASCII, une nuance de prompt et un usage non vides", () => {
    for (const e of TEDDY_EXPRESSIONS) {
      // Slug technique : ASCII (clé d'asset stable — la voix accentuée vit dans la copy).
      expect(e.slug).toMatch(/^[a-z]+$/);
      expect(e.promptMood.trim().length).toBeGreaterThan(0);
      expect(e.usage.trim().length).toBeGreaterThan(0);
    }
  });

  it("les slugs sont uniques (pas de doublon dans le model sheet)", () => {
    const slugs = TEDDY_EXPRESSIONS.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
