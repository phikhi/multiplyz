"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { strings } from "@/strings";
import { LogoutButton } from "@/components/LogoutButton";
import { currentMapAction } from "@/app/(app)/carte/actions";
import type { MapNode, MapStars, NodeType, WorldMap } from "@/lib/game/map";
import type { CurrentWorldMap, WorldTheme } from "@/lib/game/world-theme";

/**
 * **Écran carte** — chemin de nœuds du monde courant (story #125/6.7, WIREFRAMES §2,
 * PRODUCT §2.1, MAP §1/§2/§4/§5). Consomme la carte **déjà composée côté serveur**
 * (5.2 géométrie + 5.3 progression + moteur 3.4 dette de révision + **thème per-monde**
 * 6.6/6.7, via `currentMapAction` → `loadCurrentWorldMap`) — **aucune régénération de
 * géométrie** ici (invariance de géométrie à l'état runtime, CLAUDE.md/rétro #123 : ce
 * composant ne fait qu'AFFICHER `WorldMap.nodes`, jamais recalculer positions/count).
 *
 * **Thématisation per-monde (story 6.7)** : `<main>` porte `data-world=<slug>` +
 * `--world-accent` (DESIGN_TOKENS §per-monde — la SEULE variable qu'un monde surcharge).
 * L'observable per-monde vient d'un **titre thématisé** (« Monde 3 · Forêt ») + d'un **bandeau
 * d'accent** consommant `--world-accent` en pixel visible. Quand un **fond-image réel** du monde
 * existe (Nginx **validé**, `background !== null`), il est rendu en couverture de `<main>`, le
 * **tint de fond `--world-bg-tint`** se dérive **par monde** (re-déclaré inline sur `<main>`, fix
 * #184) et le **titre reçoit un scrim `--world-surface` opaque** (cf. `ThemedTitle`) qui garantit
 * son contraste ≥4.5:1 INDÉPENDAMMENT de la photo IA arbitraire (story #189). Sans asset réel (cas
 * CI/hors-ligne), `<main>` garde son fond neutre et le titre son fond de page (pas de scrim, pas de
 * régression #125). Le thème est un attribut **non-clé** : il ne touche jamais la géométrie (#123).
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

/**
 * Style de texte partagé des titres `h1` de l'écran (chargement / erreur / indispo / carte prête) —
 * tokens only (jamais de valeur en dur). Couleur `--color-text-primary` : lisible sur le fond de
 * page neutre (`bg-bg`) ET sur le scrim `--world-surface` du titre thématisé (contraste ≥4.5:1
 * résolu, testé). Centralisé pour éviter la duplication (une seule source de vérité de style).
 */
const TITLE_TEXT_STYLE: CSSProperties = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
  textAlign: "center",
};

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

/**
 * Médaillon d'étoiles décoratif (0..3) — doublé du texte via `aria-label` du parent.
 * **Absolu, hors flux** (playtest owner) : chevauche le BAS de la pastille (chip blanc),
 * si bien qu'il (a) n'allonge pas la ligne du nœud → **pas d'espacement variable** entre
 * les cercles (le connecteur `height:--map-node-gap` atteint alors exactement le cercle
 * suivant, corrige « le trait s'arrête avant le 2ᵉ rond »), et (b) est **opaque et au-dessus
 * du connecteur** (`zIndex` > trait) → le trait **passe dessous** au lieu de traverser les
 * étoiles. Fond `--color-bg-secondary` (blanc) : les étoiles y gardent leur contraste (cf.
 * `--map-node-star-badge-*`, tokens.css). Le cercle parent est `position:relative`.
 */
