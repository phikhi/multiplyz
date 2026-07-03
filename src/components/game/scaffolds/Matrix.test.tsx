import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Matrix, matrixLabel } from "./Matrix";
import { strings } from "@/strings";
import {
  contrastRatio,
  resolveTokenColor,
} from "@/components/game/scaffolds/test-support/tokens-css";

/**
 * Fixture de test **locale** (nit review #112) — l'ancien libellé générique du
 * placeholder de fondation #93 (`RETIRED_GENERIC_SCAFFOLD_LABEL`) a été RETIRÉ de la
 * table de strings prod (plus aucun composant ne le référence, épic #4 complet).
 * Gardée ici uniquement pour la garde anti-régression « ce n'est pas le générique ».
 */
const RETIRED_GENERIC_SCAFFOLD_LABEL = "Un petit dessin pour t'aider à voir le calcul";

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

// Lecture de la source de vérité `tokens.css` (fix #104, dette QA #102) : parsing
// partagé extrait dans `test-support/tokens-css.ts` (issue #110 — robustifie et
// dédoublonne l'ancienne copie identique de ce helper entre `NumberLine.test.tsx`
// et ce fichier, cf. commentaire du module partagé pour le détail du couplage).

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
      expect(label).not.toBe(RETIRED_GENERIC_SCAFFOLD_LABEL);
    });
  });
});
