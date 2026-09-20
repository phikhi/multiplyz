/** Explicit asset publication; schema-only migration. No seed or database replacement. */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../src/lib/db";
import { isRenderableAssetRef } from "../src/lib/game/world-theme";
import {
  publishCreatureStages,
  type ReviewedStageArt,
} from "../src/lib/worldgen/publish-creature-stages";
const target = process.argv
  .find((arg) => arg.startsWith("--database="))
  ?.slice("--database=".length);
if (!target || !existsSync(target))
  throw new Error(
    "An existing --database=… is required; this command never creates or seeds a database.",
  );
const reviewed = JSON.parse(
  readFileSync("assets/creature-stages/reviewed.json", "utf8"),
) as ReviewedStageArt[];
const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
for (const art of reviewed) {
  if (
    !isRenderableAssetRef(art.baseArtRef) ||
    sha(readFileSync(`public/generated/${art.baseArtRef}`)) !== art.baseSha256
  )
    throw new Error(`Base identity mismatch: ${art.characterId}`);
  for (const stage of [2, 3] as const) {
    const { ref, sha256 } = art.stages[stage];
    if (!isRenderableAssetRef(ref)) throw new Error("Invalid public ref");
    const source = `assets/creature-stages/${basename(ref)}`;
    if (sha(readFileSync(source)) !== sha256) throw new Error(`Unreviewed art bytes: ${source}`);
    const destination = `public/generated/${ref}`;
    if (existsSync(destination) && sha(readFileSync(destination)) !== sha256)
      throw new Error(`Ref already used by another image: ${ref}`);
  }
}
for (const art of reviewed)
  for (const stage of [2, 3] as const) {
    const ref = art.stages[stage].ref;
    mkdirSync(dirname(`public/generated/${ref}`), { recursive: true });
    copyFileSync(`assets/creature-stages/${basename(ref)}`, `public/generated/${ref}`);
  }
const db = createDatabase(target);
try {
  migrate(db, { migrationsFolder: "drizzle" });
  const ids = publishCreatureStages(db, reviewed);
  console.log(
    JSON.stringify({
      database: target,
      published: ids,
      integrity: db.$client.pragma("integrity_check", { simple: true }),
    }),
  );
} finally {
  db.$client.close();
}
