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

/**
 * Clé `localStorage` — persistance du rejet de l'invite d'installation (story 8.5, #258).
 *
 * L'invite (`InstallPrompt`, Chrome/Android `beforeinstallprompt` OU hint iOS) ne doit
 * JAMAIS réapparaître en boucle une fois rejetée par l'enfant/le parent (AC1). `localStorage`
 * est explicitement autorisé par la story (état de rejet **persistant** device-local, pas une
 * donnée de progression pédagogique/éco → hors du contrat serveur=source-de-vérité). Préfixe
 * `mz-` (même convention que les classes utilitaires `mz-focusable`/`mz-shake`, globals.css).
 */
export const INSTALL_PROMPT_DISMISSED_KEY = "mz-install-prompt-dismissed" as const;
