import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShardShopScreen } from "./ShardShopScreen";
import {
  acknowledgeCompanionAction,
  buyCompanionAction,
  shardShopStateAction,
} from "@/app/(app)/boutique/eclats/actions";
import type { ShardOffer, ShardReceipt, ShardShopState } from "@/lib/game/shard-shop-types";
import { shardShop as copy } from "@/strings/shard-shop";
import { eggShop } from "@/strings/egg-shop";
import { contrastRatio, resolveTokenColor, type Theme } from "./scaffolds/test-support/tokens-css";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./ForestScene", () => ({ ForestScene: () => null }));
vi.mock("@/app/(app)/boutique/eclats/actions", () => ({
  shardShopStateAction: vi.fn(),
  buyCompanionAction: vi.fn(),
  acknowledgeCompanionAction: vi.fn(),
}));
const stateMock = vi.mocked(shardShopStateAction);
const buyMock = vi.mocked(buyCompanionAction);
const ackMock = vi.mocked(acknowledgeCompanionAction);
const offer: ShardOffer = {
  characterId: "creature:0:0",
  displayName: "Goupil",
  rarity: "common",
  worldIndex: 0,
  artRef: "socle/creature/creature_world_0_0.png",
  story: "Un ami des sous-bois.",
  price: 60,
};
const shop: ShardShopState = {
  profileId: 7,
  coins: 30,
  shards: 100,
  offers: [offer],
  receipt: null,
};
const receipt: ShardReceipt = {
  purchaseId: "purchase-1",
  acknowledged: false,
  offer,
  balance: { coins: 30, shards: 40 },
};
const storageKey = "teddy:shards:7";
async function ready() {
  const view = render(<ShardShopScreen />);
  const button = await screen.findByRole("button", { name: /Rencontrer Goupil/ });
  fireEvent.click(button);
  return view;
}
const buy = () => screen.getByRole("button", { name: copy.confirm("Goupil", 60) });
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  stateMock.mockResolvedValue(shop);
  buyMock.mockResolvedValue({ ok: true, receipt });
  ackMock.mockResolvedValue({ ...receipt, acknowledged: true });
});

