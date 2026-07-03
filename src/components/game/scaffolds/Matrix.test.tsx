import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Matrix, matrixLabel } from "./Matrix";
import { strings } from "@/strings";

function fill(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, value),
    template,
  );
}

/** Tous les conteneurs de PAQUET (regroupement spatial/bordure — pas une grille uniforme). */
function packets(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("[data-scaffold-packet]")];
}

/**
 * Lecture de la **source de vérité** `tokens.css` (fix #104, dette QA #102, pattern
 * repris de `NumberLine.test.tsx`) : jsdom ne charge pas le CSS externe →
 * `getComputedStyle` ne résout jamais un `var(--token)` posé en style inline React.
 * Pour vérifier la **couleur EFFECTIVE** (pas seulement le nom du token asserté), ce
 * helper parse `tokens.css`, résout la chaîne de `var()` (light `:root` + dark
 * `[data-theme="dark"]`), et calcule le ratio de contraste WCAG réel — un test qui
 * rougit si le token du point repasse à `--color-text-inverse` (piège #94, exactement
 * le bug #104 constaté sur `NumberLine`).
 */
const TOKENS_CSS = readFileSync(resolve(__dirname, "../../../../tokens.css"), "utf-8");

/** Extrait le bloc `:root { ... }` (light) ou `[data-theme="dark"] { ... }` (dark). */
function themeBlock(theme: "light" | "dark"): string {
  const marker = theme === "light" ? ":root {" : '[data-theme="dark"] {';
  const start = TOKENS_CSS.indexOf(marker);
  if (start === -1) throw new Error(`bloc thème "${theme}" introuvable dans tokens.css`);
  const bodyStart = TOKENS_CSS.indexOf("{", start) + 1;
  const bodyEnd = TOKENS_CSS.indexOf("\n}", bodyStart);
  return TOKENS_CSS.slice(bodyStart, bodyEnd);
}

/**
 * Résout `--token` en sa valeur brute (hex OU `var(--autre-token)`) dans un bloc,
 * avec **fallback vers `:root`** si absent (cascade CSS réelle : un token non
 * redéfini dans `[data-theme="dark"]` hérite de `:root`).
 */
function rawTokenValue(block: string, token: string): string {
  const re = new RegExp(`--${token.replace(/^--/u, "")}:\\s*([^;]+);`, "u");
  const m = block.match(re);
  if (m !== null) return m[1].trim();
  if (block !== themeBlock("light")) return rawTokenValue(themeBlock("light"), token);
  throw new Error(`token "${token}" introuvable (même en fallback :root)`);
}

/** Résout entièrement une chaîne `var(--a)` → `var(--b)` → `#hex` (plusieurs niveaux). */
function resolveTokenColor(theme: "light" | "dark", token: string): string {
  const block = themeBlock(theme);
  let value = rawTokenValue(block, token);
  let depth = 0;
  while (value.startsWith("var(")) {
    if (depth++ > 5) throw new Error(`chaîne de var() trop profonde pour "${token}"`);
    const inner = value.slice(4, -1).trim();
    value = rawTokenValue(block, inner);
  }
  return value;
}

/** Luminance relative WCAG d'une couleur hex `#RRGGBB`. */
function relativeLuminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255);
  const chan = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [rl, gl, bl] = [r, g, b].map(chan);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** Ratio de contraste WCAG entre 2 couleurs hex. */
function contrastRatio(hexA: string, hexB: string): number {
  const [lLight, lDark] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (lLight + 0.05) / (lDark + 0.05);
}

