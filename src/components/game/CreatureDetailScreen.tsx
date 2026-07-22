"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { strings } from "@/strings";
import { AssetImage } from "@/components/media/AssetImage";
import { RarityBadge, RenameForm } from "@/components/game/CollectionScreen";
import type { CollectionEntry } from "@/lib/game/collection";

/**
 * **Fiche créature** (détail + histoire, story R3.2 #379, WIREFRAMES §5b) — accessible depuis une
 * carte de la Collection (tap → fiche, `CollectionScreen`). Reçoit l'entrée **déjà composée +
 * gardée en propriété côté serveur** (`loadCollectionEntry`, route `/collection/[id]`) : aucun
 * fetch client ici (à la différence de `CollectionScreen`), le serveur a déjà résolu + vérifié
 * l'appartenance avant de monter cet écran (server component `page.tsx`, redirect sinon).
 *
 * Affiche : **art EN GRAND** (le payoff, #180 — note R3.1 « vignettes créatures petites en
 * collection, R3.2 fiche montre l'art en grand »), **nom** (renommage réutilisant `RenameForm`
 * de `CollectionScreen` telle quelle — même logique, aucune duplication), **rareté**
 * (`RarityBadge` réutilisé, même badge que la grille — cohérence visuelle inter-écrans plutôt que
 * le comptage d'étoiles brut du wireframe lo-fi), **stade d'évolution** (roadmap statique
 * bébé▸ado▸adulte, **affichage seul** — la dépense d'évolution `✨40 [Faire évoluer]` du wireframe
 * est **R4.4, hors scope** : omise plutôt que posée non-fonctionnelle) et **histoire** (`« … »`).
 *
 * **SCOPE BOUNDARY (R4.4)** : aucune logique d'évolution-DÉPENSE ici. `entry.maxStage` sert
 * uniquement à distinguer, dans la roadmap, un stade **hors de portée pour cette espèce**
 * (`> maxStage`, aujourd'hui toujours vrai au-delà du stade 1) d'un stade simplement pas encore
 * atteint par le joueur — aucun bouton, aucune écriture.
 */

/** Emoji décoratif du repli quand la créature n'a pas encore d'art réel (`placeholder://`). */
const PLACEHOLDER_EMOJI = "🐾";
/** Emoji décoratif du bouton renommer (doublé du libellé texte « Renommer »). */
const RENAME_EMOJI = "✏️";
// Glyphes décoratifs (aria-hidden) — react/jsx-no-literals : aucun littéral rendu en JSX, même
// patron que le reste de l'app (AppShell/ProfileSelector/PinPad…) : constante référencée via {}.
/** Flèche retour décorative (doublée du texte visible `strings.creatureDetail.back`). */
const BACK_ARROW = "←";
/** Séparateur visuel entre 2 pips de stade (roadmap `bébé ▸ ado ▸ adulte`, WIREFRAMES §5b). */
const STAGE_SEPARATOR = "▸";

function fill(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, value),
    template,
  );
}

/** Silhouette de repli EN GRAND (même langage visuel que `CreaturePlaceholder` de la grille). */
function CreatureDetailPlaceholder() {
  return (
    <span
      aria-hidden="true"
      data-creature-detail-placeholder=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "var(--creature-detail-art-size)",
        height: "var(--creature-detail-art-size)",
        flexShrink: 0,
        borderRadius: "var(--border-radius-full)",
        backgroundColor: "var(--collection-placeholder-bg)",
        color: "var(--collection-placeholder-glyph)",
        fontSize: "var(--font-size-2xl)",
      }}
    >
      {PLACEHOLDER_EMOJI}
    </span>
  );
}

/** Les 3 stades d'évolution (ECONOMY §2/§4.4 : 1=bébé / 2=ado / 3=adulte). */
const STAGE_NUMBERS = [1, 2, 3] as const;

function stageLabel(stage: number): string {
  if (stage === 1) return strings.creatureDetail.stageBaby;
  if (stage === 2) return strings.creatureDetail.stageTeen;
  return strings.creatureDetail.stageAdult;
}

