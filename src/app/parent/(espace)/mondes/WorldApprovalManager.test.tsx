import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { strings } from "@/strings";
import {
  contrastRatio,
  mixSrgb,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";
import type { PendingWorld } from "@/lib/parent/world-approval";
import { WorldApprovalManager } from "./WorldApprovalManager";
import { approveWorldAction, rejectWorldAction } from "./actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./actions", () => ({
  approveWorldAction: vi.fn(),
  rejectWorldAction: vi.fn(),
}));

const approveMock = vi.mocked(approveWorldAction);
const rejectMock = vi.mocked(rejectWorldAction);

const wa = strings.parent.worldApproval;

const WORLD_FORET: PendingWorld = {
  id: "world:2",
  index: 2, // affiché "Monde 3" (1-based, MAP §1)
  theme: {
    slug: "foret",
    accent: "#4CAF50",
    label: "Forêt enchantée",
    background: null,
    tiles: null,
    teddy: null,
  },
};
const WORLD_OCEAN: PendingWorld = {
  id: "world:5",
  index: 5,
  theme: {
    slug: "ocean",
    accent: "#2196F3",
    label: "Océan scintillant",
    background: null,
    tiles: null,
    teddy: null,
  },
};

/** Carte (region) d'un monde par son libellé accessible (numéro + thème). */
function worldCard(n: string, theme: string) {
  return within(
    screen.getByRole("region", {
      name: wa.worldLabel.replace("{n}", n).replace("{thème}", theme),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorldApprovalManager — rendu", () => {
  it("liste les mondes en attente (numéro 1-based, thème, aperçu accent consommé via aria-label)", () => {
    render(<WorldApprovalManager pending={[WORLD_FORET, WORLD_OCEAN]} />);
    expect(screen.getByRole("heading", { level: 1, name: wa.title })).toBeInTheDocument();

    const foret = worldCard("3", "Forêt enchantée");
    expect(foret.getByText("Forêt enchantée")).toBeInTheDocument();
    expect(foret.getByText(wa.worldNumber.replace("{n}", "3"))).toBeInTheDocument();
    expect(foret.getByRole("button", { name: wa.approve.action })).toBeInTheDocument();
    expect(foret.getByRole("button", { name: wa.reject.action })).toBeInTheDocument();

    const ocean = worldCard("6", "Océan scintillant");
    expect(ocean.getByText("Océan scintillant")).toBeInTheDocument();
  });

  it("état vide (aucun monde en attente) → message neutre, aucune carte", () => {
    render(<WorldApprovalManager pending={[]} />);
    expect(screen.getByText(wa.empty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: wa.approve.action })).toBeNull();
  });
});

describe("WorldApprovalManager — approuver", () => {
  it("succès → appelle approveWorldAction(id) + feedback + refresh", async () => {
    approveMock.mockResolvedValue({ ok: true });
    render(<WorldApprovalManager pending={[WORLD_FORET]} />);

    fireEvent.click(
      worldCard("3", "Forêt enchantée").getByRole("button", { name: wa.approve.action }),
    );

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith("world:2"));
    expect(await screen.findByText(wa.approve.success)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("erreur MODERATION_FAILED (course multi-onglet) → message mappé, pas de refresh", async () => {
    approveMock.mockResolvedValue({ ok: false, code: "MODERATION_FAILED" });
    render(<WorldApprovalManager pending={[WORLD_FORET]} />);

    fireEvent.click(
      worldCard("3", "Forêt enchantée").getByRole("button", { name: wa.approve.action }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(wa.errors.MODERATION_FAILED);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("session expirée (UNAUTHORIZED) → message mappé", async () => {
    approveMock.mockResolvedValue({ ok: false, code: "UNAUTHORIZED" });
    render(<WorldApprovalManager pending={[WORLD_FORET]} />);
    fireEvent.click(
      worldCard("3", "Forêt enchantée").getByRole("button", { name: wa.approve.action }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(wa.errors.UNAUTHORIZED);
  });

  it("exception réseau/inattendue → GENERIC, pas de refresh", async () => {
    approveMock.mockRejectedValue(new Error("boom"));
    render(<WorldApprovalManager pending={[WORLD_FORET]} />);
    fireEvent.click(
      worldCard("3", "Forêt enchantée").getByRole("button", { name: wa.approve.action }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(wa.errors.GENERIC);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("WorldApprovalManager — rejeter (confirmation, patron delete 7.5)", () => {
  it("ouvre la confirmation SANS appeler rejectWorldAction avant clic sur Confirmer", () => {
    render(<WorldApprovalManager pending={[WORLD_FORET]} />);
    fireEvent.click(
      worldCard("3", "Forêt enchantée").getByRole("button", { name: wa.reject.action }),
    );
    expect(
      screen.getByText(wa.reject.confirmBody.replace("{thème}", "Forêt enchantée")),
    ).toBeInTheDocument();
    expect(rejectMock).not.toHaveBeenCalled(); // mutation-preuve : pas d'action avant confirmation
  });

  it("Annuler → ferme le panneau sans appeler rejectWorldAction", () => {
    render(<WorldApprovalManager pending={[WORLD_FORET]} />);
    fireEvent.click(
      worldCard("3", "Forêt enchantée").getByRole("button", { name: wa.reject.action }),
    );
    fireEvent.click(screen.getByRole("button", { name: wa.reject.cancel }));
    expect(
      screen.queryByText(wa.reject.confirmBody.replace("{thème}", "Forêt enchantée")),
    ).toBeNull();
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it("Confirmer → appelle rejectWorldAction(id) + feedback + refresh", async () => {
    rejectMock.mockResolvedValue({ ok: true });
    render(<WorldApprovalManager pending={[WORLD_FORET]} />);
    fireEvent.click(
      worldCard("3", "Forêt enchantée").getByRole("button", { name: wa.reject.action }),
    );
    fireEvent.click(screen.getByRole("button", { name: wa.reject.confirm }));

    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith("world:2"));
    expect(await screen.findByText(wa.reject.success)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("erreur MODERATION_FAILED sur rejet → message mappé, pas de refresh", async () => {
    rejectMock.mockResolvedValue({ ok: false, code: "MODERATION_FAILED" });
    render(<WorldApprovalManager pending={[WORLD_FORET]} />);
    fireEvent.click(
      worldCard("3", "Forêt enchantée").getByRole("button", { name: wa.reject.action }),
    );
    fireEvent.click(screen.getByRole("button", { name: wa.reject.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(wa.errors.MODERATION_FAILED);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("exception réseau/inattendue sur rejet → GENERIC, pas de refresh", async () => {
    rejectMock.mockRejectedValue(new Error("boom"));
    render(<WorldApprovalManager pending={[WORLD_FORET]} />);
    fireEvent.click(
      worldCard("3", "Forêt enchantée").getByRole("button", { name: wa.reject.action }),
    );
    fireEvent.click(screen.getByRole("button", { name: wa.reject.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(wa.errors.GENERIC);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("WorldApprovalManager — contraste WCAG résolu (tous glyphes rendus)", () => {
  const THEMES: Theme[] = ["light", "dark"];

  it("texte primary/secondary/inverse ≥ 4.5:1 sur leur fond DOM réel", () => {
    for (const theme of THEMES) {
      const surface = resolveTokenColor(theme, "color-bg-secondary"); // = carte de monde
      // Titre, thème du monde, texte de succès (✓), corps/intro.
      expect(
        contrastRatio(resolveTokenColor(theme, "color-text-primary"), surface),
      ).toBeGreaterThanOrEqual(4.5);
      // Intro, numéro de monde, boutons fantômes (Rejeter/Annuler).
      expect(
        contrastRatio(resolveTokenColor(theme, "color-text-secondary"), surface),
      ).toBeGreaterThanOrEqual(4.5);
      // Bouton primaire (Approuver) : texte inverse sur accent plein.
      expect(
        contrastRatio(
          resolveTokenColor(theme, "color-text-inverse"),
          resolveTokenColor(theme, "color-accent-primary"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("bandeau warning (confirmation de rejet + erreurs) : texte constant sur fond warning ≥ 4.5:1", () => {
    for (const theme of THEMES) {
      expect(
        contrastRatio(
          resolveTokenColor(theme, "color-on-warning"),
          resolveTokenColor(theme, "color-status-warning"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("état DÉSACTIVÉ (approbation/rejet en vol) : texte COMPOSITÉ réellement peint ≥ 4.5:1 (aucune dilution par `opacity`)", async () => {
    // Rétro Frontend #226, repris #251 (même patron que `ProfileManager.tsx`) : un `opacity` sur le
    // bouton compositerait le texte vers le fond → sous 4.5:1. Ce test lit l'opacité RÉELLEMENT
    // rendue sur les DEUX boutons désactivés en vol (« Approuver » pendant l'appel serveur,
    // « Confirmer » le rejet pendant l'appel serveur — les deux partagent `disabledButtonStyle`) et
    // calcule la couleur POST-BLEND effectivement peinte (piège #170 « token résolu ≠ pixel peint »)
    // → il ROUGIT si un `opacity` diluant est réintroduit. Fond réellement peint =
    // `--color-bg-tertiary` (#251 : fill opaque du bouton, plus le fond transparent d'avant le fix).
    let resolveApprove: (r: { ok: true }) => void = () => {};
    approveMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApprove = resolve;
        }),
    );
    let resolveReject: (r: { ok: true }) => void = () => {};
    rejectMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReject = resolve;
        }),
    );

    function checkComposite(btn: HTMLElement) {
      const opacity = btn.style.opacity === "" ? 1 : Number(btn.style.opacity);
      expect(opacity).toBe(1); // garde directe : aucun opacity diluant sur un bouton désactivé
      for (const theme of THEMES) {
        const text = resolveTokenColor(theme, "color-text-secondary");
        const bg = resolveTokenColor(theme, "color-bg-tertiary");
        // Couleur réellement peinte = blend du texte sur le fond selon l'opacité rendue.
        const painted = opacity === 1 ? text : mixSrgb(text, bg, opacity);
        expect(contrastRatio(painted, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }

    render(<WorldApprovalManager pending={[WORLD_FORET]} />);

    // 1) « Approuver » en vol — capturé et résolu AVANT d'ouvrir le panneau de rejet : les deux
    // boutons partagent la même rangée conditionnelle (`actionRowStyle`), ouvrir le panneau de
    // rejet démonte le bouton « Approuver » (branche `isRejectPanelOpen`), donc les deux états
    // désactivés doivent être exercés en séquence, jamais superposés.
    fireEvent.click(
      worldCard("3", "Forêt enchantée").getByRole("button", { name: wa.approve.action }),
    );
    const approveBtn = await screen.findByRole("button", { name: wa.approve.action });
    expect(approveBtn).toBeDisabled();
    checkComposite(approveBtn);
    resolveApprove({ ok: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: wa.approve.action })).toBeEnabled(),
    );

    // 2) Ouvrir le panneau de rejet, puis « Confirmer » en vol.
    fireEvent.click(
      worldCard("3", "Forêt enchantée").getByRole("button", { name: wa.reject.action }),
    );
    fireEvent.click(screen.getByRole("button", { name: wa.reject.confirm }));
    const confirmBtn = await screen.findByRole("button", { name: wa.reject.confirm });
    expect(confirmBtn).toBeDisabled();
    checkComposite(confirmBtn);
    resolveReject({ ok: true });
    await waitFor(() => expect(screen.getByText(wa.reject.success)).toBeInTheDocument());
  });

  it("état DÉSACTIVÉ : fond ATTÉNUÉ discriminant du fond transparent des boutons actifs (#251, patron #227)", async () => {
    // Avant ce fix, `disabledButtonStyle` ne différait des boutons fantômes actifs que par une
    // bordure ~1.1:1 (quasi indiscernable) — un bouton désactivé pouvait être perçu comme cliquable.
    // Ce test ROUGIT si le fond désactivé retombe à "transparent" (régression vers le pattern
    // faiblement discriminant) OU s'aligne par erreur sur le fond d'un bouton actif.
    let resolveApprove: (r: { ok: true }) => void = () => {};
    approveMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApprove = resolve;
        }),
    );

    render(<WorldApprovalManager pending={[WORLD_FORET]} />);
    const card = worldCard("3", "Forêt enchantée");
    const rejectGhost = card.getByRole("button", { name: wa.reject.action });

    fireEvent.click(card.getByRole("button", { name: wa.approve.action }));
    const approveBtn = await screen.findByRole("button", { name: wa.approve.action });
    expect(approveBtn).toBeDisabled();

    expect(approveBtn.style.backgroundColor).toBe("var(--color-bg-tertiary)");
    expect(rejectGhost.style.backgroundColor).toBe("transparent");
    expect(approveBtn.style.backgroundColor).not.toBe(rejectGhost.style.backgroundColor);

    resolveApprove({ ok: true });
    await waitFor(() => expect(approveBtn).not.toBeDisabled());
  });
});
