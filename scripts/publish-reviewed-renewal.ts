/** Installs only the exact locally reviewed catalogue. No seed, migration, generation or restore. */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import * as schema from "../src/lib/db/schema";
import { loadValidatedPilotCast } from "../src/lib/worldgen/pilot-validated-cast";
import { readRuntimeCatalogue } from "../src/lib/worldgen/runtime-catalogue";
import { readCatalogueArt } from "../src/lib/worldgen/creature-design-runtime";
import { assessAsset } from "../src/lib/worldgen/qa";
import { loadWorldGenConfig } from "../src/config/server-config";
import { createWorldAssetStore } from "../src/lib/worldgen/runtime-assets";
import { assertFutureWorld, futureWorldTheme } from "../src/lib/worldgen/future-worlds";
import {
  publishReviewedRenewal,
  type ReviewedRenewal,
} from "../src/lib/worldgen/publish-reviewed-renewal";
import { readPilotReservedUnits } from "../src/lib/worldgen/pilot-status";
import { stageArtRefs } from "../src/lib/game/creature-stage-art";

async function main() {
  const app = resolve(process.cwd()),
    directory = join(app, "data/teddy-world-pilot"),
    apply = process.argv.includes("--apply");
  const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const canonical = (value: object) =>
    JSON.stringify(
      Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
    );
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  const approvalPath = join(directory, "renewal-visual-approval.json"),
    approval = read(approvalPath),
    approvalSha256 = hash(readFileSync(approvalPath));
  if (
    approval.version !== 1 ||
    approval.visualApproved !== true ||
    approval.imageCount !== 141 ||
    approval.creatureCount !== 47 ||
    approval.worlds.length !== 7
  )
    throw new Error("Validation artistique complète absente.");
  const recipePath = join(directory, "renewal-batch-plan.json"),
    recipe = read(recipePath);
  const inventoryPath = join(app, recipe.inventoryPath),
    inventory = read(inventoryPath);
  if (hash(readFileSync(inventoryPath)) !== recipe.inventorySha256)
    throw new Error("Inventaire modifié.");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  const approved = loadValidatedPilotCast(
    directory,
    join(app, "docs/playthroughs/teddy-creature-diversity/approved-magic-growth.json"),
  );
  const pilot = new Database(join(directory, "multiplyz.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  const pilotDb = drizzle(pilot, { schema });
  const sourceWorld = pilotDb
    .select()
    .from(schema.worlds)
    .all()
    .find((w) => w.index === 6);
  pilot.close();
  if (!sourceWorld || sourceWorld.status !== "buffered")
    throw new Error("Source du pilote absente.");
  const originalRuntime = readRuntimeCatalogue(
    6,
    sourceWorld.assetRefs,
    join(directory, "storage/generated"),
  );
  const runtime = {
    ...originalRuntime,
    creatures: [...originalRuntime.creatures],
    designVersion: 1 as const,
    habitat: approved.draft.plan.habitat,
  };
  const diagnosticsPath = join(
      directory,
      "refinements/e143b1de-93ee-4b87-a717-1d00a11cbb25-diagnostic.json",
    ),
    diagnostics = read(diagnosticsPath);
  const images = new Map<string, string>();
  const before: ReviewedRenewal["before"] = inventory.worlds.flatMap(
    (w: { creatures: { before: ReviewedRenewal["before"][number] }[] }) =>
      w.creatures.map((c) => c.before),
  );
  const after: ReviewedRenewal["after"] = [];
  for (const [index, world] of approval.worlds.entries()) {
    if (
      world.worldIndex !== index ||
      world.creatures.length !== (index === 6 ? 6 : inventory.worlds[index].creatures.length)
    )
      throw new Error("Monde approuvé incohérent.");
    for (const [slot, c] of world.creatures.entries()) {
      if (c.slot !== slot || c.ages.length !== 3) throw new Error("Trois âges requis.");
      for (const [n, a] of c.ages.entries()) {
        if (
          a.stage !== n + 1 ||
          !a.ref.startsWith(`world/${index}/runtime-`) ||
          images.has(a.ref) ||
          hash(store.read(a.ref)) !== a.sha256
        )
          throw new Error("Image approuvée modifiée ou répétée.");
        images.set(a.ref, a.sha256);
      }
      const stages = JSON.stringify({ 2: c.ages[1].ref, 3: c.ages[2].ref });
      if (index < 6) {
        const old = inventory.worlds[index].creatures[slot];
        if (
          c.id !== old.id ||
          c.speciesKey !== old.speciesKey ||
          c.rarity !== old.rarity ||
          c.inEggPool !== old.inEggPool ||
          c.name !== old.proposed.name ||
          old.before.maxStage !== 3
        )
          throw new Error("Correspondance familiale modifiée.");
        const role: string = old.proposed.role;
        after.push({
          ...old.before,
          nameDefault: c.name,
          artRef: c.ages[0].ref,
          artRefStages: stages,
          story: `${c.name} ${role.charAt(0).toLocaleLowerCase("fr")}${role.slice(1).replace(/[.!]$/, "")}.`,
        });
      } else {
        const design = approved.draft.plan.creatures[slot];
        if (
          c.name !== design.name ||
          c.ages[0].ref !== approved.draft.artRefs[slot] ||
          c.ages[1].ref !== approved.draft.stageArt[slot][2] ||
          c.ages[2].ref !== approved.draft.stageArt[slot][3]
        )
          throw new Error("Pilote différent de ses 18 inspections validées.");
        const original = runtime.creatures[slot];
        runtime.creatures[slot] = {
          ...original,
          nameDefault: c.name,
          story: design.story,
          artRef: c.ages[0].ref,
          stageArt: { 2: c.ages[1].ref, 3: c.ages[2].ref },
          design,
        };
        after.push({
          id: original.id,
          worldIndex: 6,
          speciesKey: original.speciesKey,
          nameDefault: c.name,
          rarity: original.rarity,
          inEggPool: original.inEggPool,
          maxStage: 3,
          artRef: c.ages[0].ref,
          artRefStages: stages,
          story: design.story,
        });
      }
    }
  }
  for (const [kind, ref] of Object.entries(runtime.assetRefs)) {
    const check = diagnostics.find(
      (d: { asset: { ref: string; kind: string } }) => d.asset.ref === ref && d.asset.kind === kind,
    );
    if (
      !check ||
      check.reason !== null ||
      !assessAsset(check.inspection, loadWorldGenConfig({}).qa).ok
    )
      throw new Error("Décor du pilote non validé.");
    images.set(ref, hash(store.read(ref)));
  }
  const manifestRef = runtime.assetRefs.background.replace(/-background\.png$/, "-manifest.json"),
    manifest = JSON.stringify(runtime);
  const plan: ReviewedRenewal = {
    before,
    after,
    world: {
      ...sourceWorld,
      status: "active",
      approvedBy: `local-owner-review:${approvalSha256.slice(0, 12)}`,
    },
  };
  const protectedSources = new Map(
    [
      approvalPath,
      recipePath,
      inventoryPath,
      diagnosticsPath,
      ...Object.keys(approval.sources).map((f) => join(directory, f)),
    ].map((p) => [p, hash(readFileSync(p))]),
  );
  for (const [file, sha] of Object.entries(approval.sources))
    if (hash(readFileSync(join(directory, file))) !== sha)
      throw new Error("Source de validation modifiée.");
  const targetRoot = join(app, "storage/generated");
  function verifyFiles(installed = false) {
    for (const [path, sha] of protectedSources)
      if (hash(readFileSync(path)) !== sha)
        throw new Error("Source modifiée pendant la publication.");
    for (const [ref, sha] of images) {
      if (hash(store.read(ref)) !== sha) throw new Error("Pixels sources modifiés.");
      if (installed && hash(readFileSync(join(targetRoot, ref))) !== sha)
        throw new Error("Pixels livrés incohérents.");
    }
    for (const world of inventory.worlds)
      for (const creature of world.creatures)
        for (const art of creature.preservedArts)
          if (
            hash(readCatalogueArt(art.ref, targetRoot, join(app, "public/generated"))) !==
            art.sha256
          )
            throw new Error("Art historique modifié.");
    if (installed && readFileSync(join(targetRoot, manifestRef), "utf8") !== manifest)
      throw new Error("Catalogue du pilote modifié.");
  }
  const sqlite = new Database(join(app, "data/multiplyz.sqlite"), {
    readonly: !apply,
    fileMustExist: true,
  });
  sqlite.pragma("busy_timeout=5000");
  sqlite.pragma("foreign_keys=ON");
  const db = drizzle(sqlite, { schema });
  try {
    verifyFiles();
    const current = db.select().from(schema.characters).all();
    const already = after.every((c) => {
      const old = current.find((r) => r.id === c.id);
      return old && canonical(old) === canonical(c);
    });
    if (!already) {
      assertFutureWorld(db, 6);
      if (futureWorldTheme(db, 6).slug !== runtime.themeSlug)
        throw new Error("Thème futur du pilote modifié.");
      if (
        before.some(
          (c) =>
            !current.find((r) => r.id === c.id) ||
            canonical(current.find((r) => r.id === c.id)!) !== canonical(c),
        )
      )
        throw new Error("Inventaire familial obsolète.");
    }
    const planPath = join(directory, "renewal-publication-plan.json");
    const review = {
      approvalSha256,
      characters: after,
      world: plan.world,
      images: [...images].map(([ref, sha256]) => ({ ref, sha256 })),
      changes: { existingCreatures: 41, newCreatures: 6, newWorld: 6 },
      reviewMethod: "explicit-owner-curated-catalogue",
      pilotQa: "18 creature stages and 3 unchanged environment assets passed existing checks",
      automaticQaUnchanged: true,
    };
    const reviewBytes = JSON.stringify(review, null, 2) + "\n";
    if (existsSync(planPath)) {
      if (readFileSync(planPath, "utf8") !== reviewBytes)
        throw new Error("Plan de publication déjà différent.");
    } else writeFileSync(planPath, reviewBytes, { flag: "wx" });
    console.log(
      JSON.stringify({
        mode: apply ? "apply" : "plan",
        ...review.changes,
        images: images.size,
        paidCalls: 0,
        reservedEur: readPilotReservedUnits(directory) / 1e6,
        alreadyInstalled: already,
      }),
    );
    if (apply) {
      for (const [ref, sha] of images) {
        const to = join(targetRoot, ref);
        mkdirSync(dirname(to), { recursive: true });
        if (existsSync(to)) {
          if (hash(readFileSync(to)) !== sha) throw new Error("Référence cible déjà occupée.");
        } else copyFileSync(join(directory, "storage/generated", ref), to, constants.COPYFILE_EXCL);
      }
      const manifestPath = join(targetRoot, manifestRef);
      if (existsSync(manifestPath)) {
        if (readFileSync(manifestPath, "utf8") !== manifest)
          throw new Error("Manifeste cible déjà occupé.");
      } else writeFileSync(manifestPath, manifest, { flag: "wx" });
      readRuntimeCatalogue(6, plan.world.assetRefs, targetRoot);
      const backup = join(app, "data/backups", `before-reviewed-renewal-${Date.now()}.sqlite`);
      mkdirSync(dirname(backup), { recursive: true });
      await sqlite.backup(backup);
      const result = publishReviewedRenewal(db, plan, () => verifyFiles(true));
      const integrity = sqlite.pragma("integrity_check", { simple: true });
      const delivered = db.select().from(schema.characters).all();
      if (after.some((c) => stageArtRefs(delivered.find((r) => r.id === c.id)!).length !== 3))
        throw new Error("Catalogue livré incomplet.");
      const receipt = {
        ...result,
        approvalSha256,
        backup,
        integrity,
        reservedEur: readPilotReservedUnits(directory) / 1e6,
        at: new Date().toISOString(),
      };
      const receiptPath = join(directory, "renewal-publication.json");
      if (!existsSync(receiptPath))
        writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
      console.log(
        JSON.stringify({
          outcome: result.outcome,
          updated: result.updated,
          inserted: result.inserted,
          preservedTables: Object.keys(result.preserved).length,
          integrity,
          backup,
        }),
      );
    }
  } finally {
    sqlite.close();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Publication impossible.");
  process.exitCode = 1;
});
