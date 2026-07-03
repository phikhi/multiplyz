import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  rawTokenValue,
  relativeLuminance,
  resolveChain,
  resolveTokenColor,
  themeBlock,
} from "./tokens-css";

/**
 * Tests du helper de test **partagé** lui-même (issue #110 : extraction de la
 * copie dupliquée entre `NumberLine.test.tsx`/`Matrix.test.tsx`). Ce module vit
 * désormais sous `src/**` (gate coverage 100 % non-vacuous, CLAUDE.md) — chaque
 * garde/branche de repli doit avoir ≥1 test à EFFET OBSERVABLE (rougit si la
 * garde est retirée/mutée), pas seulement être exécutée en passant via les
 * autres suites (`NumberLine.test.tsx`/`Matrix.test.tsx` n'exercent QUE le
 * chemin nominal).
 */
describe("test-support/tokens-css — helper partagé de résolution tokens.css", () => {
  it("themeBlock résout :root (light) ET [data-theme='dark'] (chemin nominal)", () => {
    expect(themeBlock("light")).toContain("--color-bg-primary");
    expect(themeBlock("dark")).toContain("--color-bg-primary");
    // Les 2 blocs sont réellement DIFFÉRENTS (pas le même extrait par erreur).
    expect(themeBlock("light")).not.toBe(themeBlock("dark"));
  });

  it("rawTokenValue résout un token défini directement dans le bloc demandé", () => {
    const value = rawTokenValue(themeBlock("dark"), "color-bg-primary");
    expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/u);
  });

  it("rawTokenValue retombe sur :root (light) si le token n'est PAS redéfini dans le bloc dark (cascade CSS réelle)", () => {
    // --scaffold-line-end-glyph n'est jamais surchargé en dark (cf. tokens.css,
    // commentaire fix #104) → doit résoudre depuis :root sans lever.
    const value = rawTokenValue(themeBlock("dark"), "scaffold-line-end-glyph");
    expect(value).toBe(rawTokenValue(themeBlock("light"), "scaffold-line-end-glyph"));
  });

  it("rawTokenValue lève si le token n'existe NULLE PART (même en fallback :root) — garde à effet observable", () => {
    // Un nom de token inventé, absent des 2 blocs : la garde DOIT lever plutôt que
    // renvoyer une valeur silencieusement fausse (échoue si le throw est retiré).
    expect(() => rawTokenValue(themeBlock("dark"), "ceci-nexiste-vraiment-nulle-part")).toThrow(
      /introuvable \(même en fallback :root\)/u,
    );
  });

  it("resolveTokenColor déchaîne un var(--a) → var(--b) → valeur finale (chemin nominal)", () => {
    const resolved = resolveTokenColor("light", "scaffold-line-end-bg");
    expect(resolved).toMatch(/^#[0-9A-Fa-f]{6}$/u);
  });

  it("resolveChain lève si la chaîne de var() est anormalement profonde (garde anti-boucle infinie, effet observable)", () => {
    // Bloc CSS SYNTHÉTIQUE (pas le vrai tokens.css — aucune chaîne réelle n'est
    // aussi longue) injecté directement dans `resolveChain` (paramétrable sur un
    // bloc arbitraire, cf. signature) : une chaîne de var() de profondeur > 5 DOIT
    // lever plutôt que boucler indéfiniment — échoue si le garde-fou de profondeur
    // (`depth > 5`) est retiré ou desserré.
    const deepChainBlock = [
      "--chain-0: var(--chain-1);",
      "--chain-1: var(--chain-2);",
      "--chain-2: var(--chain-3);",
      "--chain-3: var(--chain-4);",
      "--chain-4: var(--chain-5);",
      "--chain-5: var(--chain-6);",
      "--chain-6: var(--chain-7);",
      "--chain-7: #111111;",
    ].join("\n");
    expect(() => resolveChain(deepChainBlock, "chain-0", deepChainBlock)).toThrow(/trop profonde/u);
  });

  it("resolveChain résout une chaîne courte (≤5 niveaux) sans lever — la garde ne bloque QUE les chaînes anormales", () => {
    // Contre-épreuve : une chaîne de 3 niveaux (bien en-deçà du seuil) résout
    // normalement — prouve que la garde cible spécifiquement la PROFONDEUR
    // anormale, pas un rejet systématique de toute indirection var().
    const shortChainBlock = ["--a: var(--b);", "--b: var(--c);", "--c: #222222;"].join("\n");
    expect(resolveChain(shortChainBlock, "a", shortChainBlock)).toBe("#222222");
  });

  it("relativeLuminance + contrastRatio : noir/blanc = contraste maximal (21:1), même couleur = 1:1", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBe(1);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#7A5AF8", "#7A5AF8")).toBeCloseTo(1, 5);
  });
});
