/**
 * **Thème per-monde câblé à la carte** (WORLDGEN §4/§7, DESIGN_TOKENS §per-monde, story 6.7).
 *
 * Module **pur / client-safe** (aucun import DB, aucun réseau) : il transforme le monde résolu
 * côté serveur (`resolveWorld`, 6.6 — palette + refs d'assets sérialisées en JSON dans la DB) en
 * un `WorldTheme` **propre et validé** que l'écran carte (`MapScreen`, client) consomme pour
 * poser `--world-accent` (DESIGN_TOKENS §per-monde) + rendre le fond du monde.
 *
 * **Frontière de validation** (sécurité, story 6.7) : la palette + les refs d'assets viennent de
 * la DB (source de vérité serveur), mais on **revalide leur forme** avant de les rendre au front :
 * - palette → `deserializePalette` (accent hex `#RGB`/`#RRGGBB`, sinon `PaletteError` loud) ;
 * - `assetRefs.background` → `isRenderableAssetRef` (chemin Nginx **relatif** attendu, jamais un
 *   `placeholder://…` du gate owner, jamais un schéma/hôte/`..` de traversée) — un ref non
 *   rendable retombe sur `background: null` (le front affiche alors le **fond teinté** dérivé de
 *   l'accent, jamais un `<img>`/`background-image` vers une URL non validée).
 *
 * **Invariance de géométrie** (rétro #123) : le thème est un attribut **non-clé** — il ne touche
 * NI le nombre de nœuds NI leurs positions (composés par `buildMap`, indépendants du thème). Il
 * s'attache à la carte sans jamais rétroagir sur sa géométrie.
 */

import { deserializePalette } from "@/lib/worldgen/palette";
import type { WorldMap } from "./map";

/**
 * Thème d'un monde prêt pour le rendu carte (client-safe). Un monde ne pose qu'**une** variable de
 * couleur (`accent` → `--world-accent`, DESIGN_TOKENS §per-monde) ; le `slug` sert de `[data-world]`,
 * le `label` de titre affichable (voix Teddy, WIREFRAMES §2 « Monde 3 · La Forêt »), et `background`
 * de fond du monde (URL Nginx **validée**, ou `null` = pas d'asset réel → fond teinté).
 */
export interface WorldTheme {
  /** Slug du monde (`[data-world="<slug>"]`, DESIGN_TOKENS §per-monde). */
  readonly slug: string;
  /** Couleur d'accent hex validée → `--world-accent` (la SEULE variable posée par un monde). */
  readonly accent: string;
  /** Label FR affichable du thème (titre carte, kid-safe). */
  readonly label: string;
  /**
   * URL **publique validée** du fond du monde (chemin Nginx), ou `null` si le ref stocké n'est pas
   * encore un asset réel rendable (placeholder du gate owner, ou ref non conforme). `null` ⇒ le
   * front n'émet **aucun** `<img>`/`background-image` et retombe sur le fond teinté (`--world-bg-tint`).
   */
  readonly background: string | null;
}

/** Une carte du monde courant **thématisée** = la géométrie (`WorldMap`) + son thème per-monde. */
export type CurrentWorldMap = WorldMap & {
  /** Thème per-monde (accent/slug/label/fond) — attribut **non-clé** (n'altère pas la géométrie). */
  readonly theme: WorldTheme;
};

/**
 * Champs bruts d'un monde résolu (`ResolvedWorld`, 6.6) nécessaires au thème — passés en **texte**
 * (JSON de la DB) pour garder ce module client-safe (aucun import du résolveur server-only).
 */
export interface ResolvedWorldThemeInput {
  /** Label du thème curaté (déjà kid-safe, WORLDGEN §4.1). */
  readonly theme: string;
  /** Palette sérialisée (JSON `WorldPalette`) — revalidée ici. */
  readonly palette: string;
  /** Refs d'assets sérialisées (JSON `{ background, tiles, teddy }`) — validées ici. */
  readonly assetRefs: string;
}

