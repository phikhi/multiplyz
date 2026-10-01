import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AdventureScreen } from "./AdventureScreen";
import { ForestMap } from "./ForestMap";
import { useAdventure } from "@/lib/game/use-adventure";
import { initGameState } from "@/lib/game/session";
import { buildMap } from "@/lib/game/map";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { CURATED_THEMES } from "@/config/worldgen-themes";
import { worldSceneKind, worldScenes } from "@/strings/world-scenes";
import type { Adventure } from "@/lib/game/adventure-types";
const scene = vi.hoisted(() => vi.fn());
vi.mock("./ForestScene", () => ({
  ForestScene: (props: unknown) => {
    scene(props);
    return null;
  },
}));
vi.mock("@/lib/game/use-adventure", () => ({ useAdventure: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/sound/SoundProvider", () => ({
  SoundProvider: ({ children }: { children: ReactNode }) => children,
  useSound: () => ({ playSfx: vi.fn() }),
}));
vi.mock("@/lib/sound/use-prefers-reduced-motion", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/app/(app)/jouer/actions", () => ({ setChildSoundEnabledAction: vi.fn() }));
const dispatch = vi.fn();
const base: Adventure = {
  id: "persisted",
  worldIndex: 11,
  levelIndex: 0,
  revision: 8,
  phase: "arrival",
  result: null,
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
};
const theme = (slug: string) => ({
  slug,
  label: slug,
  accent: "#abcdef",
  background: null,
  tiles: null,
  teddy: null,
});
function state(a: Adventure) {
  vi.mocked(useAdventure).mockReturnValue({
    adventure: a,
    error: null,
    sending: false,
    storageWarning: false,
    dispatch,
    retry: vi.fn(),
    refresh: vi.fn(),
  });
}
function play() {
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
it.each(CURATED_THEMES)(
  "$slug drives both scene and story; buttons keep the same commands",
  (t) => {
    const a = { ...base, worldTheme: theme(t.slug) };
    state(a);
    play();
    const copy = worldScenes[worldSceneKind(t.slug, base.worldIndex)];
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    expect(screen.getByText(copy.invitation)).toBeInTheDocument();
    expect(scene).toHaveBeenLastCalledWith(
      expect.objectContaining({
        theme: a.worldTheme,
        worldIndex: 11,
        completed: 0,
        total: 1,
        reduced: true,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Allons-y" }));
    expect(dispatch).toHaveBeenCalledWith("begin");
  },
);
it("an accompanied answer advances the same visual progress, with no forest character in the ocean", () => {
  state({ ...base, phase: "feedback", worldTheme: theme("ocean") });
  play();
  expect(scene).toHaveBeenLastCalledWith(
    expect.objectContaining({ completed: 1, total: 1, showFriend: false }),
  );
});
it("unknown future themes use neutral story and safe scene rather than forest names", () => {
  state({ ...base, worldTheme: theme("new-theme") });
  play();
  expect(screen.getByRole("heading", { name: worldScenes.wonder.title })).toBeInTheDocument();
  expect(worldSceneKind("__proto__")).toBe("wonder");
});
it("changing world themes on the map never changes the visible node geometry or count", () => {
  const map = buildMap(
    0,
    { progress: { starsByLevel: new Map() }, debt: 0 },
    { ...CONFIG_DEFAULTS.map, revisionDebtThreshold: 12 },
  );
  const view = render(<ForestMap map={{ ...map, theme: theme("forest") }} adventure={null} />);
  const positions = () =>
    Array.from(view.container.querySelectorAll(".forest-map-nodes li")).map((e) =>
      e.getAttribute("style"),
    );
  const before = positions();
  view.rerender(<ForestMap map={{ ...map, theme: theme("galaxy") }} adventure={null} />);
  expect(positions()).toEqual(before);
  expect(before).toHaveLength(11);
  expect(screen.getByRole("heading", { name: "galaxy" })).toBeInTheDocument();
  expect(screen.getByText(worldScenes.galaxy.mapIntro)).toBeInTheDocument();
  expect(scene).toHaveBeenLastCalledWith(expect.objectContaining({ theme: theme("galaxy") }));
});
it("the current map and a still-pending prior passage each retain their own theme", () => {
  const map = buildMap(
    2,
    { progress: { starsByLevel: new Map() }, debt: 0 },
    { ...CONFIG_DEFAULTS.map, revisionDebtThreshold: 12 },
  );
  render(
    <ForestMap
      map={{ ...map, theme: theme("snow") }}
      adventure={{ ...base, phase: "results", worldTheme: theme("magic") }}
    />,
  );
  expect(screen.getByRole("heading", { name: worldScenes.magic.title })).toBeInTheDocument();
  expect(scene).toHaveBeenLastCalledWith(
    expect.objectContaining({ theme: theme("snow"), worldIndex: 2 }),
  );
});

it("a later stored forest becomes an open grove while the first forest stays canonical", () => {
  expect(worldSceneKind("forest", 0)).toBe("forest");
  expect(worldSceneKind("forest", 4)).toBe("grove");
  state({ ...base, worldIndex: 4, worldTheme: theme("forest") });
  play();
  expect(screen.getByRole("heading", { name: worldScenes.grove.title })).toBeInTheDocument();
});
