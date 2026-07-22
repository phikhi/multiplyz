import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CreatureDetailScreen, stageAccessibleLabel } from "./CreatureDetailScreen";
import { renameCharacterAction } from "@/app/(app)/collection/actions";
import { strings } from "@/strings";
import type { CollectionEntry } from "@/lib/game/collection";
import {
  contrastRatio,
  rawTokenValue,
  resolveTokenColor,
  themeBlock,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";

/**
 * Tests de la **fiche créature** (détail + histoire, story R3.2 #379, WIREFRAMES §5b).
 *
 * `RenameForm`/`RarityBadge` sont **réutilisés tels quels** de `CollectionScreen` (aucune
 * duplication de logique) — leur propre couverture vit dans `CollectionScreen.test.tsx` ; ici on
 * prouve le **câblage** (le formulaire persiste bien VIA cette fiche) + les glyphes/contrastes
 * **propres à cet écran** (#126 : auditer TOUT ce que CETTE PR rend, y compris via réutilisation).
 */

vi.mock("@/app/(app)/collection/actions", () => ({
  renameCharacterAction: vi.fn(),
}));

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
    maxStage: 1,
    count: 1,
    artRef: "placeholder://legendary/0",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreatureDetailScreen — affichage (WIREFRAMES §5b)", () => {
  it("affiche le nom (h1), la rareté et l'histoire ENTRE GUILLEMETS", () => {
    render(<CreatureDetailScreen entry={entry({ displayName: "Goupil", story: "Un renard." })} />);
    expect(screen.getByRole("heading", { level: 1, name: "Goupil" })).toBeInTheDocument();
    expect(screen.getByText(strings.collection.rarity.legendary)).toBeInTheDocument();
    // Guillemets français centralisés (`storyQuote`), jamais un texte en dur (#164).
    expect(screen.getByText("« Un renard. »")).toBeInTheDocument();
  });

  it("histoire vide (catalogue sans story) ⇒ aucune ligne d'histoire, mais l'écran s'affiche", () => {
    render(<CreatureDetailScreen entry={entry({ story: "" })} />);
    expect(screen.queryByText(/«/u)).not.toBeInTheDocument();
    expect(document.querySelector("[data-creature-story]")).toBeNull();
  });

  it("lien de retour vers la Collection (WIREFRAMES §5b ←)", () => {
    render(<CreatureDetailScreen entry={entry()} />);
    const link = screen.getByRole("link", { name: strings.creatureDetail.back });
    expect(link).toHaveAttribute("href", "/collection");
  });
});

/**
 * Art de créature EN GRAND (le payoff, #180 — note R3.1 « vignettes petites en collection, R3.2
 * fiche montre l'art en grand »). Même garde de sécurité partagée `<AssetImage>` que la grille
 * (réutilisée, jamais réinventée) — mais NON décoratif ici (aucun ancêtre labellé, `alt` consommé).
 */