function StarsRow({ stars }: { readonly stars: MapStars }) {
  return (
    <span
      aria-hidden="true"
      data-map-stars={stars}
      style={{
        position: "absolute",
        top: "100%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        display: "flex",
        gap: "2px",
        padding: "1px var(--space-1)",
        borderRadius: "var(--border-radius-full)",
        backgroundColor: "var(--map-node-star-badge-bg)",
        border: "1px solid var(--map-node-star-badge-border)",
        zIndex: 2,
        lineHeight: 1,
      }}
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
      {/* Étoiles = chip blanc absolu chevauchant le bas du cercle (hors flux) : garde
          l'espacement des nœuds uniforme (le connecteur atteint le cercle suivant) et
          laisse le trait passer dessous. Le cercle est `position:relative` (ci-dessus). */}
      {node.status === "completed" && <StarsRow stars={node.stars} />}
    </span>
  );

  // Les étoiles étant désormais absolues DANS le cercle, le contenu = la seule pastille
  // (plus de colonne badge+étoiles qui allongeait le nœud et cassait le connecteur).
  const content = badge;

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

/**
 * **Connecteur décoratif** entre un nœud et son PRÉCÉDENT dans l'ordre du chemin
 * (métaphore Candy Crush `◉ ── ● ── ⭐`, WIREFRAMES §2). Trait SVG dérivé UNIQUEMENT
 * des positions existantes des deux nœuds (`node.position.x`) — il **ne modifie ni le
 * nombre de nœuds ni leurs positions** (invariance de géométrie préservée, rétro #123 :
 * c'est un ornement d'affichage superposé, pas un élément de la géométrie clé).
 *
 * Layout `column-reverse` : le connecteur est ancré en HAUT du `<li>` courant et
 * descend dans la gouttière (`--map-node-gap`) vers le nœud précédent (rendu juste en
 * dessous). Il relie le centre horizontal du nœud courant (`0`, le `<li>` est déjà
 * translaté) à celui du précédent (delta de décalage serpentin entre les deux).
 *
 * **Guide de repérage visible** (`aria-hidden`, jamais navigable, jamais dans le nom
 * accessible) : depuis l'ADR 0010 le trait est rendu visible (≥3:1 WCAG 1.4.11, cf.
 * `--map-node-path-color` remappé sur `--color-text-secondary`, tokens.css) pour que le
 * chemin se lise comme voulu. Il reste décoratif au sens a11y — aucune info n'y est
 * portée (états/types/étoiles sont sur le nœud, l'ordre est porté par l'ordre DOM des
 * nœuds) — mais son contraste résolu est désormais **testé** (MapScreen.test.tsx).
 * Tokens `--map-node-path-*`.
 */
function NodeConnector({ fromX, toX }: { readonly fromX: number; readonly toX: number }) {
  // Décalages horizontaux (%) des deux nœuds (positions 5.2, pas recalculés). Le `<li>`
  // courant est DÉJÀ translaté de `currentOffset` → dans le repère du SVG (qui suit le
  // <li>), le centre du nœud courant est à x=50 ; celui du précédent est décalé du
  // DELTA de serpentin entre les deux nœuds (`prevOffset - currentOffset`).
  const currentOffset = horizontalOffsetPercent(fromX);
  const prevOffset = horizontalOffsetPercent(toX);
  const x1 = 50; // centre du nœud courant (haut du connecteur)
  const x2 = 50 + (prevOffset - currentOffset); // centre du précédent (bas du connecteur)
  return (
    <svg
      aria-hidden="true"
      data-map-connector=""
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
      style={{
        position: "absolute",
        left: 0,
        // Ancré au BAS de la pastille (`--map-node-size`) et descend sur toute la
        // gouttière (`--map-node-gap`) vers le nœud précédent (rendu juste en dessous).
        // Corrige #169 : ancré à la MOITIÉ de la pastille, le trait était peint DANS la
        // moitié basse du nœud, entièrement RECOUVERT par le médaillon opaque (zIndex 1
        // > 0) → invisible (playtest owner). Il doit vivre dans la gouttière ENTRE les
        // nœuds pour être visible.
        top: "var(--map-node-size)",
        width: "100%",
        height: "var(--map-node-gap)",
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      <line
        x1={x1}
        y1={0}
        x2={x2}
        y2={100}
        // `stroke` ET `strokeWidth` posés via `style` (jamais l'attribut JSX de
        // présentation) : garantit la résolution CSS de `var(--…)` dans TOUS les moteurs
        // (cf. NumberLine, issue #110 — cohérence avec le principe énoncé, le laisser en
        // attribut brut le contredisait). Tokens `--map-node-path-*`, jamais un littéral.
        style={{
          stroke: "var(--map-node-path-color)",
          strokeWidth: "var(--map-node-path-width)",
        }}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Chemin complet des nœuds — projette les positions normalisées `[0,1]²` (5.2) dans un
 * viewport simple : `y` pilote l'ordre vertical du chemin, `x` un décalage horizontal
 * relatif (serpentin). Aucun recalcul de géométrie : les positions viennent telles
 * quelles de `WorldMap.nodes` (invariance géométrique, CLAUDE.md/rétro #123). Un
 * connecteur décoratif relie chaque nœud à son précédent (métaphore Candy Crush). */
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
      {map.nodes.map((node, renderIndex) => {
        // Nœud précédent DANS L'ORDRE DU CHEMIN (index - 1) — `undefined` pour le 1ᵉʳ
        // nœud (départ, aucun connecteur). Dérivé de la liste fournie, pas recalculé.
        const previous = renderIndex > 0 ? map.nodes[renderIndex - 1] : undefined;
        return (
          <li
            key={node.index}
            style={{
              position: "relative",
              display: "flex",
              justifyContent: "center",
              // Décalage horizontal serpentin depuis la position normalisée (5.2) —
              // affichage seul, aucune influence sur la géométrie sous-jacente.
              transform: `translateX(${horizontalOffsetPercent(node.position.x)}%)`,
            }}
          >
            {previous !== undefined && (
              <NodeConnector fromX={node.position.x} toX={previous.position.x} />
            )}
            <NodeBadge node={node} total={total} />
          </li>
        );
      })}
    </ol>
  );
}

/**
 * **Style thématisé du conteneur carte** (câblage carte↔monde, story 6.7). Pose `--world-accent`
 * sur `<main>` (DESIGN_TOKENS §per-monde : la SEULE variable qu'un monde surcharge) → tous les
 * descendants (bandeau d'accent…) en héritent. En story 6.7, l'observable per-monde vient de
 * `--world-accent` (bandeau d'accent + titre thématisé), pas d'une teinte de fond.
 *
 * **Fond du monde** : rendu comme `background` de `<main>` **uniquement** quand un **asset réel
 * validé** existe (`theme.background !== null`, chemin Nginx passé par `isRenderableAssetRef`) →
 * image en couverture, avec `--world-bg-tint` **per-monde** en **repli** dessous. Sans asset réel
 * (placeholder du gate owner → `null`, cas CI/hors-ligne), `<main>` **garde son fond neutre**
 * (`bg-bg`) : le titre et le trait du chemin conservent leur **fond de référence de contraste
 * inchangé** (pas de régression #125). Le fond étant le `background` de `<main>` (backmost), il ne
 * peut **jamais** recouvrir les nœuds (anti-occlusion #170).
 *
 * **Tint per-monde (fix #184, story #189)** : `--world-bg-tint` (`color-mix(--world-accent 10%,
 * surface)`) est **RE-DÉCLARÉ ICI** (au niveau de la surcharge inline de `--world-accent`), pas
 * seulement à `:root`. Raison : la substitution `var()` d'un custom-property se résout **au niveau
 * où la propriété est DÉCLARÉE** — le `--world-bg-tint` de `:root` reste donc **NEUTRE** sous une
 * surcharge **descendante** de sa var source (`<main>`), c'est un **faux-dérivé dormant** (piège
 * #184). En le re-déclarant sur `<main>` (même élément que `--world-accent`), le `color-mix` se
 * re-résout avec l'accent du monde → tint réellement **per-monde**, theme-safe (light ET dark).
 */
function worldMainStyle(base: CSSProperties, theme: WorldTheme | null): CSSProperties {
  if (theme === null) {
    return base;
  }
  // Un monde pose `--world-accent` (DESIGN_TOKENS §per-monde) ; `--world-bg-tint` est re-dérivé
  // per-monde en le RE-DÉCLARANT sur le même élément (fix #184 — sinon le color-mix de `:root`
  // reste neutre sous la surcharge descendante). Disponible à tout le sous-arbre carte.
  const themed: CSSProperties = {
    ...base,
    ["--world-accent" as string]: theme.accent,
    ["--world-bg-tint" as string]:
      "color-mix(in srgb, var(--world-accent) 10%, var(--color-bg-secondary))",
  };
  if (theme.background !== null) {
    // Asset validé (Nginx) → image du monde en couverture, `--world-bg-tint` **per-monde** (cf.
    // re-déclaration ci-dessus) en repli theme-safe dessous. Jamais rendu vers une URL non validée
    // (garde `isRenderableAssetRef`). Le titre reçoit un scrim `--world-surface` (cf. `ThemedTitle`).
    themed.backgroundColor = "var(--world-bg-tint)";
    themed.backgroundImage = `url("${theme.background}")`;
    themed.backgroundSize = "cover";
    themed.backgroundPosition = "center";
    themed.backgroundRepeat = "no-repeat";
  }
  return themed;
}

/**
 * **Bandeau d'accent du monde** (décoratif, `aria-hidden`) — consommateur **direct** de
 * `--world-accent` (fond plein), rendu SOUS le titre. C'est le pixel per-monde le plus lisible :
 * sa couleur change avec le monde (généré/socle), en flux (jamais recouvert), doublé du titre
 * thématisé et du fond teinté. DESIGN_TOKENS §per-monde : `--world-accent` sert aux éléments
 * **thématiques** (fond de carte, barre), jamais aux actions (qui restent `--color-accent-primary`).
 */
function WorldAccentBar() {
  return (
    <div
      aria-hidden="true"
      data-world-accent-bar=""
      style={{
        width: "100%",
        maxWidth: "var(--max-width-play)",
        height: "var(--space-2)",
        backgroundColor: "var(--world-accent)",
        borderRadius: "var(--border-radius-full)",
      }}
    />
  );
}

/**
 * **Titre du monde + scrim de contraste** (story #189). Quand un **fond-image réel** du monde est
 * rendu (`hasBackground`, i.e. `theme.background !== null`), le titre est posé sur une **carte scrim
 * OPAQUE** consommant `--world-surface` (token per-monde, DESIGN_TOKENS §per-monde — jusqu'ici
 * **ORPHELIN**, aucun consommateur DOM = piège #125) : elle garantit le contraste du titre
 * (`--color-text-primary` ≥4.5:1 sur `--world-surface`, résolu + testé) **INDÉPENDAMMENT** de la
 * photo IA arbitraire — une photo claire ne peut plus noyer le titre. **Opaque** (jamais
 * semi-transparente) : c'est la SEULE façon d'honnêtement garantir le **plancher de contraste sur
 * le token résolu** — une photo qui transparaîtrait invaliderait ce plancher (over-claim #170). Le
 * fond de référence de contraste réellement empilé derrière le titre est donc bien `--world-surface`
 * (rétro #125). Le titre est un **enfant en flux** du scrim → peint **AU-DESSUS** du fond de carte,
 * jamais occulté (#170 : pas d'`absolute`/`z-index`, aucun risque d'occlusion). Sans fond-image
 * (`null`, cas CI/hors-ligne), **pas de scrim** : le titre garde le fond de page neutre `bg-bg`
 * (contraste inchangé → pas de régression #125).
 */
function ThemedTitle({
  text,
  hasBackground,
}: {
  readonly text: string;
  readonly hasBackground: boolean;
}) {
  // Titre THÉMATISÉ (WIREFRAMES §2 « Monde 3 · La Forêt ») : le thème per-monde (généré/socle)
  // atteint l'enfant dans le titre — texte, jamais occulté (#180).
  const heading = <h1 style={TITLE_TEXT_STYLE}>{text}</h1>;
  if (!hasBackground) {
    return heading;
  }
  return (
    <div
      data-world-scrim=""
      style={{
        display: "flex",
        justifyContent: "center",
        // Scrim OPAQUE = surface per-monde du thème courant (consomme `--world-surface`, #125) :
        // garantit le contraste du titre quelle que soit la photo IA (jamais semi-transparent, #170).
        backgroundColor: "var(--world-surface)",
        padding: "var(--space-3) var(--space-5)",
        borderRadius: "var(--card-radius)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      {heading}
    </div>
  );
}

type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly map: CurrentWorldMap };

/** Orchestrateur client de l'écran carte — charge la carte composée serveur au montage. */
export function MapScreen() {
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });

  const fetchMap = useCallback(async () => {
    try {
      const result = await currentMapAction();
      if (result.status === "ready") {
        setScreen({ kind: "ready", map: result.map });
        return;
      }
      // Monde de secours indispo (socle non amorcé) → message doux Teddy (jamais l'erreur brute) ;
      // non authentifié / autre → message générique de repli.
      setScreen({ kind: result.status === "unavailable" ? "unavailable" : "error" });
    } catch {
      // Toute erreur serveur non interceptée (invariant) → repli générique, jamais l'erreur brute.
      setScreen({ kind: "error" });
    }
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

  // Thème per-monde (câblage carte↔monde, story 6.7) — disponible seulement une fois la carte
  // chargée. `data-world` + `--world-accent` + fond du monde posés sur `<main>` (backmost).
  const theme = screen.kind === "ready" ? screen.map.theme : null;
  const baseMainStyle: CSSProperties = {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--space-6)",
    padding: "var(--space-6)",
  };

  return (
    <main
      className="bg-bg text-text"
      data-world={theme?.slug}
      style={worldMainStyle(baseMainStyle, theme)}
    >
      {screen.kind === "loading" && (
        <h1 role="status" style={TITLE_TEXT_STYLE}>
          {strings.map.loading}
        </h1>
      )}

      {screen.kind === "error" && (
        <>
          <h1 style={TITLE_TEXT_STYLE}>{strings.map.loadError}</h1>
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

      {screen.kind === "unavailable" && (
        <>
          {/* Socle de secours indispo → message DOUX voix de Teddy (COPY §90/91), jamais l'erreur
              brute. `role="status"` : annoncé (a11y), même patron que le chargement. */}
          <h1 role="status" style={TITLE_TEXT_STYLE}>
            {strings.map.worldUnavailable}
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
          {/* Titre thématisé + scrim de contraste `--world-surface` quand un fond-image réel du
              monde est rendu (garantit la lisibilité du titre par-dessus la photo, story #189). */}
          <ThemedTitle
            text={fill(strings.map.titleThemed, {
              n: String(screen.map.worldIndex + 1),
              theme: screen.map.theme.label,
            })}
            hasBackground={screen.map.theme.background !== null}
          />
          {/* Bandeau d'accent : consommateur direct de `--world-accent` (pixel per-monde visible). */}
          <WorldAccentBar />
          <NodePath map={screen.map} />
          {/* Hub (WIREFRAMES §2) : accès à la Collection (Pokédex) depuis la carte. */}
          <Link
            href="/collection"
            className="mz-focusable"
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: "var(--tap-target-min)",
              padding: "var(--space-2) var(--space-5)",
              fontFamily: "var(--font-family-display)",
              fontSize: "var(--font-size-md)",
              fontWeight: "var(--font-weight-bold)",
              color: "var(--color-text-primary)",
              backgroundColor: "var(--color-bg-tertiary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--border-radius-full)",
              textDecoration: "none",
            }}
          >
            {strings.collection.title}
          </Link>
        </>
      )}

      <LogoutButton />
    </main>
  );
}
