import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BoutiquePage from "./page";

// BoutiqueScreen (orchestrateur complet, appelle les server actions) est testé isolément
// → on le stubbe ici, cette route ne fait que le monter.
vi.mock("@/components/game/BoutiqueScreen", () => ({
  BoutiqueScreen: () => <div data-testid="boutique-screen-stub" />,
}));

describe("BoutiquePage — route /boutique (garde par le layout du groupe (app))", () => {
  it("monte BoutiqueScreen (écran boutique / œufs, story R4.2 #393)", () => {
    render(<BoutiquePage />);
    expect(screen.getByTestId("boutique-screen-stub")).toBeInTheDocument();
  });
});
