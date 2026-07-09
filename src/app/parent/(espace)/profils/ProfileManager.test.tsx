import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { strings } from "@/strings";
import {
  contrastRatio,
  mixSrgb,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";
import type { ManagedProfile } from "@/lib/parent/profiles";
import { ProfileManager } from "./ProfileManager";
import { deleteProfileAction, renameProfileAction, resetChildPinAction } from "./actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./actions", () => ({
  renameProfileAction: vi.fn(),
  resetChildPinAction: vi.fn(),
  deleteProfileAction: vi.fn(),
}));

const renameMock = vi.mocked(renameProfileAction);
const resetMock = vi.mocked(resetChildPinAction);
const deleteMock = vi.mocked(deleteProfileAction);

const m = strings.parent.manage;
const PROFILES: ManagedProfile[] = [
  { id: 1, name: "Léa", avatar: "fox", isOwner: true },
  { id: 2, name: "Zoé", avatar: "rabbit", isOwner: false },
];

/** Carte (region) d'un profil par son prénom. */
function card(name: string) {
  return within(screen.getByRole("region", { name: m.profileLabel.replace("{prénom}", name) }));
}

function pressDigits(digits: string) {
  for (const d of digits) {
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", d) }));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProfileManager — rendu", () => {
  it("liste les profils, marque le compte parent et grise sa suppression", () => {
    render(<ProfileManager profiles={PROFILES} />);
    expect(screen.getByRole("heading", { level: 1, name: m.title })).toBeInTheDocument();

    // Propriétaire : badge + hint + suppression DÉSACTIVÉE.
    const owner = card("Léa");
    expect(owner.getByText(m.ownerBadge)).toBeInTheDocument();
    expect(owner.getByText(m.ownerHint)).toBeInTheDocument();
    expect(owner.getByRole("button", { name: m.delete.action })).toBeDisabled();

    // Frère/sœur : suppression ACTIVE, pas de badge propriétaire.
    const sibling = card("Zoé");
    expect(sibling.queryByText(m.ownerBadge)).toBeNull();
    expect(sibling.getByRole("button", { name: m.delete.action })).toBeEnabled();
  });

  it("avatar hors catalogue → repli `avatarEmoji` sans casser le rendu", () => {
    render(
      <ProfileManager
        profiles={[{ id: 9, name: "Iris", avatar: "avatar-inconnu", isOwner: false }]}
      />,
    );
    // La carte rend (le prénom + les actions), l'emoji inconnu retombe sur "" (aria-hidden).
    expect(screen.getByRole("region", { name: m.profileLabel.replace("{prénom}", "Iris") }));
    expect(screen.getByText("Iris")).toBeInTheDocument();
  });
});

describe("ProfileManager — renommer", () => {
  it("succès → appelle renameProfileAction + feedback + refresh", async () => {
    renameMock.mockResolvedValue({ ok: true });
    render(<ProfileManager profiles={PROFILES} />);

    fireEvent.click(card("Zoé").getByRole("button", { name: m.rename.action }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Zoélie" } });
    fireEvent.click(screen.getByRole("button", { name: m.rename.save }));

    await waitFor(() => expect(renameMock).toHaveBeenCalledWith(2, "Zoélie"));
    expect(await screen.findByText(m.rename.success)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("erreur NAME_TAKEN → message d'erreur mappé, pas de refresh", async () => {
    renameMock.mockResolvedValue({ ok: false, code: "NAME_TAKEN" });
    render(<ProfileManager profiles={PROFILES} />);

    fireEvent.click(card("Zoé").getByRole("button", { name: m.rename.action }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    fireEvent.click(screen.getByRole("button", { name: m.rename.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.errors.NAME_TAKEN);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("erreur réseau (throw) → repli GENERIC", async () => {
    renameMock.mockRejectedValue(new Error("net"));
    render(<ProfileManager profiles={PROFILES} />);

    fireEvent.click(card("Zoé").getByRole("button", { name: m.rename.action }));
    fireEvent.click(screen.getByRole("button", { name: m.rename.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.errors.GENERIC);
  });

  it("Annuler ferme le panneau sans appeler l'action", () => {
    render(<ProfileManager profiles={PROFILES} />);
    fireEvent.click(card("Zoé").getByRole("button", { name: m.rename.action }));
    fireEvent.click(screen.getByRole("button", { name: m.rename.cancel }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(renameMock).not.toHaveBeenCalled();
  });
});

describe("ProfileManager — réinitialiser le PIN enfant", () => {
  it("PIN 4 chiffres + succès → appelle resetChildPinAction", async () => {
    resetMock.mockResolvedValue({ ok: true });
    render(<ProfileManager profiles={PROFILES} />);

    fireEvent.click(card("Zoé").getByRole("button", { name: m.resetPin.action }));
    // Bouton désactivé tant que le PIN n'a pas 4 chiffres.
    expect(screen.getByRole("button", { name: m.resetPin.save })).toBeDisabled();
    pressDigits("3333");
    fireEvent.click(screen.getByRole("button", { name: m.resetPin.save }));

    await waitFor(() => expect(resetMock).toHaveBeenCalledWith(2, "3333"));
    expect(await screen.findByText(m.resetPin.success)).toBeInTheDocument();
  });

  it("erreur PARENT_PIN_SAME → message mappé", async () => {
    resetMock.mockResolvedValue({ ok: false, code: "PARENT_PIN_SAME" });
    render(<ProfileManager profiles={PROFILES} />);

    fireEvent.click(card("Léa").getByRole("button", { name: m.resetPin.action }));
    pressDigits("9876");
    fireEvent.click(screen.getByRole("button", { name: m.resetPin.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.errors.PARENT_PIN_SAME);
  });

  it("erreur réseau (throw) → repli GENERIC", async () => {
    resetMock.mockRejectedValue(new Error("net"));
    render(<ProfileManager profiles={PROFILES} />);
    fireEvent.click(card("Zoé").getByRole("button", { name: m.resetPin.action }));
    pressDigits("3333");
    fireEvent.click(screen.getByRole("button", { name: m.resetPin.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.errors.GENERIC);
  });
});

describe("ProfileManager — supprimer (purge)", () => {
  it("confirmation → appelle deleteProfileAction + feedback + refresh", async () => {
    deleteMock.mockResolvedValue({ ok: true });
    render(<ProfileManager profiles={PROFILES} />);

    fireEvent.click(card("Zoé").getByRole("button", { name: m.delete.action }));
    // Corps de confirmation destructif visible (irréversible, doublé ⚠️).
    expect(screen.getByText(m.delete.confirmBody.replace("{prénom}", "Zoé"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: m.delete.confirm }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(2));
    expect(await screen.findByText(m.delete.success)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("le compte parent ne peut pas ouvrir la confirmation (bouton désactivé)", () => {
    render(<ProfileManager profiles={PROFILES} />);
    const del = card("Léa").getByRole("button", { name: m.delete.action });
    fireEvent.click(del); // clic sur bouton désactivé → aucun effet
    expect(screen.queryByRole("button", { name: m.delete.confirm })).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("erreur OWNER_UNDELETABLE renvoyée par le serveur → message mappé", async () => {
    // Défense en profondeur : même si l'UI grise le bouton, le serveur reste autoritaire.
    deleteMock.mockResolvedValue({ ok: false, code: "OWNER_UNDELETABLE" });
    render(<ProfileManager profiles={PROFILES} />);
    fireEvent.click(card("Zoé").getByRole("button", { name: m.delete.action }));
    fireEvent.click(screen.getByRole("button", { name: m.delete.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.errors.OWNER_UNDELETABLE);
  });

  it("erreur réseau (throw) → repli GENERIC", async () => {
    deleteMock.mockRejectedValue(new Error("net"));
    render(<ProfileManager profiles={PROFILES} />);
    fireEvent.click(card("Zoé").getByRole("button", { name: m.delete.action }));
    fireEvent.click(screen.getByRole("button", { name: m.delete.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.errors.GENERIC);
  });
});

// ============================================================================
// Contraste WCAG RÉSOLU (rétro #104/#126 : audit de TOUS les glyphes de l'écran, valeurs
// résolues depuis tokens.css, pas seulement le nom du token). Deux thèmes.
// ============================================================================
describe("ProfileManager — contraste WCAG résolu (tous glyphes rendus)", () => {
  const THEMES: Theme[] = ["light", "dark"];

  it("texte primary/secondary/inverse ≥ 4.5:1 sur leur fond DOM réel", () => {
    for (const theme of THEMES) {
      const surface = resolveTokenColor(theme, "color-bg-secondary"); // = card-bg + carte profil
      // Titre, prénoms, texte de succès (✓), corps.
      expect(
        contrastRatio(resolveTokenColor(theme, "color-text-primary"), surface),
      ).toBeGreaterThanOrEqual(4.5);
      // Intro, hint propriétaire, badge, boutons fantômes (Renommer/Réinitialiser/Supprimer/Annuler).
      expect(
        contrastRatio(resolveTokenColor(theme, "color-text-secondary"), surface),
      ).toBeGreaterThanOrEqual(4.5);
      // Boutons primaires (Enregistrer) : texte inverse sur accent plein.
      expect(
        contrastRatio(
          resolveTokenColor(theme, "color-text-inverse"),
          resolveTokenColor(theme, "color-accent-primary"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("texte d'alerte/destructif (on-warning) ≥ 4.5:1 sur le fond amber", () => {
    for (const theme of THEMES) {
      // Bandeau d'erreur, corps de confirmation destructive, bouton « Supprimer définitivement ».
      expect(
        contrastRatio(
          resolveTokenColor(theme, "color-on-warning"),
          resolveTokenColor(theme, "color-status-warning"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("état DÉSACTIVÉ : texte COMPOSITÉ réellement peint ≥ 4.5:1 (aucune dilution par `opacity`)", () => {
    // Rétro Frontend #226 : un `opacity` sur le bouton compositerait le texte vers le fond → sous
    // 4.5:1. Ce test lit l'opacité RÉELLEMENT rendue sur les boutons désactivés et calcule la
    // couleur **post-blend** effectivement peinte (piège #170 « token résolu ≠ pixel peint ») → il
    // ROUGIT si un `opacity` diluant est réintroduit. Tous les états désactivés/pending du fichier
    // partagent le même `disabledButtonStyle` (owner-« Supprimer » permanent + « Enregistrer » vide).
    render(<ProfileManager profiles={PROFILES} />);
    const ownerDelete = card("Léa").getByRole("button", { name: m.delete.action });
    // « Enregistrer » du renommage, désactivé quand le champ est vide.
    fireEvent.click(card("Zoé").getByRole("button", { name: m.rename.action }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    const renameSave = screen.getByRole("button", { name: m.rename.save });

    for (const btn of [ownerDelete, renameSave]) {
      const opacity = btn.style.opacity === "" ? 1 : Number(btn.style.opacity);
      expect(opacity).toBe(1); // garde directe : aucun opacity diluant sur un bouton désactivé
      for (const theme of THEMES) {
        const text = resolveTokenColor(theme, "color-text-secondary");
        const bg = resolveTokenColor(theme, "color-bg-secondary");
        // Couleur réellement peinte = blend du texte sur le fond selon l'opacité rendue.
        const painted = opacity === 1 ? text : mixSrgb(text, bg, opacity);
        expect(contrastRatio(painted, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

// ============================================================================
// Gestion du focus à l'ouverture d'un panneau (rétro Frontend #226) : le focus doit se déplacer
// dans le panneau — champ pour renommer, bouton Annuler pour réinit + suppression destructive.
// ============================================================================
describe("ProfileManager — focus à l'ouverture des panneaux (a11y clavier/SR)", () => {
  it("renommer → focus déplacé sur le champ prénom", () => {
    render(<ProfileManager profiles={PROFILES} />);
    fireEvent.click(card("Zoé").getByRole("button", { name: m.rename.action }));
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("réinitialiser le code → focus déplacé sur Annuler", () => {
    render(<ProfileManager profiles={PROFILES} />);
    fireEvent.click(card("Zoé").getByRole("button", { name: m.resetPin.action }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: m.resetPin.cancel }));
  });

  it("supprimer (destructif) → focus déplacé sur Annuler (choix sûr par défaut)", () => {
    render(<ProfileManager profiles={PROFILES} />);
    fireEvent.click(card("Zoé").getByRole("button", { name: m.delete.action }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: m.delete.cancel }));
  });
});
