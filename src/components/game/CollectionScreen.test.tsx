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
    // Compteur « 0 créature » — SINGULIER (règle FR n<=1 : 0 ET 1 prennent le singulier, jamais
    // le pluriel figé « 0 créatures » — story #273/rétro #239).
    expect(screen.getByText(strings.collection.count.replace("{n}", "0"))).toBeInTheDocument();
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

  /**
   * GARDE mutation-preuve (story #273, rétro #239) : forme EXACTE du compteur pour n=0/1/2.
   * `countLabel` doit choisir le gabarit sur la borne `n <= 1` — si elle régresse à `n === 1`
   * (le bug source de #273), le cas n=0 rendrait `strings.collection.countPlural` (« 0
   * créature**s** ») au lieu de `strings.collection.count` (« 0 créature ») : l'assertion n=0
   * ci-dessous est la seule des trois qui DISTINGUE les deux bornes (n=1 et n=2 donnent le même
   * résultat sous les deux bornes) → elle ROUGIT si la borne régresse à `n === 1`.
   */
  it("compteur singulier/pluriel selon le nombre de créatures (n=0/1/2, borne n<=1→singulier)", async () => {
    const { unmount: unmount0 } = await renderReady([]);
    expect(screen.getByText(strings.collection.count.replace("{n}", "0"))).toBeInTheDocument();
    unmount0();

    const { unmount: unmount1 } = await renderReady([entry()]);
    expect(screen.getByText(strings.collection.count.replace("{n}", "1"))).toBeInTheDocument();
    unmount1();

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
 * Consommation de `entry.artRef` via le renderer guardé partagé `<AssetImage>` (story R2.1, #361) :
 * un `art_ref` **rendable** (`socle/creature/…`) rend le VRAI art de la créature (`<img>`), un
 * `placeholder://…` (état par défaut, set complet = R3.1) retombe sur le placeholder emoji. La
 * garde de sécurité (`isRenderableAssetRef`) reste portée par `<AssetImage>` (réutilisée, jamais
 * réinventée). L'art est **décoratif** (la carte `<li aria-label>` porte déjà le nom accessible).
 */
describe("CollectionScreen — art de créature consommé depuis artRef (story R2.1, #361)", () => {
  const RENDERABLE_REF = "socle/creature/cloudfox.png";

  // ▶▶ MUTATION-PROUVÉ : renderable → VRAI <img> (chemin format-réel #189) ◀◀. Ce test ROUGIT si la
  // carte cessait de consommer `entry.artRef` (retour au placeholder en dur) OU si la garde
  // `isRenderableAssetRef` de `<AssetImage>` sautait (le src deviendrait le ref brut / un fetch
  // non validé). Effet observable distinct : la présence de l'<img> à la src publique validée.
  it("art_ref RENDABLE ⇒ rend le VRAI art de la créature (<img> à la src publique validée)", async () => {
    await renderReady([entry({ displayName: "Nuagou", artRef: RENDERABLE_REF })]);
    const art = document.querySelector<HTMLImageElement>('[data-asset="collection-creature"]');
    expect(art?.tagName).toBe("IMG");
    expect(art).toHaveAttribute("src", "/generated/socle/creature/cloudfox.png");
    expect(art).toHaveAttribute("data-asset-state", "rendered");
    // Le vrai art REMPLACE le placeholder emoji pour cette carte (plus de silhouette de repli).
    expect(document.querySelector("[data-collection-placeholder]")).toBeNull();
    // Le nom reste porté par la carte `<li aria-label>` (art décoratif, pas de double annonce).
    const label = strings.collection.cardLabel
      .replace("{nom}", "Nuagou")
      .replace("{rareté}", strings.collection.rarity.legendary);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  // ▶▶ MUTATION-PROUVÉ : placeholder:// → repli emoji, JAMAIS d'<img> ◀◀. Ce test ROUGIT si la garde
  // `isRenderableAssetRef` sautait (un `<img src="placeholder://…">` fetché apparaîtrait, le
  // placeholder disparaîtrait). C'est l'état observable AUJOURD'HUI pour les créatures sans art réel.
  it("art_ref placeholder:// (état par défaut) ⇒ placeholder emoji, JAMAIS d'<img>", async () => {
    await renderReady([entry({ artRef: "placeholder://legendary/0" })]);
    const fallback = document.querySelector<HTMLElement>('[data-asset="collection-creature"]');
    expect(fallback?.tagName).toBe("SPAN");
    expect(fallback).toHaveAttribute("data-asset-state", "fallback");
    // La silhouette placeholder emoji est rendue, aucun <img> fetché vers le placeholder.
    expect(document.querySelector("[data-collection-placeholder]")).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  // Mélange réaliste (l'état R2.1) : UNE créature en vrai art, les autres en placeholder — l'écran
  // rend un <img> réel ET des placeholders côte à côte (aucune régression de la grille).
  it("collection mixte : 1 art réel + 1 placeholder ⇒ un <img> réel ET un placeholder", async () => {
    await renderReady([
      entry({ characterId: "real", displayName: "Nuagou", artRef: RENDERABLE_REF }),
      entry({ characterId: "ph", displayName: "Braisille", artRef: "placeholder://legendary/1" }),
    ]);
    const arts = [...document.querySelectorAll<HTMLElement>('[data-asset="collection-creature"]')];
    expect(arts).toHaveLength(2);
    const rendered = arts.filter((a) => a.getAttribute("data-asset-state") === "rendered");
    const fallbacks = arts.filter((a) => a.getAttribute("data-asset-state") === "fallback");
    expect(rendered).toHaveLength(1);
    expect(fallbacks).toHaveLength(1);
    expect(rendered[0].tagName).toBe("IMG");
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

/**
 * Lisibilité de la description en grille 3-col à 375px (issue #272, playtest-⚙️ confirmé
 * propriétaire — cartes ~105px, `--font-size-sm` cassait « Douce comme une feuille. » sur 3
 * lignes). Fix à DEUX leviers, chacun garanti par un token ⚙️ consommé (jamais une valeur en
 * dur) — même patron que `--collection-grid-columns` ci-dessus :
 * 1. `--collection-card-description-font-size` = `--font-size-base` (16px, un cran au-dessus
 *    de `--font-size-sm`/14px, hors zone « texte minuscule ») ;
 * 2. `--collection-card-description-line-clamp` = 2 (troncature propre ellipsis, jamais un mur
 *    de 3+ lignes fragmentées).
 * **3 colonnes PRÉSERVÉES** (WIREFRAMES §8, fidélité layout — cf. describe ci-dessus, token
 * `--collection-grid-columns` intouché par cette story).
 */
describe("CollectionScreen — lisibilité de la description (issue #272, playtest-⚙️)", () => {
  it("le token --collection-card-description-font-size vaut var(--font-size-base) (un cran au-dessus de --font-size-sm)", () => {
    const value = rawTokenValue(themeBlock("light"), "--collection-card-description-font-size");
    expect(value).toBe("var(--font-size-base)");
  });

  it("le token --collection-card-description-line-clamp vaut exactement 2 (troncature propre, pas un mur de 3+ lignes)", () => {
    const value = rawTokenValue(themeBlock("light"), "--collection-card-description-line-clamp");
    expect(value).toBe("2");
  });

  it("la description rendue consomme le token de taille de police (pas --font-size-sm en dur)", async () => {
    await renderReady([entry({ story: "Une histoire suffisamment longue pour tester." })]);
    const story = document.querySelector<HTMLElement>("[data-collection-story]");
    expect(story).not.toBeNull();
    expect(story?.style.fontSize).toBe("var(--collection-card-description-font-size)");
    // Garde anti-régression explicite : ne DOIT PAS revenir à l'ancien token direct (qui
    // contournerait le point de calibration ⚙️ playtest de cette story).
    expect(story?.style.fontSize).not.toBe("var(--font-size-sm)");
  });

  it("la description rendue consomme le token de troncature (line-clamp 2 lignes, ellipsis, jamais un mur de texte)", async () => {
    await renderReady([entry({ story: "Une histoire suffisamment longue pour tester." })]);
    const story = document.querySelector<HTMLElement>("[data-collection-story]");
    expect(story).not.toBeNull();
    // Le nombre de lignes est piloté par le token (rougit si la troncature est retirée OU si
    // un futur agent fige "2" en dur au lieu de consommer le token, #127-class).
    expect(story?.style.webkitLineClamp).toBe("var(--collection-card-description-line-clamp)");
    expect(story?.style.display).toBe("-webkit-box");
    expect(story?.style.overflow).toBe("hidden");
    expect(story?.style.textOverflow).toBe("ellipsis");
    // `-webkit-box-orient` (requis par la technique line-clamp classique, un VRAI navigateur
    // l'applique) n'est PAS assertable ici : le `cssstyle` de jsdom ne reconnaît pas cette
    // propriété legacy (`el.style.webkitBoxOrient` reste `undefined`, `cssText` la rejette
    // silencieusement — vérifié empiriquement, pas une supposition). L'effet RÉEL (clamp actif
    // + `-webkit-box-orient` appliqué) est prouvé en vrai navigateur par la garde E2E dédiée
    // (`e2e/auth.spec.ts`, section « Lisibilité de la description » : `getComputedStyle`
    // résout `-webkit-line-clamp` à "2" ET `scrollHeight > clientHeight` sur une histoire
    // longue — jsdom ne fait aucun layout, cf. CLAUDE.md #170).
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

  // #126 : la story 8.2b TOUCHE cet écran → auditer TOUS ses glyphes/textes rendus, pas seulement
  // ceux de la carte de créature. Les 3 assertions ci-dessous couvrent le libellé du bouton
  // « Renommer » (sur --color-bg-tertiary, un fond que la suite n'exerçait pas), le CTA « Retour à
  // la carte » et le titre h1 — tous en flux normal, plein-alpha (aucune opacity d'ancêtre, prouvé
  // par le bloc d'audit #226 ci-dessus) → le contraste résolu sur le fond réel suffit (pas de
  // paintedContrast requis, cf. #226).
  it.each(["light", "dark"] as Theme[])(
    "%s : le libellé du bouton « Renommer » (--collection-text) ≥ 4.5:1 sur son fond (--color-bg-tertiary)",
    (theme) => {
      const text = resolveTokenColor(theme, "--collection-text");
      const bg = resolveTokenColor(theme, "--color-bg-tertiary");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : le CTA « Retour à la carte » (--color-text-inverse) ≥ 4.5:1 sur son fond accent plein (--color-accent-primary)",
    (theme) => {
      // CTA sur fond ACCENT PLEIN → --color-text-inverse est ici légitime (règle a11y CLAUDE.md :
      // text-inverse réservé à un fond accent plein, jamais un fond neutre).
      const text = resolveTokenColor(theme, "--color-text-inverse");
      const bg = resolveTokenColor(theme, "--color-accent-primary");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : le titre h1 (--color-text-primary) ≥ 4.5:1 sur le fond de PAGE (--color-bg-primary)",
    (theme) => {
      const text = resolveTokenColor(theme, "--color-text-primary");
      const bg = resolveTokenColor(theme, "--color-bg-primary");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

/**
 * Audit build (rétro #126 : « une story qui TOUCHE un écran audite TOUS ses glyphes rendus »,
 * étendu #170/#190 occlusion et #226 opacité diluante) — story 8.2b (#266) touche cet écran pour
 * le reflow responsive. Aucun glyphe/carte de cet écran n'est superposé/positionné (`position`
 * reste `static`, flux normal en colonne) ni sous une `opacity` diluante — donc AUCUNE garde de
 * non-occlusion `boundingClientRect` ni de contraste composité `paintedContrast` n'est nécessaire
 * ICI (contrairement à `MapScreen`/`QuestionCard`, qui EN ONT). Ce test le PROUVE (au lieu de
 * l'affirmer en commentaire, #164) : il ROUGIT si un futur changement pose `position:absolute`
 * ou une `opacity` diluante sur l'un de ces éléments sans ajouter la garde correspondante.
 */
describe("CollectionScreen — audit build #126 : zéro occlusion/opacité sur les glyphes rendus (#170/#190/#226)", () => {
  /**
   * Récupère les 6 éléments rendus de l'écran que l'audit doit couvrir (carte + les 5 glyphes/
   * textes qu'elle porte : nom, rareté, histoire, placeholder, compteur). Chacun a un `data-*`
   * dédié (jamais un query par texte, fragile à la copie) → l'audit couvre RÉELLEMENT ce que son
   * titre énumère (#164 : pas d'over-claim comment↔code). Fixture avec `story` non vide ⇒ le `<p>`
   * d'histoire EST rendu (sinon `data-collection-story` serait absent — le `not.toBeNull` rougirait).
   */
  async function renderAndCollectAuditedElements() {
    await renderReady([entry({ story: "Une histoire." })]);
    const audited = {
      card: document.querySelector<HTMLElement>("[data-collection-card]"),
      name: document.querySelector<HTMLElement>("[data-collection-name]"),
      rarityBadge: document.querySelector<HTMLElement>("[data-collection-rarity]"),
      story: document.querySelector<HTMLElement>("[data-collection-story]"),
      placeholder: document.querySelector<HTMLElement>("[data-collection-placeholder]"),
      count: document.querySelector<HTMLElement>("[data-collection-count]"),
    };
    // Chaque élément que le titre nomme DOIT exister — sinon l'audit serait vacuous (boucle vide).
    for (const [key, el] of Object.entries(audited)) {
      expect(el, `élément audité manquant : ${key}`).not.toBeNull();
    }
    return audited as { [K in keyof typeof audited]: HTMLElement };
  }

  it("carte + nom/rareté/histoire/placeholder/compteur restent en flux normal (position statique, jamais superposés)", async () => {
    const a = await renderAndCollectAuditedElements();
    for (const el of [a.card, a.name, a.rarityBadge, a.story, a.placeholder, a.count]) {
      // "" = valeur inline par défaut (jsdom résout la CASCADE, pas le layout — suffisant ici :
      // aucune règle CSS externe ne pose `position` sur ces éléments, seul le style inline compte).
      expect(["", "static"]).toContain(el.style.position);
    }
  });

  it("aucun texte/glyphe ne porte une opacity diluante (carte/nom/rareté/histoire/placeholder/compteur)", async () => {
    const a = await renderAndCollectAuditedElements();
    // Rejet de TOUTE opacité diluante (#260 : jamais une valeur interdite unique) : seule
    // pleine-opacité ("" hérité, ou "1" explicite) est acceptée sur un élément texte.
    for (const el of [a.card, a.name, a.rarityBadge, a.story, a.placeholder, a.count]) {
      expect(["", "1"]).toContain(el.style.opacity);
    }
  });
});
