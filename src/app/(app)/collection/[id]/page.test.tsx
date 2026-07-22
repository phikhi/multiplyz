import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { redirect } from "next/navigation";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { loadCollectionEntry } from "@/lib/game/collection";
import type { CollectionEntry } from "@/lib/game/collection";
import CreatureDetailPage from "./page";

// Page serveur = pont mince : lit la session (profileId) + délègue à `loadCollectionEntry`
// (déjà testée sur base réelle, `collection.test.ts`), puis transmet à l'écran de présentation
// (testé isolément, `CreatureDetailScreen.test.tsx`). On stubbe TOUTES les dépendances serveur
// pour ne prouver ICI que le CÂBLAGE + les gardes de redirection (session / propriété).
const FAKE_DB = { __fakeDb: true };
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => FAKE_DB) }));
vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: vi.fn() }));
vi.mock("@/lib/game/collection", () => ({ loadCollectionEntry: vi.fn() }));
vi.mock("@/components/game/CreatureDetailScreen", () => ({
  CreatureDetailScreen: (props: { entry: CollectionEntry }) => (
    <div data-testid="creature-detail-stub" data-character-id={props.entry.characterId} />
  ),
}));

const redirectMock = vi.mocked(redirect);
const profileIdMock = vi.mocked(getCurrentChildProfileId);
const entryMock = vi.mocked(loadCollectionEntry);

const ENTRY: CollectionEntry = {
  characterId: "legendary:0",
  displayName: "Braisille",
  defaultName: "Braisille",
  nickname: null,
  rarity: "legendary",
  story: "La gardienne légendaire.",
  stage: 1,
  maxStage: 1,
  count: 1,
  artRef: "placeholder://legendary/0",
};

function paramsFor(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreatureDetailPage — route /collection/[id] (story R3.2 #379)", () => {
  it("sans session enfant → redirige vers le sélecteur (défense en profondeur, même garde que le layout)", async () => {
    profileIdMock.mockResolvedValue(null);
    await CreatureDetailPage({ params: paramsFor("legendary:0") });
    expect(redirectMock).toHaveBeenCalledWith("/");
    expect(entryMock).not.toHaveBeenCalled();
  });

  // GARDE PROPRIÉTÉ (effet observable) : id inconnu / créature d'un autre profil
  // (`loadCollectionEntry` renvoie `null`) ⇒ redirige vers la grille, jamais un plantage.
  it("créature non possédée (id inconnu / autre profil) → redirige vers la grille (no-fail)", async () => {
    profileIdMock.mockResolvedValue(7);
    entryMock.mockReturnValue(null);
    await CreatureDetailPage({ params: paramsFor("inconnu") });
    expect(redirectMock).toHaveBeenCalledWith("/collection");
  });

  it("créature possédée → charge l'entrée du PROFIL DE LA SESSION et monte l'écran", async () => {
    profileIdMock.mockResolvedValue(7);
    entryMock.mockReturnValue(ENTRY);
    const ui = await CreatureDetailPage({ params: paramsFor("legendary:0") });
    render(ui);
    expect(entryMock).toHaveBeenCalledWith(FAKE_DB, 7, "legendary:0");
    expect(screen.getByTestId("creature-detail-stub")).toHaveAttribute(
      "data-character-id",
      "legendary:0",
    );
  });

  it("un id SANS caractère à encoder atteint loadCollectionEntry inchangé (decodeURIComponent no-op)", async () => {
    profileIdMock.mockResolvedValue(42);
    entryMock.mockReturnValue({ ...ENTRY, characterId: "creature:3:1" });
    await CreatureDetailPage({ params: paramsFor("creature:3:1") });
    expect(entryMock).toHaveBeenCalledWith(FAKE_DB, 42, "creature:3:1");
  });

  // ▶▶ MUTATION-PROUVÉ — bug RÉEL trouvé en instruisant (curl direct, jamais en review) ◀◀ : le
  // segment dynamique `id` arrive ENCORE percent-encodé (le routeur App Router ne le décode PAS
  // pour un catch simple `[id]`, vérifié empiriquement en vrai serveur `next dev` — `%3A` reste
  // `%3A`, jamais redevenu `:`). `characterId` contient `:` (`legendary:0`, `creature:3:1`…) et
  // `CollectionScreen` l'encode via `encodeURIComponent` pour construire le `href` — sans
  // `decodeURIComponent` ICI, `loadCollectionEntry` chercherait un id littéralement
  // `"legendary%3A0"`, introuvable → **faux-négatif SILENCIEUX** (redirect vers la grille, jamais
  // un plantage — exactement ce qui s'est produit avant ce fix). Ce test ROUGIT si le
  // `decodeURIComponent` est retiré.
  it("le segment `id` ENCODÉ (`%3A`) est DÉCODÉ avant d'atteindre loadCollectionEntry", async () => {
    profileIdMock.mockResolvedValue(42);
    entryMock.mockReturnValue({ ...ENTRY, characterId: "legendary:0" });
    await CreatureDetailPage({ params: paramsFor("legendary%3A0") });
    expect(entryMock).toHaveBeenCalledWith(FAKE_DB, 42, "legendary:0");
  });
});