describe("choosing a companion with shards", () => {
  it("previews the chosen art, story, exact price and remaining balance, then acquires and visits it", async () => {
    await ready();
    expect(screen.getByText(copy.after(40))).toBeInTheDocument();
    expect(screen.getByText(offer.story)).toBeInTheDocument();
    expect(buyMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: copy.confirmTitle("Goupil") })).toHaveFocus();
    fireEvent.click(buy());
    await screen.findByRole("heading", { name: copy.welcome("Goupil") });
    expect(buyMock).toHaveBeenCalledWith(expect.any(String), offer.characterId, 7);
    expect(screen.getByRole("img", { name: "Goupil" })).toHaveAttribute(
      "src",
      expect.stringContaining("creature_world_0_0.png"),
    );
    expect(screen.getByText(copy.paid(60, 40))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: eggShop.visit }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/collection/creature%3A0%3A0"),
    );
    expect(ackMock).toHaveBeenCalledWith("purchase-1", 7);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
  it("supports changing one's mind without spending", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: copy.change }));
    expect(screen.getByRole("heading", { name: copy.title })).toHaveFocus();
    expect(buyMock).not.toHaveBeenCalled();
  });
  it("suppresses double clicks and shows no acquisition before server success", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof buyCompanionAction>>) => void;
    buyMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await ready();
    const button = buy();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(buyMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(copy.saved)).toBeNull();
    await act(async () => resolve({ ok: true, receipt }));
    expect(screen.getByText(copy.saved)).toBeInTheDocument();
  });
  it("retains an uncertain purchase and retries the same target and id after closure", async () => {
    buyMock.mockRejectedValueOnce(Error("response lost"));
    const view = await ready();
    fireEvent.click(buy());
    await screen.findByText(copy.network);
    const args = buyMock.mock.calls[0];
    view.unmount();
    stateMock.mockResolvedValue({ ...shop, offers: [], receipt });
    render(<ShardShopScreen />);
    await waitFor(() => expect(buyMock).toHaveBeenCalledTimes(2));
    expect(buyMock.mock.calls[1]).toEqual(args);
    await screen.findByText(copy.saved);
  });
  it("restores the server encounter even without local storage data", async () => {
    stateMock.mockResolvedValue({ ...shop, offers: [], receipt });
    render(<ShardShopScreen />);
    await screen.findByText(copy.saved);
    expect(buyMock).not.toHaveBeenCalled();
  });
  it("retries a pending purchase when the network returns and transfers focus off retry", async () => {
    buyMock.mockRejectedValueOnce(Error("offline"));
    await ready();
    fireEvent.click(buy());
    await screen.findByText(copy.network);
    screen.getByRole("button", { name: eggShop.retry }).focus();
    fireEvent(window, new Event("online"));
    await screen.findByText(copy.saved);
    expect(screen.getByRole("heading", { name: copy.welcome("Goupil") })).toHaveFocus();
    expect(buyMock.mock.calls[1]).toEqual(buyMock.mock.calls[0]);
  });
  it.each(["companion", "shop", "map"] as const)(
    "retains the %s destination after a lost acknowledgement and closure",
    async (destination) => {
      stateMock.mockResolvedValue({ ...shop, receipt });
      ackMock.mockRejectedValueOnce(Error("lost"));
      const view = render(<ShardShopScreen />);
      await screen.findByText(copy.saved);
      fireEvent.click(
        screen.getByRole("button", {
          name:
            destination === "companion"
              ? eggShop.visit
              : destination === "shop"
                ? eggShop.returnShop
                : eggShop.continue,
        }),
      );
      await screen.findByText(copy.network);
      expect(router.replace).not.toHaveBeenCalled();
      view.unmount();
      stateMock.mockResolvedValue({ ...shop, offers: [], receipt: null });
      render(<ShardShopScreen />);
      await waitFor(() =>
        expect(router.replace).toHaveBeenCalledWith(
          destination === "companion"
            ? "/collection/creature%3A0%3A0"
            : destination === "shop"
              ? "/boutique"
              : "/carte",
        ),
      );
      expect(ackMock).toHaveBeenCalledTimes(2);
      expect(buyMock).not.toHaveBeenCalled();
    },
  );
  it("shows the missing shards without a purchase button, and keeps adventure available", async () => {
    stateMock.mockResolvedValue({ ...shop, shards: 59 });
    await ready();
    expect(screen.getByText(copy.missing(1))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.confirm("Goupil", 60) })).toBeNull();
    expect(screen.getByRole("link", { name: eggShop.continue })).toHaveAttribute("href", "/carte");
  });
  it.each(["BROKE", "OWNED", "UNAVAILABLE", "INVALID", "REPLAY"] as const)(
    "clears definitive refusal %s and refreshes the catalogue",
    async (error) => {
      buyMock.mockResolvedValue({ ok: false, error });
      await ready();
      stateMock.mockResolvedValue({ ...shop, offers: [] });
      fireEvent.click(buy());
      await screen.findByText(copy.empty);
      expect(localStorage.getItem(storageKey)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: eggShop.retry }));
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(buyMock).toHaveBeenCalledTimes(1);
    },
  );
  it("does not replay a previous profile's stored intention", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ kind: "buy", purchaseId: "old", characterId: offer.characterId }),
    );
    stateMock.mockResolvedValue({ ...shop, profileId: 8 });
    await ready();
    expect(buyMock).not.toHaveBeenCalled();
    fireEvent.click(buy());
    await screen.findByText(copy.saved);
    expect(buyMock).toHaveBeenCalledWith(expect.not.stringMatching(/^old$/), offer.characterId, 8);
  });
  it("retains the pending intent if the session changes during purchase", async () => {
    buyMock.mockResolvedValue({ ok: false, error: "UNAUTHENTICATED" });
    await ready();
    stateMock.mockResolvedValue({ ...shop, profileId: 8 });
    fireEvent.click(buy());
    await screen.findByText(eggShop.auth);
    expect(localStorage.getItem(storageKey)).not.toBeNull();
    expect(screen.getByRole("link", { name: eggShop.login })).toBeInTheDocument();
    expect(screen.queryByText(copy.saved)).toBeNull();
  });
  it("shows the sign-in path for an absent session", async () => {
    stateMock.mockResolvedValue(null);
    render(<ShardShopScreen />);
    await screen.findByRole("link", { name: eggShop.login });
    expect(buyMock).not.toHaveBeenCalled();
  });
  it("blocks spending when the browser cannot save the intent", async () => {
    await ready();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("denied");
    });
    fireEvent.click(buy());
    await screen.findByText(eggShop.storage);
    expect(buyMock).not.toHaveBeenCalled();
  });
  it.each([
    "broken JSON",
    JSON.stringify({ kind: "buy", purchaseId: "" }),
    JSON.stringify({ kind: "close", purchaseId: "a", destination: "unsafe" }),
  ])("ignores corrupt local intent %s", async (value) => {
    localStorage.setItem(storageKey, value);
    await ready();
    expect(buyMock).not.toHaveBeenCalled();
  });
  it.each(["light", "dark"] as Theme[])(
    "keeps informative text and rarity glyphs readable in %s",
    (theme) => {
      for (const [ink, paper] of [
        ["--forest-ink", "--forest-paper"],
        ["--forest-ink", "--forest-soft"],
        ["--forest-cream", "--forest-deep"],
        ["--forest-muted", "--forest-paper"],
      ])
        expect(
          contrastRatio(resolveTokenColor(theme, ink), resolveTokenColor(theme, paper)),
        ).toBeGreaterThanOrEqual(4.5);
    },
  );
  it("uses singular shard copy for zero and one", () => {
    expect([0, 1, 2].map(copy.price)).toEqual(["0 éclat", "1 éclat", "2 éclats"]);
  });
});
