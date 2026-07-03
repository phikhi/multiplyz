"use client";

import { strings } from "@/strings";
import { PIN_LENGTH } from "@/lib/auth/validation";

/**
 * Pavé PIN partagé (WIREFRAMES §1b) — gros boutons pour une saisie enfant.
 * **Composant contrôlé** : ne détient aucun état, `value` + `onChange` sont
 * portés par le parent (l'onboarding #2.2 ici, réutilisé par la connexion #2.3).
 *
 * A11y : cibles ≥ 44 px (`--tap-target-min`), état des pastilles **doublé d'un
 * libellé** (pas seulement la couleur — daltonisme), groupe nommé. Tokens
 * uniquement. Zéro texte en dur (glyphes = constantes, libellés = `strings`).
 */
export interface PinPadProps {
  /** Chiffres saisis (0 → PIN_LENGTH caractères). */
  value: string;
  /** Notifie le parent de la nouvelle valeur (ajout/effacement d'un chiffre). */
  onChange: (next: string) => void;
  /** Libellé accessible du groupe (annoncé par les lecteurs d'écran). */
  label: string;
}

// Glyphes en constantes (react/jsx-no-literals : aucun littéral rendu en JSX).
const DOT_FILLED = "●";
const DOT_EMPTY = "○";
const BACKSPACE_GLYPH = "⌫";
const ZERO = "0";
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/** Remplace un jeton `{x}` par sa valeur (micro-interpolation des gabarits). */
function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

// Style de touche = tokens composants dédiés au pavé numérique (tokens.css).
const keyStyle = {
  minWidth: "var(--tap-target-min)",
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "var(--font-size-2xl)",
  fontWeight: "var(--font-weight-bold)",
  borderRadius: "var(--keypad-key-radius)",
  border: "1px solid var(--color-border-primary)",
  backgroundColor: "var(--keypad-key-bg)",
  color: "var(--keypad-key-text)",
  cursor: "pointer",
  fontFamily: "var(--font-family-display)",
} as const;

export function PinPad({ value, onChange, label }: PinPadProps) {
  const pressDigit = (digit: string) => {
    if (value.length >= PIN_LENGTH) return; // pavé plein : on ignore
    onChange(value + digit);
  };

  const pressBackspace = () => {
    if (value.length === 0) return; // rien à effacer
    onChange(value.slice(0, -1));
  };

  return (
    <div role="group" aria-label={label}>
      {/* Pastilles de progression — état doublé d'un libellé (a11y daltonisme). */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "var(--space-3)",
          marginBottom: "var(--space-5)",
        }}
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => {
          const filled = index < value.length;
          const position = String(index + 1);
          const dotLabel = filled
            ? fill(strings.pinPad.dotFilled, "{n}", position)
            : fill(strings.pinPad.dotEmpty, "{n}", position);
          return (
            <span
              key={index}
              role="img"
              aria-label={dotLabel}
              style={{
                fontSize: "var(--font-size-xl)",
                color: filled ? "var(--color-accent-primary)" : "var(--color-text-secondary)",
              }}
            >
              {filled ? DOT_FILLED : DOT_EMPTY}
            </span>
          );
        })}
      </div>

      {/* Clavier — grille 3 colonnes, dernier rang : vide · 0 · effacer. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "var(--space-3)",
          maxWidth: "var(--space-12)",
          margin: "0 auto",
        }}
      >
        {DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            className="mz-focusable"
            aria-label={fill(strings.pinPad.digit, "{d}", digit)}
            onClick={() => pressDigit(digit)}
            style={keyStyle}
          >
            {digit}
          </button>
        ))}
        {/* Cellule vide (aligne le 0 au centre, cf. wireframe). */}
        <span aria-hidden="true" />
        <button
          type="button"
          className="mz-focusable"
          aria-label={fill(strings.pinPad.digit, "{d}", ZERO)}
          onClick={() => pressDigit(ZERO)}
          style={keyStyle}
        >
          {ZERO}
        </button>
        <button
          type="button"
          className="mz-focusable"
          aria-label={strings.pinPad.backspace}
          onClick={pressBackspace}
          style={keyStyle}
        >
          {BACKSPACE_GLYPH}
        </button>
      </div>
    </div>
  );
}
