import type { ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AdventureScreen } from "./AdventureScreen";
import { initGameState } from "@/lib/game/session";
import type { Adventure } from "@/lib/game/adventure-types";
import { forest } from "@/strings/forest";
import { daily } from "@/strings/daily";
import { strings } from "@/strings";
const m = vi.hoisted(() => ({ dispatch: vi.fn(), retry: vi.fn(), refresh: vi.fn(), replace: vi.fn(), playSfx: vi.fn(), sound: vi.fn(async (_enabled: boolean) => {}), scene: vi.fn(), state: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => m }));
vi.mock("@/lib/game/use-adventure", () => ({ useAdventure: m.state }));
vi.mock("./ForestScene", () => ({ ForestScene: (props: unknown) => { m.scene(props); return null; } }));
vi.mock("@/lib/sound/SoundProvider", () => ({ SoundProvider: ({ children }: { children: ReactNode }) => children, useSound: () => m }));
vi.mock("@/lib/sound/use-prefers-reduced-motion", () => ({ usePrefersReducedMotion: () => false }));
vi.mock("@/app/(app)/jouer/actions", () => ({ setChildSoundEnabledAction: m.sound }));
const base: Adventure = { id: "recovery", revision: 0, worldIndex: 0, levelIndex: 0, phase: "arrival", result: null,
  game: initGameState([{ factKey: "comp10_3", skill: "comp10", operands: [3], format: "qcm", choices: [7, 3, 5, 1], isReask: false }], 0, () => "q") };
