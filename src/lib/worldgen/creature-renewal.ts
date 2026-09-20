import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppDatabase } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { resolveWorld } from "./socle";
import { findCuratedTheme } from "@/config/worldgen-themes";
import { validateCreatureDesign } from "./creature-design";
import { loadValidatedPilotCast } from "./pilot-validated-cast";
import { readCatalogueArt } from "./creature-design-runtime";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
type Row = typeof characters.$inferSelect;
/** Exact historical catalogue binding; future-world publication guards remain untouched. */
export function assertRenewalRows(
  expected: readonly { id: string; before: Row }[],
  actual: readonly Row[],
) {
  if (
    expected.length !== actual.length ||
    new Set(expected.map((c) => c.id)).size !== actual.length ||
    expected.some(
      (c) => JSON.stringify(c.before) !== JSON.stringify(actual.find((row) => row.id === c.id)),
    )
  )
    throw new Error(
      "Catalogue familial modifié depuis l’inventaire ; aucun remplacement automatique.",
    );
}

export function loadRenewalPlan(app: string, index: number, db: AppDatabase) {
  if (!Number.isInteger(index) || index < 0 || index > 5)
    throw new Error("Monde de refonte hors du socle autorisé.");
  const pilot = join(app, "data/teddy-world-pilot");
  const root = join(app, "docs/playthroughs/teddy-creature-diversity");
  const validated = loadValidatedPilotCast(pilot, join(root, "approved-magic-growth.json"));
  const bytes = readFileSync(join(root, `renewal-world-${index}.json`));
  const recipe = JSON.parse(bytes.toString());
  if (
    recipe.version !== 1 ||
    recipe.worldIndex !== index ||
    recipe.validatedCastApprovalSha256 !== validated.approvalSha256 ||
    !/^docs\/playthroughs\/teddy-creature-diversity\/renewal-[0-9a-f-]{36}\/plan\.json$/.test(
      recipe.inventoryPath,
    ) ||
    typeof recipe.habitat !== "string" ||
    recipe.habitat.length < 30 ||
    recipe.habitat.length > 1500
  )
    throw new Error("Recette de refonte absente ou détachée du groupe validé.");
  const inventoryBytes = readFileSync(join(app, recipe.inventoryPath));
  if (hash(inventoryBytes) !== recipe.inventorySha256)
    throw new Error("Inventaire de refonte modifié.");
  const inventory = JSON.parse(inventoryBytes.toString());
  if (
    inventory.worlds?.length !== 6 ||
    inventory.validatedPilotRun !== validated.inspectionRun ||
    inventory.databaseWritten !== false ||
    inventory.published !== false
  )
    throw new Error("Inventaire familial invalide.");
  const world = inventory.worlds[index];
  const resolved = resolveWorld(db, index);
  if (
    world.worldIndex !== index ||
    world.label !== resolved.theme ||
    world.theme !== findCuratedTheme(resolved.theme)?.slug
  )
    throw new Error("Thème familial différent de l’inventaire.");
  const actual = db
    .select()
    .from(characters)
    .all()
    .filter((c) => c.worldIndex === index);
  assertRenewalRows(world.creatures, actual);
  for (const c of world.creatures)
    for (const art of c.preservedArts) {
      if (
        hash(
          readCatalogueArt(art.ref, join(app, "storage/generated"), join(app, "public/generated")),
        ) !== art.sha256
      )
        throw new Error("Art familial modifié depuis l’inventaire.");
    }
  const plan = validateCreatureDesign(recipe, index, world.theme, []);
  if (
    plan.creatures.some((c, i) => c.name !== world.creatures[i]?.proposed.name) ||
    world.creatures.length !== plan.creatures.length
  )
    throw new Error("La refonte doit garder la correspondance des compagnons.");
  plan.habitat = recipe.habitat;
  return {
    plan,
    validated,
    recipeSha256: hash(bytes),
    inventoryAt: inventory.at as string,
    mapping: world.creatures.map(
      (c: {
        id: string;
        speciesKey: string;
        rarity: string;
        inEggPool: boolean;
        proposed: { name: string };
      }) => ({
        id: c.id,
        speciesKey: c.speciesKey,
        rarity: c.rarity,
        inEggPool: c.inEggPool,
        proposedName: c.proposed.name,
      }),
    ),
  };
}
