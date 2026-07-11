import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionCard } from "./QuestionCard";
import { strings } from "@/strings";
import type { LevelQuestion } from "@/lib/engine/service";
import {
  contrastRatio,
  mixSrgb,
  resolveTokenColor,
} from "@/components/game/scaffolds/test-support/tokens-css";
import { mockPhone } from "@/lib/responsive/test-support/mock-phone";

/**
 * Contraste WCAG COMPOSITÉ (#226) : lit l'`opacity` RÉELLEMENT rendue sur `el` et calcule la
 * couleur **post-blend** effectivement peinte (`text` fondu vers `bg` selon l'opacité) avant de
 * mesurer le ratio contre `bg`. Reproduit le patron canonique de `ProfileManager.test.tsx` — un
 * token résolu ≥4.5:1 ne prouve RIEN dès qu'un `opacity` d'ancêtre/élément s'empile (CLAUDE.md
 * #226). ROUGIT si un `opacity` diluant est (ré)introduit : `mixSrgb(text, bg, opacity<1)` fait
 * tomber le contraste sous 4.5:1.
 */
function paintedContrast(el: HTMLElement, text: string, bg: string): number {
  const opacity = el.style.opacity === "" ? 1 : Number(el.style.opacity);
  const painted = opacity === 1 ? text : mixSrgb(text, bg, opacity);
  return contrastRatio(painted, bg);
}

function qcmQuestion(overrides: Partial<LevelQuestion> = {}): LevelQuestion {
  return {
    factKey: "mult_6x8",
    skill: "mult",
    operands: [6, 8],
    format: "qcm",
    choices: [42, 48, 54, 36],
    isReask: false,
    ...overrides,
  };
}

function paveQuestion(overrides: Partial<LevelQuestion> = {}): LevelQuestion {
  return {
    factKey: "add_7+5",
    skill: "add",
    operands: [7, 5],
    format: "pave",
    choices: null,
    isReask: false,
    ...overrides,
  };
}

describe("QuestionCard — format QCM", () => {
  it("affiche l'énoncé et une barre de progression annoncée", () => {
    render(
      <QuestionCard
        question={qcmQuestion()}
        questionNumber={4}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={vi.fn()}
      />,
    );
    expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", {
        name: strings.play.question.progress.replace("{n}", "4").replace("{total}", "10"),
      }),
    ).toBeInTheDocument();
  });

  it("affiche les 4 choix comme boutons nommés a11y", () => {
    render(
      <QuestionCard
        question={qcmQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={vi.fn()}
      />,
    );
    const group = screen.getByRole("group", { name: strings.play.question.choicesLabel });
    expect(group).toBeInTheDocument();
    for (const choice of [42, 48, 54, 36]) {
      expect(
        screen.getByRole("button", {
          name: strings.play.question.choiceOption.replace("{n}", String(choice)),
        }),
      ).toBeInTheDocument();
    }
  });

  it("clic sur un choix appelle onAnswer avec sa valeur", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={qcmQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={onAnswer}
        onDontKnow={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: strings.play.question.choiceOption.replace("{n}", "48") }),
    );
    expect(onAnswer).toHaveBeenCalledWith(48);
  });
});

