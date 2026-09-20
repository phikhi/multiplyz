import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ForestHelp } from "./ForestHelp";
import type { LevelQuestion } from "@/lib/engine/service";
import { contrastRatio, resolveTokenColor } from "./scaffolds/test-support/tokens-css";
const questions: LevelQuestion[] = [
  {
    factKey: "comp10_3",
    skill: "comp10",
    operands: [3],
    format: "qcm",
    choices: null,
    isReask: false,
  },
  {
    factKey: "add_3+4",
    skill: "add",
    operands: [3, 4],
    format: "qcm",
    choices: null,
    isReask: false,
  },
  {
    factKey: "sub_9-4",
    skill: "sub",
    operands: [9, 4],
    format: "qcm",
    choices: null,
    isReask: false,
  },
  {
    factKey: "mult_3x4",
    skill: "mult",
    operands: [3, 4],
    format: "qcm",
    choices: null,
    isReask: false,
  },
];
describe("forest scaffolds", () => {
  it.each(questions)(
    "represents $skill exactly, without premature numeric synthesis",
    (question) => {
      const onReveal = vi.fn();
      const onRetry = vi.fn();
      const { container, rerender } = render(
        <ForestHelp
          question={question}
          revealed={false}
          disabled={false}
          onReveal={onReveal}
          onRetry={onRetry}
        />,
      );
      expect(container.querySelector(".forest-help-result")).toBeNull();
      if (question.skill === "comp10") {
        expect(container.querySelectorAll(".forest-tenframe i")).toHaveLength(10);
        expect(container.querySelectorAll('[data-filled="true"]')).toHaveLength(3);
      }
      if (question.skill === "mult") {
        expect(container.querySelectorAll(".forest-matrix>div")).toHaveLength(3);
        expect(container.querySelectorAll(".forest-matrix i")).toHaveLength(12);
      }
      if (question.skill === "add" || question.skill === "sub") {
        expect(container.querySelector('[data-current="true"]')).toHaveTextContent(
          String(question.operands[0]),
        );
      }
      const explore = screen.getByRole("button", { name: "Éclairer la suite" });
      explore.focus();
      fireEvent.click(explore);
      expect(explore).toHaveFocus();
      if (question.skill === "sub")
        expect(container.querySelector('[data-current="true"]')).toHaveTextContent("8");
      if (question.skill === "add")
        expect(container.querySelector('[data-current="true"]')).toHaveTextContent("4");
      fireEvent.click(screen.getByRole("button", { name: "Voir le résultat" }));
      expect(onReveal).toHaveBeenCalledOnce();
      rerender(
        <ForestHelp
          question={question}
          revealed
          disabled={false}
          onReveal={onReveal}
          onRetry={onRetry}
        />,
      );
      expect(container.querySelector(".forest-help-result")).not.toHaveTextContent("?");
      expect(container.querySelector("h2")).toHaveFocus();
      fireEvent.click(screen.getByRole("button", { name: "Je réessaie" }));
      expect(onRetry).toHaveBeenCalledOnce();
    },
  );
  it.each(["--forest-ink", "--forest-muted", "--forest-star", "--forest-dot", "--forest-added"])(
    "%s on the actual opaque reading surface >= 4.5:1",
    (token) => {
      expect(
        contrastRatio(
          resolveTokenColor("light", token),
          resolveTokenColor("light", "--forest-cream"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
  it("input and frame borders have >= 3:1 on their painted background", () => {
    expect(
      contrastRatio(
        resolveTokenColor("light", "--forest-line"),
        resolveTokenColor("light", "--forest-cream"),
      ),
    ).toBeGreaterThanOrEqual(3);
  });
});
