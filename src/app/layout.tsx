import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "multiplyz",
  description: "Jeu de maths ludique.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
