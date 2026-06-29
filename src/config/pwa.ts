/**
 * Constantes PWA — couleurs du manifest Web App Manifest.
 *
 * Le manifest est du JSON brut : les valeurs ne peuvent pas être des var(--…).
 * Ces hexadécimaux sont sourcés depuis tokens.css (mode clair) et centralisés
 * ici pour éviter les magic numbers éparpillés (règle tokens §CLAUDE.md).
 *
 * theme_color      = --color-accent-primary light  (#7A5AF8 violet)
 * background_color = --color-bg-primary light       (#FAF7FF lavande crème)
 */
export const PWA_THEME_COLOR = "#7A5AF8" as const;
export const PWA_BG_COLOR = "#FAF7FF" as const;
