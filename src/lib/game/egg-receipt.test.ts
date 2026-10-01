import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import {
  characters,
  collection,
  eggPity,
  eggReceipts,
  ledger,
  profiles,
  wallet,
} from "@/lib/db/schema";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { buyEggAndDraw } from "./egg-draw";
import { acknowledgeEgg, pendingEggReceipt, purchaseEgg } from "./egg-receipt";
import { loadWallet } from "./wallet";

let db: AppDatabase;
let profileId: number;
const now = new Date("2026-09-10T12:00:00Z");
const economy = CONFIG_DEFAULTS.economy;
const map = CONFIG_DEFAULTS.map;
const buy = (id: string, owner = profileId) =>
  purchaseEgg(db, owner, economy, map, id, now, () => 0);
beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = db
    .insert(profiles)
    .values({ name: "Léa", avatar: "fox", pinHash: "test" })
    .returning()
    .get().id;
  db.insert(wallet).values({ profileId, coins: 1000, shards: 0 }).run();
});
afterEach(() => db.$client.close());

describe("durable egg encounter", () => {
  it("restores the same result after response loss; replay never draws or spends again", () => {
    const first = buy("a");
    expect(first.ok).toBe(true);
    if (!first.ok) throw Error("purchase failed");
    expect(pendingEggReceipt(db, profileId)).toEqual(first.receipt);
    expect(buy("a")).toMatchObject(first);
    expect(loadWallet(db, profileId)).toEqual({ coins: 950, shards: 0 });
    expect(db.select().from(ledger).all()).toHaveLength(1);
    expect(db.select().from(collection).get()?.count).toBe(1);
    expect(first.receipt.result.creature.artRef).toContain("socle/creature/");
  });
  it("binds different concurrent intentions, including a lost response later retried AFTER acknowledgement", () => {
    const first = buy("a");
    if (!first.ok) throw Error("purchase failed");
    expect(buy("other-tab")).toEqual(first);
    expect(acknowledgeEgg(db, profileId, "a")?.acknowledged).toBe(true);
    expect(acknowledgeEgg(db, profileId, "a")?.acknowledged).toBe(true);
    expect(pendingEggReceipt(db, profileId)).toBeNull();
    expect(buy("other-tab")).toMatchObject({
      ok: true,
      receipt: { drawId: "a", acknowledged: true, result: first.receipt.result },
    });
    expect(loadWallet(db, profileId).coins).toBe(950);
  });
  it("keeps exact paid reward and art despite later balance/catalogue changes", () => {
    const first = buy("a");
    if (!first.ok) throw Error("purchase failed");
    acknowledgeEgg(db, profileId, "a");
    db.update(wallet).set({ coins: 900 }).where(eq(wallet.profileId, profileId)).run();
    db.update(characters).set({ artRef: "changed.png", story: "changed" }).run();
    expect(buy("a")).toMatchObject({ ok: true, receipt: { result: first.receipt.result } });
  });
  it("does not spend on missing pool or insufficient balance; legacy already-spent ids stay no-op", () => {
    buyEggAndDraw(db, profileId, economy, map, "legacy", now, () => 0);
    expect(buy("legacy")).toEqual({ ok: false, error: "REPLAY" });
    db.update(wallet).set({ coins: 0 }).run();
    expect(buy("broke")).toEqual({ ok: false, error: "BROKE" });
    db.update(characters).set({ inEggPool: false }).run();
    expect(buy("empty")).toEqual({ ok: false, error: "NO_POOL" });
    expect(db.select().from(eggReceipts).all()).toHaveLength(0);
  });
  it("isolates profiles for resume, purchase keys and acknowledgement, and cascades receipts", () => {
    const other = db
      .insert(profiles)
      .values({ name: "Noé", avatar: "fox", pinHash: "test" })
      .returning()
      .get().id;
    buy("same");
    expect(pendingEggReceipt(db, other)).toBeNull();
    expect(acknowledgeEgg(db, other, "same")).toBeNull();
    expect(buy("same", other)).toEqual({ ok: false, error: "BROKE" });
    expect(pendingEggReceipt(db, profileId)).not.toBeNull();
    db.delete(profiles).where(eq(profiles.id, profileId)).run();
    expect(db.select().from(eggReceipts).all()).toEqual([]);
  });
  it("receipt write failure rolls back payment, collection, shards and pity, including a duplicate", () => {
    buy("first");
    acknowledgeEgg(db, profileId, "first");
    const before = {
      wallet: loadWallet(db, profileId),
      collection: db.select().from(collection).all(),
      pity: db.select().from(eggPity).all(),
      ledger: db.select().from(ledger).all(),
    };
    db.run(
      sql`CREATE TRIGGER fail_receipt BEFORE INSERT ON egg_receipts BEGIN SELECT RAISE(ABORT, 'receipt failed'); END`,
    );
    expect(() => buy("failed")).toThrow("receipt failed");
    expect({
      wallet: loadWallet(db, profileId),
      collection: db.select().from(collection).all(),
      pity: db.select().from(eggPity).all(),
      ledger: db.select().from(ledger).all(),
    }).toEqual(before);
  });
  it("reuses duplicates and configured pity without extra rewards on retries", () => {
    const first = buy("first");
    if (!first.ok) throw Error("purchase failed");
    acknowledgeEgg(db, profileId, "first");
    for (let i = 0; i < economy.spend.pityThreshold; i++) {
      const draw = buy(`duplicate-${i}`);
      expect(draw).toMatchObject({
        ok: true,
        receipt: { result: { isNew: false, shardsAwarded: economy.spend.duplicateShardsCommon } },
      });
      buy(`duplicate-${i}`);
      acknowledgeEgg(db, profileId, `duplicate-${i}`);
    }
    const next = buy("pity");
    expect(next).toMatchObject({
      ok: true,
      receipt: { result: { isNew: true, pityApplied: true, shardsAwarded: 0 } },
    });
    expect(loadWallet(db, profileId).shards).toBe(
      economy.spend.pityThreshold * economy.spend.duplicateShardsCommon,
    );
  });
});
