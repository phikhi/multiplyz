import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MapPage from "./page";

// MapScreen (orchestrateur complet, appelle une server action) est testé isolément
// → on le stubbe ici, cette route ne fait que le monter.
vi.mock("@/components/game/MapScreen", () => ({
  MapScreen: () => <div data-testid="map-screen-stub" />,
}));

describe("MapPage — route /carte (garde par le layout du groupe (app))", () => {
  it("monte MapScreen (écran carte, #125)", () => {
    render(<MapPage />);
    expect(screen.getByTestId("map-screen-stub")).toBeInTheDocument();
  });
});
