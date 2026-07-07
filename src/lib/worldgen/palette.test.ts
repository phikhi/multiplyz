import { describe, expect, it } from "vitest";
import { deriveWorldPalette, isHexColor, PaletteError, serializePalette } from "./palette";

/**
 * Tests de la **dérivation de palette** (WORLDGEN §4.2, DESIGN_TOKENS §per-monde). Prouvent à
 * effet observable qu'un monde ne pose QUE `--world-accent` (pas de fond clair figé) et qu'un
 * accent mal formé lève (échec loud, jamais une variable CSS silencieusement ignorée).
 */

describe("palette — isHexColor", () => {
  it("accepte #RGB et #RRGGBB", () => {
    expect(isHexColor("#2BB7E6")).toBe(true);
    expect(isHexColor("#abc")).toBe(true);
  });

  it("refuse un hex mal formé", () => {
    expect(isHexColor("2BB7E6")).toBe(false); // sans #
    expect(isHexColor("#12")).toBe(false); // longueur invalide
    expect(isHexColor("#zzzzzz")).toBe(false); // pas hex
    expect(isHexColor("rgb(0,0,0)")).toBe(false);
  });
});

describe("palette — deriveWorldPalette", () => {
  it("dérive { slug, accent } depuis un accent hex valide (une seule variable, DESIGN_TOKENS)", () => {
    const p = deriveWorldPalette("ocean", "#2BB7E6");
    expect(p).toEqual({ slug: "ocean", accent: "#2BB7E6" });
    // Effet observable : AUCUN token de fond clair figé (theme-safe) — seulement l'accent + slug.
    expect(Object.keys(p).sort()).toEqual(["accent", "slug"]);
  });

  it("lève PaletteError sur un accent mal formé (échec loud, pas de var CSS ignorée)", () => {
    // Mutation-guard : retirer la garde `isHexColor` ferait passer un accent invalide silencieusement.
    expect(() => deriveWorldPalette("ocean", "bleu")).toThrow(PaletteError);
    expect(() => deriveWorldPalette("ocean", "#12")).toThrow(/couleur hex/);
  });
});

describe("palette — serializePalette", () => {
  it("sérialise en JSON relisible (colonne worlds.palette)", () => {
    const json = serializePalette({ slug: "forest", accent: "#5BBF73" });
    expect(JSON.parse(json)).toEqual({ slug: "forest", accent: "#5BBF73" });
  });
});
