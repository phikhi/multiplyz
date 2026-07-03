import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResultsScreen } from "./ResultsScreen";
import { strings } from "@/strings";
import type { StarCount } from "@/lib/engine/stars";

describe("ResultsScreen — jamais d'échec (ENGINE §5/§9)", () => {
  it("le titre reçoit le focus au montage (a11y, LEARNINGS #36)", () => {
    render(<ResultsScreen stars={2} onContinue={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 1, name: strings.play.results.title });
    expect(heading).toHaveFocus();
  });

  it("libellé a11y singulier à 1 étoile", () => {
    render(<ResultsScreen stars={1} onContinue={vi.fn()} />);
    expect(
      screen.getByRole("img", { name: strings.play.results.starsLabel.replace("{n}", "1") }),
    ).toBeInTheDocument();
  });

  // Test paramétré sur TOUTES les valeurs du domaine StarCount (LEARNINGS #59).
  it.each([0, 1, 2, 3] as StarCount[])(
    "affiche l'encouragement correspondant à %i étoile(s)",
    (stars) => {
      render(<ResultsScreen stars={stars} onContinue={vi.fn()} />);
      expect(screen.getByText(strings.play.results.byStars[stars])).toBeInTheDocument();
    },
  );

  it("libellé a11y pluriel à 0, 2 et 3 étoiles (jamais singulier hors n=1)", () => {
    for (const stars of [0, 2, 3] as StarCount[]) {
      const { unmount } = render(<ResultsScreen stars={stars} onContinue={vi.fn()} />);
      expect(
        screen.getByRole("img", {
          name: strings.play.results.starsLabelPlural.replace("{n}", String(stars)),
        }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("0 étoile reste un résultat normal, jamais un écran d'échec (no-fail)", () => {
    render(<ResultsScreen stars={0} onContinue={vi.fn()} />);
    expect(
      screen.getByRole("heading", { level: 1, name: strings.play.results.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.play.results.continue })).toBeInTheDocument();
  });

  it("clic sur continuer appelle onContinue", () => {
    const onContinue = vi.fn();
    render(<ResultsScreen stars={3} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: strings.play.results.continue }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
