import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import {
  characters,
  collection,
  collectionKey,
  evolutionReceipts,
  ledger,
  profiles,
  wallet,
} from "@/lib/db/schema";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { loadCollection, loadCollectionEntry, renameCharacter } from "./collection";
import { loadCollectionAlbum } from "./collection-album";
import {
  acknowledgeEvolution,
  evolveCompanion,
  loadEvolutionOffer,
  loadEvolutionState,
  pendingEvolutionReceipt,
  stageAssetsReady,
} from "./evolution";
import { creatureStageArt, stageArtRefs } from "./creature-stage-art";
import { loadWallet } from "./wallet";

let db: AppDatabase;
let profileId: number;
const characterId = "creature:0:0";
const now = new Date("2026-09-10T20:00:00Z");
const economy = CONFIG_DEFAULTS.economy;
const refs = [
  "socle/creature/creature_world_0_0.png",
  "socle/creature/creature_world_0_0-ado.png",
  "socle/creature/creature_world_0_0-adulte.png",
];
const ready = () => true;
const offer = () => loadEvolutionOffer(db, profileId, characterId, economy, ready);
const grow = (
  fromStage = 1,
  price = fromStage === 1 ? 40 : 100,
  art = refs[fromStage],
  owner = profileId,
) => evolveCompanion(db, owner, characterId, fromStage, price, art, economy, now, ready);
const acknowledge = (stage = 1) => acknowledgeEvolution(db, profileId, characterId, stage);

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = db
    .insert(profiles)
    .values({ name: "Nova", avatar: "fox", pinHash: "test" })
    .returning()
    .get().id;
  db.insert(wallet).values({ profileId, coins: 83, shards: 140 }).run();
  db.update(characters)
    .set({ maxStage: 3, artRefStages: JSON.stringify({ 2: refs[1], 3: refs[2] }) })
    .where(eq(characters.id, characterId))
    .run();
  db.insert(collection)
    .values({
      id: collectionKey(profileId, characterId),
      profileId,
      characterId,
      stage: 1,
      count: 7,
      nickname: "Mon étoile",
      unlockedAt: now,
    })
    .run();
});
afterEach(() => db.$client.close());

