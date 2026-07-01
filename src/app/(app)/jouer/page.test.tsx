import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PlayPage from "./page";
import { strings } from "@/strings";

// LogoutButton est testé isolément (dépend du router) → on le stubbe ici.
vi.mock("@/components/LogoutButton", () => ({
  LogoutButton: () => <button type="button">{strings.play.logout}</button>,
}));

describe("PlayPage — placeholder protégé", () => {
  it("affiche l'accueil (voix Teddy) et la déconnexion", () => {
    render(<PlayPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: strings.play.greeting }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.play.logout })).toBeInTheDocument();
  });
});
