"use client";

import { useCallback } from "react";
import { strings } from "@/strings";
import type { StarCount } from "@/lib/engine/stars";
import type { GrantedLegendary } from "@/lib/game/finish-level";
import { useSound } from "@/lib/sound/SoundProvider";
import { AssetImage } from "@/components/media/AssetImage";
import { TEDDY_EXPRESSION_REF } from "@/config/teddy";

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
 *
 * **Son (story 8.4, #257, AC #1)** : SFX `"results"` au montage du titre (`<h1>`, ref-callback,
 * même nœud que `focusOnMount` — `ResultsScreen` ne monte RÉELLEMENT qu'une fois par niveau,
 * `PlayScreen` retraverse toujours `"loading"` entre 2 résultats, cf. commentaire du `key`
 * distinct côté `PlayScreen.tsx` — un ref-callback mount-only est donc le contrat CORRECT ici,
 * contrairement à `LegendaryReveal` ci-dessous).
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
/** Emoji du repli de la légendaire quand elle n'a pas encore d'art réel (`placeholder://`, R3.1). */
const LEGENDARY_EMOJI = "🐾";
/** Repli no-fail de l'avatar Teddy si le sprite n'est pas servi (story R2.2, #360). */
const TEDDY_FALLBACK = "🧸";

function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

/**
 * **Carte de la légendaire** révélée à l'écran de résultats du boss (MAP §6, COPY §3
 * « déblocage créature »). Illustration (`legendary.artRef` via `<AssetImage>`, story R2.1 #361 —
 * vrai art si rendable, repli emoji sinon) + nom + histoire. Le nom + l'annonce sont **doublés
 * d'un texte** (jamais la seule icône/couleur, a11y). Tokens
 * `--collection-*` (texte fiable ≥4.5:1 sur le fond de carte, jamais `--color-star` sur fond
 * neutre — rétro #126). L'ensemble est un `role="img"` au nom accessible explicite.
 *
 * **Son (story 8.4, #257, AC #1 « ouverture d'œuf »)** : SFX `"legendary"` au montage de CE
 * `<div>` racine. `legendary` arrive fréquemment APRÈS le 1er rendu de `ResultsScreen` (résolution
 * serveur async de `finishLevelAction`, fire-and-forget) : `ResultsScreen` réutilise alors le
 * MÊME `<h1>` (UPDATE, pas remount — cf. commentaire du son sur `ResultsScreen`), mais cette
 * sous-arborescence `LegendaryReveal` n'existe PAS tant que `legendary === null` (rendu
 * conditionnel `{legendary !== null && <LegendaryReveal .../>}`) → son APPARITION est un montage
 * RÉEL au sens React, que ce soit au tout 1er rendu (legendary déjà connu) ou plus tard (arrivée
 * async). Un ref-callback ici capture donc naturellement les 2 cas SANS jamais retomber dans le
 * STACK-TRAP #244 (élément mount-only réutilisé entre branches) : il n'y a rien à réutiliser, le
 * nœud n'existait simplement pas avant.
 */
function LegendaryReveal({ legendary }: { readonly legendary: GrantedLegendary }) {
  const { playSfx } = useSound();
  const playLegendarySfxOnMount = useCallback(
    (node: HTMLDivElement | null) => {
      if (node !== null) playSfx("legendary");
    },
    [playSfx],
  );
  const label = fill(strings.play.results.legendaryLabel, "{nom}", legendary.name);
  return (
    <div
      ref={playLegendarySfxOnMount}
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
      {/* Illustration de la légendaire (story R2.1, #361) : consomme `legendary.artRef` via le
          renderer guardé partagé `<AssetImage>`. `art_ref` rendable (`socle/creature/…`) → VRAI art ;
          `placeholder://…` (état par défaut, art réel = R3.1) → repli emoji dans le médaillon.
          **Décoratif** : le `<div role="img" aria-label>` parent porte déjà le nom accessible complet
          (« Créature légendaire gagnée : {nom} 🌟 ») → l'art est un doublon a11y (même a11y que
          l'ancien médaillon emoji `aria-hidden`). EN FLUX → même emplacement, aucune occlusion. */}
      <AssetImage
        assetRef={legendary.artRef}
        alt={legendary.name}
        decorative
        width="var(--space-8)"
        dataAsset="results-legendary-art"
        fallback={
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
        }
      />
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
  const { playSfx } = useSound();
  // Ref-callback : focus le titre dès qu'il est monté (LEARNINGS #36 — évite la
  // branche `current === null` non couverte d'un `useEffect` + `?.`) ET joue le SFX
  // `"results"` (story 8.4, #257 AC #1 — mount-only CORRECT ici, cf. JSDoc du composant).
  const focusAndPlayResultsSfxOnMount = useCallback(
    (node: HTMLHeadingElement | null) => {
      node?.focus();
      if (node !== null) playSfx("results");
    },
    [playSfx],
  );

  const starsLabel =
    stars === 1
      ? fill(strings.play.results.starsLabel, "{n}", String(stars))
      : fill(strings.play.results.starsLabelPlural, "{n}", String(stars));

  // Teddy célèbre (story R2.2, #360, ART §2 « sprites de réaction en jeu ») : `acclame` (bras
  // levés, éclat) à 3 étoiles, sinon `content` (fierté chaleureuse) — JAMAIS un visage triste
  // même à 0 étoile (no-fail, ENGINE §5 : « Bien joué, on avance ! »).
  const isCheer = stars === 3;
  const teddyRef = isCheer ? TEDDY_EXPRESSION_REF.acclame : TEDDY_EXPRESSION_REF.content;
  const teddyAlt = isCheer
    ? strings.play.results.teddyAltCheer
    : strings.play.results.teddyAltProud;

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
        ref={focusAndPlayResultsSfxOnMount}
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

      {/* Teddy célèbre EN FLUX (sous le titre, au-dessus des étoiles) — réserve son espace, ne
          recouvre rien (#278b, non-occlusion structurelle). Repli no-fail = 🧸 emoji. */}
      <AssetImage
        assetRef={teddyRef}
        alt={teddyAlt}
        width="var(--teddy-results-size)"
        dataAsset="teddy-results"
        fallback={
          <span aria-hidden="true" style={{ fontSize: "var(--font-size-3xl)" }}>
            {TEDDY_FALLBACK}
          </span>
        }
      />

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