/**
 * Sentence accessible COMPLÈTE du bloc stade (une seule annonce lecteur d'écran, plutôt que 3
 * pips séparés) : « Stade : bébé (actuel), ado (pas encore), adulte (pas encore) ». Pure —
 * testable indépendamment du rendu.
 */
export function stageAccessibleLabel(stage: number, maxStage: number): string {
  const parts = STAGE_NUMBERS.map((s) => {
    const label = stageLabel(s);
    if (s === stage) return `${label} (${strings.creatureDetail.stageCurrentSuffix})`;
    if (s > maxStage) return `${label} (${strings.creatureDetail.stageLockedSuffix})`;
    return label;
  });
  return `${strings.creatureDetail.stagePrefix} : ${parts.join(", ")}`;
}

/**
 * Roadmap statique du stade d'évolution (WIREFRAMES §5b « bébé ▸ [ado] ▸ adulte »), **affichage
 * seul** (R4.4 câblera la dépense). Chaque pip double glyphe (●/○/🔒) ET texte (crochets pour le
 * stade actuel, suffixe pour un stade hors de portée) — jamais la seule couleur (a11y
 * daltonisme). Le rôle visuel est `aria-hidden` : la sentence complète (`stageAccessibleLabel`)
 * porte le nom accessible du bloc entier, évitant une annonce fragmentée pip par pip.
 */
function StageIndicator({
  stage,
  maxStage,
}: {
  readonly stage: number;
  readonly maxStage: number;
}) {
  return (
    <p
      data-creature-stage=""
      aria-label={stageAccessibleLabel(stage, maxStage)}
      style={{
        margin: 0,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-1)",
        fontFamily: "var(--font-family-body)",
        fontSize: "var(--font-size-sm)",
        color: "var(--collection-text-muted)",
      }}
    >
      {/* Gabarit littéral (TemplateLiteral, pas un Literal brut) → react/jsx-no-literals OK,
          même patron que le bouton renommer de CollectionScreen (`{`${RENAME_EMOJI} …`}`). */}
      <span aria-hidden="true">{`${strings.creatureDetail.stagePrefix} :`}</span>
      {STAGE_NUMBERS.map((s, i) => {
        const locked = s > maxStage;
        const isCurrent = s === stage;
        const label = stageLabel(s);
        const glyph = locked ? "🔒" : s <= stage ? "●" : "○";
        const text = isCurrent
          ? `[${label}]`
          : locked
            ? `${label} (${strings.creatureDetail.stageLockedSuffix})`
            : label;
        return (
          <span
            key={s}
            aria-hidden="true"
            data-creature-stage-pip={s}
            style={{
              color: locked ? "var(--collection-text-muted)" : "var(--collection-text)",
              fontWeight: isCurrent ? "var(--font-weight-bold)" : "var(--font-weight-normal)",
            }}
          >
            {`${i > 0 ? `${STAGE_SEPARATOR} ` : ""}${glyph} ${text}`}
          </span>
        );
      })}
    </p>
  );
}

