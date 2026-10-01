import { beforeEach, expect, it, vi } from "vitest";
import { resumeAdventureAction, adventureCommandAction } from "./adventure-actions";
const m = vi.hoisted(() => ({
  profile: vi.fn(),
  load: vi.fn(),
  start: vi.fn(),
  command: vi.fn(),
  locked: vi.fn(),
  diagnostic: vi.fn(),
  recalibrate: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: m.profile }));
vi.mock("@/lib/db", () => ({ getDb: () => "DB" }));
vi.mock("@/lib/game/adventure", () => ({
  loadAdventure: m.load,
  startAdventure: m.start,
  commandAdventure: m.command,
}));
vi.mock("@/lib/game/adventure-world", () => ({
  presentAdventureWorld: (_db: unknown, adventure: unknown) => adventure,
}));
vi.mock("@/lib/parent/screen-time-lock", () => ({ evaluateScreenTimeLock: m.locked }));
vi.mock("@/lib/parent/settings", () => ({ readHouseholdSettings: () => ({}) }));
vi.mock("@/lib/engine/service", () => ({
  needsDiagnostic: m.diagnostic,
  isRecalibrationRequested: m.recalibrate,
}));
beforeEach(() => {
  vi.clearAllMocks();
  m.profile.mockResolvedValue(7);
  m.load.mockReturnValue(null);
  m.locked.mockReturnValue(false);
  m.diagnostic.mockReturnValue(false);
  m.recalibrate.mockReturnValue(false);
});
it("requires a child session for reads and writes", async () => {
  m.profile.mockResolvedValue(null);
  expect(await resumeAdventureAction()).toEqual({ ok: false, error: "UNAUTHENTICATED" });
  expect(await adventureCommandAction({ profileId: 9 })).toEqual({
    ok: false,
    error: "UNAUTHENTICATED",
  });
  expect(m.command).not.toHaveBeenCalled();
  expect(m.load).not.toHaveBeenCalled();
});
it("resumes an existing passage despite a later time lock or recalibration request", async () => {
  const active = { phase: "question", id: "saved" };
  m.load.mockReturnValue(active);
  m.locked.mockReturnValue(true);
  m.recalibrate.mockReturnValue(true);
  expect(await resumeAdventureAction()).toEqual({ ok: true, adventure: active });
  expect(m.start).not.toHaveBeenCalled();
  expect(m.locked).not.toHaveBeenCalled();
});
it("honors the hard lock before creating a new run", async () => {
  m.locked.mockReturnValue(true);
  expect(await resumeAdventureAction()).toEqual({ ok: false, error: "LOCKED" });
  expect(m.start).not.toHaveBeenCalled();
});
it.each([false, true])(
  "returns the durable diagnostic chosen by the engine (recalibration %s)",
  async (recalibration) => {
    const diagnostic = { id: "diagnostic", diagnostic: { recalibration, responses: [] } };
    m.start.mockReturnValue(diagnostic);
    expect(await resumeAdventureAction()).toEqual({ ok: true, adventure: diagnostic });
    expect(m.start.mock.calls[0].slice(0, 2)).toEqual(["DB", 7]);
  },
);
it("creates for the session profile after the preceding receipt is closed", async () => {
  m.load.mockReturnValue({ phase: "closed" });
  m.start.mockReturnValue({ id: "new" });
  expect(await resumeAdventureAction()).toEqual({ ok: true, adventure: { id: "new" } });
  expect(m.start.mock.calls[0].slice(0, 2)).toEqual(["DB", 7]);
});
it("returns the engine's empty-level state instead of creating an empty adventure", async () => {
  m.start.mockReturnValue(null);
  expect(await resumeAdventureAction()).toEqual({ ok: false, error: "EMPTY" });
});
it("ignores a client profile and refreshes the map only with a confirmed receipt", async () => {
  m.command.mockReturnValue({ ok: true, adventure: { result: null } });
  await adventureCommandAction({ profileId: 9 });
  expect(m.command.mock.calls[0].slice(0, 2)).toEqual(["DB", 7]);
  expect(m.revalidate).not.toHaveBeenCalled();
  m.command.mockReturnValue({ ok: false, error: "INVALID" });
  await adventureCommandAction(null);
  expect(m.revalidate).not.toHaveBeenCalled();
  m.command.mockReturnValue({ ok: true, adventure: { result: { ok: true } } });
  await adventureCommandAction({});
  expect(m.revalidate).toHaveBeenCalledWith("/carte", "layout");
});
