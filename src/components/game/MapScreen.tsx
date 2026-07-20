"use client";

import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { strings } from "@/strings";
import { LogoutButton } from "@/components/LogoutButton";
import { currentMapAction } from "@/app/(app)/carte/actions";
import type { MapNode, MapStars, NodeType, WorldMap } from "@/lib/game/map";
import type { CurrentWorldMap, WorldTheme } from "@/lib/game/world-theme";
import { useIsPhone } from "@/lib/responsive/use-is-phone";
import { usePrefersReducedMotion } from "@/lib/sound/use-prefers-reduced-motion";

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
 * son contraste ≥4.5:1 INDÉPENDAMMENT de la photo IA arbitraire (story #189).
 *
 * **Tint = fond RÉEL même sans photo (story #199)** : `<main>` peint désormais `--world-bg-tint`
 * comme son `backgroundColor` dès qu'un thème est résolu — plus seulement quand `background !==
 * null`. Avant #199, le tint était bien re-dérivé (#184) mais jamais **peint** dans l'état
 * sans-image (repli socle placeholder, CI, hors-ligne) : l'enfant ne voyait jamais l'identité du
 * monde sans photo (déclaré ≠ consommé, #125/#180). Sûr **sans scrim** ici (contrairement à la
 * photo) car la palette d'accent est **bornée** (6 thèmes curatés, `CURATED_THEMES` — jamais une
 * couleur IA arbitraire) : le contraste titre/nœuds/trait sur ce tint est **prouvé
 * analytiquement** pour les 6 accents × 2 thèmes (MapScreen.test.tsx), pas seulement affirmé.
 * Le thème est un attribut **non-clé** : il ne touche jamais la géométrie (#123).
 *
 * **Richesse visuelle per-monde (story #190)** : au-delà de l'accent/titre/fond, deux assets du
 * monde résolu (WORLDGEN §4) atteignent l'écran carte quand ils sont **validés** (`isRenderableAssetRef`,
 * même garde que le fond) — sinon rendu **propre** sans eux (déclaré ≠ consommé, #125/#180) : (a) une
 * **bande de décor thématisée** (`theme.tiles`, `WorldTilesBand`) rendue **en flux** entre l'accent et
 * le chemin (jamais sous un glyphe → zéro régression contraste #104/#170), (b) une **variante Teddy
 * per-monde** (`theme.teddy`, `CurrentNodeTeddy`, ancrée master figé #158/ADR 0009) posée en avatar
 * « tu es ici » **superposé** au médaillon du nœud courant → garde DOUBLÉE pixels + géométrie E2E
 * (non-occlusion #170), sans jamais recouvrir le glyphe de statut.
 *
 * **Contraste généralisé sur photo arbitraire (story #202)** : la photo (pas le tint, cf. #199)
 * est **arbitraire** — aucune garantie analytique possible (#170). Deux glyphes de bas de chemin
 * y étaient peints **sans** scrim (mesuré ~1.21:1 sur la fixture E2E rayée) : le bouton « Changer de
 * joueur » (`LogoutButton`, texte transparent) et le **trait du chemin** (`NodeConnector`, peint
 * dans la gouttière de `<main>`, backmost). Même patron que le scrim du titre (#189, opaque
 * `--world-surface`, jamais semi-transparent) : `FooterScrim` enveloppe `LogoutButton`, et
 * `NodeConnector` reçoit une **casing** opaque sous le trait coloré — **seulement** quand
 * `theme.background !== null` (sans photo, #199 couvre déjà le contraste analytiquement, pas de
 * scrim superflu). Les autres glyphes de l'écran (médaillons de nœud, étoiles, badge de type) ont
 * **déjà** leur propre fond opaque local (`--map-node-*-bg`) — inchangés par le fond de `<main>`,
 * revérifié par audit (MapScreen.test.tsx, CLAUDE.md règle #126 : auditer TOUS les glyphes).
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
 *
 * **Reflow responsive (story 8.2 #255, WIREFRAMES §8 « carte : scroll vertical du chemin »)** :
 * le chemin est un `<ol>` en `flexDirection:column-reverse` sans contrainte de hauteur/`overflow`
 * sur `<main>` (`minHeight:100dvh`, flux normal) — le **scroll vertical de la page** est donc déjà
 * la mécanique native, à TOUTE largeur de viewport (aucun changement requis pour l'obtenir). Le
 * décalage horizontal serpentin (`translateX`, `NodePath`) est **relatif à la largeur du nœud
 * lui-même** (±50 % de `--map-node-size`, jamais du viewport) → **aucun risque de débordement
 * horizontal**, quelle que soit la largeur d'écran (prouvé E2E aux 3 tailles). Le SEUL ajustement
 * `useIsPhone` (`--bp-phone`) consommé ici : la marge horizontale de `<main>` se resserre
 * (`--space-6` → `--space-4`) sous le breakpoint téléphone, pour donner plus de largeur utile au
 * chemin sur un viewport étroit (WIREFRAMES §8 « nœuds/médaillons correctement disposés ») —
 * **tablette/desktop gardent `--space-6`** (disposition actuelle préservée, AC story 8.2, aucune
 * régression). Ce padding est **CSS pur** : il ne touche jamais `WorldMap.nodes` (compte/positions
 * restent invariants à l'état runtime, rétro #123 — étendu ici à l'état `isPhone`, garde unitaire
 * dédiée) ni la géométrie LOCALE Teddy↔médaillon (`--map-node-teddy-size`/`--map-node-gap`, tokens
 * fixes indépendants du padding de `<main>`) — la non-occlusion #170/#190 déjà prouvée reste donc
 * valide à toute largeur, **revérifiée explicitement aux 3 tailles par garde E2E** (jamais une
 * géométrie seulement raisonnée, rétro #190 : ce même écran EST la surface littérale de ce piège).
 * Collection (grille)/Boutique (cartes empilées) = story 8.2b, **hors scope ici**.
 *
 * **Auto-scroll vers le nœud courant au montage (story #268, discovered playtest-⚙️)** : sur
 * téléphone la carte scrolle verticalement (WIREFRAMES §8, `<main>` sans `overflow`, scroll de
 * PAGE natif) et le nœud courant (Teddy + ▶) n'est PAS toujours dans le premier écran — sa
 * position dans le chemin `column-reverse` dépend de la progression (nœud 0 = fond du chemin,
 * boss = sommet), donc l'enfant peut devoir scroller manuellement pour retrouver son point de
 * reprise. WIREFRAMES §8 n'exige pas cet ancrage (calibration UX in-contract) : `NodePath` ancre
 * le lien du nœud **courant** (`currentNodeRef`) et l'amène dans le viewport via
 * `scrollIntoView` dans un `useEffect([])` **MONT-ONLY volontaire** (CLAUDE.md piège #244) —
 * sûr ici car `NodePath` n'est rendu QUE depuis la branche `screen.kind === "ready"` de
 * `MapScreen` (jamais `loading`/`error`/`unavailable`), donc chaque apparition de `NodePath`
 * est un vrai montage React (nouvelle instance), jamais une UPDATE d'un composant réconcilié à
 * la même position. `prefers-reduced-motion` (a11y, CLAUDE.md) → `behavior:"auto"` (scroll
 * instantané, jamais l'animation `"smooth"`). Ne touche QUE le scroll : la géométrie de
 * `WorldMap.nodes` (compte/positions, invariance #123) est totalement inchangée.
 *
 * **Calibration richesse per-monde à froid (⚙️ playtest #203, discovered issue de #190)** : le
 * proprio a joué la carte (32px, marge amont 8px) et rapporté Teddy à la fois « trop petit » ET
 * « qui chevauche » — deux forces opposées. Recalibré au COUPLE taille+chevauchement (cf.
 * `CurrentNodeTeddy`, 32→40px), jamais la taille seule (rétro #190 : agrandir sans creuser le
 * chevauchement redonnerait l'occlusion originale). `WorldTilesBand` reçoit un cadre
 * bordure+ombre (`--map-tiles-border`/`--map-tiles-shadow`) pour lire comme un décor intentionnel
 * plutôt qu'un bandeau orphelin — hauteur (96px) inchangée, la question du proprio portait sur la
 * LECTURE, pas la taille. Aucun changement de `WorldMap.nodes` ni de `--map-node-gap` (#123).
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

/**
 * **Avatar Teddy per-monde** posé sur le nœud **courant** (mascotte-guide « tu es ici », MAP §1
 * point de reprise). Rendu **uniquement** quand le monde résolu fournit une variante Teddy validée
 * (`theme.teddy !== null`, ancrée img2img sur le master figé #158, ADR 0009, WORLDGEN §4/§8). La
 * richesse per-monde **atteint réellement l'enfant** sur le chemin (déclaré ≠ consommé, #125/#180).
 *
 * **Décoratif** (`aria-hidden`, `background-image`, jamais un `<img>` non validé) : le nœud porte
 * déjà son nom accessible complet → Teddy n'ajoute aucune info (pas de double annonce a11y).
 *
 * **Superposé / anti-occlusion (#170)** : `position:absolute` **hors flux** (n'altère NI le nombre
 * de nœuds NI leurs positions → invariance de géométrie #123) dans le médaillon `position:relative`.
 * Il **flotte AU-DESSUS** de la pastille (`bottom:100%` + léger chevauchement décoratif du haut) →
 * son bas reste **au-dessus du glyphe de statut centré**, jamais recouvrant (`zIndex` > connecteur).
 * Garde DOUBLÉE (jsdom ne fait aucun layout) : preuve pixel (capture réelle ouverte) + preuve
 * **géométrie E2E** (`e2e/auth.spec.ts` : avatar visible, dans le cadre, bas ≤ centre du médaillon).
 *
 * **Calibration présence/occlusion (⚙️ playtest #203)** : le proprio a rapporté Teddy à la fois
 * « trop petit » (32px, fix #170) ET « qui chevauche » — deux forces opposées sur le MÊME avatar.
 * Résolu en faisant varier **le couple** taille (`--map-node-teddy-size`, 32→40px) ET profondeur du
 * chevauchement décoratif du haut (`--space-2`→`--space-4`, -8px→-16px) **ensemble** : l'avatar
 * « coiffe » davantage son PROPRE médaillon (plus de présence visuelle, glyphe de statut toujours
 * dégagé — marge aval 16px, jamais < la moitié du rayon du médaillon) au lieu de déborder vers le
 * médaillon AMONT (marge inchangée, 8px — même delta numérique que le fix #170 original). Agrandir
 * SEULEMENT la taille sans approfondir le chevauchement referait déborder l'avatar (rétro #190) :
 * la garde E2E `teddyTop ≥ bas du médaillon amont` (jamais une géométrie raisonnée seule) est
 * l'arbitre, pas ce commentaire.
 */
function CurrentNodeTeddy({ src }: { readonly src: string }) {
  return (
    <span
      aria-hidden="true"
      data-world-teddy=""
      style={{
        position: "absolute",
        // Flotte au-dessus de la pastille ; chevauchement décoratif du haut du médaillon
        // (--space-4, ⚙️ #203) → l'avatar « coiffe » le nœud (présence) sans jamais recouvrir
        // le glyphe centré (marge aval encore généreuse, cf. commentaire de tête).
        bottom: "100%",
        marginBottom: "calc(var(--space-4) * -1)",
        left: "50%",
        transform: "translateX(-50%)",
        width: "var(--map-node-teddy-size)",
        height: "var(--map-node-teddy-size)",
        backgroundImage: `url("${src}")`,
        backgroundSize: "contain",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        pointerEvents: "none",
        zIndex: 3,
      }}
    />
  );
}

/** Une pastille de nœud du chemin (verrouillé / courant / terminé), doublée d'un texte. */
function NodeBadge({
  node,
  total,
  teddyUrl,
  anchorRef,
}: {
  readonly node: MapNode;
  readonly total: number;
  /** URL validée de la variante Teddy per-monde, ou `null` (aucun avatar). Rendu sur le nœud courant. */
  readonly teddyUrl: string | null;
  /**
   * Ref posée sur le lien du nœud (ancrage auto-scroll #268) — fournie par `NodePath`
   * uniquement pour le nœud **courant** (`undefined` pour tous les autres). Sans effet sur un
   * nœud verrouillé (jamais un lien, cf. `isNavigable`) : le nœud courant est TOUJOURS navigable
   * (`status === "current"` ⊂ `isNavigable`), donc toujours attaché à un vrai `<a>`.
   */
  readonly anchorRef?: Ref<HTMLAnchorElement>;
}) {
  const accessibleName = nodeAccessibleName(node, total);
  const badge = (
    <span
      aria-hidden="true"
      data-map-medallion=""
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
      {/* Avatar Teddy per-monde sur le nœud COURANT (marqueur « tu es ici ») — rendu seulement si
          le monde fournit une variante Teddy validée. Superposé, flotte au-dessus, jamais occlusif. */}
      {node.status === "current" && teddyUrl !== null && <CurrentNodeTeddy src={teddyUrl} />}
    </span>
  );

  // Les étoiles étant désormais absolues DANS le cercle, le contenu = la seule pastille
  // (plus de colonne badge+étoiles qui allongeait le nœud et cassait le connecteur).
  const content = badge;

  if (isNavigable(node.status)) {
    return (
      <Link
        ref={anchorRef}
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
 *
 * **Casing de contraste sur photo (story #202)** : quand une **photo IA arbitraire** du monde est
 * active (`hasBackground`), le trait est peint dans la gouttière de `<main>` (backmost) directement
 * SUR la photo → contraste **non garantissable analytiquement** (sur la fixture E2E rayée ~1.21:1,
 * quasi invisible, #170). Même patron que le scrim du titre (#189) : une **casing OPAQUE**
 * (`--world-surface`, jamais semi-transparente) plus large (`--map-node-path-casing-width` = 8px >
 * les 4px du trait) est peinte **sous** le trait coloré → le fond de RÉFÉRENCE de contraste du trait
 * redevient un token opaque (`--world-surface`), pas la photo. Rendue **uniquement** sur photo :
 * sans photo (tint-seul #199 / neutre), le contraste du trait est déjà prouvé analytiquement
 * (MapScreen.test.tsx) → pas de casing superflue. La casing partage la géométrie exacte du trait
 * (même `x1/x2`, même SVG en gouttière) → aucun risque d'occlusion nouveau (#170/#190).
 */
function NodeConnector({
  fromX,
  toX,
  hasBackground,
}: {
  readonly fromX: number;
  readonly toX: number;
  /** `true` si une photo réelle du monde est rendue → casing opaque sous le trait (contraste, #202). */
  readonly hasBackground: boolean;
}) {
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
      {/* Casing OPAQUE (story #202) : peinte EN PREMIER (donc SOUS le trait coloré, ordre de peinture
          SVG) et plus large → le fond de référence de contraste du trait redevient `--world-surface`
          (opaque), jamais la photo arbitraire (#170). Rendue seulement sur photo (sans photo, #199 :
          contraste déjà prouvé analytiquement). Même géométrie que le trait → 0 occlusion nouvelle. */}
      {hasBackground && (
        <line
          data-map-connector-casing=""
          x1={x1}
          y1={0}
          x2={x2}
          y2={100}
          style={{
            stroke: "var(--world-surface)",
            strokeWidth: "var(--map-node-path-casing-width)",
          }}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
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
function NodePath({
  map,
  teddyUrl,
  hasBackground,
}: {
  readonly map: WorldMap;
  /** Variante Teddy per-monde validée (ou `null`) — posée sur le nœud courant (marqueur « tu es ici »). */
  readonly teddyUrl: string | null;
  /** `true` si une photo réelle du monde est rendue → casing opaque sous le trait (contraste, #202). */
  readonly hasBackground: boolean;
}) {
  const total = map.nodes.length;
  // Ancrage auto-scroll vers le nœud COURANT au montage (story #268) — cf. commentaire de tête
  // (MONT-ONLY volontaire, sûr car `NodePath` n'est rendu que depuis la branche `ready`).
  const currentNodeRef = useRef<HTMLAnchorElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  useEffect(() => {
    // `[]` : ancrage MONT-ONLY volontaire (CLAUDE.md piège #244) — ne doit PAS se ré-exécuter à
    // chaque re-render de `MapScreen` pendant que la carte reste `ready` (ex. `isPhone` qui
    // change au redimensionnement) : un effet dépendant de `prefersReducedMotion` scroll-jackerait
    // l'enfant en pleine lecture de la carte. `NodePath` n'apparaît QUE dans l'état `ready` → chaque
    // fois qu'il apparaît est un vrai montage React (nouvelle instance), jamais une UPDATE d'un
    // composant réconcilié à la même position (le piège #244 ne s'applique pas ici).
    currentNodeRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "center",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mont-only volontaire, cf. commentaire ci-dessus (#268/#244)
  }, []);
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
              <NodeConnector
                fromX={node.position.x}
                toX={previous.position.x}
                hasBackground={hasBackground}
              />
            )}
            <NodeBadge
              node={node}
              total={total}
              teddyUrl={teddyUrl}
              anchorRef={node.status === "current" ? currentNodeRef : undefined}
            />
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
 * **Fond du monde** : le `<main>` peint TOUJOURS le **tint per-monde `--world-bg-tint`** comme
 * `backgroundColor` dès qu'un thème est résolu (story #199 — avant, le tint était re-dérivé mais
 * peint SEULEMENT quand une photo existait, donc **jamais visible** dans l'état sans-image : repli
 * socle placeholder, CI, hors-ligne → carte neutre, identité du monde non vécue, gap #180). Quand un
 * **asset réel validé** existe en plus (`theme.background !== null`, chemin Nginx passé par
 * `isRenderableAssetRef`), l'image du monde se pose **par-dessus** ce tint en couverture. Le fond
 * (tint OU image) étant le `background` de `<main>` (backmost), il ne peut **jamais** recouvrir les
 * nœuds (anti-occlusion #170). Sûr **sans scrim** dans l'état tint-seul : la palette d'accent est
 * bornée (6 thèmes curatés) → contraste des glyphes/titre/trait sur ce tint **prouvé
 * analytiquement** (MapScreen.test.tsx), contrairement à la photo arbitraire (qui, elle, exige un
 * scrim/casing opaque, cf. `ThemedTitle` #189 / `FooterScrim`+casing du trait #202).
 *
 * **Tint per-monde (fix #184, story #189/#199)** : `--world-bg-tint` (`color-mix(--world-accent 10%,
 * surface)`) est **RE-DÉCLARÉ ICI** (au niveau de la surcharge inline de `--world-accent`), pas
 * seulement à `:root`. Raison : la substitution `var()` d'un custom-property se résout **au niveau
 * où la propriété est DÉCLARÉE** — le `--world-bg-tint` de `:root` reste donc **NEUTRE** sous une
 * surcharge **descendante** de sa var source (`<main>`), c'est un **faux-dérivé dormant** (piège
 * #184). En le re-déclarant sur `<main>` (même élément que `--world-accent`), le `color-mix` se
 * re-résout avec l'accent du monde → tint réellement **per-monde**, theme-safe (light ET dark). Le
 * `backgroundColor` posé ci-dessous consomme cette re-déclaration → le tint est bien PEINT per-monde.
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
    // ⚠️ Garder cette formule en SYNC avec `tokens.css` (`--world-bg-tint`, même ratio 10%) : la
    // re-déclaration inline est un contournement #184 (`color-mix` à `:root` ne se re-dérive PAS
    // sous une surcharge descendante de `--world-accent`), donc la formule est volontairement
    // DUPLIQUÉE ici — un changement du wash dans `tokens.css` doit être répercuté à cette ligne.
    ["--world-bg-tint" as string]:
      "color-mix(in srgb, var(--world-accent) 10%, var(--color-bg-secondary))",
    // Story #199 : le tint per-monde est PEINT comme fond réel de la carte dès qu'un thème est
    // résolu (plus seulement quand une photo existe). Consomme la re-déclaration ci-dessus → tint
    // per-monde effectif. Sans photo, c'est LE fond qui donne l'identité du monde à l'enfant.
    backgroundColor: "var(--world-bg-tint)",
  };
  if (theme.background !== null) {
    // Asset validé (Nginx) → image du monde en couverture, PAR-DESSUS le tint per-monde déjà posé
    // (repli theme-safe si l'image ne décode pas). Jamais rendu vers une URL non validée (garde
    // `isRenderableAssetRef`). Le titre reçoit un scrim `--world-surface` (cf. `ThemedTitle`).
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
 * **Bande de décor thématisée du monde** (« tuiles de carte », WORLDGEN §4, story #190) — élément
 * **décoratif** (`aria-hidden`) rendu **uniquement** quand le monde résolu fournit des tuiles
 * validées (`theme.tiles !== null`, chemin Nginx passé par `isRenderableAssetRef`). C'est la
 * richesse visuelle per-monde qui **atteint l'enfant** sur l'écran carte (déclaré ≠ consommé,
 * #125/#180) : son image change avec le monde (généré/socle).
 *
 * **Zéro régression contraste (#104/#125/#170)** : la bande est rendue **entre** le bandeau d'accent
 * et le chemin, **en flux** — aucun glyphe de nœud, aucun titre, aucun trait de connecteur n'est
 * empilé **par-dessus** elle, donc le **fond de référence de contraste** des glyphes de nœud (leur
 * médaillon opaque) reste **inchangé**. Repli teinté `--world-bg-tint` **per-monde** sous l'image
 * (hérité de `<main>` qui le re-déclare, fix #184) : jamais un `<img>` vers une URL non validée.
 *
 * **Cadre « carte postale » (⚙️ playtest #203)** : sans bordure ni ombre, une bande plein-largeur se
 * fond visuellement dans le fond de la carte (surtout en tint-seul #199, même famille de couleur) et
 * se lit comme un artefact plutôt qu'un élément posé. `--map-tiles-border`/`--map-tiles-shadow`
 * (mêmes tokens que les CARTES de l'app, `--color-border-primary`/`--card-shadow`) l'habillent d'un
 * cadre discret cohérent avec le langage visuel des autres surfaces cartes — purement décoratif,
 * aucun changement de contraste texte (la bande ne porte aucun glyphe).
 */
function WorldTilesBand({ src }: { readonly src: string }) {
  return (
    <div
      aria-hidden="true"
      data-world-tiles=""
      style={{
        width: "100%",
        maxWidth: "var(--max-width-play)",
        height: "var(--map-tiles-height)",
        backgroundColor: "var(--world-bg-tint)",
        backgroundImage: `url("${src}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        borderRadius: "var(--map-tiles-radius)",
        border: "1px solid var(--map-tiles-border)",
        boxShadow: "var(--map-tiles-shadow)",
      }}
    />
  );
}

