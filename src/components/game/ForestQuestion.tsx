"use client";

import { useEffect, useRef, useState } from "react";
import type { LevelQuestion } from "@/lib/engine/service";
import { formatEquation } from "@/lib/game/equation";
import { forest } from "@/strings/forest";

export interface ForestQuestionProps {
  question: LevelQuestion;
  draftKey: string;
  paused: boolean;
  disabled: boolean;
  retrying: boolean;
  onAnswer(value: number | null, responseMs: number): void;
}

export function ForestQuestion({
  question,
  draftKey,
  paused,
  disabled,
  retrying,
  onAnswer,
}: ForestQuestionProps) {
  const [digits, setDigits] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) ?? "null")?.digits ?? "";
    } catch {
      return "";
    }
  });
  const elapsed = useRef(0);
  const started = useRef<number | null>(null);
  const latestDigits = useRef(digits);
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      elapsed.current = JSON.parse(localStorage.getItem(draftKey) ?? "null")?.elapsed ?? 0;
    } catch {
      /* optional draft */
    }
    if (input.current) input.current.focus();
    else heading.current?.focus();
  }, [draftKey]);
  useEffect(() => {
    const save = () => {
      if (started.current !== null) {
        elapsed.current += performance.now() - started.current;
        started.current = performance.now();
      }
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ digits: latestDigits.current, elapsed: elapsed.current }),
        );
      } catch {
        /* server checkpoint remains authoritative */
      }
    };
    const visibility = () => {
      save();
      started.current = !document.hidden && !paused && !disabled ? performance.now() : null;
    };
    visibility();
    const tick = setInterval(save, 1000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      started.current = null;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", save);
    };
  }, [paused, disabled, draftKey]);

  function change(value: string) {
    const next = value.replace(/\D/g, "").slice(0, 4);
    latestDigits.current = next;
    setDigits(next);
    try {
      localStorage.setItem(draftKey, JSON.stringify({ digits: next, elapsed: elapsed.current }));
    } catch {
      /* optional draft */
    }
  }
  function answer(value: number | null) {
    if (disabled || paused) return;
    const ms =
      elapsed.current + (started.current === null ? 0 : performance.now() - started.current);
    onAnswer(value, Math.min(86_400_000, Math.max(0, Math.round(ms))));
  }
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (paused || disabled || event.repeat || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if ((event.target as HTMLElement)?.matches("input, textarea, [contenteditable=true]")) return;
      if (question.format === "qcm" && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        const choice = question.choices?.[Number(event.key) - 1];
        if (choice !== undefined) answer(choice);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  return (
    <div className="forest-question">
      <p className="forest-kicker">{retrying ? forest.again : forest.question}</p>
      <h2 ref={heading} tabIndex={-1} className="forest-equation">
        {formatEquation(question.skill, question.operands)}
      </h2>
      {question.format === "qcm" ? (
        <div className="forest-answers" role="group" aria-label={forest.answerLabel}>
          {question.choices?.map((value, index) => (
            <button key={index} disabled={disabled || paused} onClick={() => answer(value)}>
              <kbd aria-hidden="true">{index + 1}</kbd>
              {value}
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (digits !== "") answer(Number(digits));
          }}
        >
          <div className="forest-input-row">
            <input
              ref={input}
              aria-label={forest.answerLabel}
              inputMode="numeric"
              autoComplete="off"
              value={digits}
              onChange={(event) => change(event.target.value)}
              disabled={paused || disabled}
            />
            <button className="forest-primary" disabled={paused || disabled || digits === ""}>
              {forest.submit}
            </button>
          </div>
          <div className="forest-keypad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit) => (
              <button
                type="button"
                key={digit}
                disabled={disabled || paused}
                onClick={() => change(digits + digit)}
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              aria-label={forest.backspace}
              disabled={disabled || paused}
              onClick={() => change(digits.slice(0, -1))}
            >
              {"⌫"}
            </button>
            <button
              type="button"
              aria-label={forest.clear}
              disabled={disabled || paused}
              onClick={() => change("")}
            >
              {"C"}
            </button>
          </div>
        </form>
      )}
      <button
        className="forest-help-link"
        disabled={disabled || paused}
        onClick={() => answer(null)}
      >
        {forest.help}
      </button>
    </div>
  );
}
