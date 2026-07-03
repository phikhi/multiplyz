import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Helper de test **partagé** (issue #110, note additionnelle « fragilité du helper
 * `tokens.css` couplé au format texte » — dupliqué à l'identique dans
 * `NumberLine.test.tsx` ET `Matrix.test.tsx` avant cette extraction, PR #109/#96).
 *
 * Lit la **source de vérité** `tokens.css` (fix #104, dette QA #102) : jsdom ne
 * charge pas le CSS externe → `getComputedStyle` ne résout jamais un `var(--token)`
 * posé en style inline React. Pour vérifier la **couleur/valeur EFFECTIVE** (pas
 * seulement le nom du token asserté), ce module parse `tokens.css`, résout la
 * chaîne de `var()` (light `:root` + dark `[data-theme="dark"]`, avec fallback vers
 * `:root` pour un token non redéfini en dark — cascade CSS réelle), et expose un
 * calcul de contraste WCAG réel — un test qui rougit si un token repasse à une
 * valeur qui casse le contraste (piège #94, bug #104).
 *
 * **Couplage connu (documenté, pas un bug)** : ce parsing est couplé au **format
 * texte** de `tokens.css` — un bloc `:root {` / `[data-theme="dark"] {` avec des
 * déclarations `--token: valeur;` une par ligne. Si `tokens.css` est un jour
 * reformaté de façon incompatible (ex. tout sur une ligne, guillemets différents
 * autour du sélecteur), ce helper devra être ajusté en même temps. Robustifié
 * (issue #110) : tolère les espaces/retours à la ligne variables autour des `:`/`;`
 * (`\s*`), pas seulement l'espacement exact observé au moment de l'écriture.
 */

const TOKENS_CSS = readFileSync(resolve(__dirname, "../../../../../tokens.css"), "utf-8");

export type Theme = "light" | "dark";

/**
 * Extrait le bloc `:root { ... }` (light) ou `[data-theme="dark"] { ... }` (dark).
 *
 * Le garde `start === -1` protège contre un `tokens.css` dont la structure de base
 * (`:root {`/`[data-theme="dark"] {`) aurait disparu — un invariant du fichier que
 * CE MÊME module lit comme source de vérité. Non exercable sans corrompre
 * `tokens.css` réel au moment du test (ce qui casserait aussi tous les autres
 * tests de contraste qui en dépendent) — `/* v8 ignore *‍/` documenté, pas un
 * exclude de fichier/scope (cf. CLAUDE.md : réservé au boilerplate non testable).
 */
export function themeBlock(theme: Theme): string {
  const marker = theme === "light" ? ":root {" : '[data-theme="dark"] {';
  const start = TOKENS_CSS.indexOf(marker);
  /* v8 ignore next — invariant structurel de tokens.css, non corruptible en test (cf. doc ci-dessus) */
  if (start === -1) throw new Error(`bloc thème "${theme}" introuvable dans tokens.css`);
  const bodyStart = TOKENS_CSS.indexOf("{", start) + 1;
  const bodyEnd = TOKENS_CSS.indexOf("\n}", bodyStart);
  return TOKENS_CSS.slice(bodyStart, bodyEnd);
}

/**
 * Résout `--token` en sa valeur brute (hex, longueur CSS, OU `var(--autre-token)`)
 * dans un `block` **fourni par l'appelant** (jamais lu directement depuis
 * `tokens.css` ici) — avec **fallback vers `:root`** si absent (cascade CSS
 * réelle : un token non redéfini dans `[data-theme="dark"]` hérite de `:root` —
 * ex. `--scaffold-line-end-glyph`, jamais surchargé en dark, cf. tokens.css).
 * Robustifié (#110) : `\s*` tolère un espacement variable autour de `:`/`;`.
 * Prend un `block` en paramètre (plutôt que de rappeler `themeBlock("light")`
 * en interne) pour rester **testable avec un bloc CSS synthétique** — cf.
 * `tokens-css.test.ts`, garde de profondeur `resolveTokenColor`.
 */
export function rawTokenValue(
  block: string,
  token: string,
  lightFallbackBlock = themeBlock("light"),
): string {
  const re = new RegExp(`--${token.replace(/^--/u, "")}\\s*:\\s*([^;]+);`, "u");
  const m = block.match(re);
  if (m !== null) return m[1].trim();
  if (block !== lightFallbackBlock)
    return rawTokenValue(lightFallbackBlock, token, lightFallbackBlock);
  throw new Error(`token "${token}" introuvable (même en fallback :root)`);
}

/**
 * Résout entièrement une chaîne `var(--a)` → `var(--b)` → valeur finale.
 * Garde anti-boucle infinie (`depth > 5`) : protège contre une chaîne de `var()`
 * circulaire/anormalement longue dans `tokens.css` — testée directement via
 * `resolveChain` (paramétrable sur un bloc CSS synthétique, cf. `tokens-css.test.ts`)
 * plutôt qu'un `c8 ignore`, car CETTE garde est réellement déclenchable en test.
 */
export function resolveChain(block: string, token: string, lightFallbackBlock: string): string {
  let value = rawTokenValue(block, token, lightFallbackBlock);
  let depth = 0;
  while (value.startsWith("var(")) {
    if (depth++ > 5) throw new Error(`chaîne de var() trop profonde pour "${token}"`);
    const inner = value.slice(4, -1).trim();
    value = rawTokenValue(block, inner, lightFallbackBlock);
  }
  return value;
}

/** Résout un token pour un thème nommé (`light`/`dark`) — wrapper de `resolveChain` sur les vrais blocs `tokens.css`. */
export function resolveTokenColor(theme: Theme, token: string): string {
  const lightBlock = themeBlock("light");
  const block = theme === "light" ? lightBlock : themeBlock("dark");
  return resolveChain(block, token, lightBlock);
}

/** Luminance relative WCAG d'une couleur hex `#RRGGBB`. */
export function relativeLuminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255);
  const chan = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [rl, gl, bl] = [r, g, b].map(chan);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** Ratio de contraste WCAG entre 2 couleurs hex (≥ 4.5:1 = AA texte normal, ≥ 3:1 = élément non-texte). */
export function contrastRatio(hexA: string, hexB: string): number {
  const [lLight, lDark] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (lLight + 0.05) / (lDark + 0.05);
}