/**
 * **Titre du monde + scrim de contraste** (story #189). Quand un **fond-image réel** du monde est
 * rendu (`hasBackground`, i.e. `theme.background !== null`), le titre est posé sur une **carte scrim
 * OPAQUE** consommant `--world-surface` (surface **du thème** light/dark, déclarée au §per-monde de
 * DESIGN_TOKENS mais **CONSTANTE entre mondes** — seul `--world-accent` varie ; jusqu'ici
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
        // Scrim OPAQUE = surface **du thème** (light/dark, constante entre mondes ; consomme
        // `--world-surface`, #125) : garantit le contraste du titre quelle que soit la photo IA
        // (jamais semi-transparent, #170). Seul `--world-accent`/`--world-bg-tint` varient par monde.
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

/**
 * **Scrim de contraste du bouton de bas d'écran** (« Changer de joueur », `LogoutButton`, story
 * #202). Le bouton est un contrôle **ghost/outline** (`background:transparent`, texte
 * `--color-text-secondary`, cf. `LogoutButton.tsx`) : sans fond opaque, son texte est peint
 * directement sur le fond de `<main>`. Sur une **photo IA arbitraire** (`active`, i.e.
 * `theme.background !== null`), ce fond n'est plus un token → contraste **non garantissable**
 * (mesuré ~1.21:1 sur la fixture E2E rayée, quasi illisible — #170, audit #126).
 *
 * Même patron que le scrim du titre (#189) : une **carte scrim OPAQUE** (`--world-surface`, jamais
 * semi-transparente) enveloppe le bouton → le fond de RÉFÉRENCE du texte redevient `--world-surface`
 * (`--color-text-secondary` ≥4.5:1 sur `--world-surface`, résolu + testé, MapScreen.test.tsx),
 * INDÉPENDAMMENT de la photo. **Enfant en flux** (pas d'`absolute`/`z-index`) → aucun risque
 * d'occlusion (#170). Rendu **uniquement** sur photo (`active`) : sans photo (tint-seul #199 /
 * neutre), le bouton garde le contraste déjà prouvé sur son fond token (pas de scrim superflu, pas
 * de régression #125 dans les autres écrans — le bouton est partagé, cf. `PlayScreen`). Le hub
 * « Ma collection » a **déjà** son propre fond opaque local (`--color-bg-tertiary`) → pas concerné
 * (audit #126 : tous les glyphes du footer revus, seul le bouton ghost manquait de fond opaque).
 */
