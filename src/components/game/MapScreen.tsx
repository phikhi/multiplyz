"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { strings } from "@/strings";
import { LogoutButton } from "@/components/LogoutButton";
import { currentMapAction } from "@/app/(app)/carte/actions";
import type { MapNode, MapStars, NodeType, WorldMap } from "@/lib/game/map";

/**
 * **Écran carte** — chemin de nœuds du monde courant (story #125, WIREFRAMES §2,
 * PRODUCT §2.1, MAP §1/§2/§4/§5). Consomme la carte **déjà composée côté serveur**
 * (5.2 géométrie + 5.3 progression + moteur 3.4 dette de révision, via
 * `currentMapAction` → `loadCurrentWorldMap`) — **aucune régénération de géométrie**
 * ici (invariance de géométrie à l'état runtime, CLAUDE.md/rétro #123 : ce composant
 * ne fait qu'AFFICHER `WorldMap.nodes`, jamais recalculer positions/count).
 *
 * **Navigation nœud → niveau** (`(app)/jouer`) : le nœud **courant** (point de
 * reprise, MAP §1) et tout nœud **terminé** (rejoue, progression monotone) sont des
 * liens vers `/jouer` — le moteur serveur sert toujours le contenu pertinent du
 * profil (ENGINE §3/§4), cette carte ne transmet pas de `level_index` cible (la
 * composition fine niveau↔nœud/pièces est story #5.5, ECONOMY §4.1). Un nœud
 * **verrouillé** n'est jamais un lien (déblocage linéaire, MAP §1/§8 : jamais
 * fondé sur les étoiles).
 *
 * **A11y (CLAUDE.md)** : chaque nœud est doublé d'un **texte** (jamais couleur/forme
 * seule, daltonisme) — le nom accessible porte statut + type + étoiles. Cibles
 * ≥ 44 px (`--map-node-size` = 64px). `prefers-reduced-motion` respecté nativement
 * (aucune animation ajoutée ici). **Tokens only** — famille `--map-node-*`
 * (tokens.css), zéro valeur en dur.
 */

/** Glyphe décoratif (doublé du texte) par état de nœud — jamais la seule info portée. */
const STATUS_GLYPH: Record<MapNode["status"], string> = {
  locked: "🔒",
  current: "▶",
  completed: "✓",
};

/** Glyphe décoratif de TYPE, superposé en médaillon — distingue par FORME, pas couleur. */
const TYPE_GLYPH: Record<NodeType, string | null> = {
  normal: null,
  revision: "↻",
  treasure: "🎁",
  boss: "👑",
};

const FILLED_STAR = "★";
const EMPTY_STAR = "☆";
const STAR_SLOTS: readonly MapStars[] = [1, 2, 3];

function fill(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, value),
    template,
  );
}

/** Libellé accessible des étoiles d'un nœud terminé (0..3, MAP §4 — jamais une barrière). */
function starsLabel(stars: MapStars): string {
  const template = stars === 1 ? strings.map.starsLabel : strings.map.starsLabelPlural;
  return fill(template, { n: String(stars) });
}

/** Nom accessible complet d'un nœud — statut + type, dérivé (jamais couleur/forme seule). */
function nodeAccessibleName(node: MapNode, total: number): string {
  const position = String(node.index + 1);
  const typeLabel = strings.map.type[node.type];
  const base =
    node.status === "locked"
      ? fill(strings.map.nodeLocked, { n: position, total: String(total) })
      : node.status === "current"
        ? fill(strings.map.nodeCurrent, { n: position, total: String(total) })
        : fill(strings.map.nodeCompleted, {
            n: position,
            total: String(total),
            stars: starsLabel(node.stars),
          });
  return `${base} — ${typeLabel}`;
}

/** Nœud navigable : courant (reprise) ou terminé (rejoue) — jamais verrouillé (MAP §1). */
function isNavigable(status: MapNode["status"]): boolean {
  return status === "current" || status === "completed";
}

