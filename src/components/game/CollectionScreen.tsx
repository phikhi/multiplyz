"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { strings } from "@/strings";
import { collectionAction, renameCharacterAction } from "@/app/(app)/collection/actions";
import { AssetImage } from "@/components/media/AssetImage";
import type { CollectionEntry } from "@/lib/game/collection";
import type { Rarity } from "@/lib/db/schema";

/**
 * **Écran Collection (Pokédex)** — créatures possédées (nom + histoire + rareté) +
 * **renommage** enfant (story 5.6, WIREFRAMES §5, PRODUCT §2.3, ECONOMY §3.2/§3.3).
 * Consomme la collection **déjà composée côté serveur** (`collectionAction` →
 * `loadCollection`) — aucun recalcul ici (ce composant ne fait qu'AFFICHER).
 *
 * **A11y (CLAUDE.md)** : chaque rareté est **doublée d'un texte** (« légendaire »/« rare »/
 * « commune ») ET d'un **glyphe distinct** (jamais couleur/forme seule, daltonisme). Les
 * glyphes/textes utilisent des **tokens texte fiables** (`--collection-*` → `--color-text-*`,
 * ≥4.5:1 sur le fond de carte réel), jamais `--color-star`/`--color-coin` (accents décoratifs
 * qui échouent le contraste sur fond neutre — rétro #104/#125/#126). Cibles ≥ 44 px.
 * `prefers-reduced-motion` respecté nativement (aucune animation ajoutée). **Tokens only**.
 *
 * **Lisibilité description en grille 3-col (issue #272, playtest-⚙️)** : la description
 * (histoire) tronque proprement à `--collection-card-description-line-clamp` (2) lignes avec
 * ellipsis, à `--collection-card-description-font-size` (`--font-size-base`, un cran au-dessus
 * de `--font-size-sm`) — la grille **3 colonnes reste inchangée** (WIREFRAMES §8,
 * `--collection-grid-columns`), seule la présentation de la description est ajustée.
 */

/** Glyphe distinct par rareté (doublé du LABEL texte) — distingue par FORME, pas couleur. */
const RARITY_GLYPH: Record<Rarity, string> = {
  common: "●",
  rare: "◆",
  legendary: "★",
};

/** Emoji décoratif du repli quand la créature n'a pas encore d'art réel (`placeholder://`, R3.1). */
const PLACEHOLDER_EMOJI = "🐾";
/** Emoji décoratif du bouton renommer (doublé du libellé texte « Renommer »). */
const RENAME_EMOJI = "✏️";

function fill(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, value),
    template,
  );
}

/**
 * Libellé du compteur « N créature(s) » (singulier/pluriel) — règle FRANÇAISE : `0` ET `1`
 * prennent le SINGULIER (« 0 créature », « 1 créature »), `≥2` le PLURIEL (« 2 créatures »).
 * Borne `n <= 1` (jamais `n === 1` seul, qui ferait retomber `0` au pluriel figé « 0 créatures »
 * — bug source #273, même règle que `pluralize()` de `dashboard-format.ts`, rétro #239).
 */
function countLabel(n: number): string {
  const template = n <= 1 ? strings.collection.count : strings.collection.countPlural;
  return fill(template, { n: String(n) });
}

/** Nom accessible d'une carte de créature : nom affiché + rareté (doublage a11y). */
function cardAccessibleName(entry: CollectionEntry): string {
  return fill(strings.collection.cardLabel, {
    nom: entry.displayName,
    rareté: strings.collection.rarity[entry.rarity],
  });
}

/**
 * Silhouette **repli** (emoji) quand la créature n'a pas encore d'art réel rendable (`art_ref` =
 * `placeholder://…`, R3.1). Sert de `fallback` à `<AssetImage>` : quand `art_ref` est rendable
 * (`socle/creature/…`, story R2.1 #361), l'image réelle est rendue à la place (cf. `CreatureCard`).
 */
function CreaturePlaceholder() {
  return (
    <span
      aria-hidden="true"
      data-collection-placeholder=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Taille tokenisée dimensionnée pour la grille 3-colonnes à 320px (WIREFRAMES §8).
        width: "var(--collection-placeholder-size)",
        height: "var(--collection-placeholder-size)",
        flexShrink: 0,
        borderRadius: "var(--border-radius-full)",
        backgroundColor: "var(--collection-placeholder-bg)",
        color: "var(--collection-placeholder-glyph)",
        fontSize: "var(--font-size-xl)",
      }}
    >
      {PLACEHOLDER_EMOJI}
    </span>
  );
}

