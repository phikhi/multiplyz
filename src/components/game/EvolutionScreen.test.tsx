import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeEvolutionAction,
  evolveCompanionAction,
  evolutionStateAction,
} from "@/app/(app)/collection/evolution-actions";
import { EvolutionScreen } from "./EvolutionScreen";
import { evolution as copy } from "@/strings/evolution";
import type { EvolutionReceipt, EvolutionState } from "@/lib/game/evolution-types";
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/app/(app)/collection/evolution-actions", () => ({
  acknowledgeEvolutionAction: vi.fn(),
  evolveCompanionAction: vi.fn(),
  evolutionStateAction: vi.fn(),
}));
const initial: EvolutionState = {
  profileId: 4,
  coins: 80,
  shards: 140,
  entry: {
    characterId: "creature:0:0",
    displayName: "Étoile",
    defaultName: "Bulle",
    nickname: "Étoile",
    rarity: "common",
    story: "Une amie des étoiles.",
    stage: 1,
    maxStage: 3,
    count: 3,
    artRef: "socle/creature/baby.png",
  },
  offer: {
    characterId: "creature:0:0",
    displayName: "Étoile",
    fromStage: 1,
    toStage: 2,
    beforeArtRef: "socle/creature/baby.png",
    afterArtRef: "socle/creature/teen.png",
    price: 40,
  },
  receipt: null,
};
const receipt: EvolutionReceipt = {
  offer: initial.offer!,
  balance: { coins: 80, shards: 100 },
  acknowledged: false,
};
const storageKey = "teddy:evolution:4:creature:0:0";
const growIntent = { kind: "grow", fromStage: 1, price: 40, artRef: "socle/creature/teen.png" };
async function ready() {
  await waitFor(() => expect(evolutionStateAction).toHaveBeenCalled());
  const image = screen.getByAltText("Étoile · Ado");
  fireEvent.load(image);
  await waitFor(() => expect(screen.getByRole("button", { name: copy.confirm(40) })).toBeEnabled());
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(evolutionStateAction).mockResolvedValue(initial);
  vi.mocked(evolveCompanionAction).mockResolvedValue({ ok: true, receipt });
  vi.mocked(acknowledgeEvolutionAction).mockResolvedValue({ ...receipt, acknowledged: true });
});
afterEach(cleanup);
describe("growth consent and reliable resumption", () => {
  it("shows distinct images, exact cost and balance; does not spend until explicit consent; double click is safe", async () => {
    render(<EvolutionScreen initial={initial} />);
    expect(screen.getByText(copy.after(100))).toBeVisible();
    expect(screen.getByText(copy.cosmetic)).toBeVisible();
    expect(screen.getByAltText("Étoile")).toHaveAttribute(
      "src",
      "/generated/socle/creature/baby.png",
    );
    expect(screen.getByAltText("Étoile · Ado")).toHaveAttribute(
      "src",
      "/generated/socle/creature/teen.png",
    );
    expect(evolveCompanionAction).not.toHaveBeenCalled();
    await ready();
    const button = screen.getByRole("button", { name: copy.confirm(40) });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByRole("heading", { name: copy.grown("Étoile") })).toHaveFocus();
    expect(evolveCompanionAction).toHaveBeenCalledExactlyOnceWith(
      "creature:0:0",
      1,
      40,
      "socle/creature/teen.png",
      4,
    );
    expect(screen.getByText(copy.historical(100))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: copy.return("Étoile") }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/collection/creature%3A0%3A0"));
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
  it("enables consent when the server-rendered image completed before hydration", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(768);
    render(<EvolutionScreen initial={initial} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: copy.confirm(40) })).toBeEnabled(),
    );
    expect(screen.queryByText(copy.imageLoading)).toBeNull();
    expect(evolveCompanionAction).not.toHaveBeenCalled();
  });
  it("refuses consent while the next image is missing and keeps a way back", async () => {
    render(<EvolutionScreen initial={initial} />);
    await waitFor(() => expect(evolutionStateAction).toHaveBeenCalled());
    fireEvent.error(screen.getByAltText("Étoile · Ado"));
    expect(screen.getByRole("button", { name: copy.confirm(40) })).toBeDisabled();
    expect(screen.getByText(copy.imageError)).toBeVisible();
    expect(screen.getByRole("link", { name: copy.keep })).toHaveAttribute(
      "href",
      "/collection/creature%3A0%3A0",
    );
    expect(evolveCompanionAction).not.toHaveBeenCalled();
  });
  it("shows missing shards and no spend action", async () => {
    const broke = { ...initial, shards: 12 };
    vi.mocked(evolutionStateAction).mockResolvedValue(broke);
    render(<EvolutionScreen initial={broke} />);
    expect(await screen.findByText(copy.missing(28))).toBeVisible();
    expect(screen.queryByRole("button", { name: copy.confirm(40) })).toBeNull();
  });
  it("resumes the exact baby-to-teen intent after lost response and closure, then resumes lost acknowledgement", async () => {
    vi.mocked(evolveCompanionAction).mockRejectedValueOnce(new Error("lost"));
    const view = render(<EvolutionScreen initial={initial} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: copy.confirm(40) }));
    expect(await screen.findByText(copy.errors.NETWORK)).toBeVisible();
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(growIntent);
    view.unmount();
    const grown = {
      ...initial,
      entry: { ...initial.entry, stage: 2, artRef: "socle/creature/teen.png" },
      receipt,
    };
    vi.mocked(evolutionStateAction).mockResolvedValue(grown);
    const second = render(<EvolutionScreen initial={grown} />);
    await waitFor(() => expect(evolveCompanionAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(evolveCompanionAction).mock.calls[1]).toEqual([
      "creature:0:0",
      1,
      40,
      "socle/creature/teen.png",
      4,
    ]);
    vi.mocked(acknowledgeEvolutionAction).mockRejectedValueOnce(new Error("lost ack"));
    const back = await screen.findByRole("button", { name: copy.return("Étoile") });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    expect(await screen.findByText(copy.errors.NETWORK)).toBeVisible();
    second.unmount();
    vi.mocked(evolutionStateAction).mockResolvedValue({ ...grown, receipt: null });
    render(<EvolutionScreen initial={{ ...grown, receipt: null }} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/collection/creature%3A0%3A0"));
    expect(acknowledgeEvolutionAction).toHaveBeenCalledTimes(2);
  });
  it("keeps a pre-commit intent and retries on reconnection with correct focus", async () => {
    vi.mocked(evolveCompanionAction).mockRejectedValueOnce(new Error("offline"));
    render(<EvolutionScreen initial={initial} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: copy.confirm(40) }));
    const retry = await screen.findByRole("button", { name: copy.retry });
    retry.focus();
    fireEvent(window, new Event("online"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: copy.grown("Étoile") })).toHaveFocus(),
    );
    expect(evolveCompanionAction).toHaveBeenCalledTimes(2);
  });
  it("does not start a spend when local storage refuses writes", async () => {
    render(<EvolutionScreen initial={initial} />);
    await ready();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    fireEvent.click(screen.getByRole("button", { name: copy.confirm(40) }));
    expect(await screen.findByText(copy.errors.STORAGE)).toBeVisible();
    expect(evolveCompanionAction).not.toHaveBeenCalled();
  });
  it("ignores malformed storage and does not replay another profile's intent", async () => {
    localStorage.setItem(storageKey, "bad json");
    localStorage.setItem("teddy:evolution:8:creature:0:0", JSON.stringify(growIntent));
    render(<EvolutionScreen initial={initial} />);
    await ready();
    expect(evolveCompanionAction).not.toHaveBeenCalled();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
  it("refuses to replay when the authenticated profile changed", async () => {
    localStorage.setItem(storageKey, JSON.stringify(growIntent));
    vi.mocked(evolutionStateAction).mockResolvedValue({ ...initial, profileId: 8 });
    render(<EvolutionScreen initial={initial} />);
    expect(await screen.findByText(copy.errors.UNAUTHENTICATED)).toBeVisible();
    expect(evolveCompanionAction).not.toHaveBeenCalled();
  });
  it.each(["BROKE", "CHANGED", "UNAVAILABLE"] as const)(
    "clears a refused intent (%s) and reloads the authoritative state",
    async (error) => {
      vi.mocked(evolveCompanionAction).mockResolvedValue({ ok: false, error });
      render(<EvolutionScreen initial={initial} />);
      await ready();
      fireEvent.click(screen.getByRole("button", { name: copy.confirm(40) }));
      expect(await screen.findByText(copy.errors[error])).toBeVisible();
      expect(localStorage.getItem(storageKey)).toBeNull();
    },
  );
  it("shows adult completion without another evolution", async () => {
    const adult = { ...initial, offer: null, entry: { ...initial.entry, stage: 3 } };
    vi.mocked(evolutionStateAction).mockResolvedValue(adult);
    render(<EvolutionScreen initial={adult} />);
    await act(async () => {});
    expect(screen.getByText(copy.complete)).toBeVisible();
    expect(evolveCompanionAction).not.toHaveBeenCalled();
  });
});
