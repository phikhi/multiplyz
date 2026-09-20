import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MapPage from "./page";
const mocks = vi.hoisted(() => ({ current: vi.fn(), adventure: vi.fn(), profile: vi.fn() }));
vi.mock("./actions", () => ({ currentMapAction: mocks.current }));
vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: mocks.profile }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/game/adventure", () => ({ loadAdventure: mocks.adventure }));
vi.mock("@/lib/game/adventure-world", () => ({
  presentAdventureWorld: (_db: unknown, adventure: unknown) => adventure,
}));
vi.mock("@/components/game/MapScreen", () => ({ MapScreen: () => <div data-testid="fallback" /> }));
vi.mock("@/components/game/ForestMap", () => ({
  ForestMap: (props: unknown) => (
    <div data-testid="forest-map" data-props={JSON.stringify(props)} />
  ),
}));
beforeEach(() => {
  mocks.profile.mockResolvedValue(7);
  mocks.adventure.mockReturnValue({ id: "active" });
});
describe("MapPage", () => {
  it("passes the server map and the child's durable checkpoint to the forest", async () => {
    mocks.current.mockResolvedValue({ status: "ready", map: { worldIndex: 3 } });
    render(await MapPage());
    expect(JSON.parse(screen.getByTestId("forest-map").getAttribute("data-props")!)).toEqual({
      map: { worldIndex: 3 },
      adventure: { id: "active" },
    });
    expect(mocks.adventure).toHaveBeenCalledWith({}, 7);
  });
  it("keeps the retry UI if the world is unavailable", async () => {
    mocks.current.mockResolvedValue({ status: "unavailable" });
    render(await MapPage());
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });
});

it("keeps a closed checkpoint closed and does not invent an active passage", async () => {
  mocks.current.mockResolvedValue({ status: "ready", map: { worldIndex: 3 } });
  mocks.adventure.mockReturnValue({ id: "finished", phase: "closed" });
  render(await MapPage());
  expect(
    JSON.parse(screen.getByTestId("forest-map").getAttribute("data-props")!).adventure,
  ).toEqual({ id: "finished", phase: "closed" });
});
