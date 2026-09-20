import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdventure } from "./use-adventure";
import { initGameState } from "./session";
import type { Adventure } from "./adventure-types";
import { adventureCommandAction, resumeAdventureAction } from "@/app/(app)/jouer/adventure-actions";
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/(app)/jouer/adventure-actions", () => ({
  adventureCommandAction: vi.fn(),
  resumeAdventureAction: vi.fn(),
}));
const send = vi.mocked(adventureCommandAction);
const load = vi.mocked(resumeAdventureAction);
const state: Adventure = {
  id: "session",
  revision: 8,
  worldIndex: 0,
  levelIndex: 10,
  phase: "results",
  game: initGameState(
    [
      {
        factKey: "comp10_3",
        skill: "comp10",
        operands: [3],
        format: "qcm",
        choices: [7, 6, 5, 3],
        isReask: false,
      },
    ],
    0,
    () => "q",
  ),
  result: {
    ok: true,
    stars: 0,
    unlockedNextWorld: true,
    coinsApplied: true,
    legendaryAdded: true,
    reward: { base: 10, starBonus: 0, treasureBonus: 0, bossBonus: 50, total: 60 },
    balance: { coins: 60, shards: 0 },
    legendary: {
      characterId: "legendary:0",
      name: "Amie",
      story: "Forêt",
      artRef: "socle/creature/legendary_world_0.png",
    },
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  load.mockResolvedValue({ ok: true, adventure: state });
});

describe("receipt acknowledgement before visiting a companion", () => {
  it("waits for server acknowledgement then opens exactly the granted creature", async () => {
    const { result } = renderHook(() => useAdventure(7));
    await waitFor(() => expect(result.current.sending).toBe(false));
    await waitFor(() => expect(result.current.adventure).toEqual(state));
    let resolve!: (r: Awaited<ReturnType<typeof adventureCommandAction>>) => void;
    send.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    act(() => {
      result.current.dispatch("close", { destination: "companion" });
      result.current.dispatch("close", { destination: "companion" });
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("teddy:pending:7")!)).toEqual({
      sessionId: "session",
      revision: 8,
      kind: "close",
      destination: "companion",
    });
    await act(async () =>
      resolve({ ok: true, adventure: { ...state, phase: "closed", revision: 9 } }),
    );
    expect(router.replace).toHaveBeenCalledWith("/collection/legendary%3A0");
    expect(localStorage.getItem("teddy:pending:7")).toBeNull();
  });
  it("a lost reply and remount resend the same close and preserve the destination", async () => {
    send.mockRejectedValueOnce(new Error("offline"));
    const hook = renderHook(() => useAdventure(7));
    await waitFor(() => expect(hook.result.current.adventure).toEqual(state));
    act(() => hook.result.current.dispatch("close", { destination: "companion" }));
    await waitFor(() => expect(hook.result.current.error).toBe("NETWORK"));
    const pending = JSON.parse(localStorage.getItem("teddy:pending:7")!);
    hook.unmount();
    send.mockResolvedValue({ ok: true, adventure: { ...state, phase: "closed", revision: 9 } });
    renderHook(() => useAdventure(7));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/collection/legendary%3A0"));
    expect(send).toHaveBeenLastCalledWith(pending, 7);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "companion"] as const)(
    "ordinary receipts return to the map (destination %s)",
    async (destination) => {
      load.mockResolvedValue({ ok: true, adventure: { ...state, result: null } });
      send.mockResolvedValue({ ok: true, adventure: { ...state, result: null, phase: "closed" } });
      const { result } = renderHook(() => useAdventure(7));
      await waitFor(() => expect(result.current.adventure).not.toBeNull());
      act(() => result.current.dispatch("close", { destination }));
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/carte"));
    },
  );
  it("a rejected command does not navigate or discard its pending intention", async () => {
    send.mockResolvedValue({ ok: false, error: "STALE" });
    const { result } = renderHook(() => useAdventure(7));
    await waitFor(() => expect(result.current.adventure).toEqual(state));
    act(() => result.current.dispatch("close", { destination: "companion" }));
    await waitFor(() => expect(result.current.error).toBe("STALE"));
    expect(router.replace).not.toHaveBeenCalled();
    expect(localStorage.getItem("teddy:pending:7")).not.toBeNull();
  });
});

it("refreshes the route if a diagnostic became necessary and respects a saved rest destination", async () => {
  load.mockResolvedValueOnce({ ok: false, error: "DIAGNOSTIC" });
  const hook = renderHook(() => useAdventure(7));
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  load.mockResolvedValueOnce({ ok: true, adventure: { ...state, phase: "closed", restReason: "suggested" } });
  await act(async () => hook.result.current.retry());
  expect(router.replace).toHaveBeenCalledWith("/repos");
});
it("retains network errors from initial load and prevents concurrent reloads", async () => {
  load.mockRejectedValueOnce(new Error("offline"));
  const hook = renderHook(() => useAdventure(7));
  await waitFor(() => expect(hook.result.current.error).toBe("NETWORK"));
  let finish!: (value: Awaited<ReturnType<typeof resumeAdventureAction>>) => void;
  load.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  act(() => { void hook.result.current.retry(); void hook.result.current.retry(); });
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => finish({ ok: true, adventure: state }));
  expect(hook.result.current.error).toBeNull();
});
it("does not load a hook unmounted before its initial microtask", async () => {
  const hook = renderHook(() => useAdventure(7)); hook.unmount();
  await act(async () => {}); expect(load).not.toHaveBeenCalled();
});
it.each(["read", "write", "remove"])("signals storage %s failure while keeping the server checkpoint authoritative", async (operation) => {
  if (operation === "read") localStorage.setItem("teddy:pending:7", "bad-json");
  const hook = renderHook(() => useAdventure(7));
  await waitFor(() => expect(hook.result.current.adventure).toEqual(state));
  if (operation === "write") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  if (operation === "remove") vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
  send.mockResolvedValue({ ok: true, adventure: { ...state, revision: 9 } });
  act(() => hook.result.current.dispatch("close"));
  await waitFor(() => expect(hook.result.current.adventure?.revision).toBe(9));
  expect(hook.result.current.storageWarning).toBe(true);
});
it("does not send the same pending command twice on simultaneous online events", async () => {
  const hook = renderHook(() => useAdventure(7));
  await waitFor(() => expect(hook.result.current.adventure).toEqual(state));
  let finish!: (value: Awaited<ReturnType<typeof adventureCommandAction>>) => void;
  send.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  act(() => {
    hook.result.current.dispatch("pause");
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
  });
  expect(send).toHaveBeenCalledOnce();
  await act(async () => finish({ ok: true, adventure: { ...state, paused: true } }));
});

it.each([false, true])("explicit refresh discards a stale local intention and reloads the server, removal denied=%s", async (denied) => {
  send.mockResolvedValueOnce({ ok: false, error: "STALE" });
  const hook = renderHook(() => useAdventure(7));
  await waitFor(() => expect(hook.result.current.adventure).toEqual(state));
  act(() => hook.result.current.dispatch("close"));
  await waitFor(() => expect(hook.result.current.error).toBe("STALE"));
  if (denied) vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
  await act(async () => hook.result.current.refresh());
  expect(load).toHaveBeenCalledTimes(2);
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.storageWarning).toBe(denied);
});
