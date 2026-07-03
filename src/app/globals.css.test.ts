import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  rawTokenValue,
  relativeLuminance,
  themeBlock,
} from "@/components/game/scaffolds/test-support/tokens-css";

/**
 * Utilitaire `:focus-visible` partagé (issue #38) — garde à effet observable sur
 * `globals.css` : le sélecteur `.mz-focusable:focus-visible` doit exister ET
 * référencer le token `--shadow-focus` (jamais une couleur en dur), ET la valeur
 * RÉSOLUE de ce token doit produire un anneau visuellement visible/contrasté sur
 * le fond réel de l'app (`--color-bg-primary`), dans les 2 thèmes — pas seulement
 * l'assertion que le nom du token est présent (règle CLAUDE.md / rétro #104 :
 * « une garde visuelle doit asserter la géométrie rendue et/ou la couleur résolue,
 * jamais seulement la forme d'un path SVG ou des data-* » — ici appliqué au CSS
 * global : on résout la VRAIE valeur `rgba(...)` depuis `tokens.css`, pas le nom).
 */
const GLOBALS_CSS = readFileSync(resolve(__dirname, "./globals.css"), "utf-8");

/** Extrait le corps de la règle `.mz-focusable:focus-visible { ... }`. */
function focusableRuleBody(): string {
  const marker = ".mz-focusable:focus-visible {";
  const start = GLOBALS_CSS.indexOf(marker);
  if (start === -1)
    throw new Error("règle .mz-focusable:focus-visible introuvable dans globals.css");
  const bodyStart = GLOBALS_CSS.indexOf("{", start) + 1;
  const bodyEnd = GLOBALS_CSS.indexOf("}", bodyStart);
  return GLOBALS_CSS.slice(bodyStart, bodyEnd);
}

/** Parse `rgba(r, g, b, a)` en composantes numériques. */
function parseRgba(value: string): { r: number; g: number; b: number; a: number } {
  const m = value.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/u,
  );
  if (m === null) throw new Error(`valeur rgba() inattendue: "${value}"`);
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Number(m[4]) : 1,
  };
}

/** Convertit une couleur hex `#RRGGBB` en composantes 0..255. */
function parseHex(hex: string): { r: number; g: number; b: number } {
  const n = hex.replace("#", "");
  return {
    r: Number.parseInt(n.slice(0, 2), 16),
    g: Number.parseInt(n.slice(2, 4), 16),
    b: Number.parseInt(n.slice(4, 6), 16),
  };
}

/** Compose une couleur `rgba` par-dessus un fond opaque hex (alpha blending réel). */
function compositeOverBackground(rgba: string, backgroundHex: string): string {
  const fg = parseRgba(rgba);
  const bg = parseHex(backgroundHex);
  const blend = (fgChan: number, bgChan: number) => Math.round(fg.a * fgChan + (1 - fg.a) * bgChan);
  const r = blend(fg.r, bg.r);
  const g = blend(fg.g, bg.g);
  const b = blend(fg.b, bg.b);
  const toHex = (c: number) => c.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Extrait `box-shadow: <offsetX> <offsetY> <blur> <spread> <couleur>;` (forme utilisée ici). */
function boxShadowParts(rule: string): { spreadPx: number; color: string } {
  const m = rule.match(/box-shadow:\s*0\s+0\s+0\s+(\d+)px\s+(rgba?\([^)]+\))\s*;/u);
  if (m === null) throw new Error(`box-shadow inattendu dans la règle: "${rule}"`);
  return { spreadPx: Number(m[1]), color: m[2] };
}

describe("utilitaire :focus-visible partagé (issue #38, tokenisé --shadow-focus)", () => {
  it("la règle .mz-focusable:focus-visible existe et référence le token --shadow-focus (jamais une couleur en dur)", () => {
    const rule = focusableRuleBody();
    expect(rule).toContain("box-shadow: var(--shadow-focus)");
    // Garde anti-régression : la déclaration `box-shadow` de cette règle DOIT
    // référencer `var(--shadow-focus)` — pas un `rgba()`/hex en dur à la place.
    const boxShadowDecl = rule.match(/box-shadow:[^;]+;/u)?.[0] ?? "";
    expect(boxShadowDecl).toMatch(/box-shadow:\s*var\(--shadow-focus\)\s*;/u);
    expect(boxShadowDecl).not.toMatch(/rgba?\(/u);
  });

  it("l'utilitaire ne pose PAS `outline: none` seul (fallback visible pour un agent qui ignore box-shadow)", () => {
    const rule = focusableRuleBody();
    expect(rule).toMatch(/outline:\s*\d+px\s+solid\s+transparent/u);
    expect(rule).not.toMatch(/outline:\s*none/u);
  });

  // Boutons focusables vivent sur --color-bg-primary (fond de page, ex. écrans
  // pleine page) ET --color-bg-secondary (cartes, ex. `--card-bg`) — les DEUX
  // surfaces sont testées : un anneau contrasté sur l'une mais pas l'autre
  // resterait une régression a11y invisible sur la surface non testée.
  it.each([
    ["light", "color-bg-primary"],
    ["light", "color-bg-secondary"],
    ["dark", "color-bg-primary"],
    ["dark", "color-bg-secondary"],
  ] as const)(
    "%s sur %s : --shadow-focus RÉSOLU produit un anneau de spread non nul, visible/contrasté (≥3:1 WCAG 1.4.11)",
    (theme, bgToken) => {
      // Résolution depuis la source de vérité tokens.css (pattern #104/#110) — la
      // valeur RÉELLE du token, pas seulement son nom. `--shadow-focus` est un
      // box-shadow brut "0 0 0 Npx rgba(...)" (pas une chaîne var() à chaîner).
      const rawShadow = rawTokenValue(themeBlock(theme), "shadow-focus");
      const { spreadPx, color } = boxShadowParts(`box-shadow: ${rawShadow};`);
      expect(spreadPx).toBeGreaterThan(0); // anneau réellement visible (pas 0px)

      const bg = rawTokenValue(themeBlock(theme), bgToken);
      const composited = compositeOverBackground(color, bg);
      // Élément non-texte (indicateur de focus, WCAG 1.4.11) : ratio ≥ 3:1 contre le
      // fond réel sur lequel l'anneau apparaît, une fois l'alpha du token composité —
      // rougit si un futur changement de couleur/opacité rend l'anneau trop discret.
      const bgLum = relativeLuminance(bg);
      const compositedLum = relativeLuminance(composited);
      expect(bgLum).not.toBeCloseTo(compositedLum, 1); // vraiment distinct, pas juste "différent au dernier bit"
      expect(contrastRatio(composited, bg)).toBeGreaterThanOrEqual(3);
    },
  );
});
