import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionScreen, CompanionArt, RenameForm, RarityBadge } from "./CollectionScreen";
import { collectionAlbumAction, renameCharacterAction } from "@/app/(app)/collection/actions";
import { strings } from "@/strings";
import { companions } from "@/strings/companions";
import type { CollectionEntry } from "@/lib/game/collection";

vi.mock("@/app/(app)/collection/actions", () => ({
  collectionAlbumAction: vi.fn(),
  renameCharacterAction: vi.fn(),
}));
const load = vi.mocked(collectionAlbumAction);
const rename = vi.mocked(renameCharacterAction);
const entry: CollectionEntry = {
  characterId: "legendary:0",
  displayName: "Luciolune",
  defaultName: "Gardienne",
  nickname: "Luciolune",
  rarity: "legendary",
  story: "La forêt.",
  stage: 1,
  maxStage: 1,
  count: 1,
  artRef: "socle/creature/legendary_world_0.png",
};
const album = {
  entries: [entry],
  families: [
    {
      worldIndex: 0,
      slots: [
        { characterId: entry.characterId, artRef: entry.artRef, rarity: entry.rarity, entry },
        {
          characterId: "other",
          artRef: "socle/creature/creature_world_0_0.png",
          rarity: "common" as const,
          entry: null,
        },
        {
          characterId: "guardian",
          artRef: "placeholder://unknown",
          rarity: "legendary" as const,
          entry: null,
        },
      ],
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
});

describe("companion album", () => {
  it("loads real possessions, preserves the detail identity and renders non-interactive silhouettes", async () => {
    load.mockResolvedValue(album);
    render(<CollectionScreen />);
    expect(screen.getByRole("status")).toHaveTextContent(strings.collection.loading);
    const title = await screen.findByRole("heading", { name: companions.title });
    expect(title).toHaveFocus();
    expect(screen.getByRole("link", { name: /Luciolune/ })).toHaveAttribute(
      "href",
      "/collection/legendary%3A0",
    );
    expect(document.querySelector('[data-asset="collection-creature"]')).toHaveAttribute(
      "src",
      "/generated/socle/creature/legendary_world_0.png",
    );
    expect(screen.getByText(companions.unknownGuardian)).toBeInTheDocument();
    expect(screen.getByText(companions.unknown)).toBeInTheDocument();
    expect(document.querySelector('[data-owned="false"] a')).toBeNull();
    expect(screen.getByRole("heading", { name: companions.family(1) })).toBeInTheDocument();
  });
  it("an empty collection gives a clear route to the adventure", async () => {
    load.mockResolvedValue({ entries: [], families: [] });
    render(<CollectionScreen />);
    expect(await screen.findByText(companions.empty)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continuer l’aventure" })).toHaveAttribute(
      "href",
      "/carte",
    );
  });
  it.each(["refusal", "network"])(
    "retries after %s without an unhandled rejection",
    async (kind) => {
      if (kind === "refusal") load.mockResolvedValueOnce(null);
      else load.mockRejectedValueOnce(new Error("offline"));
      load.mockResolvedValueOnce(album);
      render(<CollectionScreen />);
      fireEvent.click(
        await screen.findByRole("button", { name: strings.collection.loadErrorRetry }),
      );
      expect(await screen.findByRole("heading", { name: companions.title })).toHaveFocus();
    },
  );
  it("does not start the request after an immediate unmount", async () => {
    const { unmount } = render(<CollectionScreen />);
    unmount();
    await act(async () => {});
    expect(load).not.toHaveBeenCalled();
  });
});

describe("nickname editing", () => {
  it("keeps a failed draft, retries, and blocks concurrent submissions", async () => {
    const onSaved = vi.fn();
    const onCancel = vi.fn();
    rename.mockRejectedValueOnce(new Error("offline"));
    render(<RenameForm entry={entry} onSaved={onSaved} onCancel={onCancel} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Mon amie" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(strings.collection.renameError);
    expect(input).toHaveValue("Mon amie");
    let resolve!: (value: Awaited<ReturnType<typeof renameCharacterAction>>) => void;
    rename.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    fireEvent.submit(input.closest("form")!);
    fireEvent.submit(input.closest("form")!);
    expect(rename).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: strings.collection.renameCancel })).toBeDisabled();
    await act(async () => resolve({ ok: true, nickname: "Mon amie", error: null }));
    expect(onSaved).toHaveBeenCalledWith(entry.characterId, "Mon amie");
  });
  it("a malformed success does not replace the displayed name", async () => {
    rename.mockResolvedValue({ ok: true, nickname: null, error: null });
    const onSaved = vi.fn();
    render(<RenameForm entry={entry} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: strings.collection.renameSubmit }));
    await screen.findByRole("alert");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

it.each(["common", "rare", "legendary"] as const)(
  "rarity %s has text as well as a glyph",
  (rarity) => {
    render(<RarityBadge rarity={rarity} />);
    expect(screen.getByText(strings.collection.rarity[rarity])).toBeInTheDocument();
  },
);
it("missing art retains a named fallback and changes correctly when the reference changes", () => {
  const { rerender } = render(
    <CompanionArt artRef="socle/creature/missing.png" name="Amie" dataAsset="test-art" />,
  );
  fireEvent.error(screen.getByRole("img", { name: "Amie" }));
  expect(screen.getByRole("img", { name: "Amie" })).toHaveAttribute("data-asset-state", "fallback");
  rerender(<CompanionArt artRef={entry.artRef} name="Amie" dataAsset="test-art" />);
  expect(screen.getByRole("img", { name: "Amie" })).toHaveAttribute("data-asset-state", "rendered");
});
