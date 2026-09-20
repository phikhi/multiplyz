"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { evolution } from "@/strings/evolution";
import { companions } from "@/strings/companions";
import { forest } from "@/strings/forest";
import { strings } from "@/strings";
import { RarityBadge, RenameForm, CompanionArt } from "@/components/game/CollectionScreen";
import type { CollectionEntry } from "@/lib/game/collection";

// Shared stage labels retain the existing cosmetic progression.
const STAGE_SEPARATOR = "▸";

function fill(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, value),
    template,
  );
}

/** Cosmetic stages, with the actual published catalogue limit. */
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

/** Published stages; glyph and text both identify the current stage. */
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

/** The server has already checked possession for this profile. */
export function CreatureDetailScreen({ entry: initialEntry }: { readonly entry: CollectionEntry }) {
  const [entry, setEntry] = useState(initialEntry);
  const [isRenaming, setIsRenaming] = useState(false);
  const [saved, setSaved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  function finishRename() {
    setIsRenaming(false);
    heading.current?.focus();
  }
  return (
    <main className="forest companion-page companion-detail">
      <div className="companion-page-inner">
        <nav className="companion-nav">
          <Link href="/collection">
            {companions.back} {strings.creatureDetail.back}
          </Link>
          <Link href="/carte">{forest.returnMap}</Link>
        </nav>
        <article className="companion-dossier" data-creature-card="">
          <div className="companion-portrait">
            <p className="forest-kicker">{companions.home}</p>
            <CompanionArt
              artRef={entry.artRef}
              name={entry.displayName}
              dataAsset="creature-detail-art"
            />
          </div>
          <div className="companion-biography">
            <RarityBadge rarity={entry.rarity} />
            <h1 data-creature-name="" tabIndex={-1} ref={heading}>
              {entry.displayName}
            </h1>
            <StageIndicator stage={entry.stage} maxStage={entry.maxStage} />
            <div className="companion-story">
              <h2>{companions.story}</h2>
              {entry.story !== "" && (
                <p data-creature-story="">
                  {fill(strings.creatureDetail.storyQuote, { histoire: entry.story })}
                </p>
              )}
            </div>
            {isRenaming ? (
              <RenameForm
                entry={entry}
                onCancel={finishRename}
                onSaved={(_id, nickname) => {
                  setEntry({ ...entry, nickname, displayName: nickname });
                  setSaved(true);
                  finishRename();
                }}
              />
            ) : (
              <button
                className="forest-primary"
                onClick={() => {
                  setSaved(false);
                  setIsRenaming(true);
                }}
              >
                {strings.collection.rename}
              </button>
            )}
            {entry.stage < entry.maxStage && (
              <div className="companion-growth-link">
                <Link
                  className="forest-primary"
                  href={`/collection/${encodeURIComponent(entry.characterId)}/grandir`}
                >
                  {evolution.entry}
                </Link>
                <p>{evolution.cosmetic}</p>
              </div>
            )}
            {saved && (
              <p role="status" className="companion-name-saved">
                {companions.savedName}
              </p>
            )}
          </div>
        </article>
      </div>
    </main>
  );
}