function backgroundVar(status: MapNode["status"]): string {
  if (status === "current") return "var(--map-node-current-bg)";
  if (status === "completed") return "var(--map-node-completed-bg)";
  return "var(--map-node-locked-bg)";
}

function borderVar(status: MapNode["status"]): string {
  if (status === "current") return "var(--map-node-current-border)";
  if (status === "completed") return "var(--map-node-completed-border)";
  return "var(--map-node-locked-border)";
}

function glyphVar(status: MapNode["status"]): string {
  if (status === "current") return "var(--map-node-current-glyph)";
  if (status === "completed") return "var(--map-node-completed-glyph)";
  return "var(--map-node-locked-glyph)";
}

/** Médaillon de type superposé (trésor/boss/révision) — `null` pour un niveau normal. */
function TypeBadge({ type }: { readonly type: NodeType }) {
  const glyph = TYPE_GLYPH[type];
  if (glyph === null) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      data-map-type-badge={type}
      style={{
        position: "absolute",
        top: "calc(var(--space-1) * -1)",
        right: "calc(var(--space-1) * -1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "var(--space-5)",
        height: "var(--space-5)",
        borderRadius: "var(--border-radius-full)",
        backgroundColor: "var(--map-node-type-badge-bg)",
        border: "1px solid var(--map-node-type-badge-border)",
        color: "var(--map-node-type-badge-glyph)",
        fontSize: "var(--font-size-xs)",
        lineHeight: 1,
      }}
    >
      {glyph}
    </span>
  );
}

/** Rangée d'étoiles décorative (0..3) — doublée du texte via `aria-label` du parent. */
function StarsRow({ stars }: { readonly stars: MapStars }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: "flex", gap: "2px", justifyContent: "center" }}
      data-map-stars={stars}
    >
      {STAR_SLOTS.map((slot) => (
        <span
          key={slot}
          style={{
            fontSize: "var(--font-size-xs)",
            color: slot <= stars ? "var(--map-node-star-filled)" : "var(--map-node-star-empty)",
          }}
        >
          {slot <= stars ? FILLED_STAR : EMPTY_STAR}
        </span>
      ))}
    </span>
  );
}

/** Une pastille de nœud du chemin (verrouillé / courant / terminé), doublée d'un texte. */
function NodeBadge({ node, total }: { readonly node: MapNode; readonly total: number }) {
  const accessibleName = nodeAccessibleName(node, total);
  const badge = (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "var(--map-node-size)",
        height: "var(--map-node-size)",
        borderRadius: "var(--border-radius-full)",
        backgroundColor: backgroundVar(node.status),
        border: `2px solid ${borderVar(node.status)}`,
        color: glyphVar(node.status),
        fontSize: "var(--font-size-lg)",
      }}
    >
      {STATUS_GLYPH[node.status]}
      <TypeBadge type={node.type} />
    </span>
  );

  const content = (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-1)",
      }}
    >
      {badge}
      {node.status === "completed" && <StarsRow stars={node.stars} />}
    </span>
  );

  if (isNavigable(node.status)) {
    return (
      <Link
        href="/jouer"
        className="mz-focusable"
        aria-label={accessibleName}
        data-map-node={node.index}
        data-map-node-status={node.status}
        data-map-node-type={node.type}
        style={{
          display: "flex",
          minWidth: "var(--tap-target-min)",
          minHeight: "var(--tap-target-min)",
          textDecoration: "none",
        }}
      >
        {content}
      </Link>
    );
  }

  return (
    <span
      role="img"
      aria-label={accessibleName}
      data-map-node={node.index}
      data-map-node-status={node.status}
      data-map-node-type={node.type}
      style={{
        display: "flex",
        minWidth: "var(--tap-target-min)",
        minHeight: "var(--tap-target-min)",
      }}
    >
      {content}
    </span>
  );
}

