import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEggShop } from "./use-egg-shop";
import { useShardShop } from "./use-shard-shop";
import { useEvolution } from "./use-evolution";
import type { EvolutionState } from "./evolution-types";
const m = vi.hoisted(() => ({
  eggLoad: vi.fn(),
  eggBuy: vi.fn(),
  eggAck: vi.fn(),
  shardLoad: vi.fn(),
  shardBuy: vi.fn(),
  shardAck: vi.fn(),
  evolutionLoad: vi.fn(),
  evolutionBuy: vi.fn(),
  evolutionAck: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => m }));
vi.mock("@/app/(app)/boutique/actions", () => ({
  boutiqueStateAction: m.eggLoad,
  buyEggAction: m.eggBuy,
  acknowledgeEggAction: m.eggAck,
}));
vi.mock("@/app/(app)/boutique/eclats/actions", () => ({
  shardShopStateAction: m.shardLoad,
  buyCompanionAction: m.shardBuy,
  acknowledgeCompanionAction: m.shardAck,
}));
vi.mock("@/app/(app)/collection/evolution-actions", () => ({
  evolutionStateAction: m.evolutionLoad,
  evolveCompanionAction: m.evolutionBuy,
  acknowledgeEvolutionAction: m.evolutionAck,
}));
const offer = {
  characterId: "creature:0:0",
  displayName: "Test",
  fromStage: 1,
  toStage: 2,
  beforeArtRef: "socle/0/baby.png",
  afterArtRef: "socle/0/ado.png",
  price: 40,
};
const initial: EvolutionState = {
  profileId: 7,
  coins: 70,
  shards: 100,
  offer,
  receipt: null,
  entry: {
    characterId: offer.characterId,
    displayName: "Test",
    defaultName: "Test",
    nickname: null,
    rarity: "common",
    story: "Fixture",
    stage: 1,
    maxStage: 3,
    count: 1,
    artRef: offer.beforeArtRef,
  },
};
const evolutionReceipt = { offer, balance: { coins: 70, shards: 60 }, acknowledged: false };
const eggReceipt = {
  drawId: "draw",
  acknowledged: false,
  result: {
    ok: true,
    creature: { characterId: offer.characterId },
    balance: { coins: 20, shards: 100 },
  },
};
const shardReceipt = {
  purchaseId: "purchase",
  offer: { characterId: offer.characterId },
  balance: { coins: 70, shards: 60 },
  acknowledged: false,
};
const eggState = {
  profileId: 7,
  coins: 70,
  shards: 100,
  eggPriceCoins: 50,
  available: true,
  receipt: eggReceipt,
};
const shardState = { profileId: 7, coins: 70, shards: 100, offers: [], receipt: shardReceipt };
interface Lifecycle {
  busy: boolean;
  error: string | null;
  retry(): Promise<void>;
  buy(): void;
  close(): void;
}
function useEggHarness(): Lifecycle {
  const h = useEggShop();
  return { ...h, buy: () => h.buy(), close: () => h.close("map") };
}
function useShardHarness(): Lifecycle {
  const h = useShardShop();
  return { ...h, buy: () => h.buy(offer.characterId), close: () => h.close("map") };
}
function useEvolutionHarness(): Lifecycle {
  const h = useEvolution({ ...initial, receipt: evolutionReceipt });
  return { ...h, buy: h.grow };
}
const cases = [
  {
    name: "egg",
    use: useEggHarness,
    load: m.eggLoad,
    buy: m.eggBuy,
    ack: m.eggAck,
    state: eggState,
    receipt: eggReceipt,
    key: "teddy:egg:7",
  },
  {
    name: "shards",
    use: useShardHarness,
    load: m.shardLoad,
    buy: m.shardBuy,
    ack: m.shardAck,
    state: shardState,
    receipt: shardReceipt,
    key: "teddy:shards:7",
  },
  {
    name: "evolution",
    use: useEvolutionHarness,
    load: m.evolutionLoad,
    buy: m.evolutionBuy,
    ack: m.evolutionAck,
    state: { ...initial, receipt: evolutionReceipt },
    receipt: evolutionReceipt,
    key: "teddy:evolution:7:creature:0:0",
  },
];
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  for (const c of cases) {
    c.load.mockResolvedValue(c.state);
    c.buy.mockResolvedValue({ ok: true, receipt: c.receipt });
    c.ack.mockResolvedValue(c.receipt);
  }
});
for (const c of cases)
  describe(`${c.name} lifecycle`, () => {
    it("coalesces reloads and ignores a load response after unmount", async () => {
      const pending = deferred();
      c.load.mockReturnValue(pending.promise);
      const hook = renderHook(c.use);
      await waitFor(() => expect(c.load).toHaveBeenCalledOnce());
      act(() => {
        void hook.result.current.retry();
        hook.result.current.buy();
      });
      expect(c.load).toHaveBeenCalledOnce();
      expect(c.buy).not.toHaveBeenCalled();
      hook.unmount();
      await act(async () => pending.resolve(c.state));
      expect(m.replace).not.toHaveBeenCalled();
    });
    it.each(["buy", "close"] as const)(
      "ignores a %s reply after unmount while retaining the stored intent",
      async (kind) => {
        const hook = renderHook(c.use);
        await waitFor(() => expect(hook.result.current.busy).toBe(false));
        const pending = deferred();
        const action = kind === "buy" ? c.buy : c.ack;
        action.mockReturnValue(pending.promise);
        act(() => hook.result.current[kind]());
        const stored = localStorage.getItem(c.key);
        expect(stored).not.toBeNull();
        hook.unmount();
        await act(async () =>
          pending.resolve(kind === "buy" ? { ok: true, receipt: c.receipt } : c.receipt),
        );
        expect(localStorage.getItem(c.key)).toBe(stored);
        expect(m.replace).not.toHaveBeenCalled();
      },
    );
    it("retains acknowledgement intent after an expired session, without navigating", async () => {
      c.ack.mockResolvedValue(null);
      const hook = renderHook(c.use);
      await waitFor(() => expect(hook.result.current.busy).toBe(false));
      act(() => hook.result.current.close());
      await waitFor(() => expect(hook.result.current.error).toBe("UNAUTHENTICATED"));
      expect(localStorage.getItem(c.key)).not.toBeNull();
      expect(m.replace).not.toHaveBeenCalled();
    });
    it("reports failed storage reads, without replaying an unreadable purchase", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("denied");
      });
      const hook = renderHook(c.use);
      await waitFor(() => expect(hook.result.current.error).toBe("STORAGE"));
      expect(c.buy).not.toHaveBeenCalled();
    });
    it.each([false, true])("handles rejected loads, unmounted=%s", async (unmounted) => {
      const pending = deferred();
      c.load.mockReturnValue(pending.promise);
      const hook = renderHook(c.use);
      await waitFor(() => expect(c.load).toHaveBeenCalled());
      if (unmounted) hook.unmount();
      await act(async () => pending.reject(new Error("offline")));
      if (!unmounted) expect(hook.result.current.error).toBe("NETWORK");
      expect(m.replace).not.toHaveBeenCalled();
    });
  });
