import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoutiqueScreen } from "./BoutiqueScreen";
import {
  acknowledgeEggAction,
  boutiqueStateAction,
  buyEggAction,
} from "@/app/(app)/boutique/actions";
import type { EggReceipt, EggShopState } from "@/lib/game/egg-receipt-types";
import { eggShop as copy } from "@/strings/egg-shop";
import { contrastRatio, resolveTokenColor, type Theme } from "./scaffolds/test-support/tokens-css";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./ForestScene", () => ({ ForestScene: () => null }));
vi.mock("@/app/(app)/boutique/actions", () => ({
  boutiqueStateAction: vi.fn(),
  buyEggAction: vi.fn(),
  acknowledgeEggAction: vi.fn(),
}));
const stateMock = vi.mocked(boutiqueStateAction);
const buyMock = vi.mocked(buyEggAction);
const ackMock = vi.mocked(acknowledgeEggAction);
const receipt: EggReceipt = {
  drawId: "draw-1",
  acknowledged: false,
  result: {
    ok: true,
    creature: {
      characterId: "creature:0:0",
      displayName: "Goupil",
      rarity: "common",
      artRef: "socle/creature/creature_world_0_0.png",
      story: "Un ami des sous-bois.",
    },
    isNew: true,
    shardsAwarded: 0,
    pityApplied: false,
    balance: { coins: 70, shards: 0 },
  },
};
const shop: EggShopState = {
  profileId: 7,
  eggPriceCoins: 50,
  coins: 120,
  shards: 0,
  available: true,
  receipt: null,
};
const storageKey = "teddy:egg:7";
const intent = { kind: "buy", drawId: "draw-1", revealed: false };
const buyButton = () => screen.getByRole("button", { name: copy.buy(50) });
async function ready() {
  const view = render(<BoutiqueScreen />);
  await screen.findByRole("button", { name: copy.buy(50) });
  return view;
}
async function reveal() {
  fireEvent.click(buyButton());
  await screen.findByRole("button", { name: copy.open });
  fireEvent.click(screen.getByRole("button", { name: copy.open }));
  await screen.findByRole("heading", { name: copy.named("Goupil") });
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  stateMock.mockResolvedValue(shop);
  buyMock.mockResolvedValue({ ok: true, receipt });
  ackMock.mockResolvedValue({ ...receipt, acknowledged: true });
});

