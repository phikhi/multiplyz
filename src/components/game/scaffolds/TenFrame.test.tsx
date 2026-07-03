import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TenFrame } from "./TenFrame";
import { strings } from "@/strings";

/** Domaine complet des compléments à 10 (ENGINE §1 `a + ? = 10`, a ∈ 1..9). */
const A_DOMAIN = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const FILLED = "●";
const EMPTY = "○";

function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

/** Les glyphes de cases sont des `<span>` (grille) — distincts du conteneur racine. */
function cells(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll("span")];
}
function filledCells(container: HTMLElement): HTMLElement[] {
  return cells(container).filter((c) => c.textContent === FILLED);
}
function emptyCells(container: HTMLElement): HTMLElement[] {
  return cells(container).filter((c) => c.textContent === EMPTY);
}

describe("TenFrame — dix-cases des compléments à 10 (ENGINE §1, PRODUCT §3.4, story #94)", () => {
  // Rendu paramétré sur TOUT le domaine a ∈ 1..9 (LEARNINGS #59 : un lookup/rendu
  // dérivé d'une valeur doit être testé sur chaque valeur du domaine, pas un seul
  // échantillon). Garde à effet observable : ces assertions ÉCHOUENT si remplies/
  // vides sont inversées, ou si le total dérive de 10 (mutation de la logique).
  it.each(A_DOMAIN)("a=%i → exactement a cases remplies ET (10-a) cases vides, total=10", (a) => {
    const { container } = render(<TenFrame operands={[a]} correctAnswer={10 - a} />);
    // Total = 10 cases systématiquement, quel que soit a.
    expect(cells(container)).toHaveLength(10);
    expect(filledCells(container)).toHaveLength(a);
    expect(emptyCells(container)).toHaveLength(10 - a);
  });

  it.each(A_DOMAIN)("a=%i → le texte visible annonce 'il manque {n} pour faire 10'", (a) => {
    render(<TenFrame operands={[a]} correctAnswer={10 - a} />);
    const expected = fill(strings.play.scaffold.tenFrame.missing, "{n}", String(10 - a));
    expect(screen.getByText(expected)).toBeInTheDocument();
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

  it("ne porte PAS de role='img' propre (unique role='img' = conteneur, rétro #94 FIX)", () => {
    // Effet observable anti-imbrication : si TenFrame réintroduisait un `role='img'`,
    // `VisualScaffold` en aurait deux (opacité lecteur d'écran, label interne avalé).
    const { container } = render(<TenFrame operands={[3]} correctAnswer={7} />);
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(0);
  });

  it("aucun opérande en dur : le rendu dérive uniquement de operands/correctAnswer", () => {
    // Deux jeux de props différents → deux rendus différents (pas de valeur figée).
    const { container: c1 } = render(<TenFrame operands={[2]} correctAnswer={8} />);
    const { container: c2 } = render(<TenFrame operands={[7]} correctAnswer={3} />);
    expect(filledCells(c1)).toHaveLength(2);
    expect(filledCells(c2)).toHaveLength(7);
    expect(filledCells(c1).length).not.toBe(filledCells(c2).length);
  });

  it("a11y : le visuel est décoratif (racine + glyphes aria-hidden, info via le conteneur)", () => {
    const { container } = render(<TenFrame operands={[5]} correctAnswer={5} />);
    // La racine du composant est aria-hidden (le nom accessible vient du conteneur
    // `VisualScaffold`, unique `role='img'`).
    const root = container.querySelector('[data-scaffold-kind="ten-frame"]');
    expect(root).toHaveAttribute("aria-hidden", "true");
    const glyphs = cells(container);
    expect(glyphs.length).toBeGreaterThan(0);
    for (const glyph of glyphs) {
      expect(glyph).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("a11y : remplies vs vides distinguées par MOTIF (glyphes distincts)", () => {
    const { container } = render(<TenFrame operands={[3]} correctAnswer={7} />);
    const filled = filledCells(container);
    const empty = emptyCells(container);
    expect(filled).toHaveLength(3);
    expect(empty).toHaveLength(7);
    // Glyphes distincts (motif) — jamais le même caractère pour les deux états.
    expect(filled[0]?.textContent).not.toBe(empty[0]?.textContent);
  });

  it("a11y : remplies vs vides distinguées par COULEUR de glyphe (contraste, rétro #94 FIX)", () => {
    // Garde de contraste : un token de glyphe UNIQUE pour les 2 états (le bug corrigé)
    // rendrait ces deux couleurs identiques → ce test rougirait. La couleur pleine
    // contraste sur l'accent, la vide sur la surface neutre (tokens distincts).
    const { container } = render(<TenFrame operands={[3]} correctAnswer={7} />);
    const filledColor = filledCells(container)[0]?.style.color;
    const emptyColor = emptyCells(container)[0]?.style.color;
    expect(filledColor).toBe("var(--scaffold-cell-filled-glyph)");
    expect(emptyColor).toBe("var(--scaffold-cell-empty-glyph)");
    expect(filledColor).not.toBe(emptyColor);
  });

  it("n'ajoute AUCUN contrôle focusable (étayage illustratif)", () => {
    const { container } = render(<TenFrame operands={[6]} correctAnswer={4} />);
    expect(container.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
  });
});
