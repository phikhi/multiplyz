import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Home from "./page";
import { BRAND_NAME } from "@/config/brand";
import { strings } from "@/strings";

describe("Home", () => {
  it("affiche le nom de marque centralisé", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: BRAND_NAME })).toBeInTheDocument();
  });

  it("affiche le texte de démarrage depuis le module strings (zéro texte en dur)", () => {
    render(<Home />);
    expect(screen.getByText(strings.app.booting)).toBeInTheDocument();
  });
});