/**
 * Badge de rareté : glyphe distinct + LABEL texte (doublage a11y, jamais couleur seule).
 * **Exporté** (réutilisé par la fiche créature, story R3.2 #379, WIREFRAMES §5b — même badge
 * qu'en grille, cohérence visuelle inter-écrans plutôt que le comptage d'étoiles brut du
 * wireframe lo-fi ; a11y/contraste déjà prouvés ci-dessous, jamais réinventés).
 */
export function RarityBadge({ rarity }: { readonly rarity: Rarity }) {
  return (
    <span
      data-collection-rarity={rarity}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        fontFamily: "var(--font-family-body)",
        fontSize: "var(--font-size-sm)",
        fontWeight: "var(--font-weight-semibold)",
        color: "var(--collection-rarity-glyph)",
      }}
    >
      <span aria-hidden="true">{RARITY_GLYPH[rarity]}</span>
      {strings.collection.rarity[rarity]}
    </span>
  );
}

/**
 * Formulaire inline de renommage (WIREFRAMES §5b). **Exporté** (réutilisé TEL QUEL par la fiche
 * créature, story R3.2 #379 — même logique de renommage, aucune duplication).
 */
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

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      setState("saving");
      void (async () => {
        const result = await renameCharacterAction(entry.characterId, value);
        if (result.ok && result.nickname !== null) {
          onSaved(entry.characterId, result.nickname);
          return;
        }
        setState("error");
      })();
    },
    [entry.characterId, value, onSaved],
  );

  return (
    <form
      onSubmit={submit}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", width: "100%" }}
    >
      <label
        style={{
          fontFamily: "var(--font-family-body)",
          fontSize: "var(--font-size-sm)",
          color: "var(--collection-text-muted)",
        }}
      >
        {strings.collection.renameLabel}
        <input
          type="text"
          value={value}
          maxLength={20}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          className="mz-focusable"
          style={{
            width: "100%",
            marginTop: "var(--space-1)",
            minHeight: "var(--tap-target-min)",
            padding: "var(--space-2) var(--space-3)",
            fontFamily: "var(--font-family-body)",
            fontSize: "var(--font-size-md)",
            color: "var(--collection-text)",
            backgroundColor: "var(--color-bg-tertiary)",
            border: "1px solid var(--collection-card-border)",
            borderRadius: "var(--border-radius-md)",
          }}
        />
      </label>
      {state === "error" && (
        <p
          role="alert"
          style={{
            margin: 0,
            fontFamily: "var(--font-family-body)",
            fontSize: "var(--font-size-sm)",
            color: "var(--collection-text-muted)",
          }}
        >
          {strings.collection.renameError}
        </p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        <button
          type="submit"
          className="mz-focusable"
          disabled={state === "saving"}
          style={{
            flex: "1 1 auto",
            minHeight: "var(--tap-target-min)",
            padding: "var(--space-2) var(--space-4)",
            fontFamily: "var(--font-family-display)",
            fontSize: "var(--font-size-sm)",
            fontWeight: "var(--font-weight-bold)",
            color: "var(--color-text-inverse)",
            backgroundColor: "var(--color-accent-primary)",
            border: "none",
            borderRadius: "var(--border-radius-full)",
            cursor: "pointer",
          }}
        >
          {state === "saving" ? strings.collection.renaming : strings.collection.renameSubmit}
        </button>
        <button
          type="button"
          className="mz-focusable"
          onClick={onCancel}
          style={{
            flex: "1 1 auto",
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
          {strings.collection.renameCancel}
        </button>
      </div>
    </form>
  );
}

/** Une carte de créature possédée (avatar + nom + rareté + histoire + renommer). */
function CreatureCard({
  entry,
  isRenaming,
  onStartRename,
  onSaved,
  onCancel,
}: {
  readonly entry: CollectionEntry;
  readonly isRenaming: boolean;
  readonly onStartRename: (characterId: string) => void;
  readonly onSaved: (characterId: string, nickname: string) => void;
  readonly onCancel: () => void;
}) {
  return (
    <li
      data-collection-card={entry.characterId}
      style={{
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
        // Padding resserré (token ⚙️) pour tenir 3 colonnes à 320px sans débordement.
        padding: "var(--collection-card-padding)",
        // minWidth 0 : autorise la carte à se compresser sous sa largeur de contenu dans la
        // grille (évite qu'un mot long force un scroll horizontal à 320px, WIREFRAMES §8).
        minWidth: 0,
        backgroundColor: "var(--collection-card-bg)",
        border: "1px solid var(--collection-card-border)",
        borderRadius: "var(--border-radius-lg)",
        textAlign: "center",
      }}
    >
      {/* Navigation vers la fiche créature (story R3.2, #379, WIREFRAMES §5b) : tap sur la carte
          → détail. Le `<Link>` porte le nom accessible (nom + rareté, doublage a11y) — il
          remplace l'ancien `aria-label` du `<li>` (le `<li>` n'est pas nativement interactif ;
          le lien, lui, est focalisable/annoncé au clavier, une amélioration a11y). EN FLUX (pas
          de position absolue) → aucune garde d'occlusion requise par construction (#170/#278). */}
      <Link
        href={`/collection/${encodeURIComponent(entry.characterId)}`}
        aria-label={cardAccessibleName(entry)}
        className="mz-focusable"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-2)",
          width: "100%",
          minWidth: 0,
          textDecoration: "none",
          color: "inherit",
          borderRadius: "var(--border-radius-md)",
        }}
      >
        {/* Illustration de la créature (story R2.1, #361) : consomme `entry.artRef` via le
            renderer guardé partagé `<AssetImage>` (réutilise `isRenderableAssetRef`/
            `assetPublicUrl`, R2.2). `art_ref` rendable (`socle/creature/…`) → VRAI art ;
            `placeholder://…` (état par défaut, set complet = R3.1) → repli emoji. **Décoratif** :
            le `<Link>` ci-dessus porte déjà le nom accessible (nom + rareté) → l'art est un
            doublon a11y (même a11y que l'ancien placeholder `aria-hidden`). EN FLUX (pas de
            position absolue) → même slot que le placeholder, géométrie de grille 3-col
            inchangée (WIREFRAMES §8). */}
        <AssetImage
          assetRef={entry.artRef}
          alt={entry.displayName}
          decorative
          width="var(--collection-placeholder-size)"
          dataAsset="collection-creature"
          fallback={<CreaturePlaceholder />}
        />
        <span
          data-collection-name=""
          style={{
            fontFamily: "var(--font-family-display)",
            fontSize: "var(--font-size-md)",
            fontWeight: "var(--font-weight-bold)",
            color: "var(--collection-text)",
          }}
        >
          {entry.displayName}
        </span>
        <RarityBadge rarity={entry.rarity} />
        {entry.story !== "" && (
          <p
            data-collection-story=""
            style={{
              margin: 0,
              fontFamily: "var(--font-family-body)",
              // Police un cran au-dessus (16px, `--font-size-sm` 14px cassait en mur de 3+
              // lignes fragmentées à 375px — issue #272, playtest-⚙️ confirmé propriétaire).
              fontSize: "var(--collection-card-description-font-size)",
              color: "var(--collection-text-muted)",
              // Troncature PROPRE 2 lignes (ellipsis) plutôt qu'un mur de texte fragmenté sur
              // 3+ lignes irrégulières — token ⚙️ centralisé (jamais un nombre en dur), même
              // patron que `--collection-grid-columns` consommé via `var()`.
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: "var(--collection-card-description-line-clamp)",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {entry.story}
          </p>
        )}
      </Link>
      {isRenaming ? (
        <RenameForm entry={entry} onSaved={onSaved} onCancel={onCancel} />
      ) : (
        <button
          type="button"
          className="mz-focusable"
          onClick={() => onStartRename(entry.characterId)}
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
    </li>
  );
}

type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly entries: readonly CollectionEntry[] };

/** Orchestrateur client de l'écran collection — charge la collection composée serveur au montage. */
export function CollectionScreen() {
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const fetchCollection = useCallback(async () => {
    const result = await collectionAction();
    if (result.entries === null) {
      setScreen({ kind: "error" });
      return;
    }
    setScreen({ kind: "ready", entries: result.entries });
  }, []);

  const retry = useCallback(() => {
    setScreen({ kind: "loading" });
    void fetchCollection();
  }, [fetchCollection]);

  useEffect(() => {
    // Différé en microtâche (react-hooks/set-state-in-effect, même pattern que MapScreen).
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void fetchCollection();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchCollection]);

  const startRename = useCallback((characterId: string) => setRenamingId(characterId), []);
  const cancelRename = useCallback(() => setRenamingId(null), []);

  const onSaved = useCallback((characterId: string, nickname: string) => {
    setRenamingId(null);
    // Met à jour l'affichage localement (le serveur est déjà la source de vérité persistée).
    setScreen((prev) => {
      // Garde de forme du reducer : `onSaved` n'est déclenché QUE depuis une carte rendue
      // (état "ready" — le bouton renommer n'existe pas ailleurs). Inatteignable par l'UI,
      // mais exigé par le typage de `ScreenState`.
      /* v8 ignore next — état "ready" garanti quand une carte déclenche onSaved */
      if (prev.kind !== "ready") return prev;
      return {
        kind: "ready",
        entries: prev.entries.map((entry) =>
          entry.characterId === characterId ? { ...entry, nickname, displayName: nickname } : entry,
        ),
      };
    });
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
        gap: "var(--space-5)",
        // Padding tokenisé resserré → maximise la largeur de la grille 3-colonnes sur
        // téléphone (WIREFRAMES §8), jamais de scroll horizontal à 320px.
        padding: "var(--collection-page-padding)",
      }}
    >
      {screen.kind === "loading" && (
        <h1 role="status" style={headingStyle}>
          {strings.collection.loading}
        </h1>
      )}

      {screen.kind === "error" && (
        <>
          <h1 style={headingStyle}>{strings.collection.loadError}</h1>
          <button type="button" className="mz-focusable" onClick={retry} style={ctaStyle}>
            {strings.collection.loadErrorRetry}
          </button>
        </>
      )}

      {screen.kind === "ready" && (
        <>
          <h1 style={headingStyle}>{strings.collection.title}</h1>
          <p
            data-collection-count=""
            style={{
              margin: 0,
              fontFamily: "var(--font-family-body)",
              fontSize: "var(--font-size-md)",
              color: "var(--collection-text-muted)",
            }}
          >
            {countLabel(screen.entries.length)}
          </p>

          {screen.entries.length === 0 ? (
            <p
              style={{
                fontFamily: "var(--font-family-body)",
                fontSize: "var(--font-size-md)",
                color: "var(--collection-text-muted)",
                textAlign: "center",
                maxWidth: "var(--max-width-play)",
              }}
            >
              {strings.collection.empty}
            </p>
          ) : (
            <ul
              data-collection-grid=""
              style={{
                display: "grid",
                // **3 colonnes** (WIREFRAMES §8) — token ⚙️ centralisé, jamais un nombre en
                // dur. `minmax(0, 1fr)` empêche tout débordement à 320px (les cartes se
                // compressent au lieu de forcer un scroll horizontal). Vaut sur téléphone ET
                // desktop (grille centrée dans --max-width-play).
                gridTemplateColumns: "repeat(var(--collection-grid-columns), minmax(0, 1fr))",
                gap: "var(--collection-grid-gap)",
                width: "100%",
                maxWidth: "var(--max-width-play)",
                margin: 0,
                padding: 0,
              }}
            >
              {screen.entries.map((entry) => (
                <CreatureCard
                  key={entry.characterId}
                  entry={entry}
                  isRenaming={renamingId === entry.characterId}
                  onStartRename={startRename}
                  onSaved={onSaved}
                  onCancel={cancelRename}
                />
              ))}
            </ul>
          )}

          <Link
            href="/carte"
            className="mz-focusable"
            style={{
              ...ctaStyle,
              display: "inline-flex",
              alignItems: "center",
              textDecoration: "none",
            }}
          >
            {strings.collection.back}
          </Link>
        </>
      )}
    </main>
  );
}

const headingStyle = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
  textAlign: "center",
} as const;

const ctaStyle = {
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