describe("forest egg shop", () => {
  it("shows real balance and explicit cost, then opens and acknowledges before visiting the collection", async () => {
    await ready();
    expect(screen.getByText(copy.after(70))).toBeInTheDocument();
    await reveal();
    expect(buyMock).toHaveBeenCalledWith(expect.any(String), 7);
    expect(screen.getByText(receipt.result.creature.story)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Goupil" })).toHaveAttribute(
      "src",
      expect.stringContaining("creature_world_0_0.png"),
    );
    expect(screen.getByRole("heading", { name: copy.named("Goupil") })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: copy.visit }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/collection/creature%3A0%3A0"),
    );
    expect(ackMock).toHaveBeenCalledWith("draw-1", 7);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
  it("suppresses rapid double clicks and waits for confirmed purchase before opening", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof buyEggAction>>) => void;
    buyMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await ready();
    const button = buyButton();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(buyMock).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(screen.queryByRole("button", { name: copy.open })).toBeNull();
    await act(async () => resolve({ ok: true, receipt }));
    expect(screen.getByRole("button", { name: copy.open })).toBeEnabled();
  });
  it("keeps an uncertain purchase id across a network failure, unmount and restored session", async () => {
    buyMock.mockRejectedValueOnce(Error("lost response"));
    const first = await ready();
    fireEvent.click(buyButton());
    await screen.findByText(copy.network);
    const saved = JSON.parse(localStorage.getItem(storageKey)!);
    expect(saved.drawId).toBe(buyMock.mock.calls[0][0]);
    first.unmount();
    stateMock.mockResolvedValue({ ...shop, coins: 70, receipt });
    render(<BoutiqueScreen />);
    await screen.findByRole("button", { name: copy.open });
    await waitFor(() => expect(buyMock).toHaveBeenCalledTimes(2));
    expect(buyMock.mock.calls[1]).toEqual(buyMock.mock.calls[0]);
  });
  it("retries the saved collection destination after a lost acknowledgement", async () => {
    const first = await ready();
    await reveal();
    ackMock.mockRejectedValueOnce(Error("lost"));
    fireEvent.click(screen.getByRole("button", { name: copy.visit }));
    await screen.findByText(copy.network);
    expect(router.replace).not.toHaveBeenCalled();
    first.unmount();
    stateMock.mockResolvedValue({ ...shop, coins: 70 });
    render(<BoutiqueScreen />);
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/collection/creature%3A0%3A0"),
    );
    expect(ackMock).toHaveBeenCalledTimes(2);
    expect(buyMock).toHaveBeenCalledTimes(1);
  });
  it("restores an unacknowledged server receipt without browser storage", async () => {
    stateMock.mockResolvedValue({ ...shop, receipt });
    render(<BoutiqueScreen />);
    await screen.findByRole("button", { name: copy.open });
    expect(buyMock).not.toHaveBeenCalled();
  });
  it("restores the revealed phase and announces useful duplicate shards and pity", async () => {
    const duplicate = {
      ...receipt,
      result: { ...receipt.result, isNew: false, shardsAwarded: 25, pityApplied: true },
    };
    localStorage.setItem(storageKey, JSON.stringify({ ...intent, revealed: true }));
    buyMock.mockResolvedValue({ ok: true, receipt: duplicate });
    render(<BoutiqueScreen />);
    await screen.findByText(copy.shardsGain(25));
    expect(screen.getByText(copy.duplicate("Goupil", 25))).toBeInTheDocument();
    expect(screen.getByText(copy.pity)).toBeInTheDocument();
    expect(screen.getByText(copy.shardsGain(25)).closest('[role="img"]')).toBeNull();
  });
  it("returns to the updated shop or map after acknowledgement", async () => {
    await ready();
    await reveal();
    stateMock.mockResolvedValue({ ...shop, coins: 70, shards: 10 });
    fireEvent.click(screen.getByRole("button", { name: copy.returnShop }));
    await screen.findByRole("button", { name: copy.buy(50) });
    expect(screen.getByText(copy.after(20))).toBeInTheDocument();
    await reveal();
    fireEvent.click(screen.getByRole("button", { name: copy.continue }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/carte"));
  });
  it.each([
    { ...shop, coins: 12 },
    { ...shop, available: false },
  ])("keeps learning accessible when buying is unavailable", async (state) => {
    stateMock.mockResolvedValue(state);
    render(<BoutiqueScreen />);
    await screen.findByRole("link", { name: copy.continue });
    expect(screen.queryByRole("button", { name: copy.buy(50) })).toBeNull();
    expect(
      screen.getByText(state.available ? copy.missing(38) : copy.unavailable),
    ).toBeInTheDocument();
  });
  it("refreshes a stale balance after a definitive insufficient-funds refusal", async () => {
    await ready();
    stateMock.mockResolvedValue({ ...shop, coins: 10 });
    buyMock.mockResolvedValue({ ok: false, error: "BROKE" });
    fireEvent.click(buyButton());
    await screen.findByText(copy.broke);
    await screen.findByText(copy.missing(40));
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
  it("allows retrying initial load failure and on network return", async () => {
    stateMock.mockRejectedValueOnce(Error("offline"));
    render(<BoutiqueScreen />);
    await screen.findByText(copy.network);
    fireEvent.click(screen.getByRole("button", { name: copy.retry }));
    await screen.findByRole("button", { name: copy.buy(50) });
    buyMock.mockRejectedValueOnce(Error("offline"));
    fireEvent.click(buyButton());
    await screen.findByText(copy.network);
    fireEvent(window, new Event("online"));
    await screen.findByRole("button", { name: copy.open });
  });
  it("does not spend when durable local intent cannot be written", async () => {
    await ready();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("denied");
    });
    fireEvent.click(buyButton());
    await screen.findByText(copy.storage);
    expect(buyMock).not.toHaveBeenCalled();
  });
  it("does not replay another profile's intention", async () => {
    localStorage.setItem("teddy:egg:8", JSON.stringify(intent));
    await ready();
    expect(buyMock).not.toHaveBeenCalled();
  });
  it("returns keyboard focus to the heading after a retry in the same shop phase", async () => {
    await ready();
    buyMock.mockResolvedValue({ ok: false, error: "BROKE" });
    fireEvent.click(buyButton());
    const retry = await screen.findByRole("button", { name: copy.retry });
    retry.focus();
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    await waitFor(() => expect(buyButton()).toBeEnabled());
    expect(screen.getByRole("heading", { name: copy.title })).toHaveFocus();
  });
  it("discards malformed local JSON while restoring the server's pending egg", async () => {
    localStorage.setItem(storageKey, "{broken");
    stateMock.mockResolvedValue({ ...shop, receipt });
    render(<BoutiqueScreen />);
    await screen.findByRole("button", { name: copy.open });
    expect(screen.queryByText(copy.storage)).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(buyMock).not.toHaveBeenCalled();
  });
  it("routes session expiry to profile selection and leaves the intent intact", async () => {
    await ready();
    buyMock.mockResolvedValue({ ok: false, error: "UNAUTHENTICATED" });
    fireEvent.click(buyButton());
    await screen.findByRole("link", { name: copy.login });
    expect(localStorage.getItem(storageKey)).not.toBeNull();
  });
  it("handles an unauthenticated initial load", async () => {
    stateMock.mockResolvedValue(null);
    render(<BoutiqueScreen />);
    await screen.findByRole("link", { name: copy.login });
  });
});

describe("shop readable foregrounds in both themes", () => {
  it.each(["light", "dark"] as Theme[])("foreground/background pairs ≥4.5:1 (%s)", (theme) => {
    for (const [fg, bg] of [
      ["--forest-cream", "--forest-deep"],
      ["--forest-gold", "--forest-deep"],
      ["--forest-mint", "--forest-deep"],
      ["--forest-ink", "--forest-cream"],
      ["--forest-muted", "--forest-cream"],
      ["--forest-ink", "--forest-gold"],
      ["--forest-ink", "--forest-soft"],
    ])
      expect(
        contrastRatio(resolveTokenColor(theme, fg), resolveTokenColor(theme, bg)),
      ).toBeGreaterThanOrEqual(4.5);
  });
});
