import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT) || 3104;
const baseURL = `http://localhost:${PORT}`;

// Base SQLite dédiée à l'E2E (jamais la base de dev). Wipée à froid par
// `global-setup.ts` puis migrée au boot du serveur → état « foyer vide »
// déterministe, requis par le gating 1er usage (#2.2) et le round-trip health.
const E2E_DATABASE_PATH = "data/e2e.sqlite";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "on",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Migre la base E2E AVANT de démarrer le serveur (table `profiles` requise
    // par le gating). Idempotent (Drizzle journalise les migrations appliquées).
    // Puis pré-amorce les assets réels d'un monde (fond-image #189 + tuiles/Teddy #190) DANS ce
    // même contexte (cwd + DATABASE_PATH) que le serveur → les chemins `background/tiles/teddy
    // !== null` (scrim + tint + bande de décor + avatar Teddy per-monde) sont exercés en vrai
    // navigateur, sans dépendre des assets gitignorés.
    // ...puis amorce un profil frère/sœur (`Zoé`) + sa session (story 7.5 : prouver
    // suppression=purge+révocation sur un NON-propriétaire ; la création de frères/sœurs est v2,
    // pas d'UI) — DANS le même contexte que le serveur (cwd + DATABASE_PATH), comme les assets.
    // ...puis amorce 2 mondes `buffered` en attente d'approbation (story 7.9, #231) — le worker
    // daemon n'est jamais lancé en E2E, sans cet amorçage `/parent/mondes` resterait toujours vide.
    // ...puis amorce un profil dédié (`Nino`) + 5 créatures possédées (story 8.2b, #266) — la
    // collection ne se peuple qu'au boss (hors scope d'un test de reflow, boutique/gacha
    // inexistante cf. #269) : sans cet amorçage `/collection` resterait toujours vide.
    // ...puis amorce un profil dédié (`Milo`) + 6 niveaux complétés (story #268) — le nœud
    // COURANT résultant (7ᵉ sur 11, ni le 1ᵉʳ ni le boss) prouve l'ancrage auto-scroll sur une
    // position qui EXIGE le scroll pour être garantie visible (jouer 6 niveaux en E2E serait lent
    // et hors-scope, le sujet est le SCROLL, pas la progression).
    // ...puis amorce un profil dédié (`Timéo`) + 6 jours d'`attempts` backdatés (issue #241) — la
    // sparkline de justesse quotidienne n'affiche une FORME qu'à ≥2 jours DISTINCTS, hors
    // d'atteinte d'un parcours de jeu E2E réel en un seul run (même patron que `seed-collection`).
    // ...puis amorce un profil dédié (`Nova`) + 1 ligne `mastery` par compétence (issue #326,
    // canari « état jouable » WORKFLOW §21.d) — SANS session pré-amorcée (le canari se connecte
    // via la VRAIE UI de login) ni ligne `progress` (nœud courant = le tout premier, Teddy dessus).
    // ...puis amorce un profil dédié (`Iris`) + 10 niveaux complétés (story R3.3, #381) — le nœud
    // COURANT résultant EST le boss (dernier nœud du monde socle 0) : prouve que la révélation
    // rend le VRAI art légendaire (`characters.art_ref`, R3.1 #378) sans rejouer les niveaux
    // normaux qui précèdent en E2E (lent, hors-scope — le sujet est la RÉVÉLATION).
    // Démarre le serveur via `next dev` DIRECTEMENT (jamais `pnpm dev`, story R0.1 #323) : le script
    // `dev` de `package.json` lance AUSSI `tsx scripts/seed-dev-world-assets.ts` (fixture dev, même
    // patron que `seed-world-assets.ts` ci-dessus mais namespace `world/dev`) — l'appeler ici
    // ré-écrirait le slot 0 APRÈS `seed-world-assets.ts` (même ligne `socle_worlds`, la base E2E
    // partage le même mécanisme) et ferait servir le fixture `world/dev/…` à la place du fixture
    // E2E `world/e2e/…` (les deux fixtures pointent la même image committée, mais des URLs
    // publiques différentes — les assertions `toContain("world/e2e/…")` attendent précisément
    // celle-ci). `next dev` seul saute ce double-amorçage, la migration ayant déjà tourné ci-dessus.
    command: `pnpm db:migrate && tsx e2e/seed-world-assets.ts && tsx e2e/seed-sibling.cli.ts && tsx e2e/seed-pending-worlds.cli.ts && tsx e2e/seed-collection.cli.ts && tsx e2e/seed-map-progress.cli.ts && tsx e2e/seed-accuracy-history.cli.ts && tsx e2e/seed-canari.cli.ts && tsx e2e/seed-boss-progress.cli.ts && next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ...process.env, DATABASE_PATH: E2E_DATABASE_PATH },
  },
});
