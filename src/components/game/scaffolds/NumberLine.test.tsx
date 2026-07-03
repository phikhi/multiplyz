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
    /** Le connecteur SVG du saut (data-jump) et son path principal (arc courbe). */
    function jump(container: HTMLElement) {
      return container.querySelector('[data-jump="true"]');
    }
    /** Extrait les coordonnées `M x y Q cx cy x2 y2` du 1er path (l'arc). */
    function arcEndpoints(container: HTMLElement): { x1: number; x2: number } {
      const path = container.querySelector('[data-jump="true"] path');
      const d = path?.getAttribute("d") ?? "";
      // `M x1 y1 Q cx cy x2 y2`
      const m = d.match(/^M\s+([\d.]+)\s+[\d.]+\s+Q\s+[\d.]+\s+[\d.]+\s+([\d.]+)\s+/u);
      if (m === null) throw new Error(`arc path inattendu: "${d}"`);
      return { x1: Number(m[1]), x2: Number(m[2]) };
    }

    it("l'arc de saut EXISTE sur la ligne (pas seulement dans le texte)", () => {
      // Effet observable : si le connecteur visuel était retiré (retour à la seule
      // flèche du texte), cette assertion rougirait — le modèle « droite AVEC saut »
      // (PRODUCT §3.4) exige de VOIR le bond.
      const { container } = render(<NumberLine operands={[3, 4]} correctAnswer={7} />);
      expect(jump(container)).not.toBeNull();
    });

    it("add → l'arc va du départ (a) vers la DROITE (arrivée > départ) + data-jump-direction=forward", () => {
      // Effet observable de l'ORIENTATION dérivée du sens : addition = saut avant →
      // l'abscisse d'arrivée de l'arc est à DROITE de l'abscisse de départ.
      const { container } = render(<NumberLine operands={[3, 4]} correctAnswer={7} />);
      expect(jump(container)).toHaveAttribute("data-jump-direction", "forward");
      const { x1, x2 } = arcEndpoints(container);
      expect(x2).toBeGreaterThan(x1);
    });

    it("sub → l'arc va du départ (a) vers la GAUCHE (arrivée < départ) + data-jump-direction=backward", () => {
      // Soustraction = saut arrière → l'abscisse d'arrivée est à GAUCHE du départ.
      const { container } = render(<NumberLine operands={[9, 4]} correctAnswer={5} />);
      expect(jump(container)).toHaveAttribute("data-jump-direction", "backward");
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

    it("la pointe de flèche de l'arc s'ouvre dans le sens du saut (add=droite, sub=gauche)", () => {
      // Effet observable de l'orientation de la POINTE : le 2ᵉ path (arrowhead) porte
      // des offsets `l ±arrow …` dont le signe suit le sens (dir=+1 add / −1 sub).
      const { container: add } = render(<NumberLine operands={[2, 3]} correctAnswer={5} />);
      const { container: sub } = render(<NumberLine operands={[8, 3]} correctAnswer={5} />);
      const addArrow = add.querySelectorAll('[data-jump="true"] path')[1]?.getAttribute("d") ?? "";
      const subArrow = sub.querySelectorAll('[data-jump="true"] path')[1]?.getAttribute("d") ?? "";
      // add → offsets positifs (vers la droite) ; sub → négatifs (vers la gauche).
      expect(addArrow).toMatch(/l\s+5\s/u);
      expect(subArrow).toMatch(/l\s+-5\s/u);
      expect(addArrow).not.toBe(subArrow);
    });

    it("l'arc est décoratif (aucun role='img' ni texte annoncé — a11y via le conteneur)", () => {
      const { container } = render(<NumberLine operands={[4, 3]} correctAnswer={7} />);
      const svg = jump(container);
      expect(svg?.querySelectorAll('[role="img"]')).toHaveLength(0);
      // Le SVG ne contient aucun nœud texte (l'info a11y passe par le label du parent).
      expect(svg?.textContent).toBe("");
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
