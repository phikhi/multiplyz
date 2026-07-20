// CLI exécuté par `pnpm dev` (APRÈS `db:migrate`, AVANT `next dev` — même contexte cwd/DATABASE_PATH
// que le serveur, aucune divergence de chemin possible). Story R0.1 (#323, épic R0 #316) :
// aujourd'hui `pnpm db:migrate` amorce le socle avec des refs `placeholder://…` (`seedSocleWorlds`,
// gate owner #158/#181) → en dev local frais, la carte ne montre AUCUN art (fallback tint seul,
// #199), jamais le vrai monde kawaii. Ce script pointe le slot 0 sur la MÊME fixture réelle
// dé-échantillonnée que l'E2E (`seedRealWorldFixture`, partagée avec `e2e/seed-world-assets.ts`) —
// AC1 #323 : dev (`next dev`) rend le vrai art socle, plus le fixture rayé ni le blanc.
//
// Hors `src/` (pas de coverage, même patron que `scripts/db-migrate.ts`) : wiring I/O pur, la
// logique (copie + réécriture theme/palette/assetRefs) vit dans `scripts/lib/seed-real-world-fixture`.
//
// Ne touche JAMAIS `pnpm build`/`pnpm start` (production, Forge/VPS) — ce script n'est câblé que
// dans le script `dev` de `package.json`.
import { resolveDatabasePath } from "../src/lib/db/config";
import { seedRealWorldFixture } from "./lib/seed-real-world-fixture";

seedRealWorldFixture({
  databasePath: resolveDatabasePath(),
  // Namespace dev dédié, distinct de `world/e2e` (deux bases SQLite séparées, mais deux dossiers
  // publics par prudence — zéro dépendance croisée si les deux tournent en parallèle sur le poste).
  publicDir: "public/generated/world/dev",
  assetNamespace: "world/dev",
  logPrefix: "seed-dev-world-assets",
});
