import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ParentMotionControl } from "./ParentMotionControl";
import { parent as p } from "@/strings/parent";
const reduced = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sound/use-prefers-reduced-motion", () => ({ usePrefersReducedMotion: reduced }));
beforeEach(() => { localStorage.clear(); reduced.mockReturnValue(false); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
it("restores the browser preference and persists a parent change", () => {
  localStorage.setItem("teddy:reduced", "true"); render(<ParentMotionControl />);
  act(() => vi.runOnlyPendingTimers());
  const button = screen.getByRole("switch");
  expect(button).toHaveAttribute("aria-checked", "true");
  fireEvent.click(button);
  expect(button).toHaveAttribute("aria-checked", "false");
  expect(localStorage.getItem("teddy:reduced")).toBe("false");
});
it.each(["read", "write"])("disables the preference honestly after a storage %s failure", (operation) => {
  vi.spyOn(Storage.prototype, operation === "read" ? "getItem" : "setItem").mockImplementation(() => { throw new Error("denied"); });
  render(<ParentMotionControl />); act(() => vi.runOnlyPendingTimers());
  if (operation === "write") fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByRole("status")).toHaveTextContent(p.motionUnavailable);
  expect(screen.getByRole("switch")).toBeDisabled();
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
});
it("respects a system preference and cancels pending work on unmount", () => {
  reduced.mockReturnValue(true);
  const view = render(<ParentMotionControl />);
  expect(screen.getByRole("switch")).toBeDisabled();
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
});
