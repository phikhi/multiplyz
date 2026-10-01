import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RestPage from "./(app)/repos/page";
import ReturnPage from "./(app)/reprendre/page";
import ParentLoginPage from "./parent/connexion/page";
import ParentAccessPage from "./parent/(espace)/acces/page";
import EvolutionPage from "./(app)/collection/[id]/grandir/page";
import ShardShopPage from "./(app)/boutique/eclats/page";
import WorldScenesPage from "./atelier/mondes/page";
import { daily } from "@/strings/daily";
import { parent as p } from "@/strings/parent";
const m = vi.hoisted(() => ({
  profile: vi.fn(),
  rest: vi.fn(),
  path: vi.fn(),
  household: vi.fn(),
  session: vi.fn(),
  profiles: vi.fn(),
  evolution: vi.fn(),
  selector: vi.fn(),
  screen: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: m.profile }));
vi.mock("@/lib/game/daily-return", () => ({ dailyRestState: m.rest, dailyReturnPath: m.path }));
vi.mock("@/lib/auth/household", () => ({ householdExists: m.household }));
vi.mock("@/lib/auth/current-session", () => ({ getCurrentParentSession: m.session }));
vi.mock("@/lib/auth/login", () => ({ listProfiles: m.profiles }));
vi.mock("@/components/ForestHome", () => ({
  ForestHome: ({ children, quiet }: { children: ReactNode; quiet?: boolean }) => (
    <div data-testid="home" data-quiet={quiet}>
      {children}
    </div>
  ),
}));
vi.mock("@/components/ProfileSelector", () => ({
  ProfileSelector: (props: unknown) => {
    m.selector(props);
    return <div>selector</div>;
  },
}));
vi.mock("./(app)/collection/evolution-actions", () => ({ evolutionStateAction: m.evolution }));
vi.mock("@/components/game/EvolutionScreen", () => ({
  EvolutionScreen: (props: unknown) => {
    m.screen(props);
    return <div>evolution</div>;
  },
}));
vi.mock("@/components/game/ShardShopScreen", () => ({ ShardShopScreen: () => <div>shards</div> }));
vi.mock("@/components/game/WorldScenesPreview", () => ({
  WorldScenesPreview: () => <div>preview</div>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  m.profile.mockResolvedValue(7);
  m.household.mockReturnValue(true);
  m.session.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
it.each([RestPage, ReturnPage])(
  "redirects anonymous children before reading progression",
  async (page) => {
    m.profile.mockResolvedValue(null);
    await expect(page()).rejects.toThrow("redirect:/");
    expect(m.rest).not.toHaveBeenCalled();
    expect(m.path).not.toHaveBeenCalled();
  },
);
it.each([
  ["limit", false, daily.limitTitle, daily.limitHint],
  ["suggested", false, daily.suggestedTitle, daily.suggestedHint],
  ["manual", false, daily.restTitle, daily.restHint],
  ["manual", true, daily.restTitle, daily.restHint],
])(
  "renders rest reason %s, active=%s with the appropriate return path",
  async (reason, active, title, hint) => {
    m.rest.mockReturnValue({ reason, active });
    render(await RestPage());
    expect(screen.getByRole("heading", { name: String(title) })).toBeInTheDocument();
    expect(screen.getByText(String(hint))).toBeInTheDocument();
    expect(screen.getByTestId("home")).toHaveAttribute("data-quiet", "true");
    if (reason === "limit") {
      expect(screen.queryByRole("link", { name: daily.continue })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: daily.resume })).not.toBeInTheDocument();
    } else
      expect(
        screen.getByRole("link", { name: active ? daily.resume : daily.continue }),
      ).toHaveAttribute("href", active ? "/jouer" : "/carte");
  },
);
it("resolves the authenticated child's durable return destination on the server", async () => {
  m.path.mockReturnValue("/boutique");
  await expect(ReturnPage()).rejects.toThrow("redirect:/boutique");
  expect(m.path).toHaveBeenCalledWith({}, 7, expect.any(Object), expect.any(Number));
});
it("redirects parent login before listing profiles if onboarding is absent or session already exists", async () => {
  m.household.mockReturnValue(false);
  await expect(ParentLoginPage()).rejects.toThrow("redirect:/");
  expect(m.session).not.toHaveBeenCalled();
  m.household.mockReturnValue(true);
  m.session.mockResolvedValue({ kind: "parent" });
  await expect(ParentLoginPage()).rejects.toThrow("redirect:/parent");
  expect(m.profiles).not.toHaveBeenCalled();
});
it("opens the parent selector with the server's profiles", async () => {
  m.profiles.mockReturnValue([{ id: 7 }]);
  render(await ParentLoginPage());
  expect(m.selector).toHaveBeenCalledWith({ profiles: [{ id: 7 }], startParent: true });
});
it("links access settings to child profiles and parent recovery", () => {
  render(<ParentAccessPage />);
  expect(screen.getByRole("heading", { name: p.accessTitle })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: p.profiles })).toHaveAttribute("href", "/parent/profils");
  expect(screen.getByRole("link", { name: p.recover })).toHaveAttribute(
    "href",
    "/parent/recuperation",
  );
});
it("refuses invalid encoded creature IDs before requesting evolution state", async () => {
  await expect(EvolutionPage({ params: Promise.resolve({ id: "%zz" }) })).rejects.toThrow(
    "redirect:/collection",
  );
  expect(m.evolution).not.toHaveBeenCalled();
});
it("redirects missing evolution state, and passes authorized state with a decoded ID", async () => {
  m.evolution.mockResolvedValue(null);
  await expect(
    EvolutionPage({ params: Promise.resolve({ id: "creature%3A0%3A0" }) }),
  ).rejects.toThrow("redirect:/collection");
  const initial = { profileId: 7, coins: 20 };
  m.evolution.mockResolvedValue(initial);
  render(await EvolutionPage({ params: Promise.resolve({ id: "creature%3A0%3A0" }) }));
  expect(m.evolution).toHaveBeenLastCalledWith("creature:0:0");
  expect(m.screen).toHaveBeenLastCalledWith({ initial });
});
it("renders the shard shop entry", () => {
  render(<ShardShopPage />);
  expect(screen.getByText("shards")).toBeInTheDocument();
});
it.each([
  ["production", "", false],
  ["test", "worlds", true],
  ["development", "", true],
])("guards the art workbench in %s with build flag %s", (env, flag, allowed) => {
  vi.stubEnv("NODE_ENV", env);
  vi.stubEnv("TEDDY_CHECK_BUILD", flag);
  if (allowed) {
    render(WorldScenesPage());
    expect(screen.getByText("preview")).toBeInTheDocument();
  } else expect(() => WorldScenesPage()).toThrow("not-found");
});
