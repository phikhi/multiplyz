"use client";

import { useCallback } from "react";
import { strings } from "@/strings";
import type { StarCount } from "@/lib/engine/stars";
import type { GrantedLegendary } from "@/lib/game/finish-level";

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
  /**
   * **Légendaire garantie** obtenue en battant le boss (MAP §6, story 5.6), ou `null` pour un
   * niveau non-boss (aucune carte légendaire affichée). Nom + histoire + réf d'art placeholder.
   */
  readonly legendary?: GrantedLegendary | null;
  readonly onContinue: () => void;
}

const FILLED_STAR = "★";
const EMPTY_STAR = "☆";
const STAR_SLOTS: readonly StarCount[] = [1, 2, 3];
/** Emoji décoratif de la silhouette placeholder de la légendaire (art réel = épic #6). */
const LEGENDARY_EMOJI = "🐾";

function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

/**
 * **Carte de la légendaire** révélée à l'écran de résultats du boss (MAP §6, COPY §3
 * « déblocage créature »). Silhouette placeholder (art réel épic #6) + nom + histoire. Le
 * nom + l'annonce sont **doublés d'un texte** (jamais la seule icône/couleur, a11y). Tokens
 * `--collection-*` (texte fiable ≥4.5:1 sur le fond de carte, jamais `--color-star` sur fond
 * neutre — rétro #126). L'ensemble est un `role="img"` au nom accessible explicite.
 */
function LegendaryReveal({ legendary }: { readonly legendary: GrantedLegendary }) {
  const label = fill(strings.play.results.legendaryLabel, "{nom}", legendary.name);
  return (
    <div
      role="img"
      aria-label={label}
      data-results-legendary={legendary.characterId}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-4)",
        maxWidth: "var(--max-width-play)",
        backgroundColor: "var(--collection-card-bg)",
        border: "1px solid var(--collection-card-border)",
        borderRadius: "var(--border-radius-lg)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "var(--space-8)",
          height: "var(--space-8)",
          borderRadius: "var(--border-radius-full)",
          backgroundColor: "var(--collection-placeholder-bg)",
          color: "var(--collection-placeholder-glyph)",
          fontSize: "var(--font-size-2xl)",
        }}
      >
        {LEGENDARY_EMOJI}
      </span>
      <p
        aria-hidden="true"
        style={{
          margin: 0,
          fontFamily: "var(--font-family-display)",
          fontSize: "var(--font-size-md)",
          fontWeight: "var(--font-weight-bold)",
          // Glyphe/texte de rareté = token TEXTE fiable (≥4.5:1 sur le fond de carte),
          // jamais --color-star sur fond neutre (rétro #126). ★ + « légendaire » (double a11y).
          color: "var(--collection-rarity-glyph)",
        }}
      >
        {`${FILLED_STAR} ${strings.play.results.legendaryTitle}`}
      </p>
      <p
        aria-hidden="true"
        style={{
          margin: 0,
          fontFamily: "var(--font-family-display)",
          fontSize: "var(--font-size-lg)",
          fontWeight: "var(--font-weight-bold)",
          color: "var(--collection-text)",
        }}
      >
        {legendary.name}
      </p>
      {legendary.story !== "" && (
        <p
          aria-hidden="true"
          style={{
            margin: 0,
            fontFamily: "var(--font-family-body)",
            fontSize: "var(--font-size-sm)",
            color: "var(--collection-text-muted)",
            textAlign: "center",
          }}
        >
          {legendary.story}
        </p>
      )}
    </div>
  );
}

export function ResultsScreen({ stars, coins, legendary = null, onContinue }: ResultsScreenProps) {
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

      {legendary !== null && <LegendaryReveal legendary={legendary} />}

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
