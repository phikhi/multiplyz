import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionScreen } from "./CollectionScreen";
import { collectionAction, renameCharacterAction } from "@/app/(app)/collection/actions";
import { strings } from "@/strings";
import type { CollectionEntry } from "@/lib/game/collection";
import type { Rarity } from "@/lib/db/schema";
import {
  contrastRatio,
  rawTokenValue,
  resolveTokenColor,
  themeBlock,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";

/**
 * Tests de l'écran **Collection (Pokédex)** (story 5.6, WIREFRAMES §5, PRODUCT §2.3).
 *
 * **Piège #1 (rétro #104/#125/#126, feed-forward brief)** : tout glyphe/texte rendu exige un
 * test de contraste WCAG **résolu** (`tokens.css` → hex → ratio réel ≥4.5:1), par glyphe
 * distinct, sur le fond DOM réellement empilé derrière lui — cf. blocs "contraste WCAG résolu".
 * On audite TOUS les glyphes rendus (nom, rareté par-rareté, histoire, compteur), pas seulement
 * un token par famille.
 */

vi.mock("@/app/(app)/collection/actions", () => ({
  collectionAction: vi.fn(),
  renameCharacterAction: vi.fn(),
}));

const collectionActionMock = vi.mocked(collectionAction);
const renameActionMock = vi.mocked(renameCharacterAction);

function entry(overrides: Partial<CollectionEntry> = {}): CollectionEntry {
  return {
    characterId: "legendary:0",
    displayName: "Braisille",
    defaultName: "Braisille",
    nickname: null,
    rarity: "legendary",
    story: "La gardienne légendaire.",
    stage: 1,
    count: 1,
    artRef: "placeholder://legendary/0",
    ...overrides,
  };
}

async function renderReady(entries: readonly CollectionEntry[]) {
  collectionActionMock.mockResolvedValue({ entries });
  const result = render(<CollectionScreen />);
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CollectionScreen — chargement / erreur", () => {
  it("affiche un statut de chargement puis la collection (non authentifié → erreur)", async () => {
    collectionActionMock.mockResolvedValue({ entries: null });
    render(<CollectionScreen />);
    expect(screen.getByRole("status")).toHaveTextContent(strings.collection.loading);
    await waitFor(() => expect(screen.getByText(strings.collection.loadError)).toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: strings.collection.loadErrorRetry }),
    ).toBeInTheDocument();
  });

  it("retry recharge la collection après une erreur", async () => {
    collectionActionMock.mockResolvedValue({ entries: null });
    render(<CollectionScreen />);
    await waitFor(() => screen.getByText(strings.collection.loadError));

    collectionActionMock.mockResolvedValue({ entries: [entry()] });
    fireEvent.click(screen.getByRole("button", { name: strings.collection.loadErrorRetry }));
    await waitFor(() => expect(screen.getByText("Braisille")).toBeInTheDocument());
  });
});

