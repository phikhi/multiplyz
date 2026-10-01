import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { computeParentOverview } from "@/lib/parent/overview";
import {
  computeAccuracyStats,
  computeSpeedStats,
  computeMasteryMap,
  type AttemptRecord,
} from "@/lib/parent/stats";
import { computeRegularityStats } from "@/lib/parent/regularity";
import { parent as p } from "@/strings/parent";
import { strings } from "@/strings";
import { ParentDashboard } from "./ParentDashboard";
import { SettingsForm } from "./reglages/SettingsForm";
import { resolveSettingsDefaults } from "@/lib/parent/settings";
import { saveSettingsAction, requestRecalibrationAction } from "./reglages/actions";
import { WorldApprovalManager } from "./mondes/WorldApprovalManager";
import { approveWorldAction } from "./mondes/actions";
import { buildWorldTheme } from "@/lib/game/world-theme";
import { deriveWorldPalette, serializePalette } from "@/lib/worldgen/palette";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./reglages/actions", () => ({
  saveSettingsAction: vi.fn(),
  requestRecalibrationAction: vi.fn(),
}));
vi.mock("./mondes/actions", () => ({ approveWorldAction: vi.fn(), rejectWorldAction: vi.fn() }));
const now = Date.UTC(2026, 8, 11, 12),
  config = CONFIG_DEFAULTS;
function dashboard(records: AttemptRecord[]) {
  const stats = {
    accuracy: computeAccuracyStats(records, config, now),
    speed: computeSpeedStats(records, config, now),
    masteryMap: computeMasteryMap([], config),
    reviewList: [],
    regularity: computeRegularityStats(records, config.regularity, now),
    accuracyDaily: [],
  };
  return render(
    <ParentDashboard
      displayName="Nova"
      profileId={1}
      profiles={[{ id: 1, name: "Nova" }]}
      stats={stats}
      overview={computeParentOverview(records, [], config, now, "recent")}
      progression={null}
      respectWindowMinMinutes={15}
      respectWindowMaxMinutes={20}
      pendingWorldsCount={0}
      sparklineWindowDays={7}
    />,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
});
describe("TEDDy parent notebook", () => {
  it("does not render absence as zero accuracy or stable progress", () => {
    dashboard([]);
    expect(screen.getAllByText(p.noAnswers).length).toBeGreaterThan(0);
    expect(screen.getByText(p.noComparison)).toBeInTheDocument();
    expect(screen.queryByText(p.stable)).not.toBeInTheDocument();
    expect(screen.queryByText("0 %")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        p.timeHint(config.regularity.maxDayAmplitudeMinutes, config.regularity.dayTimeZone),
      ),
    ).toBeInTheDocument();
  });
  it("renders a genuine zero and its denominator with sample caution", () => {
    dashboard([{ skill: "add", correct: false, responseMs: 2300, isRetry: false, createdAt: now }]);
    expect(screen.getAllByText("0 %").length).toBeGreaterThan(0);
    expect(screen.getAllByText(p.answers(0, 1)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(p.small).length).toBeGreaterThan(0);
    expect(screen.getByText(p.zeroMinutes)).toBeInTheDocument();
  });
  it("keeps the last confirmed setting after a rejected save then persists a retry", async () => {
    vi.mocked(saveSettingsAction)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true });
    render(
      <SettingsForm
        settings={resolveSettingsDefaults()}
        profileId={2}
        displayName="Lune"
        profiles={[{ id: 2, name: "Lune" }]}
        nudgeOptions={[15, 20]}
        hardLockOptions={[45]}
        volumeOptions={[50, 70]}
      />,
    );
    const select = screen.getByLabelText(strings.parent.settings.screenTime.nudgeLabel);
    fireEvent.change(select, { target: { value: "15" } });
    await screen.findByText(p.saveFailure);
    expect(select).toHaveValue("20");
    fireEvent.change(select, { target: { value: "15" } });
    await waitFor(() => expect(select).toHaveValue("15"));
    expect(saveSettingsAction).toHaveBeenLastCalledWith({ screenTimeNudgeMinutes: 15 });
    vi.mocked(requestRecalibrationAction).mockResolvedValue({ ok: true });
    fireEvent.click(
      screen.getByRole("button", { name: strings.parent.settings.recalibrate.action }),
    );
    expect(requestRecalibrationAction).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: strings.parent.settings.recalibrate.confirm }),
    );
    await screen.findByText(p.recalibrateDone);
    expect(requestRecalibrationAction).toHaveBeenCalledWith(2);
  });
  it("shows actual world references and creature stories, with confirmation before approval", async () => {
    vi.mocked(approveWorldAction).mockResolvedValue({ ok: true });
    const theme = buildWorldTheme({
      theme: "Jardin suspendu",
      palette: serializePalette(deriveWorldPalette("foret", "#4CAF50")),
      assetRefs: JSON.stringify({ background: "world/9/background.png" }),
    });
    render(
      <WorldApprovalManager
        pending={[
          {
            id: "world:9",
            index: 9,
            theme,
            creatures: [
              {
                id: "friend",
                name: "Lumo",
                artRef: "world/9/lumo.png",
                story: "Vit dans les racines.",
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByAltText(p.background)).toHaveAttribute(
      "src",
      "/generated/world/9/background.png",
    );
    expect(screen.getByAltText(`Lumo · ${p.creatureStages[0]}`)).toHaveAttribute(
      "src",
      "/generated/world/9/lumo.png",
    );
    expect(screen.getByText("Vit dans les racines.")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: strings.parent.worldApproval.approve.action }),
    );
    expect(approveWorldAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: p.approveConfirm }));
    await waitFor(() => expect(approveWorldAction).toHaveBeenCalledWith("world:9"));
  });
});
