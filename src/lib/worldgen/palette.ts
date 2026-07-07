/**
 * **Dérivation de palette** d'un monde généré (WORLDGEN §4.2, DESIGN_TOKENS §per-monde).
 *
 * Un monde ne pose qu'**une seule variable** : `--world-accent` (DESIGN_TOKENS §per-monde,
 * CLAUDE.md « un monde ne pose que `--world-accent` »). Le tint (`--world-bg-tint`) et la
 * surface se **dérivent automatiquement** côté CSS (`color-mix`) → **theme-safe** (lisible en
 * clair ET en sombre). On ne persiste donc **que** l'accent + le slug (`[data-world]`), jamais
 * un pastel clair en dur (piège DESIGN_TOKENS §per-monde : un fond clair figé casse le dark mode).
 *
 * Fonction **pure** (aucune I/O, aucun RNG) : l'accent vient du thème curaté (`worldgen-themes`).
 * Le résultat est sérialisé en JSON dans `worlds.palette` (colonne texte) et lu par le front pour
 * poser `[data-world="<slug>"] { --world-accent: <accent> }`.
 */

/**
 * Palette d'un monde (WORLDGEN §4.2). **Un seul token de couleur** (`accent` → `--world-accent`),
 * le reste étant dérivé côté CSS (theme-safe). Le `slug` sert de sélecteur `[data-world]`.
 */
export interface WorldPalette {
  /** Slug du monde (`[data-world="<slug>"]`, DESIGN_TOKENS §per-monde). */
  readonly slug: string;
  /** Couleur d'accent hex → `--world-accent` (la SEULE variable posée par un monde). */
  readonly accent: string;
}

/** `#RGB` ou `#RRGGBB` valide (garde de forme d'un accent hex avant persistance). */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * `true` si `value` est une couleur hex valide (`#RGB`/`#RRGGBB`). Garde de forme : un accent
 * de thème mal formé ne doit **jamais** être posé en `--world-accent` (CSS invalide → variable
 * ignorée, monde sans teinte). Consommée par `deriveWorldPalette` (échec loud, jamais silencieux).
 */
export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

/** Erreur de dérivation de palette (accent de thème mal formé — garde de forme). */
export class PaletteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaletteError";
  }
}

/**
 * Dérive la **palette** d'un monde depuis le slug + l'accent de son thème curaté (WORLDGEN §4.2).
 * Valide l'accent (`isHexColor`) — un accent mal formé **lève** (`PaletteError`, échec loud au
 * seam : mieux vaut un throw actionnable qu'une variable CSS silencieusement ignorée). Pure.
 *
 * @throws {PaletteError} si `accent` n'est pas une couleur hex valide.
 */
export function deriveWorldPalette(slug: string, accent: string): WorldPalette {
  if (!isHexColor(accent)) {
    throw new PaletteError(
      `Palette invalide pour le monde "${slug}" : accent "${accent}" n'est pas une couleur hex ` +
        `(#RGB / #RRGGBB). Corrige le thème dans worldgen-themes.ts.`,
    );
  }
  return { slug, accent };
}

/** Sérialise une palette pour la colonne texte `worlds.palette` (JSON stable). */
export function serializePalette(palette: WorldPalette): string {
  return JSON.stringify(palette);
}
