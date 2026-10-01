import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { profiles } from "@/lib/db/schema";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { startAdventure } from "@/lib/game/adventure";
import { resumeAdventureAction, adventureCommandAction } from "./adventure-actions";
const m = vi.hoisted(() => ({
  profile: vi.fn(),
  db: vi.fn(),
  limit: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: m.profile }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: m.db,
}));
vi.mock("next/cache", () => ({ revalidatePath: m.invalidate }));
vi.mock("@/lib/parent/screen-time-lock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/parent/screen-time-lock")>()),
  evaluateScreenTimeLock: m.limit,
}));
let db: AppDatabase, id: number;
beforeEach(() => {
  vi.clearAllMocks();
  db = createDatabase(":memory:");
  runMigrations(db);
  id = db
    .insert(profiles)
    .values({ name: "Nova", nameKey: "nova", avatar: "cat", pinHash: "test" })
    .returning()
    .get().id;
  m.db.mockReturnValue(db);
  m.profile.mockResolvedValue(id);
  m.limit.mockReturnValue(false);
});
afterEach(() => db.$client.close());
it("requires the current child session and protects an intent against a profile switch", async () => {
  m.profile.mockResolvedValue(null);
  expect(await resumeAdventureAction(id)).toEqual({ ok: false, error: "UNAUTHENTICATED" });
  m.profile.mockResolvedValue(id + 1);
  expect(await resumeAdventureAction(id)).toEqual({ ok: false, error: "UNAUTHENTICATED" });
  expect(await adventureCommandAction({ kind: "pause" }, id)).toEqual({
    ok: false,
    error: "UNAUTHENTICATED",
  });
  expect(m.db).not.toHaveBeenCalled();
});
it("starts the real diagnostic for a new profile", async () => {
  const result = await resumeAdventureAction(id);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.adventure.diagnostic?.responses).toEqual([]);
});
it("applies the parental limit before any new diagnostic or adventure", async () => {
  m.limit.mockReturnValue(true);
  expect(await resumeAdventureAction(id)).toEqual({ ok: false, error: "LOCKED" });
});
it("preserves and resumes a paused run even if the limit is later reached", async () => {
  const a = startAdventure(db, id, CONFIG_DEFAULTS.engine, CONFIG_DEFAULTS.map, Date.now())!;
  const result = await adventureCommandAction(
    { sessionId: a.id, revision: a.revision, kind: "pause" },
    id,
  );
  expect(result.ok).toBe(true);
  m.limit.mockReturnValue(true);
  expect(await resumeAdventureAction(id)).toEqual(result);
  expect(m.limit).not.toHaveBeenCalled();
});
it("rejects malformed commands without opening a session", async () => {
  expect(await adventureCommandAction({ kind: "answer", value: { stage: 99 } }, id)).toEqual({
    ok: false,
    error: "INVALID",
  });
});
