import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CollectionPage from "./page";

// CollectionScreen (orchestrateur complet, appelle une server action) est testé isolément
// → on le stubbe ici, cette route ne fait que le monter.
vi.mock("@/components/game/CollectionScreen", () => ({
  CollectionScreen: () => <div data-testid="collection-screen-stub" />,
}));

describe("CollectionPage — route /collection (garde par le layout du groupe (app))", () => {
  it("monte CollectionScreen (écran collection, story 5.6)", () => {
    render(<CollectionPage />);
    expect(screen.getByTestId("collection-screen-stub")).toBeInTheDocument();
  });
});
