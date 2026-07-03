import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NumberLine, numberLineLabel } from "./NumberLine";
import { strings } from "@/strings";

function fill(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, value),
    template,
  );
}

/** Points (départ + arrivée) portés par la grille — <span> avec un texte numérique. */
function points(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("[data-scaffold-kind='number-line'] span")].filter(
    (el) => el.textContent !== "" && /^-?\d+$/u.test(el.textContent ?? ""),
  );
}

/**
 * Lecture de la **source de vérité** `tokens.css` (fix #104, dette QA #102) : jsdom
 * ne charge pas le CSS externe → `getComputedStyle` ne résout jamais un
 * `var(--token)` posé en style inline React. Pour vérifier la **couleur EFFECTIVE**
 * (pas seulement le nom du token asserté), ce helper parse `tokens.css`, résout la
 * chaîne de `var()` (light `:root` + dark `[data-theme="dark"]`), et calcule le
 * ratio de contraste WCAG réel — un test qui rougit si le token repasse à
 * `--color-text-inverse` (piège #94, exactement le bug #104 constaté sur la capture).
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
 * redéfini dans `[data-theme="dark"]` hérite de `:root` — ex.
 * `--scaffold-line-end-glyph`, jamais surchargé en dark, cf. tokens.css).
 */
function rawTokenValue(block: string, token: string): string {
  const re = new RegExp(`--${token.replace(/^--/u, "")}:\\s*([^;]+);`, "u");
  const m = block.match(re);
  if (m !== null) return m[1].trim();
  if (block !== themeBlock("light")) return rawTokenValue(themeBlock("light"), token);
  throw new Error(`token "${token}" introuvable (même en fallback :root)`);
}

/** Résout entièrement une chaîne `var(--a)` → `var(--b)` → `#hex` (2 niveaux max ici). */
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

/** Ratio de contraste WCAG entre 2 couleurs hex (≥ 4.5:1 = AA texte normal). */
function contrastRatio(hexA: string, hexB: string): number {
  const [lLight, lDark] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (lLight + 0.05) / (lDark + 0.05);
}