describe("CollectionScreen — affichage (WIREFRAMES §5)", () => {
  it("collection vide → message d'encouragement (posture douce, jamais d'échec)", async () => {
    await renderReady([]);
    expect(screen.getByText(strings.collection.empty)).toBeInTheDocument();
    // Compteur « 0 créature » (pluriel géré par la logique, 0 ≠ 1).
    expect(
      screen.getByText(strings.collection.countPlural.replace("{n}", "0")),
    ).toBeInTheDocument();
  });

  it("affiche chaque créature possédée (nom + histoire + carte a11y)", async () => {
    await renderReady([entry({ displayName: "Braisille", story: "La gardienne." })]);
    expect(screen.getByText("Braisille")).toBeInTheDocument();
    expect(screen.getByText("La gardienne.")).toBeInTheDocument();
    // Nom accessible de la carte = nom + rareté (doublage a11y).
    const label = strings.collection.cardLabel
      .replace("{nom}", "Braisille")
      .replace("{rareté}", strings.collection.rarity.legendary);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it("compteur singulier/pluriel selon le nombre de créatures", async () => {
    const { unmount } = await renderReady([entry()]);
    expect(screen.getByText(strings.collection.count.replace("{n}", "1"))).toBeInTheDocument();
    unmount();
    await renderReady([entry({ characterId: "a" }), entry({ characterId: "b" })]);
    expect(
      screen.getByText(strings.collection.countPlural.replace("{n}", "2")),
    ).toBeInTheDocument();
  });

  // GARDE A11y : la rareté est doublée d'un TEXTE (« légendaire »/« rare »/« commune »), jamais
  // la seule couleur/glyphe (daltonisme). Chaque rareté rend son libellé FR.
  it.each(["common", "rare", "legendary"] as Rarity[])(
    "rareté %s doublée d'un libellé texte (a11y daltonisme)",
    async (rarity) => {
      await renderReady([entry({ characterId: rarity, rarity })]);
      expect(screen.getByText(strings.collection.rarity[rarity])).toBeInTheDocument();
    },
  );

  it("histoire vide (catalogue sans story) ⇒ aucune ligne d'histoire, mais carte affichée", async () => {
    await renderReady([entry({ displayName: "Muet", story: "" })]);
    expect(screen.getByText("Muet")).toBeInTheDocument();
    // Aucun paragraphe d'histoire vide rendu.
    expect(screen.queryByText("La gardienne légendaire.")).not.toBeInTheDocument();
  });

  it("lien vers la carte (hub, WIREFRAMES §2)", async () => {
    await renderReady([entry()]);
    const link = screen.getByRole("link", { name: strings.collection.back });
    expect(link).toHaveAttribute("href", "/carte");
  });
});

/**
 * Grille **3 colonnes** sur téléphone (WIREFRAMES §8, blocker frontend). jsdom ne calcule
 * pas la mise en page grid, mais la garde à effet observable combine deux faits :
 * 1. le **token de configuration** `--collection-grid-columns` (source de vérité `tokens.css`)
 *    vaut **exactement 3** — rougit si un futur agent revient à `auto-fill`/1-2 colonnes ;
 * 2. la grille rendue **consomme ce token** via `repeat(var(--collection-grid-columns), …)` —
 *    prouve que le nombre de colonnes vient bien du token (pas d'un `auto-fill` qui reflowerait
 *    à 1-2 colonnes à 320px). Retirer le token OU repasser à `auto-fill` casse l'un des deux.
 * La preuve de rendu réel (3 colonnes calculées à 320px) est faite en capture Playwright.
 */
describe("CollectionScreen — grille 3 colonnes sur téléphone (WIREFRAMES §8)", () => {
  it("le token --collection-grid-columns vaut 3 (source de vérité tokens.css)", () => {
    const value = rawTokenValue(themeBlock("light"), "--collection-grid-columns");
    expect(value).toBe("3");
  });

  it("la grille rendue consomme le token de colonnes (repeat(var(--collection-grid-columns), …))", async () => {
    await renderReady([entry({ characterId: "a" }), entry({ characterId: "b" })]);
    const grid = document.querySelector<HTMLElement>("[data-collection-grid]");
    expect(grid).not.toBeNull();
    // Le nombre de colonnes est piloté par le token (jamais un auto-fill qui reflowerait) —
    // la fonction `repeat()` fixe explicitement 3 pistes, pas un remplissage adaptatif.
    expect(grid?.style.gridTemplateColumns).toContain("repeat(var(--collection-grid-columns)");
    expect(grid?.style.gridTemplateColumns).not.toContain("auto-fill");
    expect(grid?.style.gridTemplateColumns).not.toContain("auto-fit");
  });
});

describe("CollectionScreen — renommage (PRODUCT §2.3)", () => {
  it("ouvre le formulaire, renomme et persiste (affichage mis à jour)", async () => {
    await renderReady([entry({ displayName: "Braisille" })]);
    renameActionMock.mockResolvedValue({ ok: true, nickname: "Flamme", error: null });

    fireEvent.click(screen.getByRole("button", { name: `✏️ ${strings.collection.rename}` }));
    const input = screen.getByLabelText(strings.collection.renameLabel);
    fireEvent.change(input, { target: { value: "Flamme" } });
    fireEvent.click(screen.getByRole("button", { name: strings.collection.renameSubmit }));

    // Renommage délégué au serveur avec l'id + le nom saisi.
    await waitFor(() => expect(renameActionMock).toHaveBeenCalledWith("legendary:0", "Flamme"));
    // L'affichage se met à jour (le nom devient « Flamme »).
    await waitFor(() => expect(screen.getByText("Flamme")).toBeInTheDocument());
    expect(screen.queryByText("Braisille")).not.toBeInTheDocument();
  });

  // GARDE « ne renomme QUE la créature ciblée » (effet observable) : avec deux créatures, en
  // renommer une ne touche PAS l'autre (le `.map` ne réécrit que l'entrée ciblée).
  it("avec deux créatures, renommer l'une laisse l'autre inchangée", async () => {
    await renderReady([
      entry({ characterId: "legendary:0", displayName: "Braisille" }),
      entry({ characterId: "legendary:1", displayName: "Aquagon" }),
    ]);
    renameActionMock.mockResolvedValue({ ok: true, nickname: "Flamme", error: null });

    // Renomme la 1ʳᵉ créature (Braisille → Flamme).
    const renameButtons = screen.getAllByRole("button", {
      name: `✏️ ${strings.collection.rename}`,
    });
    fireEvent.click(renameButtons[0]);
    fireEvent.change(screen.getByLabelText(strings.collection.renameLabel), {
      target: { value: "Flamme" },
    });
    fireEvent.click(screen.getByRole("button", { name: strings.collection.renameSubmit }));

    await waitFor(() => expect(screen.getByText("Flamme")).toBeInTheDocument());
    // L'AUTRE créature (Aquagon) est inchangée.
    expect(screen.getByText("Aquagon")).toBeInTheDocument();
    expect(screen.queryByText("Braisille")).not.toBeInTheDocument();
  });

  it("annuler ferme le formulaire sans renommer", async () => {
    await renderReady([entry({ displayName: "Braisille" })]);
    fireEvent.click(screen.getByRole("button", { name: `✏️ ${strings.collection.rename}` }));
    fireEvent.click(screen.getByRole("button", { name: strings.collection.renameCancel }));
    // Le formulaire est fermé (le bouton renommer revient), aucun appel serveur.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: `✏️ ${strings.collection.rename}` }),
      ).toBeInTheDocument(),
    );
    expect(renameActionMock).not.toHaveBeenCalled();
  });

  it("échec de renommage ⇒ message d'erreur doux, nom inchangé", async () => {
    await renderReady([entry({ displayName: "Braisille" })]);
    renameActionMock.mockResolvedValue({ ok: false, nickname: null, error: "INVALID_NAME" });

    fireEvent.click(screen.getByRole("button", { name: `✏️ ${strings.collection.rename}` }));
    fireEvent.change(screen.getByLabelText(strings.collection.renameLabel), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: strings.collection.renameSubmit }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(strings.collection.renameError),
    );
    // Nom inchangé (toujours affiché quelque part dans la carte).
    expect(screen.getByText("Braisille")).toBeInTheDocument();
  });
});

