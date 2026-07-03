"use client";

import { useCallback } from "react";
import { strings } from "@/strings";
import { pickVariant } from "@/lib/game/copy-variant";
import type { QuestionPhase } from "@/lib/game/session";

/**
 * Feedback no-fail après une réponse (ENGINE §9, WIREFRAMES §3c/§3d, COPY §3).
 *
 * - `phase === "correct"` : feedback positif bref (variante Teddy), bouton continuer.
 * - `phase === "retry"` : posture croissance — **jamais** « faux »/« erreur » (règle
 *   CLAUDE.md/COPY §6) —, montre la bonne réponse, propose un re-essai.
 *
 * **A11y (LEARNINGS #36/#23)** : le feedback est **doublé d'une icône** (✓ / ↻), jamais
 * la seule couleur (daltonisme) — glyphes en constantes (aucun littéral JSX,
 * `react/jsx-no-literals`). Annoncé via `role="status"` (contenu éphémère critique) et
 * **reçoit le focus au montage** (ref-callback + `tabIndex={-1}`, même pattern approuvé
 * que `ResultsScreen`) : à la transition question→feedback le bouton de réponse démonte,
 * sans ce déplacement le focus retomberait sur `<body>` et perdrait l'utilisateur
 * clavier. Couleurs `--color-feedback-*` (bg + texte suivent **ensemble** le thème,
 * contraste préservé dans les 2 modes — distinct du cas « chip à couleur fixe » qui
 * exigerait un token de texte constant type `--color-on-warning`, cf. LEARNINGS #23).
 */
export interface FeedbackPanelProps {
  readonly phase: Exclude<QuestionPhase, "asking">;
  /** Bonne réponse du fait (affichée uniquement en re-essai, ENGINE §9). */
  readonly correctAnswer: number;
  /** Seed déterministe pour varier la formulation (ex. index de question, COPY §1). */
  readonly variantSeed: number;
  /** Continuer vers la question suivante (uniquement depuis `phase === "correct"`). */
  readonly onContinue: () => void;
  /** Relancer le re-essai (uniquement depuis `phase === "retry"`). */
  readonly onRetry: () => void;
}

function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

const CHECK_ICON = "✓";
const RETRY_ICON = "↻";

const primaryButtonStyle = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3) var(--space-6)",
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-inverse)",
  backgroundColor: "var(--color-accent-primary)",
  border: "none",
  borderRadius: "var(--border-radius-full)",
  cursor: "pointer",
} as const;

export function FeedbackPanel({
  phase,
  correctAnswer,
  variantSeed,
  onContinue,
  onRetry,
}: FeedbackPanelProps) {
  const isCorrect = phase === "correct";
  const variants = isCorrect ? strings.play.correct.variants : strings.play.retry.variants;
  const message = pickVariant(variants, variantSeed);

  // Ref-callback : déplace le focus sur le panneau de feedback dès son montage
  // (LEARNINGS #36 — évite la branche `current === null` non couverte d'un `useEffect`
  // + `?.`, et couvre les 2 branches montage/démontage). Réplique le pattern approuvé
  // de `ResultsScreen`.
  const focusOnMount = useCallback((node: HTMLDivElement | null) => {
    node?.focus();
  }, []);

  return (
    <div
      role="status"
      ref={focusOnMount}
      tabIndex={-1}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-5)",
        borderRadius: "var(--border-radius-lg)",
        backgroundColor: isCorrect
          ? "var(--color-feedback-correct-bg)"
          : "var(--color-feedback-retry-bg)",
        width: "100%",
        maxWidth: "var(--max-width-play)",
        textAlign: "center",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: "var(--font-size-2xl)",
          color: isCorrect ? "var(--color-feedback-correct)" : "var(--color-feedback-retry)",
        }}
      >
        {isCorrect ? CHECK_ICON : RETRY_ICON}
      </span>

      <p
        style={{
          fontFamily: "var(--font-family-body)",
          fontSize: "var(--font-size-lg)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--color-text-primary)",
          margin: 0,
        }}
      >
        {message}
      </p>

      {!isCorrect && (
        <p
          style={{
            fontFamily: "var(--font-family-numeric)",
            fontSize: "var(--font-size-xl)",
            fontWeight: "var(--font-weight-bold)",
            color: "var(--color-text-primary)",
            margin: 0,
          }}
        >
          {fill(strings.play.retry.answerReveal, "{n}", String(correctAnswer))}
        </p>
      )}

      <button type="button" onClick={isCorrect ? onContinue : onRetry} style={primaryButtonStyle}>
        {isCorrect ? strings.play.correct.next : strings.play.retry.tryAgain}
      </button>
    </div>
  );
}
