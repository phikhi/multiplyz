import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { loadCollection, renameCharacter } from "@/lib/game/collection";
import { collectionAction, renameCharacterAction } from "./actions";

/**
 * Tests des **server actions collection** (story 5.6) — adaptateurs minces. Prouvent : le
 * `profile_id` vient TOUJOURS de la session (jamais du client), la lecture/le renommage sont
 * délégués à la couche `@/lib/game/collection`, et le refus non authentifié est **neutre**
 * (pas de fuite, aucune lecture/écriture).
 */

vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => "DB") }));
vi.mock("@/lib/game/collection", () => ({ loadCollection: vi.fn(), renameCharacter: vi.fn() }));

const profileMock = vi.mocked(getCurrentChildProfileId);
const loadCollectionMock = vi.mocked(loadCollection);
const renameMock = vi.mocked(renameCharacter);

const FAKE_ENTRY = {
  characterId: "legendary:0",
  displayName: "Braisille",
  defaultName: "Braisille",
  nickname: null,
  rarity: "legendary" as const,
  story: "La gardienne.",
  stage: 1,
  maxStage: 1,
  count: 1,
  artRef: "placeholder://legendary/0",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("collectionAction", () => {
  it("non authentifié → { entries: null }, aucune lecture", async () => {
    profileMock.mockResolvedValue(null);
    await expect(collectionAction()).resolves.toEqual({ entries: null });
    expect(loadCollectionMock).not.toHaveBeenCalled();
  });

  it("authentifié → renvoie la collection du profil de session (jamais du client)", async () => {
    profileMock.mockResolvedValue(7);
    loadCollectionMock.mockReturnValue([FAKE_ENTRY]);
    await expect(collectionAction()).resolves.toEqual({ entries: [FAKE_ENTRY] });
    // Lecture avec le profil de session (7), jamais un profil client.
    expect(loadCollectionMock).toHaveBeenCalledWith("DB", 7);
  });
});

describe("renameCharacterAction", () => {
  it("non authentifié → { ok: false, error: UNAUTHENTICATED }, aucun renommage", async () => {
    profileMock.mockResolvedValue(null);
    await expect(renameCharacterAction("legendary:0", "Flamme")).resolves.toEqual({
      ok: false,
      nickname: null,
      error: "UNAUTHENTICATED",
    });
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("succès → renvoie le nouveau nom (renommage délégué avec le profil de session)", async () => {
    profileMock.mockResolvedValue(7);
    renameMock.mockReturnValue({ ok: true, nickname: "Flamme" });
    await expect(renameCharacterAction("legendary:0", "  Flamme  ")).resolves.toEqual({
      ok: true,
      nickname: "Flamme",
      error: null,
    });
    // Le profil de session (7) est passé à la couche (jamais un profil client).
    expect(renameMock).toHaveBeenCalledWith("DB", 7, "legendary:0", "  Flamme  ");
  });

  it("refus de la couche → mappe l'erreur (neutre), pas de 500", async () => {
    profileMock.mockResolvedValue(7);
    renameMock.mockReturnValue({ ok: false, error: "NOT_OWNED" });
    await expect(renameCharacterAction("legendary:0", "Flamme")).resolves.toEqual({
      ok: false,
      nickname: null,
      error: "NOT_OWNED",
    });
  });

  it("refus de forme (nom invalide) → INVALID_NAME (mappé)", async () => {
    profileMock.mockResolvedValue(7);
    renameMock.mockReturnValue({ ok: false, error: "INVALID_NAME" });
    await expect(renameCharacterAction("legendary:0", "")).resolves.toEqual({
      ok: false,
      nickname: null,
      error: "INVALID_NAME",
    });
  });
});
