import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AdventureScreen } from "./AdventureScreen";
import { useAdventure } from "@/lib/game/use-adventure";
import { initGameState } from "@/lib/game/session";
import type { Adventure } from "@/lib/game/adventure-types";
import { daily } from "@/strings/daily";
import { forest } from "@/strings/forest";
const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  dispatch: vi.fn(),
  retry: vi.fn(),
  refresh: vi.fn(),
  playSfx: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("@/lib/game/use-adventure", () => ({ useAdventure: vi.fn() }));
vi.mock("./ForestScene", () => ({ ForestScene: () => null }));
vi.mock("@/lib/sound/use-prefers-reduced-motion", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/lib/sound/SoundProvider", () => ({
  SoundProvider: ({ children }: { children: ReactNode }) => children,
  useSound: () => mocks,
}));
vi.mock("@/app/(app)/jouer/actions", () => ({ setChildSoundEnabledAction: vi.fn() }));
const first: Adventure = {
  id: "daily",
  revision: 0,
  worldIndex: 0,
  levelIndex: 0,
  phase: "arrival",
  result: null,
  diagnostic: { recalibration: false, responses: [] },
  game: initGameState(
    [
      {
        factKey: "comp10_3",
        skill: "comp10",
        operands: [3],
        format: "qcm",
        choices: [7, 3, 5, 1],
        isReask: false,
      },
    ],
    0,
    () => "question",
  ),
};
function setup(adventure: Adventure | null = first, error: string | null = null) {
  vi.mocked(useAdventure).mockReturnValue({
    adventure,
    error,
    sending: false,
    storageWarning: false,
    ...mocks,
  });
  return render(
    <AdventureScreen
      profileId={2}
      sound={{ soundEnabled: false, musicEnabled: false, volume: 20 }}
      guardianLevelIndex={10}
    />,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);
it("presents the first journey without a reward and labels its progress as markers", () => {
  setup();
  expect(screen.getByRole("heading", { name: daily.diagnosticTitle })).toBeVisible();
  expect(screen.getByRole("status", { name: daily.diagnosticProgress(0, 1) })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: daily.diagnosticBegin }));
  expect(mocks.dispatch).toHaveBeenCalledWith("begin");
});
it("closes the completed diagnostic directly to its map", () => {
  setup({ ...first, phase: "finale" });
  fireEvent.click(screen.getByRole("button", { name: daily.diagnosticMap }));
  expect(mocks.dispatch).toHaveBeenCalledWith("close");
  expect(screen.queryByRole("button", { name: forest.results })).toBeNull();
});
it("keeps network retry accessible inside the persisted pause dialog", () => {
  setup({ ...first, paused: true }, "NETWORK");
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByText(forest.pending)).toBeVisible();
  expect(dialog.getByRole("button", { name: forest.resumePlay })).toBeDisabled();
  expect(dialog.queryByRole("link", { name: daily.stop })).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: forest.retryNetwork }));
  expect(mocks.retry).toHaveBeenCalledTimes(1);
});
it("resumes a server-confirmed pause and redirects a new locked run to rest", () => {
  const view = setup({ ...first, paused: true });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: forest.resumePlay }),
  );
  expect(mocks.dispatch).toHaveBeenCalledWith("resume");
  view.unmount();
  setup(null, "LOCKED");
  expect(mocks.replace).toHaveBeenCalledWith("/repos");
});
