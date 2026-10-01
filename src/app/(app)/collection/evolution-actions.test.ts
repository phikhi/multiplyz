import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, getDb, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { characters, collection, collectionKey, ledger, profiles, wallet } from "@/lib/db/schema";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { revalidatePath } from "next/cache";
import {
  acknowledgeEvolutionAction,
  evolveCompanionAction,
  evolutionStateAction,
} from "./evolution-actions";
vi.mock("@/lib/db", async (original) => ({
  ...(await original<typeof import("@/lib/db")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let db: AppDatabase;
let id: number;
const characterId = "creature:0:0";
// Existing different delivered fixtures exercise the real filesystem gate without a provider call.
const nextArt = "socle/creature/creature_world_0_1.png";
beforeEach(() => {
  vi.clearAllMocks();
  db = createDatabase(":memory:");
  runMigrations(db);
  id = db
    .insert(profiles)
    .values({ name: "Nova", avatar: "fox", pinHash: "test" })
    .returning()
    .get().id;
  db.insert(wallet).values({ profileId: id, coins: 30, shards: 40 }).run();
  db.update(characters)
    .set({ maxStage: 2, artRefStages: JSON.stringify({ 2: nextArt }) })
    .where(eq(characters.id, characterId))
    .run();
  db.insert(collection)
    .values({
      id: collectionKey(id, characterId),
      profileId: id,
      characterId,
      unlockedAt: new Date(),
    })
    .run();
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(getCurrentChildProfileId).mockResolvedValue(id);
});
afterEach(() => db.$client.close());
describe("authenticated evolution actions", () => {
  it("reads, evolves, invalidates wallet and resumes/acknowledges the same transition", async () => {
    expect(await evolutionStateAction(characterId)).toMatchObject({
      profileId: id,
      shards: 40,
      offer: { price: 40 },
      receipt: null,
    });
    expect(await evolveCompanionAction(characterId, 1, 40, nextArt, id)).toMatchObject({
      ok: true,
      receipt: { offer: { toStage: 2 } },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(await evolutionStateAction(characterId)).toMatchObject({
      shards: 0,
      entry: { stage: 2, artRef: nextArt },
      receipt: { acknowledged: false },
    });
    expect(await acknowledgeEvolutionAction(characterId, 1, id)).toMatchObject({
      acknowledged: true,
    });
    expect(await acknowledgeEvolutionAction(characterId, 1, id)).toMatchObject({
      acknowledged: true,
    });
    expect(await evolveCompanionAction(characterId, 1, 40, nextArt, id)).toMatchObject({
      ok: true,
      receipt: { acknowledged: true },
    });
    expect(db.select().from(ledger).all()).toHaveLength(1);
  });
  it.each([null, "", "x".repeat(129), { id: characterId, stage: 3, amount: 1 }])(
    "rejects malformed ids and object smuggling (%s)",
    async (value) => {
      expect(await evolutionStateAction(value)).toBeNull();
      expect(await evolveCompanionAction(value, 1, 40, nextArt, id)).toEqual({
        ok: false,
        error: "INVALID",
      });
      expect(await evolveCompanionAction(characterId, 1, 40, value, id)).toEqual({
        ok: false,
        error: "INVALID",
      });
      expect(await acknowledgeEvolutionAction(value, 1, id)).toBeNull();
      expect(db.select().from(ledger).all()).toEqual([]);
    },
  );
  it.each([0, 3, 1.5, "1", {}])("rejects invalid stage %s", async (stage) => {
    expect(await evolveCompanionAction(characterId, stage, 40, nextArt, id)).toEqual({
      ok: false,
      error: "INVALID",
    });
    expect(await acknowledgeEvolutionAction(characterId, stage, id)).toBeNull();
  });
  it.each([0, -1, 1.5, "40", {}, NaN, Infinity])(
    "rejects invalid price guard %s",
    async (price) => {
      expect(await evolveCompanionAction(characterId, 1, price, nextArt, id)).toEqual({
        ok: false,
        error: "INVALID",
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
  it.each([null, 999])("refuses absent or changed session %s", async (session) => {
    vi.mocked(getCurrentChildProfileId).mockResolvedValue(session);
    expect(await evolveCompanionAction(characterId, 1, 40, nextArt, id)).toEqual({
      ok: false,
      error: "UNAUTHENTICATED",
    });
    expect(await acknowledgeEvolutionAction(characterId, 1, id)).toBeNull();
    expect(await evolutionStateAction(characterId)).toBeNull();
    expect(db.select().from(ledger).all()).toEqual([]);
  });
  it("does not invalidate or spend when consent is stale", async () => {
    expect(await evolveCompanionAction(characterId, 1, 1, nextArt, id)).toEqual({
      ok: false,
      error: "CHANGED",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(db.select().from(ledger).all()).toEqual([]);
  });
});
