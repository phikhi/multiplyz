import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoutiqueScreen } from "./BoutiqueScreen";
import {
  boutiqueStateAction,
  buyEggAction,
  type BuyEggActionResult,
} from "@/app/(app)/boutique/actions";
import { strings } from "@/strings";
import {
  contrastRatio,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";

/**
 * Tests de l'écran **Boutique / Œufs** (story R4.2 #393, WIREFRAMES §6). Prouvent à effet observable :
 * - l'achat relaie un `drawId` opaque, la révélation affiche la créature (art rendable → `<img>`) ;
 * - **doublon** → « +N ✨ » (jamais « rien ») ; **nouvelle** → beat célébration ; **broke** → doux ;
 * - l'art consomme le token de **MAGNITUDE** dédié `--egg-reveal-art-size` (la taille rendue = E2E) ;
 * - **a11y** : bloc de révélation `role="img"` au nom accessible, art décoratif, cibles ≥ 44 px ;
 * - **contraste WCAG résolu** (rétro #104/#125/#126) sur TOUS les couples texte/fond de l'écran.
 */

vi.mock("@/app/(app)/boutique/actions", () => ({
  boutiqueStateAction: vi.fn(),
  buyEggAction: vi.fn(),
}));

const stateMock = vi.mocked(boutiqueStateAction);
const buyMock = vi.mocked(buyEggAction);

const NEW_RESULT: Extract<BuyEggActionResult, { ok: true }> = {
  ok: true,
  creature: {
    characterId: "creature:0:0",
    displayName: "Goupil",
    rarity: "common",
    artRef: "socle/creature/creature_world_0_0.png",
    story: "Un ami.",
  },
  isNew: true,
  shardsAwarded: 0,
  pityApplied: false,
  coins: 70,
  shards: 0,
};

const DUP_RESULT: Extract<BuyEggActionResult, { ok: true }> = {
  ...NEW_RESULT,
  isNew: false,
  shardsAwarded: 25,
  coins: 70,
  shards: 25,
};

async function renderReady() {
  stateMock.mockResolvedValue({ ok: true, eggPriceCoins: 50, coins: 120, shards: 40 });
  const result = render(<BoutiqueScreen />);
  await waitFor(() => expect(screen.getByRole("button", { name: /Ouvrir/ })).toBeInTheDocument());
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BoutiqueScreen — chargement + carte œuf", () => {
  it("charge l'état serveur → affiche l'œuf + le bouton d'achat avec le prix", async () => {
    await renderReady();
    expect(screen.getByRole("heading", { name: strings.boutique.title })).toBeInTheDocument();
    // Le prix (⚙️ 50) est interpolé dans le libellé du bouton (jamais un nombre en dur).
    expect(screen.getByRole("button", { name: "Ouvrir 🪙50" })).toBeInTheDocument();
  });

  it("erreur de chargement → message doux + réessai qui recharge l'écran", async () => {
    stateMock.mockResolvedValue({ ok: false, eggPriceCoins: 50, coins: 0, shards: 0 });
    render(<BoutiqueScreen />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: strings.boutique.loadError })).toBeInTheDocument(),
    );
    // Réessai : la 2ᵉ tentative réussit → l'écran revient à la carte œuf (jamais bloqué).
    stateMock.mockResolvedValue({ ok: true, eggPriceCoins: 50, coins: 120, shards: 40 });
    fireEvent.click(screen.getByRole("button", { name: strings.boutique.loadErrorRetry }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Ouvrir/ })).toBeInTheDocument());
  });
});

