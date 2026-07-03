import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeedbackPanel, type FeedbackPanelProps } from "./FeedbackPanel";
import { strings } from "@/strings";

/**
 * Rend un `FeedbackPanel` avec des props par défaut sûres (skill/operands requis pour
 * l'étayage visuel, épic #4) — chaque test n'override que ce qu'il vérifie.
 */
function renderPanel(overrides: Partial<FeedbackPanelProps> = {}) {
  const props: FeedbackPanelProps = {
    phase: "correct",
    correctAnswer: 48,
    skill: "mult",
    operands: [6, 8],
    variantSeed: 0,
    onContinue: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  return render(<FeedbackPanel {...props} />);
}

describe("FeedbackPanel — phase correct", () => {
  it("annonce une variante de la banque + bouton continuer", () => {
    renderPanel({ phase: "correct", correctAnswer: 48 });
    expect(screen.getByRole("status")).toHaveTextContent(strings.play.correct.variants[0]);
    expect(screen.getByRole("button", { name: strings.play.correct.next })).toBeInTheDocument();
    // Pas de révélation de réponse sur un feedback juste (déjà trouvée par l'enfant).
    expect(screen.queryByText(/48/)).not.toBeInTheDocument();
  });

  it("clic sur continuer appelle onContinue", () => {
    const onContinue = vi.fn();
    renderPanel({ phase: "correct", onContinue });
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe("FeedbackPanel — phase retry (no-fail, ENGINE §9)", () => {
  it("montre la bonne réponse + une variante douce (jamais « faux »)", () => {
    renderPanel({ phase: "retry", correctAnswer: 48 });
    expect(screen.getByRole("status")).toHaveTextContent(strings.play.retry.variants[0]);
    expect(
      screen.getByText(strings.play.retry.answerReveal.replace("{n}", "48")),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.play.retry.tryAgain })).toBeInTheDocument();
  });

  it("clic sur réessayer appelle onRetry (pas onContinue)", () => {
    const onRetry = vi.fn();
    const onContinue = vi.fn();
    renderPanel({ phase: "retry", correctAnswer: 9, variantSeed: 2, onRetry, onContinue });
    fireEvent.click(screen.getByRole("button", { name: strings.play.retry.tryAgain }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("varie le message selon variantSeed (COPY §1)", () => {
    const { rerender } = renderPanel({ phase: "retry", correctAnswer: 1, variantSeed: 0 });
    expect(screen.getByRole("status")).toHaveTextContent(strings.play.retry.variants[0]);

    rerender(
      <FeedbackPanel
        phase="retry"
        correctAnswer={1}
        skill="mult"
        operands={[6, 8]}
        variantSeed={1}
        onContinue={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(strings.play.retry.variants[1]);
  });
});

describe("FeedbackPanel — slot d'étayage visuel (épic #4, WIREFRAMES §3d)", () => {
  // L'étayage est un conteneur `role="img"` labellisé (VisualScaffold). Effet observable :
  // ces tests échouent si le montage conditionnel du slot est muté (retry → correct).
  it("monte l'étayage en re-essai (sous la révélation de réponse)", () => {
    renderPanel({ phase: "retry", skill: "mult", operands: [6, 8] });
    expect(screen.getByRole("img", { name: strings.play.scaffold.label })).toBeInTheDocument();
  });

  it("NE monte PAS l'étayage en feedback juste (correct)", () => {
    renderPanel({ phase: "correct", skill: "mult", operands: [6, 8] });
    // Garde à effet observable : si la condition `!isCorrect` du slot saute, ce
    // `queryByRole` trouverait l'étayage et le test échouerait.
    expect(
      screen.queryByRole("img", { name: strings.play.scaffold.label }),
    ).not.toBeInTheDocument();
  });

  it("l'étayage est rendu SOUS la révélation de la bonne réponse (ordre DOM)", () => {
    renderPanel({ phase: "retry", correctAnswer: 48, skill: "mult", operands: [6, 8] });
    const reveal = screen.getByText(strings.play.retry.answerReveal.replace("{n}", "48"));
    const scaffold = screen.getByRole("img", { name: strings.play.scaffold.label });
    // La révélation précède l'étayage dans l'ordre du document (WIREFRAMES §3d).
    expect(
      reveal.compareDocumentPosition(scaffold) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("FeedbackPanel — focus au montage (a11y, LEARNINGS #36)", () => {
  // À la transition question→feedback, le bouton de réponse démonte : le panneau doit
  // recevoir le focus pour ne pas laisser l'utilisateur clavier sur `<body>`. Effet
  // observable (échoue si le ref-callback / `tabIndex` saute).
  it("le panneau de feedback juste (correct) reçoit le focus", () => {
    renderPanel({ phase: "correct" });
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("le panneau de feedback re-essai (retry) reçoit le focus (slot monté n'y change rien)", () => {
    renderPanel({ phase: "retry" });
    // Le focus reste sur le conteneur `role="status"` malgré l'étayage monté dessous
    // (l'étayage n'ajoute aucun contrôle focusable — #38 non blocked-by).
    expect(screen.getByRole("status")).toHaveFocus();
  });
});
