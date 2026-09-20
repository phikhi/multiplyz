import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, getDb, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { characters, ledger, profiles, wallet } from "@/lib/db/schema";
import { boutiqueStateAction, buyEggAction, acknowledgeEggAction } from "./actions";
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
  db.insert(wallet).values({ profileId: id, coins: 100, shards: 0 }).run();
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(getCurrentChildProfileId).mockResolvedValue(id);
});
afterEach(() => db.$client.close());
describe("egg actions, real SQLite", () => {
  it("loads the authenticated wallet, price, available pool and pending receipt", async () => {
    expect(await boutiqueStateAction()).toEqual({
      profileId: id,
      coins: 100,
      shards: 0,
      eggPriceCoins: 50,
      available: true,
      receipt: null,
    });
    const draw = await buyEggAction("draw", id);
    expect(draw.ok).toBe(true);
    expect(await boutiqueStateAction()).toMatchObject({ coins: 50, receipt: { drawId: "draw" } });
    expect(await acknowledgeEggAction("draw", id)).toMatchObject({ acknowledged: true });
    expect(await acknowledgeEggAction("draw", id)).toMatchObject({ acknowledged: true });
    expect(await acknowledgeEggAction("missing", id)).toBeNull();
    expect((await boutiqueStateAction())?.receipt).toBeNull();
    const spend = db.select().from(ledger).get();
    expect(spend).toEqual({
      id: expect.any(Number),
      profileId: id,
      direction: "spend",
      currency: "coins",
      amount: 50,
      reason: "egg",
      refId: "egg:draw",
      createdAt: expect.any(Date),
    });
  });
  it.each([null, "", "a".repeat(65), { drawId: "a", amount: 1 }])(
    "rejects malformed ids (%s) before any spend",
    async (value) => {
      expect(await buyEggAction(value, id)).toEqual({ ok: false, error: "INVALID" });
      expect(await acknowledgeEggAction(value, id)).toBeNull();
      expect(db.select().from(ledger).all()).toEqual([]);
    },
  );
  it.each([null, 999])(
    "blocks unauthenticated and switched-profile intents (%s)",
    async (session) => {
      vi.mocked(getCurrentChildProfileId).mockResolvedValue(session);
      expect(await buyEggAction("draw", id)).toEqual({ ok: false, error: "UNAUTHENTICATED" });
      expect(await acknowledgeEggAction("draw", id)).toBeNull();
      if (session === null) expect(await boutiqueStateAction()).toBeNull();
      expect(db.select().from(ledger).all()).toEqual([]);
    },
  );
  it("shows an unavailable pool and reports refusal without spending", async () => {
    db.update(characters).set({ inEggPool: false }).run();
    expect((await boutiqueStateAction())?.available).toBe(false);
    expect(await buyEggAction("draw", id)).toEqual({ ok: false, error: "NO_POOL" });
    expect(db.select().from(ledger).all()).toEqual([]);
  });
});
