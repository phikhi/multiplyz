import type { MetadataRoute } from "next";
import { BRAND_NAME } from "@/config/brand";
import { PWA_BG_COLOR, PWA_THEME_COLOR } from "@/config/pwa";

/**
 * Manifest Web App Manifest généré dynamiquement via l'API metadata Next.js.
 * Rendu à /manifest.webmanifest.
 *
 * Couleurs sourcées depuis src/config/pwa.ts (jamais de magic numbers ici).
 * cf. SYNC.md §4 (PWA installable), STACK.md §Frontend, DESIGN_TOKENS.md.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: "Jeu de maths ludique avec Teddy, ton copain d'aventure.",
    start_url: "/",
    display: "standalone",
    lang: "fr",
    theme_color: PWA_THEME_COLOR,
    background_color: PWA_BG_COLOR,
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
