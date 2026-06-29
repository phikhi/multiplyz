import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Runtime Node requis (SQLite local en #12) — pas de runtime edge.
  // better-sqlite3 est un module natif : on le laisse hors du bundle serveur.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
