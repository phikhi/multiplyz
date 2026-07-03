"use client";

import { useState } from "react";
import { strings } from "@/strings";
import { formatEquation } from "@/lib/game/equation";
import type { LevelQuestion } from "@/lib/engine/service";

/**
 * Question de niveau (WIREFRAMES §3a « QCM » / §3b « pavé », ENGINE §6). Écran de jeu
 * **nu** (#64) : gros boutons, sans habillage visuel (étayages = épic #4).
 *
 * **Contrôlé** : ne connaît rien du jugement juste/faux (ça vit dans `gameReducer`,
 * `@/lib/game/session`) — se contente d'émettre la réponse choisie/saisie au parent.
 * Format déterminé **côté serveur** (`question.format`, ENGINE §6) — le composant ne
 * décide jamais du format, il l'affiche.
 *
 * A11y : cibles ≥ 44 px (`--tap-target-min`), boutons-réponses ≥ 72 px
 * (`--answer-min-size`), groupes nommés (`role="group"` + `aria-label`), « je ne sais
 * pas » toujours disponible (ENGINE §9, sans pénalité). Tokens uniquement.
 */
export interface QuestionCardProps {
  readonly question: LevelQuestion;
  readonly questionNumber: number;
  readonly totalQuestions: number;
  /** L'enfant a choisi/saisi `value` comme réponse. */
  readonly onAnswer: (value: number) => void;
  /** Bouton « je ne sais pas » (ENGINE §9 : indice sans pénalité, compté comme faux). */
  readonly onDontKnow: () => void;
}

function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

// Style tokens-only, réutilisé par les 2 formats (cible ≥ --answer-min-size, LEARNINGS a11y).
const choiceStyle = {
  minWidth: "var(--answer-min-size)",
  minHeight: "var(--answer-min-size)",
  padding: "var(--space-4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "var(--font-size-2xl)",
  fontWeight: "var(--font-weight-bold)",
  fontFamily: "var(--font-family-display)",
  color: "var(--answer-text)",
  backgroundColor: "var(--answer-bg)",
  border: "1px solid var(--answer-border)",
  borderRadius: "var(--answer-radius)",
  cursor: "pointer",
} as const;

const keypadKeyStyle = {
  minWidth: "var(--tap-target-min)",
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  fontFamily: "var(--font-family-display)",
  color: "var(--keypad-key-text)",
  backgroundColor: "var(--keypad-key-bg)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--keypad-key-radius)",
  cursor: "pointer",
} as const;

const BACKSPACE_GLYPH = "⌫";
const KEYPAD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const ZERO = "0";

/** Pavé numérique de saisie libre (ENGINE §6 : rappel, `box ≥ 2`). Non contrôlé en dehors du composant. */
function NumericInput({ onSubmit }: { onSubmit: (value: number) => void }) {
  const [digits, setDigits] = useState("");

  const press = (digit: string) => setDigits((prev) => (prev.length >= 4 ? prev : prev + digit));
  const backspace = () => setDigits((prev) => prev.slice(0, -1));
  // Pas de garde `digits.length === 0` ici : le bouton est `disabled` dans ce cas
  // (ci-dessous) → ce chemin n'est atteignable que par ce bouton, jamais vide au clic
  // (évite une branche défensive non couverte sous gate 100 %, LEARNINGS #75).
  const submit = () => {
    onSubmit(Number(digits));
    setDigits("");
  };

  return (
    <div role="group" aria-label={strings.play.question.inputLabel}>
      <p
        aria-live="polite"
        style={{
          fontFamily: "var(--font-family-display)",
          fontSize: "var(--font-size-2xl)",
          fontWeight: "var(--font-weight-bold)",
          color: "var(--color-text-primary)",
          textAlign: "center",
          minHeight: "var(--space-7)",
          margin: "0 0 var(--space-4) 0",
        }}
      >
        {digits}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "var(--space-3)",
          maxWidth: "var(--space-12)",
          margin: "0 auto",
        }}
      >
        {KEYPAD_DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            className="mz-focusable"
            aria-label={fill(strings.pinPad.digit, "{d}", digit)}
            onClick={() => press(digit)}
            style={keypadKeyStyle}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className="mz-focusable"
          aria-label={strings.pinPad.backspace}
          onClick={backspace}
          style={keypadKeyStyle}
        >
          {BACKSPACE_GLYPH}
        </button>
        <button
          type="button"
          className="mz-focusable"
          aria-label={fill(strings.pinPad.digit, "{d}", ZERO)}
          onClick={() => press(ZERO)}
          style={keypadKeyStyle}
        >
          {ZERO}
        </button>
        <button
          type="button"
          className="mz-focusable"
          onClick={submit}
          disabled={digits.length === 0}
          style={{
            ...keypadKeyStyle,
            backgroundColor: "var(--color-accent-primary)",
            color: "var(--color-text-inverse)",
            opacity: digits.length === 0 ? 0.5 : 1,
            cursor: digits.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          {strings.play.question.submit}
        </button>
      </div>
    </div>
  );
}

export function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  onAnswer,
  onDontKnow,
}: QuestionCardProps) {
  const equation = formatEquation(question.skill, question.operands);
  const progressLabel = fill(
    fill(strings.play.question.progress, "{n}", String(questionNumber)),
    "{total}",
    String(totalQuestions),
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-6)",
        width: "100%",
        // Largeur de la zone de jeu centrée (token dédié, cohérent avec
        // FeedbackPanel/ResultsScreen/PlayScreen) — pas un token d'espacement détourné.
        maxWidth: "var(--max-width-play)",
      }}
    >
      <div
        role="progressbar"
        aria-valuenow={questionNumber}
        aria-valuemin={1}
        aria-valuemax={totalQuestions}
        aria-label={progressLabel}
        style={{
          width: "100%",
          height: "var(--space-2)",
          borderRadius: "var(--border-radius-full)",
          backgroundColor: "var(--color-bg-tertiary)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${(questionNumber / totalQuestions) * 100}%`,
            height: "100%",
            backgroundColor: "var(--color-accent-primary)",
            borderRadius: "var(--border-radius-full)",
          }}
        />
      </div>

      <p
        style={{
          fontFamily: "var(--font-family-numeric)",
          fontSize: "var(--font-size-equation)",
          fontWeight: "var(--font-weight-bold)",
          color: "var(--color-text-primary)",
          margin: 0,
          textAlign: "center",
        }}
      >
        {equation}
      </p>

      {question.format === "qcm" && question.choices !== null ? (
        <div
          role="group"
          aria-label={strings.play.question.choicesLabel}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "var(--space-4)",
            width: "100%",
          }}
        >
          {question.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              className="mz-focusable"
              aria-label={fill(strings.play.question.choiceOption, "{n}", String(choice))}
              onClick={() => onAnswer(choice)}
              style={choiceStyle}
            >
              {choice}
            </button>
          ))}
        </div>
      ) : (
        <NumericInput onSubmit={onAnswer} />
      )}

      <button
        type="button"
        className="mz-focusable"
        onClick={onDontKnow}
        style={{
          minHeight: "var(--tap-target-min)",
          padding: "var(--space-2) var(--space-4)",
          fontFamily: "var(--font-family-body)",
          fontSize: "var(--font-size-base)",
          color: "var(--color-text-secondary)",
          backgroundColor: "transparent",
          border: "none",
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        {strings.play.question.dontKnow}
      </button>
    </div>
  );
}
