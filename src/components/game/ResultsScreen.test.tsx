import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResultsScreen } from "./ResultsScreen";
import { strings } from "@/strings";
import type { StarCount } from "@/lib/engine/stars";
import { contrastRatio, resolveTokenColor, type Theme } from "./scaffolds/test-support/tokens-css";

describe("ResultsScreen — jamais d'échec (ENGINE §5/§9)", () => {
  it("le titre reçoit le focus au montage (a11y, LEARNINGS #36)", () => {
    render(<ResultsScreen stars={2} coins={20} onContinue={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 1, name: strings.play.results.title });
    expect(heading).toHaveFocus();
  });

  it("libellé a11y singulier à 1 étoile", () => {
    render(<ResultsScreen stars={1} coins={15} onContinue={vi.fn()} />);
    expect(
      screen.getByRole("img", { name: strings.play.results.starsLabel.replace("{n}", "1") }),
    ).toBeInTheDocument();
  });

  // Test paramétré sur TOUTES les valeurs du domaine StarCount (LEARNINGS #59).
  it.each([0, 1, 2, 3] as StarCount[])(
    "affiche l'encouragement correspondant à %i étoile(s)",
    (stars) => {
      render(<ResultsScreen stars={stars} coins={10} onContinue={vi.fn()} />);
      expect(screen.getByText(strings.play.results.byStars[stars])).toBeInTheDocument();
    },
  );

  it("libellé a11y pluriel à 0, 2 et 3 étoiles (jamais singulier hors n=1)", () => {
    for (const stars of [0, 2, 3] as StarCount[]) {
      const { unmount } = render(<ResultsScreen stars={stars} coins={10} onContinue={vi.fn()} />);
      expect(
        screen.getByRole("img", {
          name: strings.play.results.starsLabelPlural.replace("{n}", String(stars)),
        }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("0 étoile reste un résultat normal, jamais un écran d'échec (no-fail)", () => {
    render(<ResultsScreen stars={0} coins={10} onContinue={vi.fn()} />);
    expect(
      screen.getByRole("heading", { level: 1, name: strings.play.results.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.play.results.continue })).toBeInTheDocument();
  });

  it("clic sur continuer appelle onContinue", () => {
    const onContinue = vi.fn();
    render(<ResultsScreen stars={3} coins={25} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: strings.play.results.continue }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe("ResultsScreen — pièces gagnées (ECONOMY §4.1, story #126)", () => {
  // GARDE « pièces affichées + doublées d'un libellé texte » (a11y daltonisme) : le nombre de
  // pièces est visible ET porté par un nom accessible (`role="img"`), jamais la seule icône 🪙.
  it("affiche les pièces gagnées avec un libellé accessible (pluriel)", () => {
    render(<ResultsScreen stars={2} coins={20} onContinue={vi.fn()} />);
    const label = strings.play.results.coinsPlural.replace("{n}", "20");
    const node = screen.getByRole("img", { name: label });
    expect(node).toBeInTheDocument();
    // Nombre visible en texte (doublage a11y, pas la seule icône).
    expect(node).toHaveTextContent("20");
  });

  it("singulier à 1 pièce (accord)", () => {
    render(<ResultsScreen stars={0} coins={1} onContinue={vi.fn()} />);
    const label = strings.play.results.coins.replace("{n}", "1");
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });

  // GARDE « coins === null ⇒ ligne pièces ABSENTE » (no-fail : les résultats s'affichent sans
  // les pièces si le serveur n'a pas encore répondu / a échoué). Effet observable : la ligne
  // pièces n'existe pas, mais le reste (titre, étoiles, encouragement, bouton) est là.
  it("coins=null (pas encore reçu / erreur réseau) ⇒ AUCUNE ligne de pièces, mais résultats affichés", () => {
    render(<ResultsScreen stars={2} coins={null} onContinue={vi.fn()} />);
    // Aucune ligne de pièces (ni singulier ni pluriel).
    expect(screen.queryByText(/pièce/u)).not.toBeInTheDocument();
    // Les résultats restent affichés (no-fail).
    expect(
      screen.getByRole("heading", { level: 1, name: strings.play.results.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(strings.play.results.byStars[2])).toBeInTheDocument();
  });

  // GARDE « 0 pièce reste affichée » (barème nul extrême) : coins=0 n'est PAS null → la ligne
  // s'affiche (pluriel « 0 pièces »). Distingue le cas "pas de gain" (0, affiché) du cas "pas
  // encore reçu" (null, masqué).
  it("coins=0 (barème nul) ⇒ ligne affichée « 0 pièces » (0 ≠ null)", () => {
    render(<ResultsScreen stars={0} coins={0} onContinue={vi.fn()} />);
    const label = strings.play.results.coinsPlural.replace("{n}", "0");
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });
});

/**
 * Contraste WCAG **résolu** du nombre de pièces (rétro #104/#125) : le texte des pièces est
 * un **glyphe/chiffre rendu distinct** sur le fond de page neutre (`--color-bg-primary`) — la
 * règle « ≥1 test de contraste par glyphe rendu » l'exige. On résout `tokens.css` (var() → hex)
 * et on vérifie ≥ 4.5:1 dans les 2 thèmes. Effet observable : remapper `--color-text-primary`
 * vers une couleur faible-contraste rougirait ce test.
 */
describe("ResultsScreen — contraste WCAG résolu du nombre de pièces (rétro #104/#125)", () => {
  it.each(["light", "dark"] as Theme[])(
    "%s : le texte des pièces (--color-text-primary) ≥ 4.5:1 sur le fond de page (--color-bg-primary)",
    (theme) => {
      const text = resolveTokenColor(theme, "--color-text-primary");
      const bg = resolveTokenColor(theme, "--color-bg-primary");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

/**
 * Contraste WCAG **résolu** des étoiles (rétro #104/#125) : les étoiles rendues en #64 avec
 * `--color-star`/`--color-star-empty` échouaient le contraste sur le fond de page neutre
 * `--color-bg-primary` (~1.45:1 plein / ~1.21:1 vide — accents décoratifs, pas des couleurs
 * de glyphe fiables). Fix 5.5 : `--results-star-filled`/`--results-star-empty` (tokens texte
 * fiables, mêmes valeurs que `--map-node-star-*`). Chaque glyphe distinct (plein ★ / vide ☆)
 * a son propre test (rétro #125 : deux glyphes différents = deux tests), sur le fond
 * réellement empilé derrière les `<span>` étoiles (`--color-bg-primary`, aucun wrapper
 * intermédiaire ne pose un autre fond dans ResultsScreen). Effet observable : remapper l'un
 * ou l'autre token vers `--color-star`/`--color-star-empty` rougirait le test correspondant.
 */
describe("ResultsScreen — contraste WCAG résolu des étoiles (rétro #104/#125)", () => {
  it.each(["light", "dark"] as Theme[])(
    "%s : l'étoile pleine (--results-star-filled) ≥ 4.5:1 sur le fond de page (--color-bg-primary)",
    (theme) => {
      const star = resolveTokenColor(theme, "--results-star-filled");
      const bg = resolveTokenColor(theme, "--color-bg-primary");
      expect(contrastRatio(star, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : l'étoile vide (--results-star-empty) ≥ 4.5:1 sur le fond de page (--color-bg-primary)",
    (theme) => {
      const star = resolveTokenColor(theme, "--results-star-empty");
      const bg = resolveTokenColor(theme, "--color-bg-primary");
      expect(contrastRatio(star, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

const FAKE_LEGENDARY = {
  characterId: "legendary:0",
  name: "Braisille",
  story: "La gardienne légendaire de ce monde.",
  artRef: "placeholder://legendary/0",
};

describe("ResultsScreen — révélation de la légendaire du boss (story 5.6, MAP §6)", () => {
  // GARDE « boss ⇒ légendaire révélée » (a11y : nom accessible doublé du texte, jamais la seule
  // icône/couleur) : la carte légendaire s'affiche avec un `role="img"` nommé + le nom visible.
  it("boss ⇒ affiche la carte de la légendaire (nom accessible + nom visible + histoire)", () => {
    render(<ResultsScreen stars={1} coins={60} legendary={FAKE_LEGENDARY} onContinue={vi.fn()} />);
    const label = strings.play.results.legendaryLabel.replace("{nom}", "Braisille");
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
    expect(screen.getByText("Braisille")).toBeInTheDocument();
    expect(screen.getByText(FAKE_LEGENDARY.story)).toBeInTheDocument();
  });

  // GARDE « niveau non-boss ⇒ AUCUNE légendaire » (contraste, effet observable) : sans légendaire,
  // aucune carte n'est rendue.
  it("niveau non-boss (legendary null par défaut) ⇒ AUCUNE carte légendaire", () => {
    render(<ResultsScreen stars={2} coins={20} onContinue={vi.fn()} />);
    expect(screen.queryByText(strings.play.results.legendaryTitle)).not.toBeInTheDocument();
  });

  it("légendaire sans histoire ⇒ carte affichée sans ligne d'histoire", () => {
    render(
      <ResultsScreen
        stars={1}
        coins={60}
        legendary={{ ...FAKE_LEGENDARY, story: "" }}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByText("Braisille")).toBeInTheDocument();
    expect(screen.queryByText(FAKE_LEGENDARY.story)).not.toBeInTheDocument();
  });
});

/**
 * Contraste WCAG **résolu** des glyphes de la carte légendaire (rétro #104/#125/#126) : nom,
 * rareté (★ + texte), histoire, silhouette placeholder — chacun sur le fond de carte réellement
 * empilé (`--collection-card-bg`) ou son fond propre. Le ★ de rareté utilise
 * `--collection-rarity-glyph` (token TEXTE fiable), jamais `--color-star` sur fond neutre (le
 * piège exact de #126). Effet observable : remapper un token vers un accent faible-contraste
 * rougirait le test.
 */
describe("ResultsScreen — contraste WCAG résolu de la carte légendaire (rétro #104/#125/#126)", () => {
  it.each(["light", "dark"] as Theme[])(
    "%s : le nom de la légendaire (--collection-text) ≥ 4.5:1 sur le fond de carte",
    (theme) => {
      const text = resolveTokenColor(theme, "--collection-text");
      const bg = resolveTokenColor(theme, "--collection-card-bg");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : le ★ + titre de rareté (--collection-rarity-glyph) ≥ 4.5:1 sur le fond de carte (jamais --color-star)",
    (theme) => {
      const glyph = resolveTokenColor(theme, "--collection-rarity-glyph");
      const bg = resolveTokenColor(theme, "--collection-card-bg");
      expect(contrastRatio(glyph, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : l'histoire de la légendaire (--collection-text-muted) ≥ 4.5:1 sur le fond de carte",
    (theme) => {
      const text = resolveTokenColor(theme, "--collection-text-muted");
      const bg = resolveTokenColor(theme, "--collection-card-bg");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as Theme[])(
    "%s : la silhouette placeholder (--collection-placeholder-glyph) ≥ 4.5:1 sur son fond",
    (theme) => {
      const glyph = resolveTokenColor(theme, "--collection-placeholder-glyph");
      const bg = resolveTokenColor(theme, "--collection-placeholder-bg");
      expect(contrastRatio(glyph, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
