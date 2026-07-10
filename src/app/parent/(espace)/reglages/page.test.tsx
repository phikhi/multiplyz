import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { getParentControlsConfig, type ParentControlsConfig } from "@/config/server-config";
import { readHouseholdSettings, type HouseholdSettings } from "@/lib/parent/settings";
import type { SettingsFormProps } from "./SettingsForm";
import ParentSettingsPage from "./page";

// Page serveur = pont mince : lit les réglages (DB) + calcule les options de minutes (bornes ⚙️ +
// valeur courante) et passe le tout au composant client (testé isolément). On stubbe getDb + la
// config + la lecture ; `minuteOptions` (pure) reste RÉELLE pour prouver le CÂBLAGE des options.
const FAKE_DB = { __fakeDb: true };
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => FAKE_DB) }));
vi.mock("@/config/server-config", () => ({ getParentControlsConfig: vi.fn() }));
vi.mock("@/lib/parent/settings", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/parent/settings")>();
  return { ...actual, readHouseholdSettings: vi.fn() };
});
vi.mock("./SettingsForm", () => ({
  SettingsForm: (props: SettingsFormProps) => (
    <div
      data-testid="form"
      data-theme={props.settings.theme}
      data-nudge={props.nudgeOptions.join(",")}
      data-hardlock={props.hardLockOptions.join(",")}
    />
  ),
}));

const readMock = vi.mocked(readHouseholdSettings);
const controlsMock = vi.mocked(getParentControlsConfig);

const CONTROLS: ParentControlsConfig = {
  screenTimeNudgeDefaultMinutes: 20,
  screenTimeNudgeMinMinutes: 5,
  screenTimeNudgeMaxMinutes: 60,
  screenTimeHardLockDefaultMinutes: 45,
  screenTimeHardLockMinMinutes: 10,
  screenTimeHardLockMaxMinutes: 240,
};

describe("ParentSettingsPage (story 7.3)", () => {
  it("lit les réglages (getDb) + calcule les options aux bornes ⚙️ et les transmet au formulaire", () => {
    const settings: HouseholdSettings = {
      theme: "dark",
      parentWorldValidation: true,
      screenTimeNudgeMinutes: 30,
      screenTimeHardLockEnabled: true,
      screenTimeHardLockMinutes: 75, // hors préset → doit rester sélectionnable (inséré + trié)
    };
    readMock.mockReturnValue(settings);
    controlsMock.mockReturnValue(CONTROLS);

    render(<ParentSettingsPage />);

    expect(getDb).toHaveBeenCalledOnce();
    expect(readMock).toHaveBeenCalledWith(FAKE_DB);
    const form = screen.getByTestId("form");
    expect(form).toHaveAttribute("data-theme", "dark");
    // Options nudge = présets dans 5..60 (la valeur 30 est déjà un préset).
    expect(form).toHaveAttribute("data-nudge", "15,20,30,45,60");
    // Options verrou dur = présets dans 10..240 + la valeur courante 75 insérée et triée.
    expect(form).toHaveAttribute("data-hardlock", "30,45,60,75,90,120");
  });
});
