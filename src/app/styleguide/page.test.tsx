import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Home from "./page";
import { BRAND_NAME } from "@/config/brand";

// Note : ThemeToggle ('use client') utilise useEffect — pas de DOM side-effect testé ici.
// La couverture E2E (Playwright) valide la bascule light/dark.
describe("DesignTokensPage", () => {
  it("affiche le titre de l'application", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: BRAND_NAME })).toBeInTheDocument();
  });

  it("affiche les sections de tokens", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 2, name: "Couleurs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Espacements" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Typographie" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Rayons" })).toBeInTheDocument();
  });
});
