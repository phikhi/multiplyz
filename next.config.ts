import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Keep isolated browser checks independent from the family development server.
  distDir:
    process.env.TEDDY_CHECK_BUILD === "worlds"
      ? ".next-worlds-check"
      : process.env.TEDDY_CHECK_BUILD === "parent"
        ? ".next-parent-check"
        : process.env.TEDDY_CHECK_BUILD === "daily"
          ? ".next-daily-check"
          : ".next",
  // Development logs must not print PIN arguments from authentication actions.
  logging: { serverFunctions: false },
  // Runtime Node requis (SQLite local en #12) — pas de runtime edge.
  // Modules natifs (better-sqlite3, argon2 pour le hash des PIN #29) : laissés
  // hors du bundle serveur.
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
};

export default nextConfig;