function FooterScrim({
  children,
  active,
}: {
  readonly children: ReactNode;
  readonly active: boolean;
}) {
  if (!active) {
    // Pas de photo (états loading/error/unavailable, ou ready sans image) : le bouton garde son
    // rendu natif sur un fond token → contraste déjà garanti, aucun scrim ajouté.
    return <>{children}</>;
  }
  return (
    <div
      data-world-footer-scrim=""
      style={{
        display: "inline-flex",
        // Scrim OPAQUE tokenisé (identique au scrim du titre #189) : le fond de référence du texte
        // ghost du bouton redevient `--world-surface`, jamais la photo arbitraire (#170). `padding:0`
        // + même `--border-radius-full` que le bouton → la pastille scrim épouse exactement le bouton.
        backgroundColor: "var(--world-surface)",
        borderRadius: "var(--border-radius-full)",
      }}
    >
      {children}
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
  // Reflow responsive (story 8.2 #255, WIREFRAMES §8) — seul consommateur de --bp-phone sur cet
  // écran, cf. commentaire de tête (marge de <main> resserrée, tablette/desktop inchangés).
  const isPhone = useIsPhone();

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
  // Une PHOTO réelle du monde est-elle rendue ? (`theme.background !== null`) → active les scrims
  // opaques de contraste sur photo arbitraire (#202 : titre déjà #189, bouton de bas d'écran +
  // casing du trait ici). Faux dans tous les autres états (loading/error/unavailable, ready
  // sans-image #199 où le contraste sur le tint borné est prouvé analytiquement).
  const hasBackground = theme?.background != null;
  const baseMainStyle: CSSProperties = {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--space-6)",
    // Marge resserrée sous --bp-phone (WIREFRAMES §8, story 8.2 #255) : plus de largeur utile pour
    // le chemin serpentin sur un viewport étroit. Tablette/desktop : --space-6 inchangé (AC : pas
    // de régression). CSS pur — aucune influence sur la géométrie de `WorldMap.nodes` (#123).
    padding: isPhone ? "var(--space-4)" : "var(--space-6)",
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
          {/* Bande de décor thématisée (tuiles du monde) — rendue seulement si le monde fournit des
              tuiles validées (WORLDGEN §4, #190). Décor per-monde visible, jamais sous un glyphe. */}
          {screen.map.theme.tiles !== null && <WorldTilesBand src={screen.map.theme.tiles} />}
          {/* Chemin des nœuds + variante Teddy per-monde sur le nœud courant (marqueur « tu es ici »).
              `hasBackground` → casing opaque sous le trait quand une photo réelle est rendue (#202). */}
          <NodePath
            map={screen.map}
            teddyUrl={screen.map.theme.teddy}
            hasBackground={screen.map.theme.background !== null}
          />
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

      {/* Bouton « Changer de joueur » (ghost/transparent) — enveloppé d'un scrim opaque
          `--world-surface` quand une photo réelle est rendue (contraste garanti sur photo
          arbitraire, #202) ; rendu nu sinon (fond token, contraste déjà garanti). */}
      <FooterScrim active={hasBackground}>
        <LogoutButton />
      </FooterScrim>
    </main>
  );
}
