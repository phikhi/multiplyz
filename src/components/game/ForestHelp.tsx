"use client";

import { useCallback, useState } from "react";
import type { LevelQuestion } from "@/lib/engine/service";
import { COMP10_TARGET } from "@/lib/engine/domain";
import { resolveAnswer } from "@/lib/game/answer";
import { formatEquation } from "@/lib/game/equation";
import { forest } from "@/strings/forest";

/** Same exact fact/operands as the engine. Exploration is optional; no answer in the initial label. */
export function ForestHelp({
  question,
  revealed,
  disabled,
  onReveal,
  onRetry,
}: {
  question: LevelQuestion;
  revealed: boolean;
  disabled: boolean;
  onReveal(): void;
  onRetry(): void;
}) {
  const [explored, setExplored] = useState(0);
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => node?.focus(), []);
  const [a, b = 0] = question.operands;
  const answer = resolveAnswer(question.factKey);
  const steps = question.skill === "comp10" ? COMP10_TARGET - a : question.skill === "mult" ? a : b;
  const max = question.skill === "add" ? a + b : a;
  const position = question.skill === "sub" ? a - explored : a + explored;
  return (
    <div className="forest-help">
      <p className="forest-kicker">{forest.help}</p>
      <h2 key={String(revealed)} tabIndex={-1} ref={focusHeading}>
        {forest.helpIntro}
      </h2>
      <p>{forest.helpLabels[question.skill]}</p>
      <div className="forest-scaffold" aria-label={forest.helpLabels[question.skill]}>
        {question.skill === "comp10" ? (
          <div className="forest-tenframe" aria-hidden="true">
            {Array.from({ length: COMP10_TARGET }, (_, i) => (
              <i key={i} data-filled={i < a} data-added={i >= a && i < a + explored} />
            ))}
          </div>
        ) : question.skill === "mult" ? (
          <div className="forest-matrix" aria-hidden="true">
            {Array.from({ length: a }, (_, row) => (
              <div key={row} data-lit={row < explored}>
                {Array.from({ length: b }, (_, col) => (
                  <i key={col} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="forest-line" aria-hidden="true">
            {Array.from({ length: max + 1 }, (_, n) => (
              <span
                key={n}
                data-visited={
                  question.skill === "sub" ? n <= a && n >= position : n >= a && n <= position
                }
                data-current={n === position}
              >
                {n}
              </span>
            ))}
          </div>
        )}
      </div>
      {revealed ? (
        <>
          <p className="forest-help-result" role="status">
            {formatEquation(question.skill, question.operands).replace("?", String(answer))}
          </p>
          <button className="forest-primary" disabled={disabled} onClick={onRetry}>
            {forest.retry}
          </button>
        </>
      ) : (
        <div className="forest-help-actions">
          <button
            className="forest-secondary"
            disabled={explored >= steps || disabled}
            onClick={() => setExplored((n) => Math.min(steps, n + 1))}
          >
            {forest.explore}
          </button>
          <button className="forest-primary" disabled={disabled} onClick={onReveal}>
            {forest.reveal}
          </button>
        </div>
      )}
    </div>
  );
}
