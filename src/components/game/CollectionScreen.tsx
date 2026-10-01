"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { strings } from "@/strings";
import { forest } from "@/strings/forest";
import { companions } from "@/strings/companions";
import { collectionAlbumAction, renameCharacterAction } from "@/app/(app)/collection/actions";
import { AssetImage } from "@/components/media/AssetImage";
import type { CollectionEntry } from "@/lib/game/collection";
import type { AlbumSlot, CollectionFamily } from "@/lib/game/collection-album";
import type { Rarity } from "@/lib/db/schema";

const RARITY_GLYPH: Record<Rarity, string> = { common: "●", rare: "◆", legendary: "★" };

export function RarityBadge({ rarity }: { readonly rarity: Rarity }) {
  return (
    <span className="companion-rarity" data-collection-rarity={rarity}>
      <span aria-hidden="true">{RARITY_GLYPH[rarity]}</span>
      {strings.collection.rarity[rarity]}
    </span>
  );
}

/** Shared nickname editor. A failed network request keeps the draft and permits retry. */
export function RenameForm({
  entry,
  onSaved,
  onCancel,
}: {
  readonly entry: CollectionEntry;
  readonly onSaved: (characterId: string, nickname: string) => void;
  readonly onCancel: () => void;
}) {
  const [value, setValue] = useState(entry.displayName);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const inFlight = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setState("saving");
    try {
      const result = await renameCharacterAction(entry.characterId, value);
      if (result.ok && result.nickname !== null) {
        onSaved(entry.characterId, result.nickname);
      } else setState("error");
    } catch {
      setState("error");
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="companion-rename"
      aria-busy={state === "saving"}
    >
      <label>
        {strings.collection.renameLabel}
        <input
          type="text"
          value={value}
          maxLength={20}
          autoFocus
          disabled={state === "saving"}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      {state === "error" && <p role="alert">{strings.collection.renameError}</p>}
      <div className="companion-actions">
        <button type="submit" className="forest-primary" disabled={state === "saving"}>
          {state === "saving" ? strings.collection.renaming : strings.collection.renameSubmit}
        </button>
        <button
          type="button"
          className="forest-secondary"
          disabled={state === "saving"}
          onClick={onCancel}
        >
          {strings.collection.renameCancel}
        </button>
      </div>
    </form>
  );
}

export function CompanionArt({
  artRef,
  name,
  dataAsset,
  decorative = false,
}: {
  artRef: string;
  name: string;
  dataAsset: string;
  decorative?: boolean;
}) {
  return (
    <AssetImage
      key={artRef}
      assetRef={artRef}
      alt={name}
      decorative={decorative}
      width="var(--companion-art-size)"
      dataAsset={dataAsset}
      fallback={
        <span className="companion-silhouette" aria-hidden="true">
          {companions.unknownGlyph}
        </span>
      }
    />
  );
}

function CreatureCard({ slot }: { slot: AlbumSlot }) {
  const entry = slot.entry;
  return (
    <li
      className="companion-card"
      data-collection-card={slot.characterId}
      data-owned={entry !== null}
    >
      {entry ? (
        <Link
          href={`/collection/${encodeURIComponent(entry.characterId)}`}
          aria-label={`${entry.displayName}, ${strings.collection.rarity[entry.rarity]}`}
        >
          <div className="companion-card-art">
            <CompanionArt
              artRef={entry.artRef}
              name={entry.displayName}
              dataAsset="collection-creature"
              decorative
            />
          </div>
          <h3 data-collection-name="">{entry.displayName}</h3>
          <RarityBadge rarity={entry.rarity} />
        </Link>
      ) : (
        <div className="companion-undiscovered">
          <div className="companion-card-art" aria-hidden="true">
            <CompanionArt
              artRef={slot.artRef}
              name={companions.unknown}
              dataAsset="collection-silhouette"
              decorative
            />
          </div>
          <h3>{slot.rarity === "legendary" ? companions.unknownGuardian : companions.unknown}</h3>
          <p>{slot.rarity === "legendary" ? companions.guardianHint : companions.eggHint}</p>
        </div>
      )}
    </li>
  );
}

type ScreenState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; entries: readonly CollectionEntry[]; families: readonly CollectionFamily[] };

export function CollectionScreen() {
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });
  const fetchCollection = useCallback(async () => {
    try {
      const result = await collectionAlbumAction();
      setScreen(result === null ? { kind: "error" } : { kind: "ready", ...result });
    } catch {
      setScreen({ kind: "error" });
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void fetchCollection();
    });
    return () => {
      cancelled = true;
    };
  }, [fetchCollection]);

  return (
    <main className="forest companion-page">
      <div className="companion-page-inner">
        <nav className="companion-nav">
          <Link href="/carte">
            {companions.back} {forest.returnMap}
          </Link>
        </nav>
        <header className="companion-heading">
          <p className="forest-kicker">{companions.eyebrow}</p>
          <h1
            key={screen.kind}
            tabIndex={-1}
            ref={(node) => {
              node?.focus();
            }}
            role={screen.kind === "loading" ? "status" : undefined}
          >
            {screen.kind === "loading"
              ? strings.collection.loading
              : screen.kind === "error"
                ? strings.collection.loadError
                : companions.title}
          </h1>
          {screen.kind === "ready" && (
            <>
              <p>{companions.intro}</p>
              <p className="companion-count" data-collection-count="">
                {companions.count(screen.entries.length)}
              </p>
            </>
          )}
        </header>
        {screen.kind === "error" && (
          <button
            className="forest-primary"
            onClick={() => {
              setScreen({ kind: "loading" });
              void fetchCollection();
            }}
          >
            {strings.collection.loadErrorRetry}
          </button>
        )}
        {screen.kind === "ready" && (
          <>
            {screen.entries.length === 0 && (
              <aside className="companion-empty">
                <p>{companions.empty}</p>
                <Link href="/carte" className="forest-primary">
                  {forest.continue}
                </Link>
              </aside>
            )}
            {screen.families.map((family) => (
              <section
                key={family.worldIndex}
                className="companion-family"
                aria-labelledby={`family-${family.worldIndex}`}
              >
                <div className="companion-family-heading">
                  <h2 id={`family-${family.worldIndex}`}>
                    {companions.family(family.worldIndex + 1)}
                  </h2>
                  <span>
                    {companions.count(family.slots.filter((slot) => slot.entry !== null).length)}
                  </span>
                </div>
                <ul className="companion-grid" data-collection-grid="">
                  {family.slots.map((slot) => (
                    <CreatureCard key={slot.characterId} slot={slot} />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
