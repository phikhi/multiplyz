"use client";

import { useCallback } from "react";
import { strings } from "@/strings";
import type { StarCount } from "@/lib/engine/stars";

/**
 * Écran de résultats de fin de niveau (WIREFRAMES §4, ENGINE §5, ECONOMY §4.1, gains #126).
 * **Jamais d'écran d'échec** : le niveau se termine toujours, même à 0 étoile (ENGINE §5/§9,
 * PRODUCT §2.2 « No-fail »). Affiche : étoiles (1–3), **pièces gagnées** (tranchées serveur,
 * barème versionné), encouragement (voix de Teddy).
 *
 * A11y (CLAUDE.md) : le titre reçoit le **focus** au montage (LEARNINGS #36 : nouvelle étape →
 * focus déplacé, ref-callback pour couvrir les 2 branches du montage/démontage). Étoiles ET
 * pièces **doublées d'un libellé texte** (jamais la seule forme/icône, daltonisme). Les pièces
 * sont un `role="img"` au nom accessible explicite ; le nombre est **visible en texte** avec un
 * token texte à contraste garanti (`--color-text-primary` — jamais `--color-coin`/`--color-star`
 * qui échouent le contraste sur fond neutre, cf. tokens.css / rétro #104/#125). Les étoiles
 * utilisent de même `--results-star-filled`/`--results-star-empty` (tokens texte fiables,
 * jamais `--color-star`/`-empty`, mêmes accents décoratifs qui échouaient le contraste ici).
 */
export interface ResultsScreenProps {
  readonly stars: StarCount;
  /**
   * Pièces créditées ce niveau (**solde serveur**, source de vérité — barème versionné
   * ECONOMY §4.1). `null` = pas encore reçu du serveur (ou erreur réseau) → la ligne de
   * pièces n'est **pas** affichée (no-fail : les résultats s'affichent quand même). En
   * pratique le nombre affiché = les pièces **gagnées** ce niveau (le serveur renvoie le
   * gain ; l'écran présente « tu gagnes N pièces »).
   */
  readonly coins: number | null;
  readonly onContinue: () => void;
}

const FILLED_STAR = "★";
const EMPTY_STAR = "☆";
const STAR_SLOTS: readonly StarCount[] = [1, 2, 3];

function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

export function ResultsScreen({ stars, coins, onContinue }: ResultsScreenProps) {
  // Ref-callback : focus le titre dès qu'il est monté (LEARNINGS #36 — évite la
  // branche `current === null` non couverte d'un `useEffect` + `?.`).
  const focusOnMount = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);

  const starsLabel =
    stars === 1
      ? fill(strings.play.results.starsLabel, "{n}", String(stars))
      : fill(strings.play.results.starsLabelPlural, "{n}", String(stars));

  // Libellé pièces (singulier/pluriel) — sert **à la fois** de texte visible et de nom
  // accessible (`role="img"`). Doublage a11y : jamais la seule icône 🪙 (daltonisme).
  const coinsLabel =
    coins === null
      ? null
      : coins === 1
        ? fill(strings.play.results.coins, "{n}", String(coins))
        : fill(strings.play.results.coinsPlural, "{n}", String(coins));

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
              color: slot <= stars ? "var(--results-star-filled)" : "var(--results-star-empty)",
            }}
          >
            {slot <= stars ? FILLED_STAR : EMPTY_STAR}
          </span>
        ))}
      </div>

      {coinsLabel !== null && (
        <p
          role="img"
          aria-label={coinsLabel}
          data-results-coins={coins}
          style={{
            fontFamily: "var(--font-family-display)",
            fontSize: "var(--font-size-lg)",
            fontWeight: "var(--font-weight-bold)",
            // Token TEXTE à contraste garanti sur le fond de page neutre (≥4.5:1 les 2
            // thèmes) — jamais --color-coin/--color-star (accents décoratifs qui échouent
            // le contraste sur fond neutre, tokens.css / rétro #104/#125). L'icône 🪙 est
            // dans la chaîne (emoji, couleur native) — la lisibilité repose sur le TEXTE.
            color: "var(--color-text-primary)",
            margin: 0,
          }}
        >
          {coinsLabel}
        </p>
      )}

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
