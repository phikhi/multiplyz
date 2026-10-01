import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { adventureSessions, profiles, progress, socleWorlds, worlds } from "@/lib/db/schema";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { startAdventure, loadAdventure } from "./adventure";
import { presentAdventureWorld } from "./adventure-world";
import { resumeAdventureAction, adventureCommandAction } from "@/app/(app)/jouer/adventure-actions";
const m = vi.hoisted(() => ({ profile: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: m.profile }));
vi.mock("@/lib/db", async (original) => ({
  ...(await original<typeof import("@/lib/db")>()),
  getDb: m.db,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let db: AppDatabase, id: number;
beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  id = db
    .insert(profiles)
    .values({ name: "Décor", nameKey: "decor", pinHash: "unit", avatar: "cat" })
    .returning()
    .get().id;
  m.profile.mockResolvedValue(id);
  m.db.mockReturnValue(db);
});
afterEach(() => db.$client.close());
function checkpoint(index = 7) {
  const a = startAdventure(db, id, CONFIG_DEFAULTS.engine, CONFIG_DEFAULTS.map, 1000)!;
  const state = { ...a, worldIndex: index, paused: true };
  db.update(adventureSessions).set({ state }).where(eq(adventureSessions.profileId, id)).run();
  return state;
}
function generated(status: "active" | "buffered" | "rejected") {
  db.insert(worlds)
    .values({
      id: "world:7",
      index: 7,
      theme: "Océan scintillant",
      palette: JSON.stringify({ slug: "ocean", accent: "#2BB7E6" }),
      assetRefs: JSON.stringify({
        background: "world/7/background.png",
        tiles: "world/7/tiles.png",
        teddy: "https://evil.test/teddy.png",
      }),
      prompt: "unit",
      seed: "unit",
      status,
    })
    .run();
}
describe("scene presentation follows server checkpoint and world guards", () => {
  it("preserves the stored family theme instead of deriving a default from the slot", () => {
    const a = checkpoint(0);
    db.update(socleWorlds)
      .set({ theme: "Forêt enchantée", palette: '{"slug":"forest","accent":"#5BBF73"}' })
      .where(eq(socleWorlds.slot, 0))
      .run();
    db.$client.pragma("query_only=ON");
    const shown = presentAdventureWorld(db, a);
    expect(shown.worldTheme?.slug).toBe("forest");
    expect(a.worldTheme).toBeUndefined();
    expect(loadAdventure(db, id)).toEqual(a);
  });
  it("uses an active generated world's theme and validated references without changing the checkpoint", () => {
    const a = checkpoint();
    generated("active");
    db.$client.pragma("query_only=ON");
    const shown = presentAdventureWorld(db, a);
    expect(shown.worldTheme).toMatchObject({
      slug: "ocean",
      background: "/generated/world/7/background.png",
      teddy: null,
    });
    expect(shown.game).toBe(a.game);
    expect(shown.paused).toBe(true);
    expect(loadAdventure(db, id)).toEqual(a);
  });
  it.each(["buffered", "rejected"] as const)(
    "keeps %s worlds behind the existing visibility guard",
    (status) => {
      const a = checkpoint();
      generated(status);
      expect(presentAdventureWorld(db, a).worldTheme?.slug).toBe("magic");
    },
  );
  it("resolves an absent generated world through the same socle fallback", () => {
    expect(presentAdventureWorld(db, checkpoint(11)).worldTheme?.slug).toBe("ocean");
  });
  it("decorates both resume and command responses, while never persisting the decoration", async () => {
    const a = checkpoint();
    generated("active");
    const resumed = await resumeAdventureAction(id);
    expect(resumed).toMatchObject({
      ok: true,
      adventure: { id: a.id, worldIndex: 7, worldTheme: { slug: "ocean" } },
    });
    const moved = await adventureCommandAction(
      {
        sessionId: a.id,
        revision: a.revision,
        kind: "resume",
        worldIndex: 2,
        worldTheme: { slug: "snow" },
      },
      id,
    );
    expect(moved).toMatchObject({
      ok: true,
      adventure: { worldIndex: 7, paused: false, worldTheme: { slug: "ocean" } },
    });
    expect(loadAdventure(db, id)?.worldTheme).toBeUndefined();
  });
  it("returns the world of a historical boss receipt even after later map progress", async () => {
    const a = checkpoint(1);
    const state = { ...a, phase: "results" as const, levelIndex: 10 };
    db.update(adventureSessions).set({ state }).where(eq(adventureSessions.profileId, id)).run();
    db.insert(progress)
      .values(
        Array.from({ length: 22 }, (_, i) => ({
          id: `${id}:${Math.floor(i / 11)}:${i % 11}`,
          profileId: id,
          worldIndex: Math.floor(i / 11),
          levelIndex: i % 11,
          stars: 0 as const,
        })),
      )
      .run();
    db.$client.pragma("query_only=ON");
    expect(await resumeAdventureAction(id)).toMatchObject({
      ok: true,
      adventure: { worldIndex: 1, phase: "results", worldTheme: { slug: "magic" } },
    });
  });
});

it("an unreadable palette cannot block a valid paused checkpoint or command", async () => {
  const a = checkpoint();
  generated("active");
  db.update(worlds).set({ palette: "corrupt" }).where(eq(worlds.index, 7)).run();
  expect(await resumeAdventureAction(id)).toMatchObject({
    ok: true,
    adventure: { worldTheme: { slug: "wonder" }, paused: true },
  });
  expect(
    await adventureCommandAction({ sessionId: a.id, revision: a.revision, kind: "resume" }, id),
  ).toMatchObject({ ok: true, adventure: { paused: false } });
  expect(loadAdventure(db, id)?.worldTheme).toBeUndefined();
});
it("a missing visual socle also falls back without writing any data", () => {
  const a = checkpoint();
  db.delete(socleWorlds).run();
  db.$client.pragma("query_only=ON");
  expect(presentAdventureWorld(db, a).worldTheme?.slug).toBe("wonder");
  expect(loadAdventure(db, id)).toEqual(a);
});
it("operational errors are not hidden as an art fallback", () => {
  const a = checkpoint();
  db.$client.exec("DROP TABLE worlds");
  expect(() => presentAdventureWorld(db, a)).toThrow();
});
