import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import ParentRecoveryPage from "./page";
import { householdExists } from "@/lib/auth/household";

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/auth/household", () => ({ householdExists: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./ParentRecoveryFlow", () => ({
  ParentRecoveryFlow: () => <div data-testid="recovery-flow" />,
}));

const householdExistsMock = vi.mocked(householdExists);
const redirectMock = vi.mocked(redirect);

afterEach(() => {
  vi.clearAllMocks();
});

describe("ParentRecoveryPage — gating foyer", () => {
  it("foyer configuré → affiche le flow (pas de redirection)", () => {
    householdExistsMock.mockReturnValue(true);
    render(<ParentRecoveryPage />);
    expect(screen.getByTestId("recovery-flow")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("aucun foyer → redirige vers l'accueil (rien à récupérer)", () => {
    householdExistsMock.mockReturnValue(false);
    render(<ParentRecoveryPage />);
    expect(redirectMock).toHaveBeenCalledWith("/");
  });
});
