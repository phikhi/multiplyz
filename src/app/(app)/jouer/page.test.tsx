import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PlayPage from "./page";

// PlayScreen (orchestrateur complet, appelle des server actions) est testé isolément
// → on le stubbe ici, cette route ne fait que le monter.
vi.mock("@/components/game/PlayScreen", () => ({
  PlayScreen: () => <div data-testid="play-screen-stub" />,
}));

describe("PlayPage — route /jouer (garde par le layout du groupe (app))", () => {
  it("monte PlayScreen (écran de jeu nu, #64)", () => {
    render(<PlayPage />);
    expect(screen.getByTestId("play-screen-stub")).toBeInTheDocument();
  });
});
