import { existsSync, openSync, closeSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrate";
import { createHousehold } from "../src/lib/auth/household";
import { seedCanariProfile, CANARI_PROFILE_NAME, CANARI_PROFILE_AVATAR, CANARI_PROFILE_PIN } from "../e2e/seed-canari";
import { seedRealWorldFixture } from "../scripts/lib/seed-real-world-fixture";

async function initialize() {
  if (process.versions.node.split(".")[0] !== "22") throw new Error("Node 22 obligatoire.");
  const root = realpathSync(process.cwd());
  if (!root.startsWith(realpathSync(tmpdir()) + sep + "teddy-canary-") || process.env.TEDDY_CANARY_ROOT !== root)
    throw new Error("Initialisation réservée au canari temporaire neuf.");
  const marker = JSON.parse(readFileSync(join(root, ".teddy-canary.json"), "utf8"));
  const databasePath = join(root, "data/canary.sqlite");
  if (marker.version !== 1 || marker.root !== root || marker.databasePath !== databasePath || process.env.DATABASE_PATH !== databasePath || realpathSync(join(root, "data")) !== join(root, "data"))
    throw new Error("Contexte du canari incohérent.");
  if (["", "-wal", "-shm"].some((suffix) => existsSync(databasePath + suffix)))
    throw new Error("Base déjà présente : aucune migration, restauration ou réinitialisation.");
  // An interrupted initialization is also never retried in place.
  closeSync(openSync(join(root, ".initialized-once"), "wx", 0o600));
  closeSync(openSync(databasePath, "wx", 0o600));
  const db = createDatabase(databasePath);
  try {
    runMigrations(db);
    await createHousehold(db, { name: CANARI_PROFILE_NAME, avatar: CANARI_PROFILE_AVATAR, childPin: CANARI_PROFILE_PIN, parentPin: "9292" });
  } finally { db.$client.close(); }
  const profileId = await seedCanariProfile();
  seedRealWorldFixture({ databasePath, publicDir: "public/generated/socle/canary", assetNamespace: "socle/canary", logPrefix: "isolated-canary" });
  const verify = createDatabase(databasePath);
  try {
    const counts = Object.fromEntries(["profiles", "sessions", "progress", "attempts", "collection"].map((table) => [table, verify.$client.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()]));
    writeFileSync(join(root, "fixture.json"), JSON.stringify({ profileId, counts, integrity: verify.$client.pragma("integrity_check", { simple: true }) }, null, 2), { flag: "wx" });
  } finally { verify.$client.close(); }
}
initialize().catch((error) => { console.error(error.message); process.exitCode = 1; });
