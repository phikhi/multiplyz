import { afterEach, beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { characters, collection, collectionKey, profiles } from "@/lib/db/schema";
import { publishCreatureStages, type ReviewedStageArt } from "./publish-creature-stages";
let db: AppDatabase;
const art = (n: number): ReviewedStageArt => ({
  characterId: `creature:0:${n}`,
  species: `creature_world_0_${n}`,
  baseArtRef: `socle/creature/creature_world_0_${n}.png`,
  baseSha256: "reviewed",
  stages: {
    2: { ref: `socle/creature/c${n}-ado.png`, sha256: "reviewed" },
    3: { ref: `socle/creature/c${n}-adulte.png`, sha256: "reviewed" },
  },
});
beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
});
afterEach(() => db.$client.close());
it("adds only stage columns, is idempotent and preserves every possession field", () => {
  const id = db
    .insert(profiles)
    .values({ name: "Nova", avatar: "fox", pinHash: "test" })
    .returning()
    .get().id;
  db.insert(collection)
    .values({
      id: collectionKey(id, art(0).characterId),
      profileId: id,
      characterId: art(0).characterId,
      nickname: "Étoile",
      count: 5,
      stage: 1,
      unlockedAt: new Date(),
    })
    .run();
  const owned = db.select().from(collection).all();
  const original = db
    .select()
    .from(characters)
    .where(eq(characters.id, art(0).characterId))
    .get();
  expect(publishCreatureStages(db, [art(0)])).toEqual([art(0).characterId]);
  expect(publishCreatureStages(db, [art(0)])).toEqual([]);
  expect(db.select().from(collection).all()).toEqual(owned);
  expect(
    db
      .select()
      .from(characters)
      .where(eq(characters.id, art(0).characterId))
      .get(),
  ).toEqual({
    ...original,
    maxStage: 3,
    artRefStages: JSON.stringify({ 2: art(0).stages[2].ref, 3: art(0).stages[3].ref }),
  });
});
it.each([
  { artRef: "world/custom/base.png" },
  { speciesKey: "custom" },
  { maxStage: 2 },
  { artRefStages: '{"2":"world/custom/teen.png"}' },
])("never overwrites a different identity or existing stage catalogue %s", (patch) => {
  db.update(characters)
    .set(patch)
    .where(eq(characters.id, art(0).characterId))
    .run();
  const before = db.select().from(characters).all();
  expect(publishCreatureStages(db, [art(0)])).toEqual([]);
  expect(db.select().from(characters).all()).toEqual(before);
});
it("rejects invalid or repeated art refs without publishing anything", () => {
  expect(() =>
    publishCreatureStages(db, [
      art(0),
      { ...art(1), stages: { 2: art(1).stages[2], 3: art(1).stages[2] } },
    ]),
  ).toThrow();
  expect(
    db
      .select()
      .from(characters)
      .where(eq(characters.id, art(0).characterId))
      .get()?.maxStage,
  ).toBe(1);
});
it("rolls back an interrupted batch and does not create missing catalogue rows", () => {
  db.run(
    sql`CREATE TRIGGER fail_publish BEFORE UPDATE ON characters WHEN OLD.id='creature:0:1' BEGIN SELECT RAISE(ABORT,'publication failed'); END;`,
  );
  expect(() => publishCreatureStages(db, [art(0), art(1)])).toThrow("publication failed");
  expect(
    db
      .select()
      .from(characters)
      .where(eq(characters.id, art(0).characterId))
      .get()?.maxStage,
  ).toBe(1);
  db.delete(characters)
    .where(eq(characters.id, art(0).characterId))
    .run();
  expect(publishCreatureStages(db, [art(0)])).toEqual([]);
});
