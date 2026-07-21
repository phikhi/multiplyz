import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeedbackPanel, type FeedbackPanelProps } from "./FeedbackPanel";
import { strings } from "@/strings";
import { mockPhone } from "@/lib/responsive/test-support/mock-phone";

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

describe("FeedbackPanel — slot d'étayage visuel (épic #4, WIREFRAMES §3d, issue #100)", () => {
  // L'étayage est un conteneur `role="img"` labellisé (VisualScaffold), présenté EN
  // PREMIER en re-essai (au-dessus de la révélation numérique — ordre inversé issue #100,
  // ADR 0007). Effet observable : ces tests échouent si le montage conditionnel du slot
  // est muté (retry → correct) OU si l'ordre DOM est remis à l'ancien (révélation d'abord).
  // `mult` → matrice (story #96) : libellé spécifique « 6 paquets de 8 », plus le
  // générique (câblé depuis #96, cf. VisualScaffold.tsx SCAFFOLD_BY_SKILL.mult).
  const matrixLabel = strings.play.scaffold.matrix.label.replace("{a}", "6").replace("{b}", "8");

  it("monte l'étayage en re-essai (au-dessus de la révélation de réponse)", () => {
    renderPanel({ phase: "retry", skill: "mult", operands: [6, 8] });
    expect(screen.getByRole("img", { name: matrixLabel })).toBeInTheDocument();
  });

  it("NE monte PAS l'étayage en feedback juste (correct)", () => {
    renderPanel({ phase: "correct", skill: "mult", operands: [6, 8] });
    // Garde à effet observable : si la condition `!isCorrect` du slot saute, ce
    // `queryByRole` trouverait l'étayage et le test échouerait.
    expect(screen.queryByRole("img", { name: matrixLabel })).not.toBeInTheDocument();
  });

  it("l'étayage est rendu AU-DESSUS de la révélation de la bonne réponse (ordre DOM, issue #100)", () => {
    renderPanel({ phase: "retry", correctAnswer: 48, skill: "mult", operands: [6, 8] });
    const reveal = screen.getByText(strings.play.retry.answerReveal.replace("{n}", "48"));
    const scaffold = screen.getByRole("img", { name: matrixLabel });
    // Ordre inversé (issue #100, ADR 0007, WIREFRAMES §3d) : l'étayage-découverte PRÉCÈDE
    // la révélation numérique en synthèse. Effet observable — ce test échoue si l'ordre
    // DOM est remis à l'ancien (révélation avant étayage) : `DOCUMENT_POSITION_FOLLOWING`
    // n'est vrai que si `reveal` suit `scaffold` dans le document.
    expect(
      scaffold.compareDocumentPosition(reveal) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // No-fail : la bonne réponse reste TOUJOURS présente (jamais retirée, juste déplacée).
    expect(reveal).toBeInTheDocument();
  });
});

describe("FeedbackPanel — Teddy réagit (story R2.2, #360, ART §2)", () => {
  // Effet observable du MAPPING expression→écran : `content` (joie) sur le feedback juste,
  // `neutre` (calme) sur le « pas encore ». ROUGIT si le mapping est muté (ex. `neutre` en juste,
  // ou le sprite TRISTE `oups` en re-essai — interdit par la posture croissance no-fail).
  it("feedback JUSTE → Teddy `content` (joie), alt consommé", () => {
    renderPanel({ phase: "correct" });
    const teddy = screen.getByRole("img", { name: strings.play.correct.teddyAlt });
    expect(teddy.tagName).toBe("IMG");
    expect(teddy).toHaveAttribute("src", "/generated/socle/teddy/content.png");
    expect(teddy).toHaveAttribute("data-asset", "teddy-feedback");
  });

  it("re-essai « pas encore » → Teddy `neutre` (JAMAIS le sprite triste `oups`), alt consommé", () => {
    renderPanel({ phase: "retry" });
    const teddy = screen.getByRole("img", { name: strings.play.retry.teddyAlt });
    expect(teddy.tagName).toBe("IMG");
    // Garde no-fail : `neutre`, jamais `oups` (visage triste culpabilisant, CLAUDE.md/COPY §6).
    expect(teddy).toHaveAttribute("src", "/generated/socle/teddy/neutre.png");
    expect(teddy.getAttribute("src")).not.toContain("oups");
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

describe("FeedbackPanel — responsive (story 8.1 #254, WIREFRAMES §8)", () => {
  it("bouton primaire : disposition actuelle préservée tablette/desktop (ActionBar transparente)", () => {
    renderPanel({ phase: "correct" });
    const button = screen.getByRole("button", { name: strings.play.correct.next });
    expect(button.parentElement!.style.display).toBe("contents");
    expect(button.parentElement!.style.position).toBe("");
  });

  it("bouton primaire : passe en barre d'action bas de zone pouce sous --bp-phone", () => {
    const restore = mockPhone(true);
    try {
      renderPanel({ phase: "retry" });
      const button = screen.getByRole("button", { name: strings.play.retry.tryAgain });
      expect(button.parentElement!.style.position).toBe("fixed");
      expect(button.parentElement!.style.bottom).toBe("0px");
    } finally {
      restore();
    }
  });

  it("reste un enfant du panneau role=status déjà focalisé (aucune restructuration DOM)", () => {
    const restore = mockPhone(true);
    try {
      renderPanel({ phase: "correct" });
      const status = screen.getByRole("status");
      const button = screen.getByRole("button", { name: strings.play.correct.next });
      expect(status).toContainElement(button);
      expect(status).toHaveFocus();
    } finally {
      restore();
    }
  });
});