describe("QuestionCard — format pavé", () => {
  it("affiche le pavé de saisie libre (pas de groupe QCM)", () => {
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={vi.fn()}
      />,
    );
    expect(screen.getByText("7 + 5 = ?")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: strings.play.question.inputLabel }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: strings.play.question.choicesLabel }),
    ).not.toBeInTheDocument();
  });

  it("saisit des chiffres puis valide → onAnswer avec la valeur numérique", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={onAnswer}
        onDontKnow={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", "1") }));
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", "2") }));
    fireEvent.click(screen.getByRole("button", { name: strings.play.question.submit }));
    expect(onAnswer).toHaveBeenCalledWith(12);
  });

  it("le bouton 0 fonctionne dans le pavé (dernier rang)", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={onAnswer}
        onDontKnow={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", "0") }));
    fireEvent.click(screen.getByRole("button", { name: strings.play.question.submit }));
    expect(onAnswer).toHaveBeenCalledWith(0);
  });

  it("efface le dernier chiffre saisi", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={onAnswer}
        onDontKnow={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", "1") }));
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", "2") }));
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.backspace }));
    fireEvent.click(screen.getByRole("button", { name: strings.play.question.submit }));
    expect(onAnswer).toHaveBeenCalledWith(1);
  });

  it("le bouton valider est désactivé et sans effet tant qu'aucun chiffre n'est saisi", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={onAnswer}
        onDontKnow={vi.fn()}
      />,
    );
    const submit = screen.getByRole("button", { name: strings.play.question.submit });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("le bouton valider affiche un glyphe compact ✓ tout en gardant le nom accessible « Valider »", () => {
    // Régression #164 : le texte « Valider » débordait la cellule carrée du pavé.
    // Le glyphe visible doit rester court ; le nom accessible vient de l'aria-label.
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={vi.fn()}
      />,
    );
    const submit = screen.getByRole("button", { name: strings.play.question.submit });
    expect(submit).toHaveTextContent("✓");
    expect(submit).not.toHaveTextContent(strings.play.question.submit);
  });

  it("ignore l'effacement quand la saisie est vide", () => {
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={vi.fn()}
      />,
    );
    // Ne doit pas jeter — l'effacement à vide est un no-op silencieux.
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.backspace }));
    expect(screen.getByRole("button", { name: strings.play.question.submit })).toBeDisabled();
  });

  it("plafonne la saisie à 4 chiffres (borne du pavé)", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={onAnswer}
        onDontKnow={vi.fn()}
      />,
    );
    for (const d of ["1", "2", "3", "4", "5"]) {
      fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", d) }));
    }
    fireEvent.click(screen.getByRole("button", { name: strings.play.question.submit }));
    expect(onAnswer).toHaveBeenCalledWith(1234);
  });

  it("vide la saisie après validation (question suivante repart de zéro)", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={onAnswer}
        onDontKnow={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", "9") }));
    fireEvent.click(screen.getByRole("button", { name: strings.play.question.submit }));
    expect(screen.getByRole("button", { name: strings.play.question.submit })).toBeDisabled();
  });
});

describe("QuestionCard — compléments à 10", () => {
  it("affiche l'énoncé à 1 opérande connu (jamais l'opérande comme inconnue)", () => {
    render(
      <QuestionCard
        question={qcmQuestion({
          factKey: "comp10_3",
          skill: "comp10",
          operands: [3],
          choices: [7, 3, 8, 6],
        })}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={vi.fn()}
      />,
    );
    expect(screen.getByText("3 + ? = 10")).toBeInTheDocument();
  });
});

describe("QuestionCard — « je ne sais pas »", () => {
  it("appelle onDontKnow (ENGINE §9, sans pénalité)", () => {
    const onDontKnow = vi.fn();
    render(
      <QuestionCard
        question={qcmQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={onDontKnow}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: strings.play.question.dontKnow }));
    expect(onDontKnow).toHaveBeenCalledTimes(1);
  });
});

describe("QuestionCard — responsive (story 8.1 #254, WIREFRAMES §8)", () => {
  it("pavé numérique : largeur bornée préservée tablette/desktop (défaut, pas de régression)", () => {
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={vi.fn()}
      />,
    );
    const group = screen.getByRole("group", { name: strings.play.question.inputLabel });
    const grid = group.querySelector("div");
    expect(grid).not.toBeNull();
    // Garde à effet observable : si la borne saute (retirée/mutée), la valeur redeviendrait "none"
    // même hors téléphone.
    expect((grid as HTMLElement).style.maxWidth).toBe("var(--space-12)");
  });

  it("pavé numérique : passe pleine largeur sous --bp-phone (WIREFRAMES §8)", () => {
    const restore = mockPhone(true);
    try {
      render(
        <QuestionCard
          question={paveQuestion()}
          questionNumber={1}
          totalQuestions={10}
          onAnswer={vi.fn()}
          onDontKnow={vi.fn()}
        />,
      );
      const group = screen.getByRole("group", { name: strings.play.question.inputLabel });
      const grid = group.querySelector("div");
      expect(grid).not.toBeNull();
      expect((grid as HTMLElement).style.maxWidth).toBe("none");
    } finally {
      restore();
    }
  });

  it("« je ne sais pas » : disposition actuelle préservée tablette/desktop (ActionBar transparente)", () => {
    render(
      <QuestionCard
        question={qcmQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: strings.play.question.dontKnow });
    expect(button.parentElement!.style.display).toBe("contents");
    expect(button.parentElement!.style.position).toBe("");
  });

  it("« je ne sais pas » : passe en barre d'action bas de zone pouce sous --bp-phone", () => {
    const restore = mockPhone(true);
    try {
      render(
        <QuestionCard
          question={qcmQuestion()}
          questionNumber={1}
          totalQuestions={10}
          onAnswer={vi.fn()}
          onDontKnow={vi.fn()}
        />,
      );
      const button = screen.getByRole("button", { name: strings.play.question.dontKnow });
      expect(button.parentElement!.style.position).toBe("fixed");
      expect(button.parentElement!.style.bottom).toBe("0px");
    } finally {
      restore();
    }
  });
});

