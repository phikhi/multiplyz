import type { Metadata, Viewport } from "next";
import { BRAND_NAME } from "@/config/brand";
import { PWA_THEME_COLOR } from "@/config/pwa";
import { LOCALE, strings } from "@/strings";
import { getDb } from "@/lib/db";
import { householdExists } from "@/lib/auth/household";
import { dataThemeAttr, readHouseholdSettings } from "@/lib/parent/settings";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { InstallPrompt } from "@/components/InstallPrompt";
import { Baloo_2, Nunito } from "next/font/google";
import "./globals.css";

// Le layout racine lit le **thème du foyer** (source de vérité serveur, story 7.3) à CHAQUE requête
// pour poser `data-theme` sur `<html>` → jamais prérendu au build (sinon ouverture SQLite au build).
// Runtime Node explicite (better-sqlite3, pas edge). Réglage `system` → aucun attribut (le
// média-query `prefers-color-scheme` de `tokens.css` décide) ; `light`/`dark` → attribut posé.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const baloo2 = Baloo_2({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  // Fournit --font-next-display, référencé par --font-family-display via globals.css.
  variable: "--font-next-display",
  display: "swap",
});

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  // Fournit --font-next-body, référencé par --font-family-body via globals.css.
  variable: "--font-next-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: strings.meta.description,
  icons: {
    // Apple touch icon (iPad/iPhone home screen)
    apple: "/icon-192.png",
  },
  other: {
    // PWA hints pour iOS / Safari
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
    "apple-mobile-web-app-title": BRAND_NAME,
  },
};

/**
 * Viewport + thème couleur (Next.js 14+ : themeColor sort de Metadata vers Viewport).
 * themeColor sourcé de src/config/pwa.ts (pas de magic number).
 */
export const viewport: Viewport = {
  themeColor: PWA_THEME_COLOR,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Thème du foyer (7.3) → `data-theme` app-wide. `system` = `undefined` → attribut omis par React.
  const db = getDb();
  const themeAttr = dataThemeAttr(readHouseholdSettings(db).theme);
  // Foyer présent ? Tranche l'ambiguïté de `/` pour le gating de l'invite d'installation (8.5) :
  // onboarding premier-run (foyer absent) = surface à NE PAS recouvrir vs sélecteur/retour
  // quotidien (foyer présent) = surface calme éligible. Lecture serveur = source de vérité.
  const hasHousehold = householdExists(db);
  return (
    <html
      lang={LOCALE}
      data-theme={themeAttr}
      className={`${baloo2.variable} ${nunito.variable}`}
      suppressHydrationWarning
    >
      <body>
        {children}
        {/* PWA : bannière douce si coupure réseau (cf. SYNC.md §3, strings.pwa.offline) */}
        <OfflineBanner />
        {/* PWA : enregistrement du service worker custom (cf. public/sw.js) */}
        <ServiceWorkerRegistration />
        {/* PWA : invite d'installation discrète, gatée aux surfaces enfant calmes (8.5 #258) */}
        <InstallPrompt householdExists={hasHousehold} />
      </body>
    </html>
  );
}
