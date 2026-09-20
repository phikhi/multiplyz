import { defineConfig, devices } from "@playwright/test";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
const root = realpathSync(process.cwd());
const marker = JSON.parse(readFileSync(join(root, ".teddy-canary.json"), "utf8"));
if (
  process.env.TEDDY_CANARY_ROOT !== root ||
  marker.root !== root ||
  marker.databasePath !== process.env.DATABASE_PATH
)
  throw new Error("Utiliser node scripts/run-isolated-canary.mjs depuis app/.");
const port = 33217;
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: ".",
  testMatch: "teddy.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: join(root, "test-results"),
  reporter: [["list"], ["json", { outputFile: join(root, "canary-results.json") }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    cwd: root,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