describe("BoutiqueScreen — ouverture d'œuf (WIREFRAMES §6b)", () => {
  it("achat d'une NOUVELLE créature → révélation avec le VRAI art (img rendable) + beat célébration", async () => {
    await renderReady();
    buyMock.mockResolvedValue(NEW_RESULT);
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir/ }));

    // Bloc de révélation présent, nommé par la créature (a11y : role="img" + aria-label).
    const reveal = await screen.findByRole("img", {
      name: strings.eggReveal.creatureLabel.replace("{nom}", "Goupil"),
    });
    expect(reveal).toHaveAttribute("data-egg-reveal", "creature:0:0");
    expect(reveal).toHaveAttribute("data-egg-reveal-new", "true");
    // Un drawId opaque a bien été transmis (string non vide).
    expect(buyMock).toHaveBeenCalledTimes(1);
    expect(typeof buyMock.mock.calls[0][0]).toBe("string");
    expect((buyMock.mock.calls[0][0] as string).length).toBeGreaterThan(0);

    // VRAI art : la ref rendable `socle/creature/…` → `<img>` (data-asset-state="rendered"),
    // jamais le repli emoji (#180 : l'enfant voit sa créature). Consomme le token de MAGNITUDE.
    const art = document.querySelector('[data-asset="egg-reveal-art"]');
    expect(art).not.toBeNull();
    expect(art).toHaveAttribute("data-asset-state", "rendered");
    expect((art as HTMLElement).style.width).toBe("var(--egg-reveal-art-size)");

    // Beat Teddy « nouvel ami » (célébration, COPY §3).
    expect(screen.getByText(strings.eggReveal.newFriend)).toBeInTheDocument();
    // CTA de fermeture.
    expect(screen.getByRole("button", { name: strings.eggReveal.dismiss })).toBeInTheDocument();
  });

  it("achat d'un DOUBLON → « +25 ✨ » (jamais « rien », ECONOMY §1)", async () => {
    await renderReady();
    buyMock.mockResolvedValue(DUP_RESULT);
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir/ }));

    const reveal = await screen.findByRole("img", {
      name: strings.eggReveal.creatureLabel.replace("{nom}", "Goupil"),
    });
    expect(reveal).toHaveAttribute("data-egg-reveal-new", "false");
    // Le beat doublon interpole les éclats gagnés (25) — jamais un gabarit figé.
    expect(
      screen.getByText(strings.eggReveal.duplicate.replace("{éclats}", "25")),
    ).toBeInTheDocument();
  });

  it("« Génial ! » referme la révélation et revient à la carte œuf (solde rafraîchi)", async () => {
    await renderReady();
    buyMock.mockResolvedValue(NEW_RESULT);
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir/ }));
    const dismiss = await screen.findByRole("button", { name: strings.eggReveal.dismiss });
    // Après le tirage, l'état serveur est re-lu (solde débité) : la carte œuf revient.
    stateMock.mockResolvedValue({ ok: true, eggPriceCoins: 50, coins: 70, shards: 0 });
    fireEvent.click(dismiss);
    await waitFor(() => expect(screen.getByRole("button", { name: /Ouvrir/ })).toBeInTheDocument());
    // La révélation a bien disparu.
    expect(
      screen.queryByRole("button", { name: strings.eggReveal.dismiss }),
    ).not.toBeInTheDocument();
  });

  it("pitié → bandeau de réassurance affiché (ECONOMY §7)", async () => {
    await renderReady();
    buyMock.mockResolvedValue({ ...NEW_RESULT, pityApplied: true });
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir/ }));
    await screen.findByRole("button", { name: strings.eggReveal.dismiss });
    expect(screen.getByText(strings.eggReveal.pity)).toBeInTheDocument();
  });

  it("solde insuffisant → indice DOUX sous le bouton, jamais bloquant (no-fail)", async () => {
    await renderReady();
    buyMock.mockResolvedValue({ ok: false, error: "BROKE" });
    stateMock.mockResolvedValue({ ok: true, eggPriceCoins: 50, coins: 10, shards: 0 });
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir/ }));
    await waitFor(() => expect(screen.getByText(strings.boutique.broke)).toBeInTheDocument());
    // Le bouton d'achat reste présent (jamais un écran de blocage).
    expect(screen.getByRole("button", { name: /Ouvrir/ })).toBeInTheDocument();
  });

  it("échec NON-BROKE (ex. REPLAY) → indice doux générique, jamais bloquant (branche non-broke)", async () => {
    await renderReady();
    buyMock.mockResolvedValue({ ok: false, error: "REPLAY" });
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir/ }));
    await waitFor(() => expect(screen.getByText(strings.boutique.loadError)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Ouvrir/ })).toBeInTheDocument();
  });
});

describe("BoutiqueScreen — a11y", () => {
  it("le bouton d'achat est une cible ≥ 44 px (token --tap-target-min)", async () => {
    await renderReady();
    const buy = screen.getByRole("button", { name: /Ouvrir/ });
    expect(buy.style.minHeight).toBe("var(--tap-target-min)");
  });

  it("l'art de la révélation est DÉCORATIF (le role=img parent porte le nom, pas de double annonce)", async () => {
    await renderReady();
    buyMock.mockResolvedValue(NEW_RESULT);
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir/ }));
    await screen.findByRole("button", { name: strings.eggReveal.dismiss });
    const art = document.querySelector('[data-asset="egg-reveal-art"]');
    // Décoratif : l'`<img>` porte alt="" (ignoré des lecteurs d'écran) — l'ancêtre role=img nomme.
    expect(art?.getAttribute("alt")).toBe("");
  });
});

// ============================================================================
// Contraste WCAG RÉSOLU (rétro #104/#125/#126) — TOUS les couples texte/fond de l'écran
// boutique + révélation, résolus depuis tokens.css (hex → ratio réel ≥ 4.5:1), sur les 2 thèmes.
// ============================================================================
describe("BoutiqueScreen — contraste WCAG résolu (tous les glyphes rendus)", () => {
  const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
    ["titre/beat sur la page", "--color-text-primary", "--color-bg-primary"],
    ["sous-titre sections (muted) sur la page", "--collection-text-muted", "--color-bg-primary"],
    ["nom de créature/œuf sur carte", "--collection-text", "--collection-card-bg"],
    ["beat/pitié/notice (muted) sur carte", "--collection-text-muted", "--collection-card-bg"],
    ["libellé du bouton d'achat sur accent", "--color-text-inverse", "--color-accent-primary"],
    ["lien retour sur fond tertiaire", "--color-text-primary", "--color-bg-tertiary"],
  ];

  it.each(["light", "dark"] as Theme[])("chaque couple texte/fond ≥ 4.5:1 (%s)", (theme) => {
    for (const [label, fgToken, bgToken] of PAIRS) {
      const fg = resolveTokenColor(theme, fgToken);
      const bg = resolveTokenColor(theme, bgToken);
      expect(contrastRatio(fg, bg), `${label} (${theme})`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