/** Écran de la fiche créature — orchestrateur client (renommage local, reste en lecture seule). */
export function CreatureDetailScreen({ entry: initialEntry }: { readonly entry: CollectionEntry }) {
  const [entry, setEntry] = useState(initialEntry);
  const [isRenaming, setIsRenaming] = useState(false);

  const onStartRename = useCallback(() => setIsRenaming(true), []);
  const onCancel = useCallback(() => setIsRenaming(false), []);
  const onSaved = useCallback((_characterId: string, nickname: string) => {
    setIsRenaming(false);
    setEntry((prev) => ({ ...prev, nickname, displayName: nickname }));
  }, []);

  return (
    <main
      className="bg-bg text-text"
      style={{
        // Shell persistant EN FLUX au-dessus (story R1.1 #337, `(app)/layout.tsx`) : réserve sa
        // propre hauteur (`--app-shell-height`) hors de ce `<main>` — jamais `100dvh` brut.
        minHeight: "calc(100dvh - var(--app-shell-height))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        // `justifyContent: center` → le mou vertical (fiche courte, art dominant) se répartit
        // au-dessus ET au-dessous de la carte, jamais un vide qui « poole » en bas d'écran (review
        // R3.2 Frontend : sinon ~36% du viewport vide en bas = « inachevé/timide »). Le lien retour
        // reste EN FLUX au sommet de la colonne centrée (jamais recouvert, non-occlusion structurelle).
        justifyContent: "center",
        gap: "var(--space-4)",
        padding: "var(--collection-page-padding)",
      }}
    >
      <div style={{ width: "100%", maxWidth: "var(--max-width-play)" }}>
        <Link
          href="/collection"
          className="mz-focusable"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            minHeight: "var(--tap-target-min)",
            padding: "var(--space-2) var(--space-3)",
            fontFamily: "var(--font-family-body)",
            fontSize: "var(--font-size-md)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--collection-text)",
            textDecoration: "none",
            borderRadius: "var(--border-radius-md)",
          }}
        >
          <span aria-hidden="true">{BACK_ARROW}</span>
          {strings.creatureDetail.back}
        </Link>
      </div>

      <div
        data-creature-card=""
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-3)",
          width: "100%",
          maxWidth: "var(--max-width-play)",
          backgroundColor: "var(--collection-card-bg)",
          border: "1px solid var(--collection-card-border)",
          borderRadius: "var(--border-radius-lg)",
          padding: "var(--space-5)",
          textAlign: "center",
        }}
      >
        {/* Art EN GRAND (le payoff, #180) : consomme `entry.artRef` via le renderer guardé
            partagé `<AssetImage>` (même garde de sécurité que Teddy/Collection). Content — pas
            décoratif : aucun ANCÊTRE ne porte déjà le nom accessible ici (le `<h1>` est un frère,
            pas un ancêtre), donc `alt` reste consommé (#239/#125). */}
        <AssetImage
          assetRef={entry.artRef}
          alt={entry.displayName}
          width="var(--creature-detail-art-size)"
          dataAsset="creature-detail-art"
          fallback={<CreatureDetailPlaceholder />}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: "var(--space-3)",
            width: "100%",
          }}
        >
          <h1
            data-creature-name=""
            style={{
              margin: 0,
              fontFamily: "var(--font-family-display)",
              fontSize: "var(--font-size-xl)",
              fontWeight: "var(--font-weight-bold)",
              color: "var(--collection-text)",
            }}
          >
            {entry.displayName}
          </h1>
          {!isRenaming && (
            <button
              type="button"
              className="mz-focusable"
              onClick={onStartRename}
              style={{
                minHeight: "var(--tap-target-min)",
                padding: "var(--space-2) var(--space-4)",
                fontFamily: "var(--font-family-display)",
                fontSize: "var(--font-size-sm)",
                fontWeight: "var(--font-weight-bold)",
                color: "var(--collection-text)",
                backgroundColor: "var(--color-bg-tertiary)",
                border: "1px solid var(--collection-card-border)",
                borderRadius: "var(--border-radius-full)",
                cursor: "pointer",
              }}
            >
              {`${RENAME_EMOJI} ${strings.collection.rename}`}
            </button>
          )}
        </div>

        {/* Renommage — RÉUTILISE `RenameForm` de `CollectionScreen` telle quelle (même logique,
            même server action `renameCharacterAction`, aucune duplication). */}
        {isRenaming && <RenameForm entry={entry} onSaved={onSaved} onCancel={onCancel} />}

        <RarityBadge rarity={entry.rarity} />

        <StageIndicator stage={entry.stage} maxStage={entry.maxStage} />

        {entry.story !== "" && (
          <p
            data-creature-story=""
            style={{
              margin: 0,
              fontFamily: "var(--font-family-body)",
              fontSize: "var(--font-size-md)",
              fontStyle: "italic",
              color: "var(--collection-text-muted)",
              maxWidth: "var(--max-width-play)",
            }}
          >
            {fill(strings.creatureDetail.storyQuote, { histoire: entry.story })}
          </p>
        )}
      </div>
    </main>
  );
}
