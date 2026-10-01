import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { characters, collection, profiles, progress, progressKey } from "@/lib/db/schema";
import { getMapConfig, getEconomyConfig } from "@/config/server-config";
import { grantLegendaryInTx, loadCollectionEntry, renameCharacter } from "./collection";
import { loadCollectionAlbum } from "./collection-album";
import { finishLevel } from "./finish-level";

let db: AppDatabase;
let id: number;
const now = new Date("2026-09-10T18:00:00Z");
const map = getMapConfig();
beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  id = db
    .insert(profiles)
    .values({ name: "Nova", nameKey: "nova", avatar: "fox", pinHash: "test" })
    .returning()
    .get().id;
});
afterEach(() => db.$client.close());

describe("album from the real catalogue", () => {
  it("shows only accessible worlds and does not invent possessions", () => {
    const album = loadCollectionAlbum(db, id, map.levelsPerWorld);
    expect(album.entries).toEqual([]);
    expect(album.families.map((f) => f.worldIndex)).toEqual([0]);
    expect(album.families[0].slots.length).toBeGreaterThan(1);
    expect(album.families[0].slots.every((s) => s.entry === null)).toBe(true);
    expect(db.select().from(collection).all()).toEqual([]);
  });
  it("joins the profile's own nickname, story and actual art; isolates another profile", () => {
    grantLegendaryInTx(db, id, 0, now);
    renameCharacter(db, id, "legendary:0", "Luciolune");
    db.update(characters)
      .set({ artRef: "world/custom/guardian.png", story: "Une histoire conservée." })
      .where(eq(characters.id, "legendary:0"))
      .run();
    const album = loadCollectionAlbum(db, id, map.levelsPerWorld);
    const slot = album.families[0].slots.find((s) => s.characterId === "legendary:0")!;
    expect(slot.artRef).toBe("world/custom/guardian.png");
    expect(album.families[0].slots[0].entry?.displayName).toBe("Luciolune");
    expect(slot.entry).toEqual(loadCollectionEntry(db, id, "legendary:0"));
    expect(slot.entry?.displayName).toBe("Luciolune");
    const other = db
      .insert(profiles)
      .values({ name: "Autre", nameKey: "autre", avatar: "fox", pinHash: "test" })
      .returning()
      .get().id;
    expect(
      loadCollectionAlbum(db, other, map.levelsPerWorld).families[0].slots.every(
        (s) => s.entry === null,
      ),
    ).toBe(true);
  });
  it("handles an empty or partial catalogue without manufactured slots", () => {
    db.delete(characters).run();
    expect(loadCollectionAlbum(db, id, map.levelsPerWorld)).toEqual({ entries: [], families: [] });
    grantLegendaryInTx(db, id, 0, now);
    const album = loadCollectionAlbum(db, id, map.levelsPerWorld);
    expect(album.families[0].slots).toHaveLength(1);
    expect(album.entries).toHaveLength(1);
  });
  it("a zero-star guardian unlocks the next family with a single acquisition; receipt matches the catalogue", () => {
    for (let levelIndex = 0; levelIndex < map.levelsPerWorld; levelIndex++) {
      db.insert(progress)
        .values({
          id: progressKey(id, 0, levelIndex),
          profileId: id,
          worldIndex: 0,
          levelIndex,
          stars: 0,
          updatedAt: now,
        })
        .run();
    }
    db.update(characters)
      .set({
        nameDefault: "Gardienne",
        artRef: "world/custom/guardian.png",
        story: "Histoire du catalogue.",
      })
      .where(eq(characters.id, "legendary:0"))
      .run();
    const result = finishLevel(
      db,
      id,
      { worldIndex: 0, levelIndex: map.levelsPerWorld, stars: 0 },
      map,
      getEconomyConfig(),
      now,
    );
    expect(result).toMatchObject({
      ok: true,
      unlockedNextWorld: true,
      legendaryAdded: true,
      legendary: {
        name: "Gardienne",
        artRef: "world/custom/guardian.png",
        story: "Histoire du catalogue.",
      },
    });
    expect(
      loadCollectionAlbum(db, id, map.levelsPerWorld).families.map((f) => f.worldIndex),
    ).toEqual([0, 1]);
    renameCharacter(db, id, "legendary:0", "Luciolune");
    const replay = finishLevel(
      db,
      id,
      { worldIndex: 0, levelIndex: map.levelsPerWorld, stars: 0 },
      map,
      getEconomyConfig(),
      now,
    );
    expect(replay).toMatchObject({
      ok: true,
      coinsApplied: false,
      legendaryAdded: false,
      legendary: { name: "Luciolune" },
    });
    expect(db.select().from(collection).all()).toHaveLength(1);
  });
});