it.each(["shop", "map"] as const)("restores an egg acknowledgement to %s", async (destination) => {
  localStorage.setItem(
    "teddy:egg:7",
    JSON.stringify({ kind: "close", drawId: "draw", destination }),
  );
  const hook = renderHook(useEggShop);
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  expect(m.eggAck).toHaveBeenCalledWith("draw", 7);
  if (destination === "shop") expect(m.refresh).toHaveBeenCalledOnce();
  else expect(m.replace).toHaveBeenCalledWith("/carte");
});
it.each([null, { ...eggState, profileId: 8 }])(
  "rejects a changed profile when returning to the egg shop",
  async (fresh) => {
    m.eggLoad.mockResolvedValueOnce(eggState).mockResolvedValueOnce(fresh);
    const hook = renderHook(useEggShop);
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    await act(async () => hook.result.current.close("shop"));
    expect(hook.result.current.error).toBe("UNAUTHENTICATED");
    expect(m.refresh).not.toHaveBeenCalled();
  },
);
it("ignores the refreshed egg shop after unmount and cannot open while saving", async () => {
  const pending = deferred();
  m.eggLoad.mockResolvedValueOnce(eggState).mockReturnValueOnce(pending.promise);
  const hook = renderHook(useEggShop);
  act(() => hook.result.current.open());
  expect(hook.result.current.revealed).toBe(false);
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  act(() => hook.result.current.close("shop"));
  await waitFor(() => expect(m.eggLoad).toHaveBeenCalledTimes(2));
  hook.unmount();
  await act(async () => pending.resolve(eggState));
  expect(m.refresh).not.toHaveBeenCalled();
});
it("can reveal a server-owned egg even when browser storage fails", async () => {
  const hook = renderHook(useEggShop);
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  act(() => hook.result.current.open());
  expect(hook.result.current.revealed).toBe(true);
  expect(m.eggBuy).not.toHaveBeenCalled();
});
it.each([
  { drawId: "draw", kind: "other" },
  { drawId: "draw", kind: "close", destination: "outside" },
  { drawId: "draw", kind: "close" },
  { drawId: "draw" },
])("does not replay an invalid egg intent %j", async (value) => {
  localStorage.setItem("teddy:egg:7", JSON.stringify(value));
  const hook = renderHook(useEggShop);
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  expect(m.eggBuy).not.toHaveBeenCalled();
  expect(m.eggAck).not.toHaveBeenCalled();
});
it.each([
  { fromStage: 1 },
  { fromStage: 2, kind: "other" },
  { fromStage: 2, kind: "grow", price: 40, artRef: "" },
])("does not replay an invalid evolution intent %j", async (value) => {
  localStorage.setItem("teddy:evolution:7:creature:0:0", JSON.stringify(value));
  const hook = renderHook(useEvolutionHarness);
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  expect(m.evolutionBuy).not.toHaveBeenCalled();
  expect(m.evolutionAck).not.toHaveBeenCalled();
});
