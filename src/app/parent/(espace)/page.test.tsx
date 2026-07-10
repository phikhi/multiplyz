import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { strings } from "@/strings";
import ParentDashboardPage from "./page";

// Le stub monte le bouton de sortie client (`ParentExitButton`) — on le stubbe (testé
// isolément) pour ne vérifier ICI que le bandeau + placeholder du stub de dashboard.
vi.mock("@/components/ParentExitButton", () => ({
  ParentExitButton: () => <button type="button" data-testid="exit" />,
}));

describe("ParentDashboardPage — stub de fondation (story 7.1)", () => {
  it("rend le bandeau « Espace parent » (titre h1) + le placeholder neutre + la sortie", () => {
    render(<ParentDashboardPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: strings.parent.dashboard.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(strings.parent.dashboard.placeholder)).toBeInTheDocument();
    expect(screen.getByTestId("exit")).toBeInTheDocument();
  });

  it("expose le lien « Gérer les profils » vers /parent/profils (story 7.5)", () => {
    render(<ParentDashboardPage />);
    const link = screen.getByRole("link", { name: strings.parent.dashboard.manageLink });
    expect(link).toHaveAttribute("href", "/parent/profils");
  });

  it("expose le lien « Réglages » vers /parent/reglages (story 7.3)", () => {
    render(<ParentDashboardPage />);
    const link = screen.getByRole("link", { name: strings.parent.dashboard.settingsLink });
    expect(link).toHaveAttribute("href", "/parent/reglages");
  });
});
