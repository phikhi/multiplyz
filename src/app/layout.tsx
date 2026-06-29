import type { Metadata } from "next";
import { BRAND_NAME } from "@/config/brand";
import { LOCALE, strings } from "@/strings";
import { Baloo_2, Nunito } from "next/font/google";
import "./globals.css";

const baloo2 = Baloo_2({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  // Override --font-family-display (défini dans tokens.css) avec l'URL optimisée.
  variable: "--font-family-display",
  display: "swap",
});

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  // Override --font-family-body (défini dans tokens.css) avec l'URL optimisée.
  variable: "--font-family-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: strings.meta.description,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={LOCALE} className={`${baloo2.variable} ${nunito.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
