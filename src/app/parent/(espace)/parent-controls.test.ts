import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, getDb, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { getCurrentParentSession } from "@/lib/auth/current-session";
import { createHousehold } from "@/lib/auth/household";
import { profiles, adventureSessions, mastery, attempts, progress, ledger } from "@/lib/db/schema";
import { createChildProfile } from "@/lib/parent/create-profile";
import { startAdventure } from "@/lib/game/adventure";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { loadParentOverview, loadParentStats } from "@/lib/parent/stats-source";
import { requestRecalibrationAction, saveSettingsAction } from "./reglages/actions";
import {
  createChildProfileAction,
  renameProfileAction,
  resetChildPinAction,
  deleteProfileAction,
} from "./profils/actions";
import { approveWorldAction, rejectWorldAction } from "./mondes/actions";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-session", () => ({ getCurrentParentSession: vi.fn() }));
vi.mock("@/lib/db", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/db")>()),
  getDb: vi.fn(),
}));
let db: AppDatabase, owner: number, child: number;
const now = Date.UTC(2026, 8, 11, 12);
const gameRows = () =>
  [adventureSessions, mastery, attempts, progress, ledger].map((t) => db.select().from(t).all());
beforeEach(async () => {
  db = createDatabase(":memory:");
  runMigrations(db);
  vi.mocked(getDb).mockReturnValue(db);
  await createHousehold(db, { name: "Nova", avatar: "cat", childPin: "7171", parentPin: "8181" });
  owner = db.select().from(profiles).get()!.id;
  child = await createChildProfile(db, { name: "Lune", avatar: "fox", pin: "4242" });
  vi.mocked(getCurrentParentSession).mockResolvedValue({
    token: "parent",
    profileId: owner,
    kind: "parent",
    expiresAt: new Date(now + 60000),
  });
});
afterEach(() => db.$client.close());
describe("TEDDy parent controls and current journeys", () => {
  it("all mutations refuse an absent parent session (including filtered child sessions)", async () => {
    vi.mocked(getCurrentParentSession).mockResolvedValue(null);
    const before = gameRows(),
      people = db.select().from(profiles).all();
    const results = await Promise.all([
      saveSettingsAction({ theme: "dark" }),
      requestRecalibrationAction(child),
      createChildProfileAction({ name: "No", avatar: "cat", pin: "3434" }),
      renameProfileAction(child, "No"),
      resetChildPinAction(child, "3434"),
      deleteProfileAction(child),
      approveWorldAction("world:1"),
      rejectWorldAction("world:1"),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(gameRows()).toEqual(before);
    expect(db.select().from(profiles).all()).toEqual(people);
  });
  it("requests the selected child's recalibration without modifying either checkpoint or mastery", async () => {
    startAdventure(db, owner, CONFIG_DEFAULTS.engine, CONFIG_DEFAULTS.map, now);
    startAdventure(db, child, CONFIG_DEFAULTS.engine, CONFIG_DEFAULTS.map, now);
    const before = gameRows();
    expect(await requestRecalibrationAction(child)).toEqual({ ok: true });
    expect(await requestRecalibrationAction(child)).toEqual({ ok: true });
    expect(gameRows()).toEqual(before);
    expect(
      db
        .select()
        .from(profiles)
        .all()
        .find((p) => p.id === child)?.recalibrationRequested,
    ).toBe(true);
    expect(
      db
        .select()
        .from(profiles)
        .all()
        .find((p) => p.id === owner)?.recalibrationRequested,
    ).toBe(false);
    expect(await requestRecalibrationAction(999)).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });
  it("renaming, PIN reset and settings preserve the active journey; reads work with query_only", async () => {
    startAdventure(db, child, CONFIG_DEFAULTS.engine, CONFIG_DEFAULTS.map, now);
    const before = gameRows();
    expect(await renameProfileAction(child, "Lune douce")).toEqual({ ok: true });
    expect(await resetChildPinAction(child, "4343")).toEqual({ ok: true });
    expect(
      await saveSettingsAction({ screenTimeHardLockEnabled: true, soundEnabled: false }),
    ).toEqual({ ok: true });
    expect(gameRows()).toEqual(before);
    db.$client.pragma("query_only=ON");
    expect(loadParentOverview(db, child, CONFIG_DEFAULTS, now, "all").total).toBe(0);
    expect(loadParentStats(db, child, CONFIG_DEFAULTS, now).regularity.today).toBe(null);
    expect(gameRows()).toEqual(before);
  });
});
