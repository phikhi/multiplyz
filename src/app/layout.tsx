import type { Metadata } from "next";
import { BRAND_NAME } from "@/config/brand";
import { LOCALE, strings } from "@/strings";
import "./globals.css";

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: strings.meta.description,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={LOCALE}>
      <body>{children}</body>
    </html>
  );
}
