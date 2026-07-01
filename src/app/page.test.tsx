import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";
import { householdExists } from "@/lib/auth/household";
import { strings } from "@/strings";

// La page ne fait que router selon l'état du foyer : on stubbe la DB, la garde
// métier et le flow (testé isolément) pour vérifier le gating.
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/auth/household", () => ({ householdExists: vi.fn() }));
vi.mock("./onboarding/OnboardingFlow", () => ({
  OnboardingFlow: () => <div data-testid="onboarding-flow" />,
}));

const householdExistsMock = vi.mocked(householdExists);

afterEach(() => {
  householdExistsMock.mockReset();
});

describe("HomePage — gating 1er usage", () => {
  it("aucun foyer → affiche l'onboarding", () => {
    householdExistsMock.mockReturnValue(false);
    render(<HomePage />);
    expect(screen.getByTestId("onboarding-flow")).toBeInTheDocument();
  });

  it("foyer configuré → placeholder (sélection de profil #2.3 à venir)", () => {
    householdExistsMock.mockReturnValue(true);
    render(<HomePage />);
    // Titre de niveau 1 présent dans les 2 états (onboarding OU placeholder) —
    // contrat attendu par les E2E cold-start (pwa.spec).
    expect(screen.getByRole("heading", { level: 1, name: strings.home.ready })).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-flow")).not.toBeInTheDocument();
  });
});
