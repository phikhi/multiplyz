import type { Metadata, Viewport } from "next";
import { BRAND_NAME } from "@/config/brand";
import { PWA_THEME_COLOR } from "@/config/pwa";
import { LOCALE, strings } from "@/strings";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { Baloo_2, Nunito } from "next/font/google";
import "./globals.css";

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
  return (
    <html
      lang={LOCALE}
      className={`${baloo2.variable} ${nunito.variable}`}
      suppressHydrationWarning
    >
      <body>
        {children}
        {/* PWA : bannière douce si coupure réseau (cf. SYNC.md §3, strings.pwa.offline) */}
        <OfflineBanner />
        {/* PWA : enregistrement du service worker custom (cf. public/sw.js) */}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
