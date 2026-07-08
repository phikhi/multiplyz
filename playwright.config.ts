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
    command: `pnpm db:migrate && tsx e2e/seed-world-assets.ts && pnpm dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ...process.env, DATABASE_PATH: E2E_DATABASE_PATH },
  },
});
