/**
 * **Thème per-monde câblé à la carte** (WORLDGEN §4/§7, DESIGN_TOKENS §per-monde, story 6.7).
 *
 * Module **pur / client-safe** (aucun import DB, aucun réseau) : il transforme le monde résolu
 * côté serveur (`resolveWorld`, 6.6 — palette + refs d'assets sérialisées en JSON dans la DB) en
 * un `WorldTheme` **propre et validé** que l'écran carte (`MapScreen`, client) consomme pour poser
 * `--world-accent` (DESIGN_TOKENS §per-monde) + rendre les **trois assets** per-monde validés :
 * fond du monde (`background`), bande de décor/tuiles (`tiles`) et variante Teddy (`teddy`).
 *
 * **Frontière de validation** (sécurité, story 6.7 + #190) : la palette + les refs d'assets viennent
 * de la DB (source de vérité serveur), mais on **revalide leur forme** avant de les rendre au front :
 * - palette → `deserializePalette` (accent hex `#RGB`/`#RRGGBB`, sinon `PaletteError` loud) ;
 * - chaque ref d'asset (`background`/`tiles`/`teddy`, WORLDGEN §4) → `isRenderableAssetRef` (chemin
 *   Nginx **relatif** attendu, jamais un `placeholder://…` du gate owner, jamais un schéma/hôte/`..`
 *   de traversée) — un ref non rendable retombe sur `null` (le front n'émet alors **aucun**
 *   `<img>`/`background-image` vers cette URL et applique son repli propre : fond teinté dérivé de
 *   l'accent pour le fond, aucune bande de décor / aucun avatar Teddy pour les deux autres).
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
 * le `label` de titre affichable (voix Teddy, WIREFRAMES §2 « Monde 3 · La Forêt »). Les trois refs
 * d'assets (`background`/`tiles`/`teddy`, WORLDGEN §4) sont chacune une URL Nginx **validée**, ou
 * `null` = pas d'asset réel rendable → repli propre (aucun `<img>`/`background-image` non validé).
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
  /**
   * URL **publique validée** des **tuiles/décor de carte** du monde (WORLDGEN §4, story #190), ou
   * `null` si le ref n'est pas un asset réel rendable. `null` ⇒ aucune bande de décor n'est rendue
   * (repli propre). Même contrat de sécurité que `background` (`isRenderableAssetRef`).
   */
  readonly tiles: string | null;
  /**
   * URL **publique validée** de la **variante Teddy per-monde** (img2img ancré sur le master figé
   * #158, ADR 0009, WORLDGEN §4/§8), ou `null` si le ref n'est pas un asset réel rendable. `null` ⇒
   * aucun avatar Teddy n'est rendu sur les nœuds (repli propre). Même contrat de sécurité que
   * `background` (`isRenderableAssetRef`).
   */
  readonly teddy: string | null;
}

/** Une carte du monde courant **thématisée** = la géométrie (`WorldMap`) + son thème per-monde. */
export type CurrentWorldMap = WorldMap & {
  /** Thème per-monde (accent/slug/label + assets `background`/`tiles`/`teddy`) — attribut **non-clé**
   * (n'altère pas la géométrie). */
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
 * Extrait la ref (string) de clé `key` d'un JSON `assetRefs` sérialisé, ou `null` si absente/mal
 * formée. Volontairement **tolérant** (pas de throw) : un `assetRefs` corrompu ne doit pas casser
 * toute la carte (no-fail pédagogie) — la clé retombe simplement sur « pas d'asset réel ». La
 * sécurité du rendu reste portée par `isRenderableAssetRef` en aval. Généralise l'ancien
 * `readBackgroundRef` (story 6.7) aux **trois** refs consommées par la carte (`background`/`tiles`/
 * `teddy`, story #190) — un seul contrat de lecture, une seule source de vérité.
 */
function readAssetRef(assetRefsJson: string, key: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(assetRefsJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const value = (parsed as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * URL publique **validée** de la ref de clé `key`, ou `null` si absente/non rendable. Applique le
 * **même contrat de sécurité** que le fond (story 6.7) à chacun des trois assets de carte
 * (`background`/`tiles`/`teddy`, story #190) : ref `null`, `placeholder://…`, schéma/hôte exotique
 * ou traversée `..` → `null` (jamais un `<img>`/`background-image` vers une URL non validée) ;
 * conforme (`world|socle/<x>/<y>.<ext>`) → URL publique Nginx. Pure — factorise l'unique garde.
 */
function readAssetUrl(assetRefsJson: string, key: string): string | null {
  const ref = readAssetRef(assetRefsJson, key);
  return ref !== null && isRenderableAssetRef(ref) ? assetPublicUrl(ref) : null;
}

/**
 * **Assemble le thème per-monde** validé depuis un monde résolu (6.6). Pure.
 *
 * 1. palette → `deserializePalette` (accent hex validé, sinon `PaletteError` loud) → `slug` + `accent` ;
 * 2. chaque ref d'asset (`background`/`tiles`/`teddy`, WORLDGEN §4) → `null` si absente/mal formée,
 *    sinon **validée** par `isRenderableAssetRef` : conforme → URL publique Nginx ; non conforme
 *    (placeholder, schéma, traversée) → `null` (repli propre, aucun fetch non validé). Contrat de
 *    sécurité **identique** pour les trois (une seule garde, `readAssetUrl`).
 *
 * @throws {PaletteError} si la palette stockée est illisible/mal formée (défense en profondeur DB).
 */
export function buildWorldTheme(input: ResolvedWorldThemeInput): WorldTheme {
  const palette = deserializePalette(input.palette);
  return {
    slug: palette.slug,
    accent: palette.accent,
    label: input.theme,
    background: readAssetUrl(input.assetRefs, "background"),
    tiles: readAssetUrl(input.assetRefs, "tiles"),
    teddy: readAssetUrl(input.assetRefs, "teddy"),
  };
}
