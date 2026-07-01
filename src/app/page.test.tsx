import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";
import { householdExists } from "@/lib/auth/household";
import { listProfiles } from "@/lib/auth/login";

// La page ne fait que router selon l'état du foyer : on stubbe la DB, la garde
// métier, la requête de liste et les écrans (testés isolément) pour vérifier le
// gating + le passage des profils servis par le serveur.
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/auth/household", () => ({ householdExists: vi.fn() }));
vi.mock("@/lib/auth/login", () => ({ listProfiles: vi.fn() }));
vi.mock("./onboarding/OnboardingFlow", () => ({
  OnboardingFlow: () => <div data-testid="onboarding-flow" />,
}));
vi.mock("@/components/ProfileSelector", () => ({
  ProfileSelector: ({ profiles }: { profiles: { id: number }[] }) => (
    <div data-testid="profile-selector" data-count={profiles.length} />
  ),
}));

const householdExistsMock = vi.mocked(householdExists);
const listProfilesMock = vi.mocked(listProfiles);

afterEach(() => {
  householdExistsMock.mockReset();
  listProfilesMock.mockReset();
});

describe("HomePage — gating 1er usage", () => {
  it("aucun foyer → affiche l'onboarding", () => {
    householdExistsMock.mockReturnValue(false);
    render(<HomePage />);
    expect(screen.getByTestId("onboarding-flow")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-selector")).not.toBeInTheDocument();
  });

  it("foyer configuré → sélecteur de profil (liste servie par le serveur)", () => {
    householdExistsMock.mockReturnValue(true);
    listProfilesMock.mockReturnValue([
      { id: 1, name: "Léa", avatar: "fox" },
      { id: 2, name: "Tom", avatar: "rabbit" },
    ]);
    render(<HomePage />);
    const selector = screen.getByTestId("profile-selector");
    expect(selector).toBeInTheDocument();
    expect(selector).toHaveAttribute("data-count", "2");
    expect(screen.queryByTestId("onboarding-flow")).not.toBeInTheDocument();
  });
});
