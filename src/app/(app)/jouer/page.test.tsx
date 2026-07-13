import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { readHouseholdSettings, type HouseholdSettings } from "@/lib/parent/settings";
import type { SoundSettings } from "@/lib/sound/settings";
import PlayPage from "./page";

// PlayScreen (orchestrateur complet, appelle des server actions) est testé isolément
// → on le stubbe ici, cette route ne fait que le monter + lui projeter les réglages son
// (story 8.4, #257). `getDb`/`readHouseholdSettings` mockés (patron `reglages/page.test.tsx`),
// `pickSoundSettings` reste RÉEL (importé transitivement par `page.tsx`) pour prouver le CÂBLAGE
// serveur→client, pas seulement l'appel de la fonction.
const FAKE_DB = { __fakeDb: true };
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => FAKE_DB) }));
vi.mock("@/lib/parent/settings", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/parent/settings")>();
  return { ...actual, readHouseholdSettings: vi.fn() };
});
vi.mock("@/components/game/PlayScreen", () => ({
  PlayScreen: (props: { sound?: SoundSettings }) => (
    <div data-testid="play-screen-stub" data-sound={JSON.stringify(props.sound)} />
  ),
}));

const readMock = vi.mocked(readHouseholdSettings);
const getDbMock = vi.mocked(getDb);

const SETTINGS: HouseholdSettings = {
  theme: "system",
  parentWorldValidation: false,
  screenTimeNudgeMinutes: 20,
  screenTimeHardLockEnabled: false,
  screenTimeHardLockMinutes: 45,
  soundEnabled: false,
  musicEnabled: true,
  volume: 33,
};

describe("PlayPage — route /jouer (garde par le layout du groupe (app))", () => {
  it("monte PlayScreen (écran de jeu nu, #64)", () => {
    readMock.mockReturnValue(SETTINGS);
    render(<PlayPage />);
    expect(screen.getByTestId("play-screen-stub")).toBeInTheDocument();
  });

  it("lit les réglages via getDb() (source de vérité serveur, story 8.3)", () => {
    readMock.mockReturnValue(SETTINGS);
    render(<PlayPage />);
    expect(getDbMock).toHaveBeenCalledTimes(1);
    expect(readMock).toHaveBeenCalledWith(FAKE_DB);
  });

  it("projette UNIQUEMENT les 3 champs son vers PlayScreen (pas le thème/temps d'écran) — câblage story 8.4 #257", () => {
    readMock.mockReturnValue(SETTINGS);
    render(<PlayPage />);
    const sound = JSON.parse(
      screen.getByTestId("play-screen-stub").getAttribute("data-sound") ?? "null",
    );
    expect(sound).toEqual({ soundEnabled: false, musicEnabled: true, volume: 33 });
  });
});
