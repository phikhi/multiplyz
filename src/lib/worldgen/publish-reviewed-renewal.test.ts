import { afterEach, beforeEach, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { characters, collection, profiles, socleWorlds, worlds } from "@/lib/db/schema";
import {
  publishReviewedRenewal,
  preservedTableDigests,
  type ReviewedRenewal,
} from "./publish-reviewed-renewal";
let db: AppDatabase, plan: ReviewedRenewal;
beforeEach(() => {
  db = createDatabase(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });
  // Explicit in-memory fixtures only: no family database, seeds or restore.
  db.insert(socleWorlds)
    .values({
      id: "socle:0",
      slot: 0,
      theme: "Forêt enchantée",
      palette: "{}",
      assetRefs: "{}",
      prompt: "fixture",
      seed: "fixture",
    })
    .run();
  const old = {
    id: "creature:0:0",
    worldIndex: 0,
    speciesKey: "creature_world_0_0",
    nameDefault: "Ancien",
    rarity: "common" as const,
    maxStage: 3,
    inEggPool: true,
    artRef: "socle/baby.png",
    artRefStages: '{"2":"socle/ado.png","3":"socle/adulte.png"}',
    story: "Ancien récit",
  };
  db.insert(characters).values(old).run();
  const person = db
    .insert(profiles)
    .values({ name: "Test", avatar: "fox", pinHash: "fixture", recalibrationRequested: true })
    .returning()
    .get();
  db.insert(collection)
    .values({
      id: "owned",
      profileId: person.id,
      characterId: old.id,
      count: 7,
      stage: 3,
      nickname: "Mon nom",
      unlockedAt: new Date(1000),
    })
    .run();
  db.$client
    .prepare("INSERT INTO adventure_sessions(profile_id,state,updated_at) VALUES(?,?,?)")
    .run(
      person.id,
      JSON.stringify({
        worldIndex: 5,
        paused: true,
        checkpoint: { answer: 7 },
        receipt: "preserved",
      }),
      1000,
    );
  plan = {
    before: [old],
    after: [
      {
        ...old,
        nameDefault: "Mycélou",
        story: "Aide les racines.",
        artRef: "world/0/new.png",
        artRefStages: '{"2":"world/0/ado.png","3":"world/0/adulte.png"}',
      },
      {
        ...old,
        id: "creature:6:0",
        worldIndex: 6,
        speciesKey: "creature_world_6_0",
        nameDefault: "Vrillou",
      },
    ],
    world: {
      id: "world:6",
      index: 6,
      theme: "Royaume magique",
      palette: "{}",
      assetRefs: "{}",
      prompt: "approved",
      seed: "magic-6",
      status: "active",
      approvedBy: "local-owner",
      createdAt: new Date(1000),
    },
  };
});
afterEach(() => db.$client.close());
it("updates the existing identity atomically, adds the future world, and preserves all family state", () => {
  const before = preservedTableDigests(db);
  let checks = 0;
  const result = publishReviewedRenewal(db, plan, () => {
    checks++;
  });
  expect(result).toMatchObject({ outcome: "installed", updated: 1, inserted: 1 });
  expect(checks).toBe(1);
  expect(db.select().from(characters).where(eq(characters.id, plan.before[0].id)).get()).toEqual(
    plan.after[0],
  );
  expect(preservedTableDigests(db)).toEqual(before);
  // Repeated installation still works after the family starts the newly available world.
  db.$client
    .prepare("UPDATE adventure_sessions SET state=?")
    .run(JSON.stringify({ worldIndex: 6, paused: true }));
  const repeated = preservedTableDigests(db);
  expect(publishReviewedRenewal(db, plan, () => {}).outcome).toBe("already-installed");
  expect(preservedTableDigests(db)).toEqual(repeated);
});
it("refuses changed catalogue input or a world reserved by a paused adventure", () => {
  db.update(characters).set({ nameDefault: "Changed" }).run();
  expect(() => publishReviewedRenewal(db, plan, () => {})).toThrow("Catalogue modifié");
  db.update(characters).set({ nameDefault: "Ancien" }).run();
  db.$client
    .prepare("UPDATE adventure_sessions SET state=?")
    .run(JSON.stringify({ worldIndex: 6 }));
  expect(() => publishReviewedRenewal(db, plan, () => {})).toThrow("parcours déjà ouvert");
  expect(db.select().from(worlds).all()).toEqual([]);
  expect(db.select().from(characters).all()).toEqual(plan.before);
});
it("rolls the whole catalogue back if a write alters a possession", () => {
  db.$client.exec(
    "CREATE TRIGGER forbidden_side_effect AFTER UPDATE ON characters BEGIN UPDATE collection SET stage=1; END;",
  );
  const before = preservedTableDigests(db);
  expect(() => publishReviewedRenewal(db, plan, () => {})).toThrow("Données familiales modifiées");
  expect(db.select().from(characters).all()).toEqual(plan.before);
  expect(db.select().from(worlds).all()).toEqual([]);
  expect(preservedTableDigests(db)).toEqual(before);
});
it("does not publish when approved files or immutable creature fields differ", () => {
  expect(() =>
    publishReviewedRenewal(db, plan, () => {
      throw new Error("Pixels modifiés");
    }),
  ).toThrow("Pixels modifiés");
  plan.after[0].maxStage = 1;
  expect(() => publishReviewedRenewal(db, plan, () => {})).toThrow("préserver identité");
  expect(db.select().from(characters).all()).toEqual(plan.before);
  expect(db.select().from(worlds).all()).toEqual([]);
});
