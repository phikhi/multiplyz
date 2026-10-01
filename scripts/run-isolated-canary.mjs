import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

if (process.versions.node.split(".")[0] !== "22") throw new Error("Node 22 obligatoire.");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--prepare-only"))
  throw new Error("Usage: node scripts/run-isolated-canary.mjs [--prepare-only]");
const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = realpathSync(mkdtempSync(join(tmpdir(), "teddy-canary-")));
// Explicit allowlist: no .env, data, storage, backups, Git or existing builds are copied.
for (const entry of [
  "src",
  "public",
  "drizzle",
  "canary",
  "e2e/seed-canari.ts",
  "scripts/lib/seed-real-world-fixture.ts",
  "test-fixtures/world/socle-sample",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "next-env.d.ts",
  "next.config.ts",
  "postcss.config.mjs",
  "tokens.css",
]) {
  const from = join(source, entry);
  if (!existsSync(from)) throw new Error(`Source canari absente: ${entry}`);
  const to = join(root, entry);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (path) => path !== join(source, "public/generated"),
  });
}
symlinkSync(join(source, "node_modules"), join(root, "node_modules"), "dir");
mkdirSync(join(root, "data"));
mkdirSync(join(root, "storage"));
writeFileSync(
  join(root, ".teddy-canary.json"),
  JSON.stringify({ version: 1, root, databasePath: join(root, "data/canary.sqlite") }, null, 2),
  { flag: "wx", mode: 0o600 },
);
// Do not inherit production secrets, worker options or a family's DATABASE_PATH.
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  LANG: process.env.LANG,
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_PATH: join(root, "data/canary.sqlite"),
  TEDDY_CANARY_ROOT: root,
};
async function run(argv) {
  const child = spawn(process.execPath, argv, { cwd: root, env, stdio: "inherit" });
  const forward = () => child.kill("SIGTERM");
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  try {
    const code = await new Promise((yes, no) => {
      child.once("error", no);
      child.once("exit", (code) => yes(code ?? 1));
    });
    if (code !== 0)
      throw new Error(`Canari interrompu (code ${code}). Preuves conservées : ${root}`);
  } finally {
    process.removeListener("SIGINT", forward);
    process.removeListener("SIGTERM", forward);
  }
}
console.log(`Canari neuf : ${root}`);
await run(["--conditions=react-server", "--import", "tsx", "canary/initialize.ts"]);
if (!args.includes("--prepare-only"))
  await run([
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config=canary/playwright.config.ts",
  ]);
console.log(`Preuves conservées : ${root}`);
