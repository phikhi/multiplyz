import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { createDatabase, getDb, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { ledger, profiles, wallet } from "@/lib/db/schema";
import { acknowledgeCompanionAction, buyCompanionAction, shardShopStateAction } from "./actions";
vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({
  ...(await original<typeof import("@/lib/db")>()),
  getDb: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let db: AppDatabase;
let id: number;
beforeEach(() => {
  vi.clearAllMocks();
  db = createDatabase(":memory:");
  runMigrations(db);
  id = db
    .insert(profiles)
    .values({ name: "Nova", avatar: "fox", pinHash: "test" })
    .returning()
    .get().id;
  db.insert(wallet).values({ profileId: id, coins: 30, shards: 200 }).run();
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(getCurrentChildProfileId).mockResolvedValue(id);
});
afterEach(() => db.$client.close());

describe("shard actions, real SQLite", () => {
  it("loads session-owned offers, charges the server price, invalidates the wallet and resumes the receipt", async () => {
    const state = await shardShopStateAction();
    expect(state).toMatchObject({ profileId: id, coins: 30, shards: 200, receipt: null });
    const offer = state!.offers[0];
    expect((await buyCompanionAction("a", offer.characterId, id)).ok).toBe(true);
    expect(await shardShopStateAction()).toMatchObject({
      shards: 200 - offer.price,
      receipt: { purchaseId: "a", offer },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(db.select().from(ledger).all()).toEqual([
      {
        id: expect.any(Number),
        profileId: id,
        direction: "spend",
        currency: "shards",
        amount: offer.price,
        reason: "shop",
        refId: "shop:a",
        createdAt: expect.any(Date),
      },
    ]);
    expect(await acknowledgeCompanionAction("a", id)).toMatchObject({ acknowledged: true });
    expect(await acknowledgeCompanionAction("a", id)).toMatchObject({ acknowledged: true });
    expect(await acknowledgeCompanionAction("unknown", id)).toBeNull();
    expect((await shardShopStateAction())?.receipt).toBeNull();
  });
  it.each([null, "", "a".repeat(129), { characterId: "creature:0:0", amount: 1 }])(
    "rejects malformed or smuggled ids (%s)",
    async (value) => {
      expect(await buyCompanionAction(value, "creature:0:0", id)).toEqual({
        ok: false,
        error: "INVALID",
      });
      expect(await buyCompanionAction("a", value, id)).toEqual({ ok: false, error: "INVALID" });
      expect(await acknowledgeCompanionAction(value, id)).toBeNull();
      expect(db.select().from(ledger).all()).toEqual([]);
    },
  );
  it.each([null, 999])("refuses absent or changed sessions (%s)", async (session) => {
    vi.mocked(getCurrentChildProfileId).mockResolvedValue(session);
    expect(await buyCompanionAction("a", "creature:0:0", id)).toEqual({
      ok: false,
      error: "UNAUTHENTICATED",
    });
    expect(await acknowledgeCompanionAction("a", id)).toBeNull();
    if (session === null) expect(await shardShopStateAction()).toBeNull();
    expect(db.select().from(ledger).all()).toEqual([]);
  });
  it("propagates a refusal without invalidating or spending", async () => {
    expect(await buyCompanionAction("a", "legendary:0", id)).toEqual({
      ok: false,
      error: "UNAVAILABLE",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(db.select().from(ledger).all()).toEqual([]);
  });
});
