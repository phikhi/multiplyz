import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ForestScene, type ForestState } from "./ForestScene";
const scene = { setState: vi.fn(), dispose: vi.fn() };
const createTeddyForest = vi.fn(() => scene);
const initial: ForestState = { phase: "arrival", completed: 0, total: 10, paused: false, reduced: false };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.doMock("/forest/world.js", () => ({ createTeddyForest })); });
afterEach(() => vi.doUnmock("/forest/world.js"));
it("initializes the live scene, updates its progress, then disposes after context loss", async () => {
  localStorage.setItem("teddy:reduced", "true");
  const view = render(<ForestScene {...initial} />);
  await waitFor(() => expect(createTeddyForest).toHaveBeenCalledOnce());
  expect(scene.setState).toHaveBeenLastCalledWith({ ...initial, reduced: true });
  view.rerender(<ForestScene {...initial} completed={4} />);
  expect(scene.setState).toHaveBeenLastCalledWith({ ...initial, completed: 4, reduced: true });
  fireEvent(view.container.querySelector(".forest-renderer")!, new Event("webglcontextlost"));
  expect(scene.dispose).toHaveBeenCalledOnce();
  expect(view.container.querySelector(".forest-fallback")).toBeInTheDocument();
});
it("disposes the live scene on unmount and tolerates unavailable browser preferences", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  const view = render(<ForestScene {...initial} />);
  await waitFor(() => expect(createTeddyForest).toHaveBeenCalledOnce());
  view.unmount(); expect(scene.dispose).toHaveBeenCalledOnce();
});
it("ignores a module resolving after its component was unmounted", async () => {
  let resolve!: (value: { createTeddyForest: typeof createTeddyForest }) => void;
  vi.doMock("/forest/world.js", () => new Promise((done) => { resolve = done; }));
  const view = render(<ForestScene {...initial} />);
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  view.unmount(); await act(async () => resolve({ createTeddyForest }));
  expect(createTeddyForest).not.toHaveBeenCalled();
});
