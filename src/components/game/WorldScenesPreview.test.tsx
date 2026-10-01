import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { WorldScenesPreview } from "./WorldScenesPreview";
import { worldPreview as p, worldScenes } from "@/strings/world-scenes";
const mocks = vi.hoisted(() => ({ scene: vi.fn(), map: vi.fn(), reduced: false }));
vi.mock("./ForestScene", () => ({
  ForestScene: (props: unknown) => {
    mocks.scene(props);
    return null;
  },
}));
vi.mock("./ForestMap", () => ({
  ForestMap: (props: unknown) => {
    mocks.map(props);
    return <div data-testid="map" />;
  },
}));
vi.mock("@/lib/sound/use-prefers-reduced-motion", () => ({
  usePrefersReducedMotion: () => mocks.reduced,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.reduced = false;
});
it("previews arrival, progress and finale with the selected world's copy", () => {
  render(<WorldScenesPreview />);
  expect(screen.getByRole("heading", { name: worldScenes.forest.title })).toBeInTheDocument();
  expect(mocks.scene).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: "arrival", completed: 0, showFriend: false }),
  );
  fireEvent.change(screen.getByLabelText(p.world), { target: { value: "ocean" } });
  expect(screen.getByText(worldScenes.ocean.invitation)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(p.progress), { target: { value: "5" } });
  expect(mocks.scene).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: "question", completed: 5 }),
  );
  fireEvent.change(screen.getByLabelText(p.progress), { target: { value: "10" } });
  expect(screen.getByText(worldScenes.ocean.encounter)).toBeInTheDocument();
  expect(mocks.scene).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: "finale", completed: 10 }),
  );
  fireEvent.change(screen.getByLabelText(p.world), { target: { value: "forest:4" } });
  expect(screen.getByRole("heading", { name: worldScenes.grove.title })).toBeInTheDocument();
});
it("keeps maps inert and propagates pause and reduced motion to both views", () => {
  render(<WorldScenesPreview />);
  fireEvent.click(screen.getByRole("button", { name: p.pause }));
  fireEvent.click(screen.getByRole("button", { name: p.reduced }));
  expect(mocks.scene).toHaveBeenLastCalledWith(
    expect.objectContaining({ paused: true, reduced: true }),
  );
  fireEvent.change(screen.getByLabelText(p.view), { target: { value: "map" } });
  expect(screen.getByTestId("map").parentElement).toHaveAttribute("inert");
  expect(mocks.map).toHaveBeenLastCalledWith(
    expect.objectContaining({ adventure: null, motion: { paused: true, reduced: true } }),
  );
  fireEvent.click(screen.getByRole("button", { name: p.resume }));
  fireEvent.click(screen.getByRole("button", { name: p.reduced }));
  expect(mocks.map).toHaveBeenLastCalledWith(
    expect.objectContaining({ motion: { paused: false, reduced: false } }),
  );
});
it("cannot override the system reduced-motion preference", () => {
  mocks.reduced = true;
  render(<WorldScenesPreview />);
  fireEvent.click(screen.getByRole("button", { name: p.reduced }));
  fireEvent.click(screen.getByRole("button", { name: p.reduced }));
  expect(screen.getByRole("button", { name: p.reduced })).toHaveAttribute("aria-pressed", "true");
});