function state(adventure: Adventure | null = base, error: string | null = null, sending = false, storageWarning = false) {
  m.state.mockReturnValue({ adventure, error, sending, storageWarning, ...m });
}
function App() { return <AdventureScreen profileId={7} guardianLevelIndex={10} sound={{ soundEnabled: false, musicEnabled: false, volume: 20 }} />; }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); state();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
it.each([[null, forest.loading], ["EMPTY", strings.play.emptyLevel], ["NETWORK", forest.loadError], ["UNAUTHENTICATED", forest.authError], ["INVALID", forest.loadError], ["STALE", forest.loadError]])("offers the appropriate recovery when initial load returns %s", async (error, title) => {
  state(null, error);
  render(<App />);
  expect(screen.getByRole("heading", { name: title! })).toBeInTheDocument();
  if (error === "UNAUTHENTICATED") expect(screen.getByRole("link", { name: forest.login })).toHaveAttribute("href", "/");
  else if (error) {
    const refresh = error === "INVALID" || error === "STALE";
    fireEvent.click(screen.getByRole("button", { name: refresh ? forest.refresh : forest.retryNetwork }));
    expect(refresh ? m.refresh : m.retry).toHaveBeenCalledOnce();
  }
  await act(async () => {});
});
it.each(["NETWORK", "UNAUTHENTICATED", "STALE"])("preserves recovery both during play and inside a paused %s session", async (error) => {
  state(base, error);
  const view = render(<App />);
  const message = error === "NETWORK" ? forest.pending : error === "UNAUTHENTICATED" ? forest.authError : forest.sessionChanged;
  expect(screen.getByText(message, { selector: ".forest-network p" })).toBeVisible();
  if (error !== "UNAUTHENTICATED") {
    fireEvent.click(screen.getByRole("button", { name: error === "NETWORK" ? forest.retryNetwork : forest.refresh }));
    expect(error === "NETWORK" ? m.retry : m.refresh).toHaveBeenCalledOnce();
  }
  state({ ...base, paused: true }, error); view.rerender(<App />);
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByText(message)).toBeVisible();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(m.dispatch).not.toHaveBeenCalled();
  if (error === "UNAUTHENTICATED") expect(dialog.getByRole("link", { name: forest.login })).toHaveAttribute("href", "/");
  else {
    fireEvent.click(dialog.getByRole("button", { name: error === "NETWORK" ? forest.retryNetwork : forest.refresh }));
    expect(error === "NETWORK" ? m.retry : m.refresh).toHaveBeenCalledTimes(2);
  }
  await act(async () => {});
});
it("shows pending save and storage warning without granting an extra reward", async () => {
  state(base, null, true);
  const view = render(<App />);
  expect(screen.getByText(forest.sending)).toBeVisible();
  state(base, null, false, true); view.rerender(<App />);
  expect(screen.getByText(forest.storageError)).toBeVisible();
  expect(screen.getByRole("button", { name: forest.begin })).toBeEnabled();
  await act(async () => {});
});
it("pauses and resumes with Escape, cancel and buttons, returning focus to Pause", async () => {
  const view = render(<App />);
  await act(async () => {});
  fireEvent.keyDown(document.body, { key: "Escape", repeat: true });
  fireEvent.keyDown(document.body, { key: "a" });
  expect(m.dispatch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Pause/ }));
  expect(m.dispatch).toHaveBeenLastCalledWith("pause");
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(m.dispatch).toHaveBeenLastCalledWith("pause");
  state({ ...base, paused: true }); view.rerender(<App />);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(m.dispatch).toHaveBeenLastCalledWith("resume");
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(m.dispatch).toHaveBeenLastCalledWith("resume");
  state(base); view.rerender(<App />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Pause/ })).toHaveFocus();
});
it.each([false, true])("keeps sound and reduced-motion controls usable, storage denied=%s", async (denied) => {
  if (denied) vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  else localStorage.setItem("teddy:reduced", "true");
  state({ ...base, paused: true });
  render(<App />); await act(async () => {});
  const reduced = screen.getByRole("button", { name: forest.reduced });
  expect(reduced).toHaveAttribute("aria-pressed", String(!denied));
  if (denied) vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  fireEvent.click(reduced);
  expect(reduced).toHaveAttribute("aria-pressed", String(denied));
  m.sound.mockRejectedValueOnce(new Error("offline"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: forest.soundOff })));
  expect(m.sound).toHaveBeenLastCalledWith(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: forest.soundOn })));
  expect(m.sound).toHaveBeenLastCalledWith(false);
});
it("routes answers, help, reveal and retry through durable commands", async () => {
  state({ ...base, phase: "question" });
  const view = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "7" }));
  expect(m.dispatch).toHaveBeenLastCalledWith("answer", { value: 7, responseMs: expect.any(Number) });
  state({ ...base, phase: "help" }); view.rerender(<App />);
  fireEvent.click(screen.getByRole("button", { name: forest.reveal }));
  expect(m.dispatch).toHaveBeenLastCalledWith("reveal");
  state({ ...base, phase: "reveal" }); view.rerender(<App />);
  expect(m.scene).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "help" }));
  fireEvent.click(screen.getByRole("button", { name: forest.retry }));
  expect(m.dispatch).toHaveBeenLastCalledWith("retry");
  await act(async () => {});
});
it.each([false, true])("focuses feedback and plays its sound once per revision, accompanied=%s", async (isRetrying) => {
  const adventure = { ...base, phase: "feedback" as const, game: { ...base.game, current: { ...base.game.current, isRetrying } } };
  state(adventure); const view = render(<App />);
  expect(screen.getByRole("heading", { name: isRetrying ? forest.accompanied : forest.correct })).toHaveFocus();
  expect(m.playSfx).toHaveBeenCalledExactlyOnceWith("correct");
  view.rerender(<App />); expect(m.playSfx).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: forest.next }));
  expect(m.dispatch).toHaveBeenLastCalledWith("next");
  state({ ...adventure, revision: 1 }); view.rerender(<App />);
  expect(m.playSfx).toHaveBeenCalledTimes(2);
  await act(async () => {});
});
it("identifies recalibration and treats completed game progress as complete", async () => {
  state({ ...base, diagnostic: { recalibration: true, responses: [] }, game: { ...base.game, finished: true } });
  render(<App />);
  expect(screen.getByText(daily.recalibrationHint)).toBeInTheDocument();
  expect(screen.getByText(daily.recalibrationEyebrow)).toBeInTheDocument();
  expect(m.scene).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 1, total: 1 }));
  await act(async () => {});
});
it("handles a closed checkpoint without displaying an answer or fabricated results", async () => {
  state({ ...base, phase: "closed" }); render(<App />);
  expect(screen.queryByRole("button", { name: forest.results })).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: forest.answerLabel })).not.toBeInTheDocument();
  await act(async () => {});
});
