import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import {
  characters,
  collection,
  eggPity,
  ledger,
  profiles,
  progress,
  shardReceipts,
  wallet,
} from "@/lib/db/schema";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { loadCollectionEntry } from "./collection";
import {
  acknowledgeShardReceipt,
  loadShardOffers,
  pendingShardReceipt,
  purchaseCompanion,
} from "./shard-shop";
import { loadWallet } from "./wallet";

let db: AppDatabase;
let id: number;
const now = new Date("2026-09-10T12:00:00Z");
const economy = CONFIG_DEFAULTS.economy;
const map = CONFIG_DEFAULTS.map;
const offers = () => loadShardOffers(db, id, economy, map);
const buy = (purchaseId: string, characterId = offers()[0].characterId, owner = id) =>
  purchaseCompanion(db, owner, economy, map, purchaseId, characterId, now);
beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  id = db
    .insert(profiles)
    .values({ name: "Nova", avatar: "fox", pinHash: "test" })
    .returning()
    .get().id;
  db.insert(wallet).values({ profileId: id, coins: 77, shards: 600 }).run();
});
afterEach(() => db.$client.close());

describe("targeted shard purchases, real SQLite", () => {
  it("lists only missing non-legendary companions from accessible worlds, with configured prices", () => {
    const initial = offers();
    expect(initial.length).toBeGreaterThan(1);
    expect(initial.every((o) => o.worldIndex === 0 && ["common", "rare"].includes(o.rarity))).toBe(
      true,
    );
    expect(initial.find((o) => o.rarity === "common")?.price).toBe(60);
    expect(initial.find((o) => o.rarity === "rare")?.price).toBe(150);
    const first = initial[0];
    buy("one", first.characterId);
    expect(offers().map((o) => o.characterId)).not.toContain(first.characterId);
    expect(
      loadShardOffers(
        db,
        id,
        {
          ...economy,
          spend: { ...economy.spend, shopPriceCommonShards: 81, shopPriceRareShards: 192 },
        },
        map,
      ).every((o) => o.price === (o.rarity === "common" ? 81 : 192)),
    ).toBe(true);
  });
  it("spends exactly once, grants the chosen companion and leaves coins, stars and pity alone", () => {
    const offer = offers().find((o) => o.rarity === "rare")!;
    db.insert(eggPity).values({ profileId: id, consecutiveDuplicates: 4, updatedAt: now }).run();
    const first = buy("one", offer.characterId);
    expect(first).toMatchObject({
      ok: true,
      receipt: { offer, balance: { coins: 77, shards: 450 } },
    });
    expect(buy("one", offer.characterId)).toEqual(first);
    expect(loadCollectionEntry(db, id, offer.characterId)).toMatchObject({
      artRef: offer.artRef,
      story: offer.story,
      stage: 1,
      count: 1,
    });
    expect(db.select().from(ledger).all()).toMatchObject([
      {
        direction: "spend",
        currency: "shards",
        amount: 150,
        reason: "shop",
        refId: "shop:one",
        profileId: id,
      },
    ]);
    expect(loadWallet(db, id)).toEqual({ coins: 77, shards: 450 });
    expect(db.select().from(progress).all()).toEqual([]);
    expect(db.select().from(eggPity).get()?.consecutiveDuplicates).toBe(4);
  });
  it("binds concurrent intentions to the pending acquisition, even with different targets and replay after acknowledgement", () => {
    const [a, b] = offers();
    const first = buy("a", a.characterId);
    expect(buy("b", b.characterId)).toEqual(first);
    expect(pendingShardReceipt(db, id)).toEqual(first.ok ? first.receipt : null);
    expect(acknowledgeShardReceipt(db, id, "a")?.acknowledged).toBe(true);
    expect(acknowledgeShardReceipt(db, id, "a")?.acknowledged).toBe(true);
    expect(pendingShardReceipt(db, id)).toBeNull();
    expect(buy("b", b.characterId)).toMatchObject({
      ok: true,
      receipt: { purchaseId: "a", acknowledged: true, offer: a },
    });
    expect(loadCollectionEntry(db, id, b.characterId)).toBeNull();
    expect(loadWallet(db, id).shards).toBe(600 - a.price);
    expect(db.select().from(ledger).all()).toHaveLength(1);
    expect(buy("new", b.characterId).ok).toBe(true);
  });
  it("retains the exact receipt when the balance, catalogue and configuration later change", () => {
    const offer = offers()[0];
    const first = buy("one", offer.characterId);
    acknowledgeShardReceipt(db, id, "one");
    db.update(characters).set({ artRef: "changed", story: "changed" }).run();
    db.update(wallet).set({ shards: 0 }).run();
    const result = purchaseCompanion(
      db,
      id,
      { ...economy, spend: { ...economy.spend, shopPriceCommonShards: 500 } },
      map,
      "one",
      "altered-target",
      now,
    );
    expect(result).toMatchObject({
      ok: true,
      receipt: { ...(first.ok ? first.receipt : {}), acknowledged: true },
    });
    expect(loadWallet(db, id).shards).toBe(0);
  });
  it("refuses unknown, locked and legendary characters, including mislabelled egg eligibility", () => {
    db.update(characters).set({ inEggPool: true }).where(eq(characters.rarity, "legendary")).run();
    for (const target of ["unknown", "legendary:0", "creature:1:0"])
      expect(buy(target, target)).toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(db.select().from(ledger).all()).toEqual([]);
    expect(db.select().from(collection).all()).toEqual([]);
  });
  it("refuses an already owned target under a new key, without duplicate compensation", () => {
    const target = offers()[0].characterId;
    buy("one", target);
    acknowledgeShardReceipt(db, id, "one");
    expect(buy("two", target)).toEqual({ ok: false, error: "OWNED" });
    expect(db.select().from(ledger).all()).toHaveLength(1);
    expect(loadCollectionEntry(db, id, target)?.count).toBe(1);
  });
  it("refuses insufficient funds but accepts the exact balance", () => {
    const offer = offers()[0];
    db.update(wallet)
      .set({ shards: offer.price - 1 })
      .run();
    expect(buy("one", offer.characterId)).toEqual({ ok: false, error: "BROKE" });
    expect(db.select().from(ledger).all()).toEqual([]);
    expect(db.select().from(shardReceipts).all()).toEqual([]);
    db.update(wallet).set({ shards: offer.price }).run();
    expect(buy("one", offer.characterId).ok).toBe(true);
    expect(loadWallet(db, id)).toEqual({ coins: 77, shards: 0 });
  });
  it.each(["collection", "shard_receipts", "ledger"])(
    "rolls back all writes if INSERT %s fails after the wallet debit",
    (table) => {
      db.$client.exec(
        `CREATE TRIGGER reject_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'write failed'); END`,
      );
      expect(() => buy("one")).toThrow("write failed");
      expect(loadWallet(db, id)).toEqual({ coins: 77, shards: 600 });
      expect(db.select().from(ledger).all()).toEqual([]);
      expect(db.select().from(collection).all()).toEqual([]);
      expect(db.select().from(shardReceipts).all()).toEqual([]);
    },
  );
  it("isolates profiles, replays and acknowledgements, and deletes receipts with their profile", () => {
    const target = offers()[0].characterId;
    buy("same", target);
    const other = db
      .insert(profiles)
      .values({ name: "Léa", avatar: "fox", pinHash: "test" })
      .returning()
      .get().id;
    expect(pendingShardReceipt(db, other)).toBeNull();
    expect(acknowledgeShardReceipt(db, other, "same")).toBeNull();
    expect(buy("same", target, other)).toEqual({ ok: false, error: "BROKE" });
    expect(loadShardOffers(db, other, economy, map).some((o) => o.characterId === target)).toBe(
      true,
    );
    db.delete(profiles).where(eq(profiles.id, id)).run();
    expect(db.select().from(shardReceipts).all()).toEqual([]);
    expect(db.get(sql`PRAGMA foreign_key_check`)).toBeUndefined();
  });
  it("uses generated-world catalogue entries once progression opens their world, without an egg-pool requirement", () => {
    db.insert(characters)
      .values({
        id: "generated-friend",
        worldIndex: 8,
        speciesKey: "generated-friend",
        nameDefault: "Plume",
        rarity: "rare",
        inEggPool: false,
        artRef: "world/8/plume.png",
        story: "Dans les nuages.",
      })
      .run();
    expect(buy("locked", "generated-friend")).toEqual({ ok: false, error: "UNAVAILABLE" });
    for (let worldIndex = 0; worldIndex < 8; worldIndex++)
      db.insert(progress)
        .values({
          id: `${id}:${worldIndex}:${map.levelsPerWorld}`,
          profileId: id,
          worldIndex,
          levelIndex: map.levelsPerWorld,
          stars: 0,
        })
        .run();
    expect(buy("open", "generated-friend")).toMatchObject({
      ok: true,
      receipt: {
        offer: {
          characterId: "generated-friend",
          artRef: "world/8/plume.png",
          worldIndex: 8,
          price: 150,
        },
      },
    });
  });
  it("returns an empty list for a partial or completed accessible catalogue", () => {
    db.delete(characters).where(eq(characters.worldIndex, 0)).run();
    expect(offers()).toEqual([]);
  });
  it("never spends for a legacy ledger replay without a receipt", () => {
    db.insert(ledger)
      .values({
        profileId: id,
        direction: "spend",
        currency: "shards",
        amount: 60,
        reason: "shop",
        refId: "shop:legacy",
        createdAt: now,
      })
      .run();
    expect(buy("legacy")).toEqual({ ok: false, error: "REPLAY" });
    expect(loadWallet(db, id).shards).toBe(600);
    expect(db.select().from(collection).all()).toEqual([]);
  });
});