/**
 * Contraste WCAG **résolu** de chaque glyphe/texte rendu sur la carte de créature (rétro
 * #104/#125/#126). Le fond de référence de chaque test = le fond DOM réellement empilé
 * derrière le glyphe (`--collection-card-bg` pour le contenu de carte ; `--color-bg-primary`
 * pour le compteur en dehors des cartes). Effet observable : remapper un token vers une valeur
 * faible-contraste rougirait le test correspondant.
 */
describe("CollectionScreen — contraste WCAG résolu des glyphes rendus (rétro #104/#125/#126)", () => {
  it.each(["light", "dark"] as Theme[])(
    "%s : le nom de créature (--collection-text) ≥ 4.5:1 sur le fond de carte (--collection-card-bg)",
    (theme) => {
      const text = resolveTokenColor(theme, "--collection-text");
      const bg = resolveTokenColor(theme, "--collection-card-bg");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : le glyphe/label de rareté (--collection-rarity-glyph) ≥ 4.5:1 sur le fond de carte",
    (theme) => {
      const glyph = resolveTokenColor(theme, "--collection-rarity-glyph");
      const bg = resolveTokenColor(theme, "--collection-card-bg");
      expect(contrastRatio(glyph, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : le texte d'histoire (--collection-text-muted) ≥ 4.5:1 sur le fond de carte",
    (theme) => {
      const text = resolveTokenColor(theme, "--collection-text-muted");
      const bg = resolveTokenColor(theme, "--collection-card-bg");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : le glyphe de silhouette placeholder (--collection-placeholder-glyph) ≥ 4.5:1 sur son fond (--collection-placeholder-bg)",
    (theme) => {
      const glyph = resolveTokenColor(theme, "--collection-placeholder-glyph");
      const bg = resolveTokenColor(theme, "--collection-placeholder-bg");
      expect(contrastRatio(glyph, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : le compteur (--collection-text-muted) ≥ 4.5:1 sur le fond de PAGE (--color-bg-primary)",
    (theme) => {
      // Le compteur « N créatures » est rendu hors carte, directement sur le fond de page.
      const text = resolveTokenColor(theme, "--collection-text-muted");
      const bg = resolveTokenColor(theme, "--color-bg-primary");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
