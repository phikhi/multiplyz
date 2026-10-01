import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

// Copy the working sources, including uncommitted edits to tracked files, but
// never family data, credentials, build caches or previous browser fixtures.
const source = process.cwd();
const root = realpathSync(mkdtempSync(join(tmpdir(), "teddy-e2e-")));
const files = execFileSync("git", ["ls-files", "-z"], { cwd: source, encoding: "utf8" });
for (const file of files.split("\0").filter(Boolean)) {
  if (/^(?:data|storage|node_modules|\.git|\.next[^/]*|\.env[^/]*)(?:\/|$)/.test(file)) continue;
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(source, file), target);
}
symlinkSync(join(source, "node_modules"), join(root, "node_modules"), "dir");
console.log(`Isolated E2E checkout: ${root}`);
const result = spawnSync(
  process.execPath,
  [join(source, "node_modules/@playwright/test/cli.js"), "test", ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, TEDDY_E2E_ROOT: root, DATABASE_PATH: join(root, "data/e2e.sqlite") },
  },
);
// Retain every run's artifacts without replacing earlier evidence.
for (const folder of ["test-results", "playwright-report", "docs/captures"]) {
  if (existsSync(join(root, folder))) {
    cpSync(join(root, folder), join(source, "test-results", basename(root), folder), {
      recursive: true,
    });
  }
}
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
