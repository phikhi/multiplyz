import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase } from "@/lib/db";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { characters, socleWorlds } from "@/lib/db/schema";
import { loadRenewalPlan } from "./creature-renewal";
import { testCreatureDesign } from "./creature-design.test-helper";
import { WORLD_HABITATS } from "./creature-design";
// The historical approval loader has its own filesystem checks. This fixture binds the
// recipe to that verified result; catalogue, inventory and art checks remain real here.
vi.mock("./pilot-validated-cast", () => ({ loadValidatedPilotCast: () => ({ approvalSha256: "approved", inspectionRun: "inspection" }) }));
let db: ReturnType<typeof createDatabase>, app: string;
const inventoryPath = "docs/playthroughs/teddy-creature-diversity/renewal-00000000-0000-0000-0000-000000000000/plan.json";
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
function put(path: string, value: unknown) { const file = join(app, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value)); }
function fixture() {
  const plan = testCreatureDesign(0, "forest");
  const rows = db.select().from(characters).all();
  const creatures = rows.map((before, i) => ({ id: before.id, speciesKey: before.speciesKey, rarity: before.rarity, inEggPool: before.inEggPool, before,
    preservedArts: [{ ref: "socle/0/old.png", sha256: hash("historical-bytes") }], proposed: { name: plan.creatures[i].name } }));
  const world = { worldIndex: 0, label: "Forêt enchantée", theme: "forest", creatures };
  const inventory = { at: "2026-09-14", worlds: Array.from({ length: 6 }, () => world), validatedPilotRun: "inspection", databaseWritten: false, published: false };
  const recipe = { ...plan, habitat: WORLD_HABITATS.forest, validatedCastApprovalSha256: "approved", inventoryPath, inventorySha256: "" };
  return { recipe, inventory, world };
}
function save(f: ReturnType<typeof fixture>) {
  f.recipe.inventorySha256 = hash(JSON.stringify(f.inventory));
  put(inventoryPath, f.inventory);
  put("docs/playthroughs/teddy-creature-diversity/renewal-world-0.json", f.recipe);
}
beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), "teddy-renewal-plan-"));
  db = createDatabase(":memory:"); migrate(db, { migrationsFolder: "drizzle" });
  db.insert(socleWorlds).values({ id: "socle:0", slot: 0, theme: "Forêt enchantée", palette: "{}", assetRefs: "{}", prompt: "fixture", seed: "fixture" }).run();
  db.insert(characters).values(testCreatureDesign(0, "forest").creatures.map((_, i) => ({ id: `creature:0:${i}`, worldIndex: 0, speciesKey: `old_${i}`, nameDefault: `Old${i}`, rarity: "common" as const, maxStage: 3, inEggPool: true, artRef: "socle/0/old.png", story: "Old story" }))).run();
  mkdirSync(join(app, "public/generated/socle/0"), { recursive: true }); writeFileSync(join(app, "public/generated/socle/0/old.png"), "historical-bytes");
});
afterEach(() => { db.$client.close(); rmSync(app, { recursive: true, force: true }); });
it("binds every identity and historical image to the approved inventory without mutating the catalogue", () => {
  const f = fixture(); save(f); const before = db.select().from(characters).all(); db.$client.pragma("query_only=ON");
  const result = loadRenewalPlan(app, 0, db);
  expect(result.plan.habitat).toBe(WORLD_HABITATS.forest);
  expect(result.inventoryAt).toBe("2026-09-14");
  expect(result.recipeSha256).toBe(hash(JSON.stringify(f.recipe)));
  expect(result.mapping).toEqual(f.world.creatures.map((c) => ({ id: c.id, speciesKey: c.speciesKey, rarity: c.rarity, inEggPool: c.inEggPool, proposedName: c.proposed.name })));
  expect(db.select().from(characters).all()).toEqual(before);
});
it.each([-1, 6, 0.5])("refuses out-of-scope world %s before reading files", (index) => { expect(() => loadRenewalPlan(app, index, db)).toThrow("hors du socle"); });
it.each([
  { version: 2 }, { worldIndex: 1 }, { validatedCastApprovalSha256: "other" }, { inventoryPath: "../outside" },
  { habitat: null }, { habitat: "short" }, { habitat: "x".repeat(1501) },
])("refuses a detached recipe %j", (patch) => {
  const f = fixture(); save(f); put("docs/playthroughs/teddy-creature-diversity/renewal-world-0.json", { ...f.recipe, ...patch });
  expect(() => loadRenewalPlan(app, 0, db)).toThrow("Recette de refonte");
});
it("detects inventory tampering before interpreting it", () => {
  const f = fixture(); save(f); put(inventoryPath, { changed: true });
  expect(() => loadRenewalPlan(app, 0, db)).toThrow("Inventaire de refonte modifié");
});
it.each([{ worlds: undefined }, { worlds: [] }, { validatedPilotRun: "other" }, { databaseWritten: true }, { published: true }])("refuses invalid inventory %j", (patch) => {
  const f = fixture(); const inventory = { ...f.inventory, ...patch }; put(inventoryPath, inventory);
  put("docs/playthroughs/teddy-creature-diversity/renewal-world-0.json", { ...f.recipe, inventorySha256: hash(JSON.stringify(inventory)) });
  expect(() => loadRenewalPlan(app, 0, db)).toThrow("Inventaire familial invalide");
});
it.each([{ worldIndex: 1 }, { label: "Changed" }, { theme: "ocean" }])("refuses changed world mapping %j", (patch) => {
  const f = fixture(); Object.assign(f.world, patch); save(f);
  expect(() => loadRenewalPlan(app, 0, db)).toThrow("Thème familial différent");
});
it("detects changed historical art", () => {
  const f = fixture(); save(f); writeFileSync(join(app, "public/generated/socle/0/old.png"), "changed");
  expect(() => loadRenewalPlan(app, 0, db)).toThrow("Art familial modifié");
});
it("refuses a proposed name detached from the creature identity", () => {
  const f = fixture(); f.world.creatures[0].proposed.name = "Different"; save(f);
  expect(() => loadRenewalPlan(app, 0, db)).toThrow("correspondance des compagnons");
});
it("refuses missing or extra mapping entries even if the plan itself is valid", () => {
  const f = fixture(); f.world.creatures.push({ ...f.world.creatures[0], id: "extra", before: { ...f.world.creatures[0].before, id: "extra" } });
  db.insert(characters).values(f.world.creatures.at(-1)!.before).run(); save(f);
  expect(() => loadRenewalPlan(app, 0, db)).toThrow("correspondance des compagnons");
});
