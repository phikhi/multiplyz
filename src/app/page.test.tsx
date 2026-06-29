import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("affiche le titre de l'application", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1, name: "multiplyz" })).toBeInTheDocument();
  });
});
