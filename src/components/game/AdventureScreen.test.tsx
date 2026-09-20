import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AdventureScreen } from "./AdventureScreen";
import { useAdventure } from "@/lib/game/use-adventure";
import { initGameState } from "@/lib/game/session";
import type { Adventure } from "@/lib/game/adventure-types";
import { companions } from "@/strings/companions";
import { forest } from "@/strings/forest";
import type { ForestState } from "./ForestScene";
const scene = vi.hoisted(() => vi.fn());
const sound = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/game/use-adventure", () => ({ useAdventure: vi.fn() }));
vi.mock("./ForestScene", () => ({
  ForestScene: (props: ForestState) => {
    scene(props);
    return null;
  },
}));
vi.mock("@/lib/sound/SoundProvider", () => ({
  SoundProvider: ({ children }: { children: ReactNode }) => children,
  useSound: () => ({ playSfx: sound }),
}));
vi.mock("@/lib/sound/use-prefers-reduced-motion", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/app/(app)/jouer/actions", () => ({ setChildSoundEnabledAction: vi.fn(async () => {}) }));
const dispatch = vi.fn();
const state: Adventure = {
  id: "run",
  revision: 9,
  worldIndex: 0,
  levelIndex: 10,
  phase: "results",
  game: initGameState(
    [
      {
        factKey: "comp10_3",
        skill: "comp10",
        operands: [3],
        format: "qcm",
        choices: [7, 6, 5, 3],
        isReask: false,
      },
    ],
    0,
    () => "q",
  ),
  result: {
    ok: true,
    stars: 0,
    unlockedNextWorld: true,
    coinsApplied: true,
    legendaryAdded: true,
    balance: { coins: 60, shards: 0 },
    reward: { base: 10, starBonus: 0, treasureBonus: 0, bossBonus: 50, total: 60 },
    legendary: {
      characterId: "legendary:0",
      name: "Braisille",
      story: "La gardienne.",
      artRef: "socle/creature/legendary_world_0.png",
    },
  },
};
function setup(adventure: Adventure, sending = false) {
  vi.mocked(useAdventure).mockReturnValue({
    adventure,
    error: null,
    sending,
    storageWarning: false,
    dispatch,
    retry: vi.fn(),
    refresh: vi.fn(),
  });
  return render(
    <AdventureScreen
      profileId={7}
      sound={{ soundEnabled: false, musicEnabled: false, volume: 20 }}
      guardianLevelIndex={10}
    />,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("legendary encounter", () => {
  it("uses the server's guardian position for its arrival", () => {
    setup({ ...state, phase: "arrival", result: null });
    expect(screen.getByRole("heading", { name: forest.guardian })).toBeInTheDocument();
    expect(screen.getByText(forest.guardianIntro)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: forest.begin }));
    expect(dispatch).toHaveBeenCalledWith("begin");
  });
  it("ordinary arrival keeps the approved passage", () => {
    setup({ ...state, phase: "arrival", levelIndex: 0, result: null });
    expect(screen.getByRole("heading", { name: forest.title })).toBeInTheDocument();
    expect(screen.getByText(forest.invitation)).toBeInTheDocument();
  });
  it.each([true, false])("shows the actual granted identity; added=%s", (legendaryAdded) => {
    setup({ ...state, phase: "finale", result: { ...state.result!, legendaryAdded } });
    expect(screen.getByRole("heading", { name: "Braisille" })).toHaveFocus();
    expect(screen.getByRole("img", { name: "Braisille" })).toHaveAttribute(
      "src",
      "/generated/socle/creature/legendary_world_0.png",
    );
    expect(
      screen.getByText(legendaryAdded ? companions.added : companions.reunited),
    ).toBeInTheDocument();
    expect(scene).toHaveBeenLastCalledWith(expect.objectContaining({ showFriend: false }));
    fireEvent.click(screen.getByRole("button", { name: forest.results }));
    expect(dispatch).toHaveBeenCalledWith("results");
  });
  it("ordinary finale retains Lumo and creates no collection link", () => {
    setup({
      ...state,
      phase: "finale",
      levelIndex: 0,
      result: {
        ...state.result!,
        legendary: null,
        legendaryAdded: false,
        unlockedNextWorld: false,
      },
    });
    expect(screen.getByRole("heading", { name: forest.welcome })).toBeInTheDocument();
    expect(screen.getByText(forest.encounter)).toBeInTheDocument();
    expect(scene).toHaveBeenLastCalledWith(expect.objectContaining({ showFriend: true }));
    expect(screen.queryByText(companions.visit)).toBeNull();
  });
  it("the companion button acknowledges the receipt through the reliable command queue", () => {
    setup(state);
    expect(screen.getByText(companions.nextWorld)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: companions.visit }));
    expect(dispatch).toHaveBeenCalledWith("close", { destination: "companion" });
  });
  it("cannot leave through the companion button while saving", () => {
    setup(state, true);
    expect(screen.getByRole("button", { name: companions.visit })).toBeDisabled();
  });
  it("the other result action continues to return to the map", () => {
    setup(state);
    fireEvent.click(screen.getByRole("button", { name: forest.returnMap }));
    expect(dispatch).toHaveBeenCalledWith("close");
  });
});

it("shows an already-applied receipt without claiming the reward again", () => {
  setup({ ...state, result: { ...state.result!, coinsApplied: false } });
  expect(screen.getByText(forest.alreadyEarned)).toBeInTheDocument();
  expect(screen.queryByText("+60")).not.toBeInTheDocument();
  expect(screen.getByText("60")).toBeInTheDocument();
});