describe("QuestionCard — pavé, contraste du glyphe Valider désactivé (extension #104/#170/#226, rétro #250)", () => {
  it("désactivé : AUCUNE dilution opacity, style plein-alpha (jamais opacity < 1)", () => {
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={vi.fn()}
      />,
    );
    const submit = screen.getByRole("button", { name: strings.play.question.submit });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-disabled", "true");
    // Garde à effet observable, ROBUSTE à TOUTE la classe #226 (pas seulement "0.5") : le glyphe
    // désactivé ne doit porter AUCUNE opacité diluante. jsdom applique `""` (propriété non posée)
    // ou "1" pour l'état plein-alpha — toute autre valeur ("0.5", "0.55", …) rougit.
    expect(["", "1"]).toContain(submit.style.opacity);
    expect(submit.style.cursor).toBe("not-allowed");
  });

  it("désactivé : contraste COMPOSITÉ ≥4.5:1 (light ET dark) — post-blend de l'opacity rendue (#226)", () => {
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={vi.fn()}
      />,
    );
    const submit = screen.getByRole("button", { name: strings.play.question.submit });
    expect(submit.style.backgroundColor).toBe("var(--keypad-key-bg)");
    expect(submit.style.color).toBe("var(--keypad-key-text)");
    for (const theme of ["light", "dark"] as const) {
      const bg = resolveTokenColor(theme, "keypad-key-bg");
      const text = resolveTokenColor(theme, "keypad-key-text");
      // Contraste POST-BLEND (lit l'opacity rendue) : ROUGIT si un `opacity` diluant (ex. 0.55,
      // valeur canonique #226) est réintroduit sur le glyphe désactivé — pas seulement la paire
      // de tokens à pleine opacité (test vacuous #226). Vérifié en réintroduisant 0.55 → RED.
      expect(paintedContrast(submit, text, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("actif (chiffres saisis) : traitement accent plein (violet + texte inverse), toujours plein-alpha", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={paveQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={onAnswer}
        onDontKnow={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", "1") }));
    const submit = screen.getByRole("button", { name: strings.play.question.submit });
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveAttribute("aria-disabled", "false");
    expect(submit.style.backgroundColor).toBe("var(--color-accent-primary)");
    expect(submit.style.color).toBe("var(--color-text-inverse)");
    expect(["", "1"]).toContain(submit.style.opacity); // jamais d'opacity diluante (classe #226)
  });
});

describe("QuestionCard — « je ne sais pas », contraste sur le nouveau fond ActionBar (audit #126, story 8.1)", () => {
  // Story 8.1 déplace ce bouton (fond transparent, texte --color-text-secondary) dans
  // l'ActionBar (fond --color-bg-secondary sur téléphone) — écran TOUCHÉ par la story, audit
  // obligatoire de TOUS les glyphes rendus (#126/#250), pas seulement les nouveaux.
  it("contraste RÉSOLU ≥4.5:1 (light ET dark) sur le fond réel de l'ActionBar", () => {
    render(
      <QuestionCard
        question={qcmQuestion()}
        questionNumber={1}
        totalQuestions={10}
        onAnswer={vi.fn()}
        onDontKnow={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: strings.play.question.dontKnow });
    expect(button.style.backgroundColor).toBe("transparent");
    expect(button.style.color).toBe("var(--color-text-secondary)");
    for (const theme of ["light", "dark"] as const) {
      const text = resolveTokenColor(theme, "color-text-secondary");
      // fond réel de l'ActionBar téléphone (le bouton est transparent, le fond peint = celui
      // de la barre) — cf. `--color-bg-secondary` dans `ActionBar.tsx`.
      const bg = resolveTokenColor(theme, "color-bg-secondary");
      // Contraste COMPOSITÉ (#226) : robuste si une opacity diluante était un jour posée sur ce
      // bouton — le bouton est plein-alpha aujourd'hui (paintedContrast === contraste direct).
      expect(paintedContrast(button, text, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
