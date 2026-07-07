import { describe, expect, it } from "vitest";
import {
  BANNED_THEME_TERMS,
  CURATED_THEMES,
  findCuratedTheme,
  hasBannedTerm,
  normalizeThemeText,
} from "./worldgen-themes";

/**
 * Tests du **pool de thèmes kid-safe curaté** (WORLDGEN §4.1). Prouvent à effet observable :
 * - la modération amont (thème hors pool / banni) est appliquée ;
 * - chaque thème porte assez de concepts de créatures pour peupler 6-8 créatures/monde ;
 * - la normalisation (accents/casse) attrape les variations.
 */

describe("worldgen-themes — pool curaté", () => {
  it("chaque thème a un slug/label/accent/accessoire non vides", () => {
    for (const theme of CURATED_THEMES) {
      expect(theme.slug).toMatch(/^[a-z]+$/);
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.accessory.length).toBeGreaterThan(0);
    }
  });

  it("chaque thème a ≥ 8 concepts de créatures (assez pour 6-8/monde + traits non vides)", () => {
    for (const theme of CURATED_THEMES) {
      // 6-8 créatures/monde (ECONOMY §5), sélection sans réutilisation → ≥ 8 concepts.
      expect(theme.creatureConcepts.length).toBeGreaterThanOrEqual(8);
      for (const c of theme.creatureConcepts) {
        expect(c.concept.length).toBeGreaterThan(0);
        expect(c.features.length).toBeGreaterThan(0);
      }
    }
  });

  it("les slugs sont uniques (pas de collision de [data-world])", () => {
    const slugs = CURATED_THEMES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("inclut les thèmes verrouillés d'ART §2/§3 (ocean/forest/magic/galaxy)", () => {
    const slugs = new Set(CURATED_THEMES.map((t) => t.slug));
    for (const expected of ["ocean", "forest", "magic", "galaxy"]) {
      expect(slugs.has(expected)).toBe(true);
    }
  });
});

describe("worldgen-themes — normalizeThemeText", () => {
  it("minuscule + retire les accents + trim", () => {
    expect(normalizeThemeText("  Océan Scintillant  ")).toBe("ocean scintillant");
    expect(normalizeThemeText("Forêt Enchantée")).toBe("foret enchantee");
  });
});

describe("worldgen-themes — findCuratedTheme", () => {
  it("trouve par slug exact", () => {
    expect(findCuratedTheme("ocean")?.slug).toBe("ocean");
  });

  it("trouve par label normalisé (accents/casse ignorés)", () => {
    // Effet observable : la normalisation est bien appliquée au label (pas juste au slug).
    expect(findCuratedTheme("OCÉAN SCINTILLANT")?.slug).toBe("ocean");
    expect(findCuratedTheme("forêt enchantée")?.slug).toBe("forest");
  });

  it("retourne undefined pour un thème hors pool", () => {
    expect(findCuratedTheme("désert inconnu")).toBeUndefined();
  });
});

describe("worldgen-themes — hasBannedTerm (WORLDGEN §4.1)", () => {
  it("liste bannie non vide", () => {
    expect(BANNED_THEME_TERMS.length).toBeGreaterThan(0);
  });

  it("refuse un thème contenant un terme banni (par inclusion de sous-chaîne)", () => {
    // Effet observable : « guerrier » contient « guerre » → attrapé par inclusion.
    expect(hasBannedTerm("monde de guerre")).toBe(true);
    expect(hasBannedTerm("le guerrier sombre")).toBe(true);
  });

  it("attrape les variations accentuées / casse (normalisation)", () => {
    // Mutation-guard : si `hasBannedTerm` ne normalisait pas, « Épée de Guerre » passerait.
    expect(hasBannedTerm("Épée de GUERRE")).toBe(true);
  });

  it("laisse passer un thème kid-safe", () => {
    expect(hasBannedTerm("océan scintillant")).toBe(false);
    expect(hasBannedTerm("forêt enchantée")).toBe(false);
  });
});
