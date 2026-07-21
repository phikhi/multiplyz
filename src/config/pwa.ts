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
 * Écrans de démarrage iOS (`apple-touch-startup-image`) — story R2.3 (#362).
 *
 * Contrairement à Chrome/Android (qui compose un splash automatiquement depuis le manifest :
 * `name` + `background_color` + icône 512), **iOS n'auto-génère PAS de splash** — il faut fournir
 * une image PAR device (résolution physique EXACTE + orientation), sinon l'app installée démarre
 * sur un écran vide. Cette liste (⚙️ centralisée = **source unique** partagée par le générateur
 * `scripts/gen-app-icons.ts` ET `layout.tsx` qui pose les `apple-touch-startup-image`) couvre les
 * iPhones **portrait** courants. Chaque device : dimensions CSS en **points** + `dpr` → le PNG
 * committé fait `width*dpr × height*dpr` px. Fond = `PWA_BG_COLOR` (même valeur que le
 * `background_color` du manifest — convention splash iOS).
 */
export interface AppleSplashDevice {
  /** Largeur CSS en points (portrait). */
  readonly width: number;
  /** Hauteur CSS en points (portrait). */
  readonly height: number;
  /** Device pixel ratio. */
  readonly dpr: number;
}

/** iPhones portrait courants (points CSS + dpr). Étendre ici = un nouveau device couvert (script + layout). */
export const APPLE_SPLASH_DEVICES: readonly AppleSplashDevice[] = [
  { width: 430, height: 932, dpr: 3 }, // 16 Pro Max / 15 Pro Max / 14 Pro Max
  { width: 402, height: 874, dpr: 3 }, // 16 Pro
  { width: 393, height: 852, dpr: 3 }, // 16 / 15 Pro / 15 / 14 Pro
  { width: 390, height: 844, dpr: 3 }, // 14 / 13 / 13 Pro / 12 / 12 Pro
  { width: 375, height: 812, dpr: 3 }, // 13 mini / 12 mini / 11 Pro / X / XS
  { width: 414, height: 896, dpr: 2 }, // 11 / XR
  { width: 375, height: 667, dpr: 2 }, // SE (2e/3e) / 8 / 7 / 6s
];

/** Dimensions PHYSIQUES (px) du splash d'un device portrait. Pure. */
export function appleSplashPixels(device: AppleSplashDevice): {
  readonly pxWidth: number;
  readonly pxHeight: number;
} {
  return { pxWidth: device.width * device.dpr, pxHeight: device.height * device.dpr };
}

/** Chemin public du splash d'un device — DÉRIVÉ des pixels (jamais dupliqué en dur, anti-drift #164). Pure. */
export function appleSplashUrl(device: AppleSplashDevice): string {
  const { pxWidth, pxHeight } = appleSplashPixels(device);
  return `/splash/apple-splash-${pxWidth}-${pxHeight}.png`;
}

/** Media query iOS exacte (points + dpr + portrait) qui sélectionne le splash de ce device. Pure. */
export function appleSplashMedia(device: AppleSplashDevice): string {
  return `(device-width: ${device.width}px) and (device-height: ${device.height}px) and (-webkit-device-pixel-ratio: ${device.dpr}) and (orientation: portrait)`;
}

/**
 * Entrées `startupImage` pour `Metadata.appleWebApp` (Next) : `{ url, media }` par device.
 * Consommé par `layout.tsx` — chaque URL doit pointer un PNG committé écrit par `gen-app-icons.ts`
 * (garde d'intégrité + anti-drift : `pwa-assets.test.ts`).
 */
export function appleStartupImages(): readonly { readonly url: string; readonly media: string }[] {
  return APPLE_SPLASH_DEVICES.map((device) => ({
    url: appleSplashUrl(device),
    media: appleSplashMedia(device),
  }));
}

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