describe("Matrix — étayage matrice de la multiplication (ENGINE §1, PRODUCT §3.4, story #96)", () => {
  // Paires paramétrées couvrant le domaine mult v1 (DOMAIN.mult, a,b ∈ 1..10) : un
  // cas simple, un cas asymétrique, et la GRANDE matrice 9×10 (bord haut du domaine).
  const CASES: ReadonlyArray<readonly [number, number]> = [
    [3, 4],
    [6, 8],
    [1, 10],
    [9, 10], // grande matrice — doit rester lisible/scrollable, jamais déborder le body
  ];

  describe.each(CASES)("a=%i b=%i", (a, b) => {
    const correctAnswer = a * b;

    it("lignes DÉRIVÉES de operands[0] (nombre de paquets = a), jamais en dur", () => {
      // Garde à effet observable : si le composant rendait un nombre de paquets fixe
      // (ou b au lieu de a), ce compte rougirait pour au moins une paire testée.
      const { container } = render(<Matrix operands={[a, b]} correctAnswer={correctAnswer} />);
      expect(packets(container)).toHaveLength(a);
    });

    it("colonnes DÉRIVÉES de operands[1] (points par paquet = b), jamais en dur", () => {
      // Garde à effet observable : si le composant rendait un nombre de points fixe
      // (ou a au lieu de b) par paquet, ce compte rougirait pour au moins une paire.
      const { container } = render(<Matrix operands={[a, b]} correctAnswer={correctAnswer} />);
      for (const packet of packets(container)) {
        expect(packet.querySelectorAll("span").length).toBe(b);
      }
    });

    it("le label visible « {a} paquets de {b} » est dérivé des operands", () => {
      render(<Matrix operands={[a, b]} correctAnswer={correctAnswer} />);
      const expected = fill(strings.play.scaffold.matrix.label, { a: String(a), b: String(b) });
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it("data-scaffold-kind='matrix' et data-skill='mult' sur la racine (garde de dispatch)", () => {
      const { container } = render(<Matrix operands={[a, b]} correctAnswer={correctAnswer} />);
      const root = container.querySelector('[data-scaffold-kind="matrix"]');
      expect(root).toHaveAttribute("data-skill", "mult");
    });
  });

  describe("regroupement spatial (feed-forward game-design rétro #95 : le modèle DOIT être dessiné)", () => {
    it("PAS une grille uniforme aplatie : a×b points existent, mais regroupés en a conteneurs de paquet distincts", () => {
      // Garde anti-régression structurelle : un refactor qui aplatirait la matrice en
      // une simple grille `a×b` points (sans conteneurs de paquet) ferait chuter le
      // compte de `[data-scaffold-packet]` à 0 ou 1, alors que le nombre total de
      // points resterait a×b — cette garde distingue les deux rendus.
      const { container } = render(<Matrix operands={[6, 8]} correctAnswer={48} />);
      const rows = packets(container);
      expect(rows).toHaveLength(6);
      const totalDots = container.querySelectorAll("[data-scaffold-packet] span").length;
      expect(totalDots).toBe(48);
    });

    it("chaque paquet est un conteneur BORDÉ (regroupement visible par structure, pas seulement la couleur des points)", () => {
      // a11y daltonisme : la distinction des groupes ne repose PAS sur la seule
      // couleur des points — chaque paquet porte sa propre bordure/fond.
      const { container } = render(<Matrix operands={[4, 5]} correctAnswer={20} />);
      for (const packet of packets(container)) {
        const el = packet as HTMLElement;
        expect(el.style.border).toMatch(/var\(--scaffold-matrix-row-border\)/u);
        expect(el.style.backgroundColor).toBe("var(--scaffold-matrix-row-bg)");
      }
    });

    it("une gouttière (gap) sépare les paquets entre eux, distincte du gap interne aux points", () => {
      // Le conteneur des lignes utilise le token de gouttière INTER-paquets, différent
      // du gap INTRA-paquet (entre points) — deux tokens distincts, jamais confondus.
      const { container } = render(<Matrix operands={[3, 4]} correctAnswer={12} />);
      const rowsContainer = container.querySelector(
        '[data-scaffold-kind="matrix"] > div > div',
      ) as HTMLElement;
      expect(rowsContainer.style.gap).toBe("var(--scaffold-matrix-row-gap)");
      const firstPacket = packets(container)[0] as HTMLElement;
      expect(firstPacket.style.gap).toBe("var(--scaffold-matrix-dot-gap)");
      expect(firstPacket.style.gap).not.toBe(rowsContainer.style.gap);
    });
  });

  describe("grande matrice (9×10) : scroll horizontal MAÎTRISÉ sur le conteneur, jamais le body", () => {
    it("le conteneur scrollable est un wrapper interne (overflowX:auto), la racine du scaffold n'a pas d'overflow propre", () => {
      // Garde à effet observable : si le débordement horizontal remontait au body (le
      // conteneur perdant son overflow-x:auto), ce test rougirait (aucun wrapper
      // scrollable identifié) — WIREFRAMES §8, reflow tél.
      const { container } = render(<Matrix operands={[9, 10]} correctAnswer={90} />);
      const root = container.querySelector('[data-scaffold-kind="matrix"]') as HTMLElement;
      const scrollWrapper = root.querySelector("div") as HTMLElement;
      expect(scrollWrapper.style.overflowX).toBe("auto");
      expect(root.style.overflowX).not.toBe("auto");
    });

    it("9 paquets de 10 points sont bien tous rendus (grande matrice reste complète, pas tronquée)", () => {
      const { container } = render(<Matrix operands={[9, 10]} correctAnswer={90} />);
      const rows = packets(container);
      expect(rows).toHaveLength(9);
      for (const packet of rows) {
        expect(packet.querySelectorAll("span").length).toBe(10);
      }
    });
  });

  describe("a11y — décoratif, pas de role='img' propre (contrat hérité rétro #94, STRICT)", () => {
    it("aucun role='img' interne (l'unique role='img' est le conteneur VisualScaffold)", () => {
      const { container } = render(<Matrix operands={[6, 8]} correctAnswer={48} />);
      expect(container.querySelectorAll('[role="img"]')).toHaveLength(0);
    });

    it("la racine est aria-hidden (visuel purement décoratif, info portée par le label du parent)", () => {
      const { container } = render(<Matrix operands={[6, 8]} correctAnswer={48} />);
      const root = container.querySelector('[data-scaffold-kind="matrix"]');
      expect(root).toHaveAttribute("aria-hidden", "true");
    });

    it("aucun contrôle focusable (étayage illustratif, #38 non blocked-by)", () => {
      const { container } = render(<Matrix operands={[6, 8]} correctAnswer={48} />);
      expect(container.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
    });
  });

  describe("contraste WCAG du point sur le fond de paquet (piège #94/#104 récurrent)", () => {
    it("le token --scaffold-matrix-dot-color n'est PAS --color-text-inverse", () => {
      const { container } = render(<Matrix operands={[6, 8]} correctAnswer={48} />);
      const dot = packets(container)[0].querySelector("span") as HTMLElement;
      expect(dot.style.color).toBe("var(--scaffold-matrix-dot-color)");
      expect(dot.style.color).not.toBe("var(--color-text-inverse)");
    });

    it.each(["light", "dark"] as const)(
      "%s : --scaffold-matrix-dot-color atteint ≥ 3:1 sur --scaffold-matrix-row-bg (WCAG 1.4.11, élément non-texte)",
      (theme) => {
        // Rougit si un futur changement réintroduit --color-text-inverse (ou toute
        // couleur trop proche du fond) sur le point du paquet.
        const dotColor = resolveTokenColor(theme, "--scaffold-matrix-dot-color");
        const rowBg = resolveTokenColor(theme, "--scaffold-matrix-row-bg");
        expect(contrastRatio(dotColor, rowBg)).toBeGreaterThanOrEqual(3);
      },
    );
  });

  describe("matrixLabel — libellé accessible (nom du role='img' parent)", () => {
    it("« {a} paquets de {b} », dérivé des operands", () => {
      const label = matrixLabel({ operands: [6, 8], correctAnswer: 48 });
      expect(label).toBe(fill(strings.play.scaffold.matrix.label, { a: "6", b: "8" }));
    });

    it("n'est jamais le libellé générique (canal a11y spécifique, pas un texte de repli)", () => {
      const label = matrixLabel({ operands: [7, 5], correctAnswer: 35 });
      expect(label).not.toBe(strings.play.scaffold.label);
    });
  });
});
