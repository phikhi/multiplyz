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
 * vers une couleur faible-contraste rougirait ce test. (On ne teste PAS les étoiles ici : elles
 * étaient déjà rendues en #64 avec `--color-star`/`-empty`, doublées par `aria-label` + forme
 * ★/☆ — hors scope du changement 5.5 ; le nouveau glyphe introduit par 5.5 est le nombre de
 * pièces, qui utilise un token texte fiable, ce que ce test verrouille.)
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
