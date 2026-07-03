import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionCard } from "./QuestionCard";
import { strings } from "@/strings";
import type { LevelQuestion } from "@/lib/engine/service";

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