describe("cosmetic evolution, real SQLite", () => {
  it("shows configured price, persists two distinct stages and preserves identity and every other game table", () => {
    const untouched = db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('wallet','ledger','collection','evolution_receipts','sqlite_sequence') ORDER BY name",
      )
      .all() as { name: string }[];
    const snapshot = () =>
      untouched.map(({ name }) => [name, db.$client.prepare(`SELECT * FROM \"${name}\"`).all()]);
    const before = snapshot();
    const owned = db.select().from(collection).get()!;
    expect(offer()).toMatchObject({
      displayName: "Mon étoile",
      fromStage: 1,
      toStage: 2,
      price: 40,
    });
    expect(grow()).toMatchObject({ ok: true, receipt: { balance: { coins: 83, shards: 100 } } });
    expect(loadCollectionEntry(db, profileId, characterId)).toMatchObject({
      artRef: refs[1],
      stage: 2,
    });
    expect(grow(2)).toEqual({ ok: false, error: "CHANGED" });
    acknowledge();
    expect(grow(2)).toMatchObject({ ok: true, receipt: { balance: { coins: 83, shards: 0 } } });
    expect(db.select().from(collection).get()).toEqual({ ...owned, stage: 3 });
    expect(loadCollection(db, profileId)[0]).toMatchObject({
      artRef: refs[2],
      stage: 3,
      nickname: "Mon étoile",
      count: 7,
    });
    expect(
      loadCollectionAlbum(db, profileId, 11).families[0].slots.find(
        (s) => s.characterId === characterId,
      )?.entry?.artRef,
    ).toBe(refs[2]);
    expect(offer()).toBeNull();
    expect(snapshot()).toEqual(before);
    expect(
      db
        .select()
        .from(ledger)
        .all()
        .map((l) => [l.currency, l.reason, l.amount]),
    ).toEqual([
      ["shards", "evolution", 40],
      ["shards", "evolution", 100],
    ]);
  });
  it("keeps the same transition after concurrent requests, lost responses, acknowledgement and later adulthood", () => {
    const first = grow();
    expect(grow()).toEqual(first);
    expect(pendingEvolutionReceipt(db, profileId, characterId)).toEqual(
      first.ok ? first.receipt : null,
    );
    acknowledge();
    acknowledge();
    expect(grow(1, 999, "tampered")).toMatchObject({
      ok: true,
      receipt: { offer: { toStage: 2 }, acknowledged: true },
    });
    grow(2);
    acknowledge(2);
    expect(grow()).toMatchObject({ ok: true, receipt: { offer: { toStage: 2 } } });
    expect(loadWallet(db, profileId)).toEqual({ coins: 83, shards: 0 });
    expect(db.select().from(ledger).all()).toHaveLength(2);
    expect(pendingEvolutionReceipt(db, profileId, characterId)).toBeNull();
  });
  it("does not reset a concurrent nickname, duplicate count, acquisition date or catalogue", () => {
    renameCharacter(db, profileId, characterId, "Lumière");
    const cat = db.select().from(characters).all();
    const old = db.select().from(collection).get();
    grow();
    expect(db.select().from(collection).get()).toEqual({ ...old, stage: 2 });
    expect(db.select().from(characters).all()).toEqual(cat);
  });
  it.each([0, 39])("refuses insufficient funds (%s) before all mutations", (shards) => {
    db.update(wallet).set({ shards }).run();
    expect(grow()).toEqual({ ok: false, error: "BROKE" });
    expect(loadWallet(db, profileId).shards).toBe(shards);
    expect(db.select().from(collection).get()?.stage).toBe(1);
    expect(db.select().from(ledger).all()).toEqual([]);
    expect(db.select().from(evolutionReceipts).all()).toEqual([]);
  });
  it("uses changed configured prices at runtime and requires new consent", () => {
    const config = {
      ...economy,
      spend: { ...economy.spend, evolutionStage2Shards: 55, evolutionStage3Shards: 77 },
    };
    expect(loadEvolutionOffer(db, profileId, characterId, config, ready)?.price).toBe(55);
    expect(evolveCompanion(db, profileId, characterId, 1, 40, refs[1], config, now, ready)).toEqual(
      { ok: false, error: "CHANGED" },
    );
    expect(evolveCompanion(db, profileId, characterId, 1, 55, refs[1], config, now, ready).ok).toBe(
      true,
    );
    acknowledge();
    expect(evolveCompanion(db, profileId, characterId, 2, 77, refs[2], config, now, ready).ok).toBe(
      true,
    );
    expect(loadWallet(db, profileId).shards).toBe(8);
  });
  it.each([
    [2, 100, refs[2]],
    [1, 1, refs[1]],
    [1, 40, refs[2]],
  ])("refuses stale or tampered consent (%s)", (stage, price, art) => {
    expect(grow(Number(stage), Number(price), String(art))).toEqual({
      ok: false,
      error: "CHANGED",
    });
    expect(db.select().from(ledger).all()).toEqual([]);
  });
  it.each([0, 3, 1.5])("refuses invalid stage %s", (stage) => {
    expect(grow(stage)).toEqual({ ok: false, error: "INVALID" });
  });
  it("isolates possessions, receipts and acknowledgements between profiles", () => {
    const other = db
      .insert(profiles)
      .values({ name: "Lune", avatar: "fox", pinHash: "test" })
      .returning()
      .get().id;
    grow();
    expect(loadEvolutionState(db, other, characterId, economy, ready)).toBeNull();
    expect(grow(1, 40, refs[1], other)).toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(acknowledgeEvolution(db, other, characterId, 1)).toBeNull();
    expect(pendingEvolutionReceipt(db, profileId, characterId)).not.toBeNull();
    db.delete(profiles).where(eq(profiles.id, profileId)).run();
    expect(db.select().from(evolutionReceipts).all()).toEqual([]);
  });
  it("accepts generated-world companions and acquired legendaries without touching their world", () => {
    for (const id of ["world:14:creature:odd", "legendary:0"]) {
      if (id.startsWith("world:"))
        db.insert(characters)
          .values({
            id,
            speciesKey: "unique",
            worldIndex: 14,
            nameDefault: "Aile",
            rarity: "rare",
            maxStage: 3,
            artRef: "world/14/base.png",
            artRefStages: '{"2":"world/14/teen.png","3":"world/14/adult.png"}',
          })
          .run();
      else
        db.update(characters)
          .set({ maxStage: 3, artRefStages: '{"2":"world/0/teen.png","3":"world/0/adult.png"}' })
          .where(eq(characters.id, id))
          .run();
      db.insert(collection)
        .values({
          id: collectionKey(profileId, id),
          profileId,
          characterId: id,
          stage: 1,
          unlockedAt: now,
        })
        .run();
      const next = loadEvolutionOffer(db, profileId, id, economy, ready)!;
      expect(
        evolveCompanion(db, profileId, id, 1, 40, next.afterArtRef, economy, now, ready).ok,
      ).toBe(true);
    }
  });
  it.each(["ledger", "collection", "evolution_receipts"])(
    "rolls back a failure in %s after the wallet debit",
    (table) => {
      const event = table === "collection" ? "UPDATE OF stage" : "INSERT";
      db.run(
        sql.raw(
          `CREATE TRIGGER fail_growth BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT, 'growth failure'); END;`,
        ),
      );
      expect(() => grow()).toThrow("growth failure");
      expect(loadWallet(db, profileId)).toEqual({ coins: 83, shards: 140 });
      expect(db.select().from(collection).get()?.stage).toBe(1);
      expect(db.select().from(ledger).all()).toEqual([]);
      expect(db.select().from(evolutionReceipts).all()).toEqual([]);
    },
  );
  it("rejects missing images before spending and survives broken catalogue metadata", () => {
    expect(
      evolveCompanion(db, profileId, characterId, 1, 40, refs[1], economy, now, () => false),
    ).toEqual({ ok: false, error: "UNAVAILABLE" });
    db.update(characters)
      .set({ artRefStages: "broken" })
      .where(eq(characters.id, characterId))
      .run();
    expect(offer()).toBeNull();
    expect(db.select().from(ledger).all()).toEqual([]);
  });
});

