import type { MetadataRoute } from "next";
import { BRAND_NAME } from "@/config/brand";
import { PWA_BG_COLOR, PWA_THEME_COLOR } from "@/config/pwa";
import { strings } from "@/strings";

/**
 * Manifest Web App Manifest généré dynamiquement via l'API metadata Next.js.
 * Rendu à /manifest.webmanifest.
 *
 * - description sourcée depuis strings.meta.description (cohérence, zéro duplication).
 * - Couleurs sourcées depuis src/config/pwa.ts (pas de magic numbers).
 * - id "/" → identifiant stable de l'app (remplacement d'installation propre).
 * cf. SYNC.md §4 (PWA installable), STACK.md §Frontend, DESIGN_TOKENS.md.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: strings.meta.description,
    start_url: "/",
    display: "standalone",
    lang: "fr",
    theme_color: PWA_THEME_COLOR,
    background_color: PWA_BG_COLOR,
    // Fichiers SÉPARÉS `any` vs `maskable` (story R2.3, #362) : une icône `maskable` a une
    // **zone de sécurité** (Teddy réduit, marge autour) pour survivre au masque Android
    // (cercle/squircle) ; une icône `any` va bord-à-bord (Teddy large). Réutiliser le MÊME
    // fichier pour les deux purposes rognerait Teddy en `maskable` OU le laisserait sur-margé en
    // `any`. Chaque `src` pointe un PNG committé RÉEL à l'effigie de Teddy (généré par
    // `scripts/gen-app-icons.ts`, intégrité + dims + non-rognage vérifiés par `pwa-assets.test.ts`).
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
