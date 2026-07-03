import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeedbackPanel } from "./FeedbackPanel";
import { strings } from "@/strings";

describe("FeedbackPanel — phase correct", () => {
  it("annonce une variante de la banque + bouton continuer", () => {
    render(
      <FeedbackPanel
        phase="correct"
        correctAnswer={48}
        variantSeed={0}
        onContinue={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(strings.play.correct.variants[0]);
    expect(screen.getByRole("button", { name: strings.play.correct.next })).toBeInTheDocument();
    // Pas de révélation de réponse sur un feedback juste (déjà trouvée par l'enfant).
    expect(screen.queryByText(/48/)).not.toBeInTheDocument();
  });

  it("clic sur continuer appelle onContinue", () => {
    const onContinue = vi.fn();
    render(
      <FeedbackPanel
        phase="correct"
        correctAnswer={48}
        variantSeed={0}
        onContinue={onContinue}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe("FeedbackPanel — phase retry (no-fail, ENGINE §9)", () => {
  it("montre la bonne réponse + une variante douce (jamais « faux »)", () => {
    render(
      <FeedbackPanel
        phase="retry"
        correctAnswer={48}
        variantSeed={0}
        onContinue={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(strings.play.retry.variants[0]);
    expect(
      screen.getByText(strings.play.retry.answerReveal.replace("{n}", "48")),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.play.retry.tryAgain })).toBeInTheDocument();
  });

  it("clic sur réessayer appelle onRetry (pas onContinue)", () => {
    const onRetry = vi.fn();
    const onContinue = vi.fn();
    render(
      <FeedbackPanel
        phase="retry"
        correctAnswer={9}
        variantSeed={2}
        onContinue={onContinue}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: strings.play.retry.tryAgain }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("varie le message selon variantSeed (COPY §1)", () => {
    const { rerender } = render(
      <FeedbackPanel
        phase="retry"
        correctAnswer={1}
        variantSeed={0}
        onContinue={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(strings.play.retry.variants[0]);

    rerender(
      <FeedbackPanel
        phase="retry"
        correctAnswer={1}
        variantSeed={1}
        onContinue={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(strings.play.retry.variants[1]);
  });
});

describe("FeedbackPanel — focus au montage (a11y, LEARNINGS #36)", () => {
  // À la transition question→feedback, le bouton de réponse démonte : le panneau doit
  // recevoir le focus pour ne pas laisser l'utilisateur clavier sur `<body>`. Effet
  // observable (échoue si le ref-callback / `tabIndex` saute).
  it("le panneau de feedback juste (correct) reçoit le focus", () => {
    render(
      <FeedbackPanel
        phase="correct"
        correctAnswer={48}
        variantSeed={0}
        onContinue={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("le panneau de feedback re-essai (retry) reçoit le focus", () => {
    render(
      <FeedbackPanel
        phase="retry"
        correctAnswer={48}
        variantSeed={0}
        onContinue={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveFocus();
  });
});
