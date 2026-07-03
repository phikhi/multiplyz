"use client";

import { useCallback } from "react";
import { strings } from "@/strings";
import type { StarCount } from "@/lib/engine/stars";

/**
 * Écran de résultats de fin de niveau (WIREFRAMES §4, ENGINE §5). **Minimal** —
 * récompenses économiques (pièces/œufs) = hors scope (épic #5, story #64 ne les
 * implémente pas). **Jamais d'écran d'échec** : le niveau se termine toujours, même à
 * 0 étoile (ENGINE §5/§9, PRODUCT §5 « No-fail »).
 *
 * A11y : le titre reçoit le **focus** au montage (LEARNINGS #36 : nouvelle étape →
 * focus déplacé, ref-callback pour couvrir les 2 branches du montage/démontage).
 * Étoiles doublées d'un libellé texte (jamais la seule forme visuelle, daltonisme).
 */
export interface ResultsScreenProps {
  readonly stars: StarCount;
  readonly onContinue: () => void;
}

const FILLED_STAR = "★";
const EMPTY_STAR = "☆";
const STAR_SLOTS: readonly StarCount[] = [1, 2, 3];

function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

export function ResultsScreen({ stars, onContinue }: ResultsScreenProps) {
  // Ref-callback : focus le titre dès qu'il est monté (LEARNINGS #36 — évite la
  // branche `current === null` non couverte d'un `useEffect` + `?.`).
  const focusOnMount = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);

  const starsLabel =
    stars === 1
      ? fill(strings.play.results.starsLabel, "{n}", String(stars))
      : fill(strings.play.results.starsLabelPlural, "{n}", String(stars));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-5)",
        padding: "var(--space-6)",
        textAlign: "center",
      }}
    >
      <h1
        ref={focusOnMount}
        tabIndex={-1}
        style={{
          fontFamily: "var(--font-family-display)",
          fontSize: "var(--font-size-xl)",
          fontWeight: "var(--font-weight-bold)",
          color: "var(--color-text-primary)",
          margin: 0,
        }}
      >
        {strings.play.results.title}
      </h1>

      <div role="img" aria-label={starsLabel} style={{ display: "flex", gap: "var(--space-2)" }}>
        {STAR_SLOTS.map((slot) => (
          <span
            key={slot}
            aria-hidden="true"
            style={{
              fontSize: "var(--font-size-3xl)",
              color: slot <= stars ? "var(--color-star)" : "var(--color-star-empty)",
            }}
          >
            {slot <= stars ? FILLED_STAR : EMPTY_STAR}
          </span>
        ))}
      </div>

      <p
        style={{
          fontFamily: "var(--font-family-body)",
          fontSize: "var(--font-size-md)",
          color: "var(--color-text-secondary)",
          margin: 0,
        }}
      >
        {strings.play.results.byStars[stars]}
      </p>

      <button
        type="button"
        className="mz-focusable"
        onClick={onContinue}
        style={{
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
        }}
      >
        {strings.play.results.continue}
      </button>
    </div>
  );
}
