import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Runtime Node requis (SQLite local en #12) — pas de runtime edge.
  // Modules natifs (better-sqlite3, argon2 pour le hash des PIN #29) : laissés
  // hors du bundle serveur.
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
};

export default nextConfig;
