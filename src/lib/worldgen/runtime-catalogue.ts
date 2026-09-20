import "server-only";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppDatabase } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import type { GeneratedWorld } from "./generate-world";
import { isRenderableAssetRef } from "@/lib/game/world-theme";
import { assertNewNames, validateCreatureDesign } from "./creature-design";

function manifestRef(assetRefs: string): string {
  const background: unknown = JSON.parse(assetRefs).background;
  if (
    typeof background !== "string" ||
    !isRenderableAssetRef(background) ||
    !/^world\/\d+\/runtime-[a-f0-9-]+-background\.png$/.test(background)
  )
    throw new Error("Manifeste de monde invalide.");
  return background.replace(/-background\.png$/, "-manifest.json");
}

export function saveRuntimeCatalogue(root: string, world: GeneratedWorld): void {
  writeFileSync(join(root, manifestRef(JSON.stringify(world.assetRefs))), JSON.stringify(world), {
    flag: "wx",
  });
}

export class RuntimeCatalogueError extends Error {}

/** A validated candidate may be previewed by a parent without entering the playable catalogue. */
export function readRuntimeCatalogue(
  worldIndex: number,
  assetRefs: string,
  root = join(process.cwd(), "storage/generated"),
): GeneratedWorld {
  try {
    const world: GeneratedWorld = JSON.parse(
      readFileSync(join(root, manifestRef(assetRefs)), "utf8"),
    );
    if (
      world.worldIndex !== worldIndex ||
      JSON.stringify(world.assetRefs) !== assetRefs ||
      !Array.isArray(world.creatures) ||
      world.creatures.length < 6 ||
      world.creatures.length > 8 ||
      new Set(world.creatures.map((c) => c.id)).size !== world.creatures.length ||
      world.creatures.filter((c) => c.rarity === "legendary").length !== 1
    )
      throw new Error("Catalogue de monde incohérent.");
    for (const c of world.creatures) {
      if (
        typeof c.id !== "string" ||
        typeof c.speciesKey !== "string" ||
        typeof c.nameDefault !== "string" ||
        typeof c.story !== "string" ||
        !["common", "rare", "legendary"].includes(c.rarity) ||
        c.inEggPool !== (c.rarity !== "legendary") ||
        !isRenderableAssetRef(c.artRef) ||
        !c.artRef.startsWith(`world/${worldIndex}/runtime-`)
      )
        throw new Error("Créature de monde incohérente.");
      if (c.stageArt !== undefined) {
        const refs = [c.artRef, c.stageArt?.["2"], c.stageArt?.["3"]];
        if (
          new Set(refs).size !== 3 ||
          refs.some(
            (ref) =>
              typeof ref !== "string" ||
              !isRenderableAssetRef(ref) ||
              !ref.startsWith(`world/${worldIndex}/runtime-`),
          )
        )
          throw new Error("Arts des trois stades incohérents.");
      }
    }
    if (world.designVersion !== undefined) {
      if (world.designVersion !== 1) throw new Error("Version de conception inconnue.");
      const plan = validateCreatureDesign(
        { creatures: world.creatures.map((c) => c.design) },
        worldIndex,
        world.themeSlug,
        [],
      );
      if (
        plan.habitat !== world.habitat ||
        world.creatures.some(
          (c, i) => c.nameDefault !== plan.creatures[i].name || c.story !== plan.creatures[i].story,
        )
      )
        throw new Error("Catalogue différent de sa conception.");
    }
    return world;
  } catch {
    throw new RuntimeCatalogueError("Catalogue de monde absent ou incohérent.");
  }
}

/** Called INSIDE the same transaction as activation, never during image generation. */
export function publishRuntimeCatalogue(
  db: Pick<AppDatabase, "insert" | "select">,
  worldIndex: number,
  assetRefs: string,
  root = join(process.cwd(), "storage/generated"),
): void {
  const world = readRuntimeCatalogue(worldIndex, assetRefs, root);
  if (world.designVersion)
    assertNewNames(
      world.creatures.map((c) => c.nameDefault),
      db
        .select({ name: characters.nameDefault })
        .from(characters)
        .all()
        .map((c) => c.name),
    );
  for (const c of world.creatures) {
    // A conflict means something already claimed this identity. Abort the WHOLE activation.
    db.insert(characters)
      .values({
        id: c.id,
        speciesKey: c.speciesKey,
        nameDefault: c.nameDefault,
        rarity: c.rarity,
        inEggPool: c.inEggPool,
        artRef: c.artRef,
        artRefStages: c.stageArt ? JSON.stringify(c.stageArt) : null,
        maxStage: c.stageArt ? 3 : 1,
        story: c.story,
        worldIndex,
      })
      .run();
  }
}