describe("CreatureDetailScreen — art EN GRAND (#180, story R3.1 note « fiche montre l'art en grand »)", () => {
  const RENDERABLE_REF = "socle/creature/cloudfox.png";

  it("art_ref RENDABLE ⇒ VRAI <img> EN GRAND, alt = nom (consommé, pas décoratif)", () => {
    render(
      <CreatureDetailScreen entry={entry({ displayName: "Nuagou", artRef: RENDERABLE_REF })} />,
    );
    const art = document.querySelector<HTMLImageElement>('[data-asset="creature-detail-art"]');
    expect(art?.tagName).toBe("IMG");
    expect(art).toHaveAttribute("src", "/generated/socle/creature/cloudfox.png");
    expect(art).toHaveAttribute("data-asset-state", "rendered");
    expect(art).toHaveAttribute("alt", "Nuagou");
    expect(art?.style.width).toBe("var(--creature-detail-art-size)");
    expect(document.querySelector("[data-creature-detail-placeholder]")).toBeNull();
  });

  it("art_ref placeholder:// (état par défaut) ⇒ silhouette de repli EN GRAND, JAMAIS d'<img>", () => {
    render(<CreatureDetailScreen entry={entry({ artRef: "placeholder://legendary/0" })} />);
    const fallback = document.querySelector<HTMLElement>('[data-asset="creature-detail-art"]');
    expect(fallback?.tagName).toBe("SPAN");
    expect(fallback).toHaveAttribute("data-asset-state", "fallback");
    expect(fallback).toHaveAttribute("aria-label", "Braisille"); // alt consommé (non décoratif)
    expect(document.querySelector("[data-creature-detail-placeholder]")).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("le token --creature-detail-art-size existe et est nettement plus grand que la vignette collection (--collection-placeholder-size)", () => {
    const detailSize = rawTokenValue(themeBlock("light"), "--creature-detail-art-size");
    const collectionSize = rawTokenValue(themeBlock("light"), "--collection-placeholder-size");
    expect(detailSize).toBe("var(--space-10)");
    // --space-10 (128px) > --space-7 (48px) : l'art de la fiche est le payoff EN GRAND.
    expect(detailSize).not.toBe(collectionSize);
  });
});

describe("CreatureDetailScreen — stade d'évolution (affichage seul, ECONOMY §4.4 — dépense = R4.4)", () => {
  // ▶▶ MUTATION-PROUVÉ : borne EXACTE du stade actuel (crochets) vs hors de portée (suffixe) ◀◀.
  it.each([
    // [stage, maxStage, attendu]
    [1, 1, "Stade : bébé (actuel), ado (pas encore), adulte (pas encore)"],
    [2, 3, "Stade : bébé, ado (actuel), adulte"],
    [1, 2, "Stade : bébé (actuel), ado, adulte (pas encore)"],
  ] as const)(
    "stageAccessibleLabel(%i, %i) compose la sentence exacte",
    (stage, maxStage, expected) => {
      expect(stageAccessibleLabel(stage, maxStage)).toBe(expected);
    },
  );

  it("rend le bloc stade avec l'aria-label composé (sentence complète, pas une annonce fragmentée)", () => {
    render(<CreatureDetailScreen entry={entry({ stage: 1, maxStage: 1 })} />);
    const stage = document.querySelector("[data-creature-stage]");
    expect(stage).toHaveAttribute("aria-label", stageAccessibleLabel(1, 1));
  });

  it("stade ACTUEL entre CROCHETS (doublage visuel a11y, WIREFRAMES §5b « [ado] »)", () => {
    render(<CreatureDetailScreen entry={entry({ stage: 2, maxStage: 3 })} />);
    const pip2 = document.querySelector('[data-creature-stage-pip="2"]');
    expect(pip2?.textContent).toContain("[ado]");
  });

  it("stade HORS DE PORTÉE (> maxStage) porte le glyphe 🔒 + suffixe visible « (pas encore) »", () => {
    render(<CreatureDetailScreen entry={entry({ stage: 1, maxStage: 1 })} />);
    const pip2 = document.querySelector('[data-creature-stage-pip="2"]');
    const pip3 = document.querySelector('[data-creature-stage-pip="3"]');
    expect(pip2?.textContent).toContain("🔒");
    expect(pip2?.textContent).toContain(`ado (${strings.creatureDetail.stageLockedSuffix})`);
    expect(pip3?.textContent).toContain("🔒");
  });

  it("stade ATTEINT mais pas actuel (≤ stage) ⇒ glyphe ● plein, label SEUL (jamais de crochets)", () => {
    render(<CreatureDetailScreen entry={entry({ stage: 2, maxStage: 3 })} />);
    const pip1 = document.querySelector('[data-creature-stage-pip="1"]');
    expect(pip1?.textContent).toContain("●");
    expect(pip1?.textContent).toContain("bébé");
    expect(pip1?.textContent).not.toContain("[bébé]");
  });

  it("stade FUTUR atteignable (> stage, ≤ maxStage) ⇒ glyphe ○ creux, jamais verrouillé", () => {
    render(<CreatureDetailScreen entry={entry({ stage: 1, maxStage: 3 })} />);
    const pip3 = document.querySelector('[data-creature-stage-pip="3"]');
    expect(pip3?.textContent).toContain("○");
    expect(pip3?.textContent).not.toContain("🔒");
    expect(pip3?.textContent).not.toContain(strings.creatureDetail.stageLockedSuffix);
  });

  it("aucun bouton « Faire évoluer » / dépense d'éclats (R4.4 hors scope — omis, jamais posé cassé)", () => {
    render(<CreatureDetailScreen entry={entry()} />);
    expect(screen.queryByRole("button", { name: /évoluer/iu })).not.toBeInTheDocument();
    expect(screen.queryByText(/✨\s*40/u)).not.toBeInTheDocument();
  });
});

describe("CreatureDetailScreen — renommage (réutilise RenameForm de CollectionScreen, PRODUCT §2.3)", () => {
  it("ouvre le formulaire, renomme et persiste (affichage mis à jour, h1)", async () => {
    render(<CreatureDetailScreen entry={entry({ displayName: "Braisille" })} />);
    renameActionMock.mockResolvedValue({ ok: true, nickname: "Flamme", error: null });

    fireEvent.click(screen.getByRole("button", { name: `✏️ ${strings.collection.rename}` }));
    const input = screen.getByLabelText(strings.collection.renameLabel);
    fireEvent.change(input, { target: { value: "Flamme" } });
    fireEvent.click(screen.getByRole("button", { name: strings.collection.renameSubmit }));

    await waitFor(() => expect(renameActionMock).toHaveBeenCalledWith("legendary:0", "Flamme"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Flamme" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { level: 1, name: "Braisille" })).not.toBeInTheDocument();
  });

  it("annuler ferme le formulaire sans renommer", async () => {
    render(<CreatureDetailScreen entry={entry({ displayName: "Braisille" })} />);
    fireEvent.click(screen.getByRole("button", { name: `✏️ ${strings.collection.rename}` }));
    fireEvent.click(screen.getByRole("button", { name: strings.collection.renameCancel }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: `✏️ ${strings.collection.rename}` }),
      ).toBeInTheDocument(),
    );
    expect(renameActionMock).not.toHaveBeenCalled();
  });

  it("échec de renommage ⇒ message d'erreur doux, nom inchangé", async () => {
    render(<CreatureDetailScreen entry={entry({ displayName: "Braisille" })} />);
    renameActionMock.mockResolvedValue({ ok: false, nickname: null, error: "INVALID_NAME" });

    fireEvent.click(screen.getByRole("button", { name: `✏️ ${strings.collection.rename}` }));
    fireEvent.change(screen.getByLabelText(strings.collection.renameLabel), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: strings.collection.renameSubmit }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(strings.collection.renameError),
    );
    expect(screen.getByRole("heading", { level: 1, name: "Braisille" })).toBeInTheDocument();
  });
});

/**
 * Contraste WCAG **résolu** de chaque glyphe/texte rendu sur la fiche (rétro #104/#125/#126) — la
 * fiche RÉUTILISE des tokens déjà prouvés ≥4.5:1 par `CollectionScreen.test.tsx` (même carte,
 * même fond), mais #126 exige un audit PAR ÉCRAN qui touche ces glyphes, pas seulement une fois
 * par famille de tokens.
 */
describe("CreatureDetailScreen — contraste WCAG résolu des glyphes rendus (#104/#125/#126)", () => {
  it.each(["light", "dark"] as Theme[])(
    "%s : le nom (h1, --collection-text) ≥ 4.5:1 sur le fond de carte (--collection-card-bg)",
    (theme) => {
      const text = resolveTokenColor(theme, "--collection-text");
      const bg = resolveTokenColor(theme, "--collection-card-bg");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : l'histoire (--collection-text-muted) ≥ 4.5:1 sur le fond de carte",
    (theme) => {
      const text = resolveTokenColor(theme, "--collection-text-muted");
      const bg = resolveTokenColor(theme, "--collection-card-bg");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : le glyphe/label de rareté (--collection-rarity-glyph, RarityBadge réutilisé) ≥ 4.5:1 sur le fond de carte",
    (theme) => {
      const glyph = resolveTokenColor(theme, "--collection-rarity-glyph");
      const bg = resolveTokenColor(theme, "--collection-card-bg");
      expect(contrastRatio(glyph, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : le lien retour (--collection-text) ≥ 4.5:1 sur le fond de PAGE (--color-bg-primary)",
    (theme) => {
      const text = resolveTokenColor(theme, "--collection-text");
      const bg = resolveTokenColor(theme, "--color-bg-primary");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : le bouton « Renommer » (--collection-text) ≥ 4.5:1 sur son fond (--color-bg-tertiary)",
    (theme) => {
      const text = resolveTokenColor(theme, "--collection-text");
      const bg = resolveTokenColor(theme, "--color-bg-tertiary");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : les pips de stade ATTEINTS/ACTUEL (--collection-text) ≥ 4.5:1 sur le fond de carte",
    (theme) => {
      const text = resolveTokenColor(theme, "--collection-text");
      const bg = resolveTokenColor(theme, "--collection-card-bg");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : les pips de stade VERROUILLÉS (--collection-text-muted) ≥ 4.5:1 sur le fond de carte",
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
});

/**
 * Audit build (#126 « une story qui TOUCHE/CRÉE un écran audite TOUS ses glyphes rendus »,
 * étendu #170/#190 occlusion et #226 opacité diluante) — AUCUN élément de cette fiche n'est
 * superposé/positionné (`position` reste `static`, flux normal en colonne) ni sous une
 * `opacity` diluante. Ce test le PROUVE plutôt que de l'affirmer en commentaire (#164) : il
 * ROUGIT si un futur changement pose `position:absolute` ou une `opacity` diluante ici sans
 * ajouter la garde de non-occlusion/contraste-composité correspondante.
 */
describe("CreatureDetailScreen — audit build #126 : zéro occlusion/opacité sur les glyphes rendus (#170/#190/#226)", () => {
  function auditedElements(): HTMLElement[] {
    const selectors = [
      "[data-creature-card]",
      "[data-creature-name]",
      "[data-creature-story]",
      "[data-creature-stage]",
      '[data-creature-stage-pip="1"]',
      '[data-creature-stage-pip="2"]',
      '[data-creature-stage-pip="3"]',
    ];
    const els = selectors
      .map((sel) => document.querySelector<HTMLElement>(sel))
      .filter((el): el is HTMLElement => el !== null);
    // Chaque sélecteur nommé DOIT exister — sinon l'audit serait vacuous (boucle vide).
    expect(els).toHaveLength(selectors.length);
    return els;
  }

  it("tous les éléments audités restent en flux normal (position statique, jamais superposés)", () => {
    render(
      <CreatureDetailScreen entry={entry({ story: "Une histoire.", stage: 1, maxStage: 3 })} />,
    );
    for (const el of auditedElements()) {
      expect(["", "static"]).toContain(el.style.position);
    }
  });

  it("aucun élément audité ne porte une opacity diluante", () => {
    render(
      <CreatureDetailScreen entry={entry({ story: "Une histoire.", stage: 1, maxStage: 3 })} />,
    );
    for (const el of auditedElements()) {
      expect(["", "1"]).toContain(el.style.opacity);
    }
  });
});