describe("real stage art contract", () => {
  it.each([
    null,
    "broken",
    "[]",
    "null",
    '"string"',
    '{"3":"world/0/adult.png"}',
    '{"2":"https://evil/image.png"}',
    '{"2":"world/../image.png"}',
    '{"2":15}',
    JSON.stringify({ 2: refs[0] }),
  ])("does not invent stage art from %s", (artRefStages) => {
    const cat = { artRef: refs[0], artRefStages, maxStage: 3 };
    expect(stageArtRefs(cat)).toEqual([refs[0]]);
    expect(creatureStageArt(cat, 2)).toBe("placeholder://stage-unavailable");
  });
  it("honours the catalogue cap and rejects identical references across stages", () => {
    expect(
      stageArtRefs({
        artRef: refs[0],
        artRefStages: JSON.stringify({ 2: refs[1], 3: refs[1] }),
        maxStage: 3,
      }),
    ).toEqual(refs.slice(0, 2));
    expect(
      stageArtRefs({ artRef: refs[0], artRefStages: JSON.stringify({ 2: refs[1] }), maxStage: 1 }),
    ).toEqual([refs[0]]);
  });
  it("reads delivered files, refuses repeated bytes, missing files and unsafe paths", () => {
    expect(stageAssetsReady([refs[0], "socle/creature/creature_world_0_1.png"])).toBe(true);
    expect(stageAssetsReady([refs[0], refs[0]])).toBe(false);
    expect(stageAssetsReady([refs[0], "socle/creature/missing.png"])).toBe(false);
    expect(stageAssetsReady(["../../.env"])).toBe(false);
  });
});
