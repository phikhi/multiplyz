import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND_SETTINGS, pickSoundSettings } from "./settings";

describe("pickSoundSettings", () => {
  it("projette les 3 champs son depuis un objet plus large (ex. HouseholdSettings)", () => {
    const wide = {
      soundEnabled: false,
      musicEnabled: true,
      volume: 42,
      theme: "dark" as const,
      screenTimeNudgeMinutes: 20,
    };
    expect(pickSoundSettings(wide)).toEqual({
      soundEnabled: false,
      musicEnabled: true,
      volume: 42,
    });
  });

  it("n'inclut AUCUN autre champ dans la sortie (surface minimale)", () => {
    const wide = { soundEnabled: true, musicEnabled: true, volume: 70, secretParentField: "x" };
    expect(Object.keys(pickSoundSettings(wide))).toEqual([
      "soundEnabled",
      "musicEnabled",
      "volume",
    ]);
  });
});

describe("DEFAULT_SOUND_SETTINGS", () => {
  it("miroir des défauts serveur (CONFIG_DEFAULTS.sound) : activé/activé/70", () => {
    expect(DEFAULT_SOUND_SETTINGS).toEqual({ soundEnabled: true, musicEnabled: true, volume: 70 });
  });
});