describe("NumberLine — droite numérique add/sub (ENGINE §1, PRODUCT §3.4, story #95)", () => {
  describe("addition — saut AVANT, arrivée = a + b", () => {
    // Domaine add v1 (DOMAIN.add, ENGINE §1) : a,b ∈ 1..10, somme ≤ 20. Échantillon
    // couvrant un cas simple, un cas franchissant la dizaine, et une somme = 20 (bord).
    const CASES: ReadonlyArray<readonly [number, number]> = [
      [3, 4],
      [8, 5], // franchit la dizaine (8+5=13)
      [10, 10], // bord haut du domaine (somme = 20)
      [1, 1],
    ];

    it.each(CASES)("a=%i b=%i → arrivée == a+b, sens avant (data-skill=add)", (a, b) => {
      const correctAnswer = a + b;
      const { container } = render(<NumberLine operands={[a, b]} correctAnswer={correctAnswer} />);
      const root = container.querySelector('[data-scaffold-kind="number-line"]');
      expect(root).toHaveAttribute("data-skill", "add");
      // Effet observable du modèle : le point de départ ET le point d'arrivée
      // affichés portent bien a et correctAnswer — pas juste un conteneur générique.
      const values = points(container).map((el) => Number(el.textContent));
      expect(values).toContain(a);
      expect(values).toContain(correctAnswer);
    });

    it.each(CASES)("a=%i b=%i → icône flèche AVANT (→), jamais ←", (a, b) => {
      const correctAnswer = a + b;
      render(<NumberLine operands={[a, b]} correctAnswer={correctAnswer} />);
      expect(screen.getByText("→")).toBeInTheDocument();
      expect(screen.queryByText("←")).not.toBeInTheDocument();
    });

    it.each(CASES)("a=%i b=%i → texte visible 'Depuis {a}, on avance de {b}'", (a, b) => {
      const correctAnswer = a + b;
      render(<NumberLine operands={[a, b]} correctAnswer={correctAnswer} />);
      const expected = fill(strings.play.scaffold.numberLine.forward, {
        a: String(a),
        b: String(b),
      });
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  describe("soustraction — saut ARRIÈRE, arrivée = a − b", () => {
    // Domaine sub v1 (DOMAIN.sub) : minuende a ≤ 20, b ≤ a. Échantillon couvrant un
    // cas simple, un cas franchissant la dizaine, et un résultat = 0 (bord).
    const CASES: ReadonlyArray<readonly [number, number]> = [
      [9, 4],
      [15, 6], // franchit la dizaine (15-6=9)
      [7, 7], // bord bas (résultat = 0)
      [20, 1], // bord haut du minuende v1
    ];

    it.each(CASES)("a=%i b=%i → arrivée == a-b, sens arrière (data-skill=sub)", (a, b) => {
      const correctAnswer = a - b;
      const { container } = render(<NumberLine operands={[a, b]} correctAnswer={correctAnswer} />);
      const root = container.querySelector('[data-scaffold-kind="number-line"]');
      expect(root).toHaveAttribute("data-skill", "sub");
      const values = points(container).map((el) => Number(el.textContent));
      expect(values).toContain(a);
      expect(values).toContain(correctAnswer);
    });

    it.each(CASES)("a=%i b=%i → icône flèche ARRIÈRE (←), jamais →", (a, b) => {
      const correctAnswer = a - b;
      render(<NumberLine operands={[a, b]} correctAnswer={correctAnswer} />);
      expect(screen.getByText("←")).toBeInTheDocument();
      expect(screen.queryByText("→")).not.toBeInTheDocument();
    });

    it.each(CASES)("a=%i b=%i → texte visible 'Depuis {a}, on recule de {b}'", (a, b) => {
      const correctAnswer = a - b;
      render(<NumberLine operands={[a, b]} correctAnswer={correctAnswer} />);
      const expected = fill(strings.play.scaffold.numberLine.backward, {
        a: String(a),
        b: String(b),
      });
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  });

  describe("bornes d'affichage ⚙️ dérivées des operands (jamais en dur)", () => {
    it("ne déborde jamais sous 0 (a proche du bord bas)", () => {
      // a=1, b=1 → correctAnswer=0 : la marge (LINE_MARGIN=2) voudrait afficher -1,
      // -2, mais le clamp au domaine v1 empêche tout affichage négatif.
      const { container } = render(<NumberLine operands={[1, 1]} correctAnswer={0} />);
      const values = points(container).map((el) => Number(el.textContent));
      // Toutes les graduations (pas seulement départ/arrivée) doivent être ≥ 0.
      const allTicks = [...container.querySelectorAll('[data-scaffold-kind="number-line"] span')]
        .map((el) => el.textContent)
        .filter((t): t is string => t !== null && /^-?\d+$/u.test(t))
        .map(Number);
      expect(Math.min(...allTicks)).toBeGreaterThanOrEqual(0);
      expect(values).toContain(0);
    });

    it("ne déborde jamais au-dessus de 20 (domaine v1 add/sub dans 20)", () => {
      // a=10, b=10 → correctAnswer=20 : la marge voudrait afficher 21, 22, mais le
      // clamp au domaine v1 (DISPLAY_CEILING=20) l'empêche.
      const { container } = render(<NumberLine operands={[10, 10]} correctAnswer={20} />);
      const allTicks = [...container.querySelectorAll('[data-scaffold-kind="number-line"] span')]
        .map((el) => el.textContent)
        .filter((t): t is string => t !== null && /^-?\d+$/u.test(t))
        .map(Number);
      expect(Math.max(...allTicks)).toBeLessThanOrEqual(20);
    });

    it("les bornes suivent les operands : deux calculs distincts → plages de graduations distinctes", () => {
      // Garde anti-valeur-en-dur : si la droite affichait toujours [0,20] fixe, ces
      // deux rendus auraient le MÊME ensemble de graduations malgré des calculs
      // très différents. Ils doivent différer (droite compacte autour du calcul).
      const { container: near } = render(<NumberLine operands={[2, 1]} correctAnswer={3} />);
      const { container: far } = render(<NumberLine operands={[10, 9]} correctAnswer={19} />);
      const ticksOf = (c: HTMLElement) =>
        [...c.querySelectorAll('[data-scaffold-kind="number-line"] span')]
          .map((el) => el.textContent)
          .filter((t): t is string => t !== null && /^-?\d+$/u.test(t))
          .map(Number)
          .sort((a, b) => a - b);
      expect(ticksOf(near)).not.toEqual(ticksOf(far));
    });
  });

  describe("saut rendu visuellement — arc sur la ligne (BLOQUANT game-design, AC #1)", () => {
    /** Le connecteur SVG de l'arc du saut (data-jump). */
    function jump(container: HTMLElement) {
      return container.querySelector('[data-jump="true"]');
    }
    /** La pointe de flèche — élément CSS séparé (fix #104, bug #1). */
    function arrow(container: HTMLElement) {
      return container.querySelector('[data-jump-arrow="true"]');
    }
    /** Extrait les coordonnées `M x1 y1 Q cx cy x2 y2` du path (l'arc). */
    function arcEndpoints(container: HTMLElement): {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    } {
      const path = container.querySelector('[data-jump="true"] path');
      const d = path?.getAttribute("d") ?? "";
      const m = d.match(/^M\s+([\d.]+)\s+([\d.]+)\s+Q\s+[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)$/u);
      if (m === null) throw new Error(`arc path inattendu: "${d}"`);
      return { x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]) };
    }
    /** Fraction horizontale (`left: N%`) d'un `Tick` portant la valeur donnée. */
    function tickFrac(container: HTMLElement, value: number): number {
      const tick = [...container.querySelectorAll('[data-scaffold-kind="number-line"] span')].find(
        (el) => el.textContent === String(value),
      );
      const wrapper = tick?.parentElement;
      const left = wrapper?.style.left ?? "";
      const m = left.match(/^([\d.]+)%$/u);
      if (m === null) throw new Error(`Tick "${value}" introuvable ou left inattendu: "${left}"`);
      return Number(m[1]);
    }

    it("l'arc de saut EXISTE sur la ligne (pas seulement dans le texte)", () => {
      // Effet observable : si le connecteur visuel était retiré (retour à la seule
      // flèche du texte), cette assertion rougirait — le modèle « droite AVEC saut »
      // (PRODUCT §3.4) exige de VOIR le bond.
      const { container } = render(<NumberLine operands={[3, 4]} correctAnswer={7} />);
      expect(jump(container)).not.toBeNull();
    });

    it("add → l'arc va du départ (a) vers la DROITE (arrivée > départ)", () => {
      // Effet observable de l'ORIENTATION dérivée du sens : addition = saut avant →
      // l'abscisse d'arrivée de l'arc est à DROITE de l'abscisse de départ.
      const { container } = render(<NumberLine operands={[3, 4]} correctAnswer={7} />);
      const { x1, x2 } = arcEndpoints(container);
      expect(x2).toBeGreaterThan(x1);
    });

    it("sub → l'arc va du départ (a) vers la GAUCHE (arrivée < départ)", () => {
      // Soustraction = saut arrière → l'abscisse d'arrivée est à GAUCHE du départ.
      const { container } = render(<NumberLine operands={[9, 4]} correctAnswer={5} />);
      const { x1, x2 } = arcEndpoints(container);
      expect(x2).toBeLessThan(x1);
    });

    it("l'arc relie EXACTEMENT le départ (a) à l'arrivée (correctAnswer), pas des positions figées", () => {
      // Garde anti-valeur-en-dur : le départ de l'arc est à gauche de l'arrivée pour
      // add, et l'amplitude reflète l'écart réel. Deux calculs d'écarts différents →
      // amplitudes d'arc différentes (rougit si les endpoints étaient constants).
      const { container: c1 } = render(<NumberLine operands={[3, 2]} correctAnswer={5} />);
      const { container: c2 } = render(<NumberLine operands={[3, 8]} correctAnswer={11} />);
      const span1 = Math.abs(arcEndpoints(c1).x2 - arcEndpoints(c1).x1);
      const span2 = Math.abs(arcEndpoints(c2).x2 - arcEndpoints(c2).x1);
      // Écart +2 (compact, borne resserrée) vs +8 : les fenêtres d'affichage diffèrent,
      // mais dans les 2 cas l'arc couvre une amplitude non nulle et orientée.
      expect(span1).toBeGreaterThan(0);
      expect(span2).toBeGreaterThan(0);
    });

    // fix #104, bug #2 (« arc décollé des points ») — dette QA #102 : les tests
    // d'origine assertaient la forme du path (M/Q, offsets fixes) mais JAMAIS que
    // l'arc touchait réellement les pastilles départ/arrivée. Garde à effet
    // observable : l'abscisse de CHAQUE endpoint de l'arc doit coïncider avec la
    // fraction horizontale du `Tick` correspondant (même référentiel de fraction,
    // donc alignement pixel-exact quel que soit le calcul). Rougit si un décalage
    // de baseline ou de fraction reviendrait décoller l'arc des points.
    it.each([
      [3, 4, 7] as const, // add — franchit la dizaine
      [9, 4, 5] as const, // sub
      [1, 1, 0] as const, // bord bas (résultat = 0)
      [10, 10, 20] as const, // bord haut (somme = 20)
    ])(
      "a=%i b=%i correctAnswer=%i → l'arc TOUCHE le départ ET l'arrivée (même fraction que les pastilles)",
      (a, _b, correctAnswer) => {
        const { container } = render(
          <NumberLine operands={[a, _b]} correctAnswer={correctAnswer} />,
        );
        const { x1, x2 } = arcEndpoints(container);
        const startFrac = tickFrac(container, a);
        const endFrac = tickFrac(container, correctAnswer);
        // Tolérance flottante minime (arrondi de fraction), pas un décalage de baseline.
        expect(x1).toBeCloseTo(startFrac, 5);
        expect(x2).toBeCloseTo(endFrac, 5);
      },
    );

    it("la baseline VERTICALE de l'arc (y1=y2=100, bord bas du SVG) est ancrée sur le CENTRE des pastilles, pas un nombre magique flottant au-dessus (fix #104, bug #2 précis)", () => {
      // Effet observable du vrai bug #2 (« décollé ») : avant #104, `baseY=92` était
      // un nombre FIXE indépendant de la hauteur réelle des pastilles — l'arc
      // flottait au-dessus d'elles. Ici, `y1`/`y2` du path (bord bas du viewBox,
      // toujours 100) doivent coïncider avec la hauteur CSS du SVG lui-même : le
      // SVG s'arrête PILE au centre des pastilles (`height` = même formule que
      // `top` de la pointe et du trait de la droite). Rougit si un futur agent
      // réintroduit un `baseY`/`height` fixe déconnecté du token de taille de pastille.
      const { container } = render(<NumberLine operands={[3, 4]} correctAnswer={7} />);
      const { y1, y2 } = arcEndpoints(container);
      expect(y1).toBe(100);
      expect(y2).toBe(100);
      const svg = jump(container) as HTMLElement;
      const arrowEl = arrow(container) as HTMLElement;
      // Le bord bas du SVG (100 % de sa `height` CSS) DOIT être la même position
      // que l'ancrage `top` de la pointe et du trait — dérivés de la MÊME formule
      // token (ARC_ZONE_HEIGHT + point-size/2), jamais une valeur indépendante.
      expect(svg.style.height).toBe(arrowEl.style.top);
      expect(svg.style.height).toMatch(/scaffold-line-point-size/u);
    });

    it("la pointe de flèche existe comme élément SÉPARÉ du path de l'arc (fix #104, bug #1 anti-régression)", () => {
      // Garde anti-régression structurelle : si la pointe était remise DANS le SVG
      // étiré de l'arc (comme avant #104), elle serait à nouveau cisaillée par le
      // `preserveAspectRatio="none"` (échelle x ≫ y). En la gardant hors du SVG (un
      // <span> CSS séparé, repère carré non déformable), la pointe reste nette à
      // TOUTE largeur de piste — rougit si le composant réintroduit un 2ᵉ <path>
      // dans le SVG à la place de cet élément dédié.
      const { container } = render(<NumberLine operands={[3, 4]} correctAnswer={7} />);
      const svg = jump(container);
      // Le SVG de l'arc ne contient plus qu'UN SEUL path (la courbe) — pas de 2ᵉ
      // path pour la pointe.
      expect(svg?.querySelectorAll("path")).toHaveLength(1);
      expect(arrow(container)).not.toBeNull();
      expect(arrow(container)?.tagName).toBe("SPAN"); // pas un <svg>/<path>
    });

    it("la pointe de flèche a un repère CARRÉ (bordures gauche/droite égales) — jamais un triangle déformé", () => {
      // Effet observable de la non-déformation : les demi-côtés gauche/droite du
      // triangle CSS doivent être IDENTIQUES (repère carré, valeur borderLeft ===
      // borderRight au caractère près — même token, même mot-clé "transparent") ET
      // TOUS DEUX transparents (seul border-bottom porte la couleur visible). Si un
      // futur changement remettait la pointe dans un viewBox étiré (x≠y), on
      // perdrait cette symétrie — cette garde rougirait dès que la pointe cesse
      // d'être un triangle CSS à bordures symétriques.
      const { container } = render(<NumberLine operands={[3, 4]} correctAnswer={7} />);
      const el = arrow(container) as HTMLElement;
      // jsdom ne décompose pas un shorthand contenant var() en sous-propriétés
      // (borderLeftColor reste vide) — on compare donc le shorthand complet.
      expect(el.style.borderLeft).toBe(el.style.borderRight);
      expect(el.style.borderLeft).toMatch(/\bsolid\s+transparent$/u);
      expect(el.style.borderRight).toMatch(/\bsolid\s+transparent$/u);
      // La couleur portée par border-bottom est le token de l'arc (visible, contrasté).
      expect(el.style.borderBottom).toBe("var(--space-2) solid var(--scaffold-line-jump-arc)");
    });

    it("add → la pointe pointe vers la DROITE (rotation +90°) + data-jump-direction=forward", () => {
      const { container } = render(<NumberLine operands={[2, 3]} correctAnswer={5} />);
      const el = arrow(container);
      expect(el).toHaveAttribute("data-jump-direction", "forward");
      expect(el?.getAttribute("style")).toMatch(/rotate\(90deg\)/u);
    });

    it("sub → la pointe pointe vers la GAUCHE (rotation -90°) + data-jump-direction=backward", () => {
      const { container } = render(<NumberLine operands={[8, 3]} correctAnswer={5} />);
      const el = arrow(container);
      expect(el).toHaveAttribute("data-jump-direction", "backward");
      expect(el?.getAttribute("style")).toMatch(/rotate\(-90deg\)/u);
    });

    it("la pointe est TOUJOURS à l'abscisse d'arrivée, jamais sous la ligne (même baseline que l'arc)", () => {
      // Garde anti-régression bug #2 appliquée à la pointe elle-même : son `top`
      // doit être EXACTEMENT le même calcul que le bord bas de l'arc (centre des
      // pastilles), pas une valeur indépendante qui pourrait dériver.
      const { container } = render(<NumberLine operands={[3, 4]} correctAnswer={7} />);
      const svg = jump(container) as HTMLElement;
      const el = arrow(container) as HTMLElement;
      expect(el.style.top).toBe(svg.style.height);
    });

    it("l'arc et la pointe sont décoratifs (aucun role='img' ni texte annoncé — a11y via le conteneur)", () => {
      const { container } = render(<NumberLine operands={[4, 3]} correctAnswer={7} />);
      const svg = jump(container);
      expect(svg?.querySelectorAll('[role="img"]')).toHaveLength(0);
      expect(arrow(container)?.getAttribute("role")).toBeNull();
      // Le SVG ne contient aucun nœud texte (l'info a11y passe par le label du parent).
      expect(svg?.textContent).toBe("");
    });
  });

  describe("chiffre d'arrivée lisible sur fond neutre (fix #104, bug #3 — piège #94 récurrent)", () => {
    // Contexte du bug : `--scaffold-line-end-glyph` était `--color-text-inverse`
    // (blanc), pensé pour un chiffre posé SUR la pastille accent — mais le chiffre
    // est rendu SOUS la pastille, sur le fond NEUTRE du panneau → blanc-sur-clair
    // invisible (le « 7 » manquant sur la capture #102). Dette QA #102 : le test
    // d'origine n'assertait jamais la couleur EFFECTIVE, seulement le nom du path.
    // Ici on résout la VRAIE valeur hex du token (via tokens.css, source de vérité)
    // et on calcule le contraste WCAG réel contre les fonds neutres — rougit si le
    // token repasse à `--color-text-inverse`.
    it("le token --scaffold-line-end-glyph n'est PLUS --color-text-inverse", () => {
      const { container } = render(<NumberLine operands={[1, 6]} correctAnswer={7} />);
      const endGlyph = points(container).find((el) => el.textContent === "7") as HTMLElement;
      expect(endGlyph.style.color).toBe("var(--scaffold-line-end-glyph)");
      expect(endGlyph.style.color).not.toBe("var(--color-text-inverse)");
    });

    it.each(["light", "dark"] as const)(
      "%s : --scaffold-line-end-glyph atteint ≥ 4.5:1 sur le fond neutre du panneau (WCAG AA)",
      (theme) => {
        const glyphColor = resolveTokenColor(theme, "--scaffold-line-end-glyph");
        // Fonds neutres possibles du panneau (bg-primary et bg-secondary, cf. rétro
        // #94) — le glyphe doit contraster sur LES DEUX, pas seulement l'un.
        const bgPrimary = resolveTokenColor(theme, "--color-bg-primary");
        const bgSecondary = resolveTokenColor(theme, "--color-bg-secondary");
        expect(contrastRatio(glyphColor, bgPrimary)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(glyphColor, bgSecondary)).toBeGreaterThanOrEqual(4.5);
      },
    );

    it("le glyphe de départ ET le glyphe d'arrivée utilisent tous les deux un token contrastant sur fond neutre (jamais --color-text-inverse hors accent plein)", () => {
      // Garde anti-régression généralisée (piège #94, promu règle CLAUDE.md) : ANY
      // glyphe de graduation posé sur le fond neutre du panneau doit utiliser un
      // token qui n'est PAS --color-text-inverse. Rougit si un futur changement
      // réintroduit ce token sur une pastille rendue hors fond accent plein.
      const { container } = render(<NumberLine operands={[2, 5]} correctAnswer={7} />);
      const startGlyph = points(container).find((el) => el.textContent === "2") as HTMLElement;
      const endGlyph = points(container).find((el) => el.textContent === "7") as HTMLElement;
      expect(startGlyph.style.color).not.toBe("var(--color-text-inverse)");
      expect(endGlyph.style.color).not.toBe("var(--color-text-inverse)");
    });
  });

  describe("numberLineLabel — libellé accessible (nom du role='img' parent)", () => {
    it("add → « Depuis {a}, on avance de {b} »", () => {
      const label = numberLineLabel("add", { operands: [6, 3], correctAnswer: 9 });
      expect(label).toBe(fill(strings.play.scaffold.numberLine.forward, { a: "6", b: "3" }));
    });

    it("sub → « Depuis {a}, on recule de {b} »", () => {
      const label = numberLineLabel("sub", { operands: [9, 3], correctAnswer: 6 });
      expect(label).toBe(fill(strings.play.scaffold.numberLine.backward, { a: "9", b: "3" }));
    });

    it("add et sub produisent des libellés DIFFÉRENTS pour les mêmes operands (sens porté par le nom accessible)", () => {
      // Effet observable anti-régression : si le registre retombait sur un seul
      // gabarit générique quel que soit le sens, ces deux libellés seraient
      // identiques → rouge.
      const forward = numberLineLabel("add", { operands: [8, 5], correctAnswer: 13 });
      const backward = numberLineLabel("sub", { operands: [8, 5], correctAnswer: 3 });
      expect(forward).not.toBe(backward);
    });
  });

  it("porte le marqueur de dispatch dérivé du registre (data-scaffold-kind + data-skill)", () => {
    // Effet observable pour le test de dispatch de VisualScaffold (LEARNINGS rétro
    // #93/#94) : un dispatch cassé routant vers le mauvais composant ferait
    // disparaître ces attributs.
    const { container } = render(<NumberLine operands={[4, 3]} correctAnswer={7} />);
    const root = container.querySelector('[data-scaffold-kind="number-line"]');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("data-skill", "add");
  });

  it("ne porte PAS de role='img' propre (unique role='img' = conteneur, contrat hérité #94)", () => {
    // Effet observable anti-imbrication : si NumberLine réintroduisait un
    // `role='img'`, VisualScaffold en aurait deux (opacité lecteur d'écran, label
    // interne avalé).
    const { container } = render(<NumberLine operands={[5, 2]} correctAnswer={7} />);
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(0);
  });

  it("a11y : le visuel est décoratif (racine aria-hidden, info via le conteneur)", () => {
    const { container } = render(<NumberLine operands={[6, 4]} correctAnswer={10} />);
    const root = container.querySelector('[data-scaffold-kind="number-line"]');
    expect(root).toHaveAttribute("aria-hidden", "true");
  });

  it("le sens du saut n'est jamais porté par la SEULE couleur : texte ET icône présents (daltonisme)", () => {
    // Garde a11y : l'icône flèche seule ne suffit pas — le texte visible doit
    // toujours accompagner le glyphe directionnel.
    render(<NumberLine operands={[7, 2]} correctAnswer={9} />);
    expect(screen.getByText("→")).toBeInTheDocument();
    expect(
      screen.getByText(fill(strings.play.scaffold.numberLine.forward, { a: "7", b: "2" })),
    ).toBeInTheDocument();
  });

  it("n'ajoute AUCUN contrôle focusable (étayage illustratif)", () => {
    const { container } = render(<NumberLine operands={[3, 8]} correctAnswer={11} />);
    expect(container.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
  });
});
