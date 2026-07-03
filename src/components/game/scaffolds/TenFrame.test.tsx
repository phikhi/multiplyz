import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TenFrame } from "./TenFrame";
import { strings } from "@/strings";

/** Domaine complet des compléments à 10 (ENGINE §1 `a + ? = 10`, a ∈ 1..9). */
const A_DOMAIN = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

describe("TenFrame — dix-cases des compléments à 10 (ENGINE §1, PRODUCT §3.4, story #94)", () => {
  // Rendu paramétré sur TOUT le domaine a ∈ 1..9 (LEARNINGS #59 : un lookup/rendu
  // dérivé d'une valeur doit être testé sur chaque valeur du domaine, pas un seul
  // échantillon). Garde à effet observable : ces assertions ÉCHOUENT si remplies/
  // vides sont inversées, ou si le total dérive de 10 (mutation de la logique).
  it.each(A_DOMAIN)("a=%i → exactement a cases remplies ET (10-a) cases vides, total=10", (a) => {
    const { container } = render(<TenFrame operands={[a]} correctAnswer={10 - a} />);
    const cells = container.querySelectorAll('[aria-hidden="true"]');
    // Total = 10 cases systématiquement, quel que soit a.
    expect(cells).toHaveLength(10);

    const filledCells = container.querySelectorAll('[aria-hidden="true"]');
    let filledCount = 0;
    let emptyCount = 0;
    for (const cell of filledCells) {
      const text = cell.textContent ?? "";
      if (text === "●") filledCount++;
      if (text === "○") emptyCount++;
    }
    expect(filledCount).toBe(a);
    expect(emptyCount).toBe(10 - a);
  });

  it.each(A_DOMAIN)("a=%i → le libellé texte annonce 'il manque {n} pour faire 10'", (a) => {
    render(<TenFrame operands={[a]} correctAnswer={10 - a} />);
    const expected = fill(strings.play.scaffold.tenFrame.missing, "{n}", String(10 - a));
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it.each(A_DOMAIN)("a=%i → le label a11y du conteneur annonce le compte rempli", (a) => {
    render(<TenFrame operands={[a]} correctAnswer={10 - a} />);
    const expectedLabel = fill(strings.play.scaffold.tenFrame.label, "{a}", String(a));
    expect(screen.getByRole("img", { name: expectedLabel })).toBeInTheDocument();
  });

  it("porte le marqueur de dispatch dérivé du registre (data-scaffold-kind + data-skill)", () => {
    // Effet observable pour le test de dispatch de VisualScaffold (LEARNINGS rétro
    // #93/#97) : un dispatch cassé routant vers le mauvais composant ferait
    // disparaître ces attributs.
    const { container } = render(<TenFrame operands={[4]} correctAnswer={6} />);
    const root = container.querySelector('[data-scaffold-kind="ten-frame"]');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("data-skill", "comp10");
  });

  it("aucun opérande en dur : le rendu dérive uniquement de operands/correctAnswer", () => {
    // Deux jeux de props différents → deux rendus différents (pas de valeur figée).
    const { container: c1 } = render(<TenFrame operands={[2]} correctAnswer={8} />);
    const { container: c2 } = render(<TenFrame operands={[7]} correctAnswer={3} />);
    const count = (container: HTMLElement) =>
      [...container.querySelectorAll('[aria-hidden="true"]')].filter(
        (node) => node.textContent === "●",
      ).length;
    expect(count(c1)).toBe(2);
    expect(count(c2)).toBe(7);
    expect(count(c1)).not.toBe(count(c2));
  });

  it("a11y : tous les glyphes de cases sont aria-hidden (info portée par le label + texte)", () => {
    const { container } = render(<TenFrame operands={[5]} correctAnswer={5} />);
    const glyphs = container.querySelectorAll("span");
    expect(glyphs.length).toBeGreaterThan(0);
    for (const glyph of glyphs) {
      expect(glyph).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("a11y : remplies vs vides distinguées par motif ET couleur (jamais couleur seule)", () => {
    const { container } = render(<TenFrame operands={[3]} correctAnswer={7} />);
    const cells = [...container.querySelectorAll('[aria-hidden="true"]')];
    const filled = cells.filter((c) => c.textContent === "●");
    const empty = cells.filter((c) => c.textContent === "○");
    expect(filled.length).toBe(3);
    expect(empty.length).toBe(7);
    // Glyphes distincts (motif) — jamais le même caractère pour les deux états.
    expect(filled[0]?.textContent).not.toBe(empty[0]?.textContent);
  });

  it("n'ajoute AUCUN contrôle focusable (étayage illustratif)", () => {
    const { container } = render(<TenFrame operands={[6]} correctAnswer={4} />);
    expect(container.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
  });
});