/**
 * Décalage horizontal (%) dérivé de `position.x` (normalisée `[0,1]`, 5.2) — centré sur
 * `0.5` (aucun décalage), affichage seul (aucune influence sur la géométrie sous-jacente,
 * invariance rétro #123). Arrondi à 2 décimales : évite le bruit flottant IEEE-754 dans
 * le DOM rendu (ex. `0.8 − 0.5 = 0.30000000000000004`) sans changer le rendu visuel.
 */
function horizontalOffsetPercent(x: number): number {
  return Math.round((x - 0.5) * 100 * 100) / 100;
}

/** Chemin complet des nœuds — projette les positions normalisées `[0,1]²` (5.2) dans un
 * viewport simple : `y` pilote l'ordre vertical du chemin, `x` un décalage horizontal
 * relatif (serpentin). Aucun recalcul de géométrie : les positions viennent telles
 * quelles de `WorldMap.nodes` (invariance géométrique, CLAUDE.md/rétro #123). */
function NodePath({ map }: { readonly map: WorldMap }) {
  const total = map.nodes.length;
  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column-reverse", // départ en bas, boss en haut (WIREFRAMES §2)
        alignItems: "center",
        gap: "var(--map-node-gap)",
        width: "100%",
        maxWidth: "var(--max-width-play)",
      }}
    >
      {map.nodes.map((node) => (
        <li
          key={node.index}
          style={{
            display: "flex",
            justifyContent: "center",
            // Décalage horizontal serpentin depuis la position normalisée (5.2) —
            // affichage seul, aucune influence sur la géométrie sous-jacente.
            transform: `translateX(${horizontalOffsetPercent(node.position.x)}%)`,
          }}
        >
          <NodeBadge node={node} total={total} />
        </li>
      ))}
    </ol>
  );
}

type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly map: WorldMap };

/** Orchestrateur client de l'écran carte — charge la carte composée serveur au montage. */
export function MapScreen() {
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });

  const fetchMap = useCallback(async () => {
    const result = await currentMapAction();
    if (result.map === null) {
      setScreen({ kind: "error" });
      return;
    }
    setScreen({ kind: "ready", map: result.map });
  }, []);

  const retry = useCallback(() => {
    setScreen({ kind: "loading" });
    void fetchMap();
  }, [fetchMap]);

  useEffect(() => {
    // Différé en microtâche (react-hooks/set-state-in-effect, même pattern que
    // `PlayScreen`, LEARNINGS) : le fetch part toujours au montage.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void fetchMap();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchMap]);

  return (
    <main
      className="bg-bg text-text"
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-6)",
        padding: "var(--space-6)",
      }}
    >
      {screen.kind === "loading" && (
        <h1
          role="status"
          style={{
            fontFamily: "var(--font-family-display)",
            fontSize: "var(--font-size-xl)",
            fontWeight: "var(--font-weight-bold)",
            color: "var(--color-text-primary)",
            margin: 0,
            textAlign: "center",
          }}
        >
          {strings.map.loading}
        </h1>
      )}

      {screen.kind === "error" && (
        <>
          <h1
            style={{
              fontFamily: "var(--font-family-display)",
              fontSize: "var(--font-size-xl)",
              fontWeight: "var(--font-weight-bold)",
              color: "var(--color-text-primary)",
              margin: 0,
              textAlign: "center",
            }}
          >
            {strings.map.loadError}
          </h1>
          <button
            type="button"
            className="mz-focusable"
            onClick={retry}
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
            {strings.map.loadErrorRetry}
          </button>
        </>
      )}

      {screen.kind === "ready" && (
        <>
          <h1
            style={{
              fontFamily: "var(--font-family-display)",
              fontSize: "var(--font-size-xl)",
              fontWeight: "var(--font-weight-bold)",
              color: "var(--color-text-primary)",
              margin: 0,
              textAlign: "center",
            }}
          >
            {fill(strings.map.title, { n: String(screen.map.worldIndex + 1) })}
          </h1>
          <NodePath map={screen.map} />
        </>
      )}

      <LogoutButton />
    </main>
  );
}