/**
 * **Base publique** des assets de monde servis par Nginx (WORLDGEN §5 : assets sur disque VPS,
 * servis par Nginx sous `public/`). Les refs stockées sont **relatives** (`world/<i>/…`,
 * `socle/<slot>/…`) ; le front préfixe cette base pour former l'URL publique. ⚙️ de déploiement
 * centralisé (jamais un chemin en dur éparpillé).
 */
export const WORLD_ASSET_BASE = "/generated/";

/**
 * Un **ref d'asset rendable** = chemin **relatif** Nginx sous le namespace `world/` ou `socle/`,
 * segments alphanumériques (`._-`), se terminant par une extension image. **Refuse** tout ce qui
 * n'est pas exactement cette forme : `placeholder://…` (gate owner, pas encore un asset réel),
 * schéma/hôte (`http:`, `//host`, `javascript:`), chemin absolu (`/etc/…`), backslash. Ancré
 * `^…$` → pas de sous-chaîne piégée.
 */
const RENDERABLE_ASSET_REF =
  /^(?:world|socle)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/u;

/**
 * `true` si `ref` est un chemin d'asset **sûr à rendre** (`<img>`/`background-image`) : forme Nginx
 * relative attendue (`world|socle/<x>/<y>.<ext>`), **sans traversée de chemin** (`..`). Garde de
 * sécurité (story 6.7) : la ref vient de la DB, mais on refuse par **défense en profondeur** tout ce
 * qui ne matche pas exactement — un placeholder, un schéma exotique ou un `..` ne doit **jamais**
 * devenir une URL fetchée. Pure. Consommée par `buildWorldTheme` (effet observable : `null` sinon).
 */
export function isRenderableAssetRef(ref: string): boolean {
  // `..` refusé explicitement (une traversée `world/0/../secret.png` matcherait sinon `[._-]+`).
  if (ref.includes("..")) {
    return false;
  }
  return RENDERABLE_ASSET_REF.test(ref);
}

/** URL publique (Nginx) d'un ref d'asset **déjà validé** (`isRenderableAssetRef`). Pure. */
export function assetPublicUrl(ref: string): string {
  return `${WORLD_ASSET_BASE}${ref}`;
}

/**
 * Extrait le `background` (string) d'un JSON `assetRefs` sérialisé, ou `null` si absent/mal formé.
 * Volontairement **tolérant** (pas de throw) : un `assetRefs` corrompu ne doit pas casser toute la
 * carte (no-fail pédagogie) — il retombe simplement sur « pas de fond réel » (fond teinté). La
 * sécurité du rendu reste portée par `isRenderableAssetRef` en aval.
 */
function readBackgroundRef(assetRefsJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(assetRefsJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const { background } = parsed as Record<string, unknown>;
  return typeof background === "string" ? background : null;
}

/**
 * **Assemble le thème per-monde** validé depuis un monde résolu (6.6). Pure.
 *
 * 1. palette → `deserializePalette` (accent hex validé, sinon `PaletteError` loud) → `slug` + `accent` ;
 * 2. `assetRefs.background` → `null` si absent/mal formé, sinon **validé** par `isRenderableAssetRef` :
 *    conforme → URL publique Nginx ; non conforme (placeholder, schéma, traversée) → `null` (fond teinté).
 *
 * @throws {PaletteError} si la palette stockée est illisible/mal formée (défense en profondeur DB).
 */
export function buildWorldTheme(input: ResolvedWorldThemeInput): WorldTheme {
  const palette = deserializePalette(input.palette);
  const backgroundRef = readBackgroundRef(input.assetRefs);
  const background =
    backgroundRef !== null && isRenderableAssetRef(backgroundRef)
      ? assetPublicUrl(backgroundRef)
      : null;
  return {
    slug: palette.slug,
    accent: palette.accent,
    label: input.theme,
    background,
  };
}
