import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { redirect } from "next/navigation";
import { getCurrentParentSession } from "@/lib/auth/current-session";
import { listManagedProfiles } from "@/lib/parent/profiles";
import { loadParentStats } from "@/lib/parent/stats-source";
import { loadProgressionSummary } from "@/lib/parent/progression";
import { countPendingWorlds } from "@/lib/parent/world-approval";
import { SocleUnavailableError } from "@/lib/worldgen/socle";
import type { ParentDashboardProps } from "./ParentDashboard";
import ParentDashboardPage from "./page";

// Page serveur = pont mince : lit la session (profileId) + compose les agrégats déjà établis
// (7.2/7.4/7.7) et les transmet au composant de présentation (testé isolément, `ParentDashboard.test.tsx`).
// On stubbe TOUTES les dépendances serveur pour ne prouver ICI que le CÂBLAGE (qui appelle quoi,
// avec quels arguments, et le repli `SocleUnavailableError`).
const FAKE_DB = { __fakeDb: true };
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => FAKE_DB) }));
vi.mock("@/config/server-config", () => ({
  getEngineConfig: vi.fn(() => ({ engine: true })),
  getMapConfig: vi.fn(() => ({ map: true })),
  getReportingConfig: vi.fn(() => ({ reporting: true })),
  getRegularityConfig: vi.fn(() => ({
    respectWindowMinMinutes: 15,
    respectWindowMaxMinutes: 20,
  })),
}));
vi.mock("@/lib/auth/current-session", () => ({ getCurrentParentSession: vi.fn() }));
vi.mock("@/lib/parent/profiles", () => ({ listManagedProfiles: vi.fn() }));
vi.mock("@/lib/parent/stats-source", () => ({ loadParentStats: vi.fn() }));
vi.mock("@/lib/parent/progression", () => ({ loadProgressionSummary: vi.fn() }));
vi.mock("@/lib/parent/world-approval", () => ({ countPendingWorlds: vi.fn() }));
vi.mock("./ParentDashboard", () => ({
  ParentDashboard: (props: ParentDashboardProps) => (
    <div
      data-testid="dashboard"
      data-name={props.displayName}
      data-progression={props.progression === null ? "null" : "set"}
      data-min={props.respectWindowMinMinutes}
      data-max={props.respectWindowMaxMinutes}
      data-pending={props.pendingWorldsCount}
    />
  ),
}));

const redirectMock = vi.mocked(redirect);
const sessionMock = vi.mocked(getCurrentParentSession);
const profilesMock = vi.mocked(listManagedProfiles);
const statsMock = vi.mocked(loadParentStats);
const progressionMock = vi.mocked(loadProgressionSummary);
const pendingWorldsMock = vi.mocked(countPendingWorlds);

const SESSION = { token: "tok", profileId: 7, kind: "parent" as const, expiresAt: new Date() };
const STATS = { fake: "stats" } as unknown as ReturnType<typeof loadParentStats>;
const PROGRESSION = { fake: "progression" } as unknown as ReturnType<typeof loadProgressionSummary>;

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue(SESSION);
  profilesMock.mockReturnValue([
    { id: 7, name: "Léa", avatar: "fox", isOwner: true },
    { id: 8, name: "Tom", avatar: "cat", isOwner: false },
  ]);
  statsMock.mockReturnValue(STATS);
  progressionMock.mockReturnValue(PROGRESSION);
  pendingWorldsMock.mockReturnValue(0);
});

describe("ParentDashboardPage — câblage serveur (story 7.7)", () => {
  it("sans session parent → redirige (défense en profondeur, même garde que le layout)", async () => {
    sessionMock.mockResolvedValue(null);
    await ParentDashboardPage();
    expect(redirectMock).toHaveBeenCalledWith("/");
    expect(statsMock).not.toHaveBeenCalled();
  });

  it("charge les stats + la progression pour LE PROFIL DE LA SESSION, jamais un autre", async () => {
    const ui = await ParentDashboardPage();
    render(ui);

    expect(statsMock).toHaveBeenCalledWith(
      FAKE_DB,
      7,
      { engine: { engine: true }, reporting: { reporting: true }, regularity: expect.any(Object) },
      expect.any(Number),
    );
    expect(progressionMock).toHaveBeenCalledWith(
      FAKE_DB,
      7,
      { map: true },
      { engine: true },
      expect.any(Object),
      expect.any(Number),
    );
  });

  it("résout le prénom affiché depuis `listManagedProfiles` (profil = celui de la session)", async () => {
    const ui = await ParentDashboardPage();
    render(ui);
    expect(screen.getByTestId("dashboard")).toHaveAttribute("data-name", "Léa");
  });

  it("garde de forme : profil de session absent de `listManagedProfiles` → repli chaîne vide (jamais un plantage)", async () => {
    profilesMock.mockReturnValue([{ id: 8, name: "Tom", avatar: "cat", isOwner: false }]);
    const ui = await ParentDashboardPage();
    render(ui);
    expect(screen.getByTestId("dashboard")).toHaveAttribute("data-name", "");
  });

  it("transmet les bornes ⚙️ de la fenêtre saine au composant de présentation", async () => {
    const ui = await ParentDashboardPage();
    render(ui);
    const el = screen.getByTestId("dashboard");
    expect(el).toHaveAttribute("data-min", "15");
    expect(el).toHaveAttribute("data-max", "20");
  });

  it("progression indisponible (`SocleUnavailableError`) → repli `progression: null`, le reste du tableau de bord tient", async () => {
    progressionMock.mockImplementation(() => {
      throw new SocleUnavailableError("socle non amorcé (fixture de test)");
    });
    const ui = await ParentDashboardPage();
    render(ui);
    expect(screen.getByTestId("dashboard")).toHaveAttribute("data-progression", "null");
    // Les stats (indépendantes de la progression) ont quand même été chargées.
    expect(statsMock).toHaveBeenCalled();
  });

  it("transmet le compte de mondes en attente (foyer, story 7.9) au composant de présentation", async () => {
    pendingWorldsMock.mockReturnValue(3);
    const ui = await ParentDashboardPage();
    render(ui);
    expect(pendingWorldsMock).toHaveBeenCalledWith(FAKE_DB);
    expect(screen.getByTestId("dashboard")).toHaveAttribute("data-pending", "3");
  });

  it("propage toute AUTRE erreur (invariant serveur) — ne masque que `SocleUnavailableError`", async () => {
    progressionMock.mockImplementation(() => {
      throw new Error("invariant cassé");
    });
    await expect(ParentDashboardPage()).rejects.toThrow("invariant cassé");
  });
});
