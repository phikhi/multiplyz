import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { strings } from "@/strings";
import {
  contrastRatio,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";
import type { HouseholdSettings } from "@/lib/parent/settings";
import { SettingsForm } from "./SettingsForm";
import { requestRecalibrationAction, saveSettingsAction } from "./actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./actions", () => ({
  saveSettingsAction: vi.fn(),
  requestRecalibrationAction: vi.fn(),
}));

const saveMock = vi.mocked(saveSettingsAction);
const recalibrateMock = vi.mocked(requestRecalibrationAction);
const s = strings.parent.settings;

const SETTINGS: HouseholdSettings = {
  theme: "system",
  parentWorldValidation: false,
  screenTimeNudgeMinutes: 20,
  screenTimeHardLockEnabled: false,
  screenTimeHardLockMinutes: 45,
};
const NUDGE_OPTIONS = [15, 20, 30, 45, 60];
const HARD_LOCK_OPTIONS = [30, 45, 60, 90, 120];

function renderForm(settings: HouseholdSettings = SETTINGS) {
  return render(
    <SettingsForm
      settings={settings}
      nudgeOptions={NUDGE_OPTIONS}
      hardLockOptions={HARD_LOCK_OPTIONS}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mockResolvedValue({ ok: true });
  recalibrateMock.mockResolvedValue({ ok: true });
  delete document.documentElement.dataset.theme;
});

// ───────────────────────────── rendu ─────────────────────────────

describe("SettingsForm — rendu (liste VERROUILLÉE DETAILS §3, registre neutre)", () => {
  it("rend le titre + les groupes thème / validation / temps d'écran / langue", () => {
    renderForm();
    expect(screen.getByRole("heading", { level: 1, name: s.title })).toBeInTheDocument();
    // Groupes (légendes).
    expect(screen.getByText(s.theme.legend)).toBeInTheDocument();
    expect(screen.getByText(s.worlds.legend)).toBeInTheDocument();
    expect(screen.getByText(s.screenTime.legend)).toBeInTheDocument();
    // Langue FR grisée (valeur + consigne future i18n) — pas un contrôle éditable.
    expect(screen.getByText(s.language.value)).toBeInTheDocument();
    expect(screen.getByText(s.language.hint)).toBeInTheDocument();
    // Retour vers le tableau de bord.
    expect(screen.getByRole("link", { name: s.back })).toHaveAttribute("href", "/parent");
  });

  it("reflète les réglages persistés : thème `dark` sélectionné, validation `auto`", () => {
    renderForm({ ...SETTINGS, theme: "dark" });
    expect(screen.getByRole("button", { name: s.theme.dark })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: s.theme.system })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: s.worlds.auto })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("verrou dur désactivé ⇒ le sélecteur « Limite par jour » n'est PAS rendu (switch off)", () => {
    renderForm();
    expect(screen.getByRole("switch", { name: s.screenTime.hardLockToggle })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.queryByRole("combobox", { name: s.screenTime.hardLockLabel })).toBeNull();
  });

  it("verrou dur activé (persisté) ⇒ le sélecteur « Limite par jour » est rendu à la bonne valeur", () => {
    renderForm({ ...SETTINGS, screenTimeHardLockEnabled: true, screenTimeHardLockMinutes: 90 });
    const select = screen.getByRole("combobox", { name: s.screenTime.hardLockLabel });
    expect(select).toHaveValue("90");
  });
});

// ───────────────────────────── thème AGIT (data-theme immédiat) ─────────────────────────────

describe("SettingsForm — thème AGIT immédiatement (data-theme app-wide)", () => {
  it("sélectionner « Sombre » ⇒ data-theme=dark + saveSettingsAction({theme:dark}) + refresh + confirmation", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: s.theme.dark }));
    // Effet IMMÉDIAT app-wide (avant même la réponse serveur).
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(saveMock).toHaveBeenCalledWith({ theme: "dark" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(s.saved));
    expect(refresh).toHaveBeenCalled();
  });

  it("sélectionner « Clair » ⇒ data-theme=light (force clair)", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: s.theme.light }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(saveMock).toHaveBeenCalledWith({ theme: "light" });
  });

  it("sélectionner « Automatique » ⇒ data-theme RETIRÉ (le système décide)", () => {
    renderForm({ ...SETTINGS, theme: "dark" });
    document.documentElement.dataset.theme = "dark";
    fireEvent.click(screen.getByRole("button", { name: s.theme.system }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(saveMock).toHaveBeenCalledWith({ theme: "system" });
  });
});

// ───────────────────────────── validation des mondes (câblage worker) ─────────────────────────────

describe("SettingsForm — validation des mondes (source de vérité du worker)", () => {
  it("« Votre approbation » ⇒ saveSettingsAction({parentWorldValidation:true})", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: s.worlds.parent }));
    expect(saveMock).toHaveBeenCalledWith({ parentWorldValidation: true });
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  });

  it("« Automatique » ⇒ saveSettingsAction({parentWorldValidation:false})", () => {
    renderForm({ ...SETTINGS, parentWorldValidation: true });
    fireEvent.click(screen.getByRole("button", { name: s.worlds.auto }));
    expect(saveMock).toHaveBeenCalledWith({ parentWorldValidation: false });
  });
});

// ───────────────────────────── temps d'écran (STOCKÉ, consommé 7.8) ─────────────────────────────

describe("SettingsForm — temps d'écran (STOCKÉ seulement, enforcement 7.8 #229)", () => {
  it("changer la pause suggérée ⇒ saveSettingsAction({screenTimeNudgeMinutes})", () => {
    renderForm();
    fireEvent.change(screen.getByRole("combobox", { name: s.screenTime.nudgeLabel }), {
      target: { value: "30" },
    });
    expect(saveMock).toHaveBeenCalledWith({ screenTimeNudgeMinutes: 30 });
  });

  it("activer le verrou dur ⇒ save({enabled:true}) + le sélecteur de limite APPARAÎT", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("switch", { name: s.screenTime.hardLockToggle }));
    expect(saveMock).toHaveBeenCalledWith({ screenTimeHardLockEnabled: true });
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: s.screenTime.hardLockLabel }),
      ).toBeInTheDocument(),
    );
  });

  it("désactiver le verrou dur ⇒ save({enabled:false}) + le sélecteur DISPARAÎT", () => {
    renderForm({ ...SETTINGS, screenTimeHardLockEnabled: true });
    fireEvent.click(screen.getByRole("switch", { name: s.screenTime.hardLockToggle }));
    expect(saveMock).toHaveBeenCalledWith({ screenTimeHardLockEnabled: false });
    expect(screen.queryByRole("combobox", { name: s.screenTime.hardLockLabel })).toBeNull();
  });

  it("changer la limite quotidienne (verrou activé) ⇒ save({screenTimeHardLockMinutes})", () => {
    renderForm({ ...SETTINGS, screenTimeHardLockEnabled: true });
    fireEvent.change(screen.getByRole("combobox", { name: s.screenTime.hardLockLabel }), {
      target: { value: "120" },
    });
    expect(saveMock).toHaveBeenCalledWith({ screenTimeHardLockMinutes: 120 });
  });
});

// ───────────────────────────── feedback d'erreur (mapping + catch) ─────────────────────────────

describe("SettingsForm — feedback d'erreur (doublé d'icône ⚠️)", () => {
  it("action { ok:false, code } ⇒ role=alert avec le message mappé", async () => {
    saveMock.mockResolvedValue({ ok: false, code: "UNAUTHORIZED" });
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: s.theme.dark }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(s.errors.UNAUTHORIZED));
  });

  it("exception réseau (action throw) ⇒ role=alert message GENERIC", async () => {
    saveMock.mockRejectedValue(new Error("network"));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: s.theme.dark }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(s.errors.GENERIC));
  });
});

// ───────────────────────────── recalibrer (story 7.6, ADR 0016 — confirm step) ─────────────────────────────

describe("SettingsForm — recalibrer (story 7.6, ADR 0016)", () => {
  const rc = s.recalibrate;

  it("rend la section recalibrer (légende + consigne + bouton d'action) — pas de confirmation par défaut", () => {
    renderForm();
    expect(screen.getByRole("button", { name: rc.action })).toBeInTheDocument();
    expect(screen.getByText(rc.hint)).toBeInTheDocument();
    // Aucune confirmation ouverte au départ (le bouton de confirmation n'est PAS rendu).
    expect(screen.queryByRole("button", { name: rc.confirm })).toBeNull();
  });

  it("cliquer « Recalibrer » OUVRE la confirmation (corps + confirmer/annuler) SANS armer (aucun appel action)", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: rc.action }));
    expect(screen.getByText(rc.confirmBody)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: rc.confirm })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: rc.cancel })).toBeInTheDocument();
    // Ouvrir n'ARME RIEN : seul « Oui, recalibrer » appelle la server action (destructive-douce).
    expect(recalibrateMock).not.toHaveBeenCalled();
  });

  it("confirmer ⇒ requestRecalibrationAction() appelé + confirmation succès + panneau refermé + refresh", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: rc.action }));
    fireEvent.click(screen.getByRole("button", { name: rc.confirm }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(rc.success));
    expect(recalibrateMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
    // Panneau de confirmation refermé après succès → le bouton d'action est de nouveau rendu.
    expect(screen.getByRole("button", { name: rc.action })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: rc.confirm })).toBeNull();
  });

  it("annuler ⇒ referme la confirmation SANS appeler l'action", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: rc.action }));
    fireEvent.click(screen.getByRole("button", { name: rc.cancel }));
    expect(recalibrateMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: rc.confirm })).toBeNull();
    expect(screen.getByRole("button", { name: rc.action })).toBeInTheDocument();
  });

  it("a11y : l'ouverture de la confirmation déplace le focus sur « Annuler » (choix sûr, rétro #226)", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: rc.action }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: rc.cancel }));
  });

  it("SÉCU : action { ok:false, code:UNAUTHORIZED } ⇒ role=alert message mappé (session expirée)", async () => {
    recalibrateMock.mockResolvedValue({ ok: false, code: "UNAUTHORIZED" });
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: rc.action }));
    fireEvent.click(screen.getByRole("button", { name: rc.confirm }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(s.errors.UNAUTHORIZED));
  });

  it("exception réseau (action throw) ⇒ role=alert message GENERIC", async () => {
    recalibrateMock.mockRejectedValue(new Error("network"));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: rc.action }));
    fireEvent.click(screen.getByRole("button", { name: rc.confirm }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(s.errors.GENERIC));
  });

  it("aucun bouton de la section recalibrer (action/confirmer/annuler) ne dilue son texte par une `opacity` (rétro #226)", () => {
    renderForm();
    // Bouton d'action fermé.
    expect(screen.getByRole("button", { name: rc.action }).style.opacity === "" ? 1 : 0).toBe(1);
    // Ouvrir la confirmation → confirmer + annuler visibles : vérifier leur alpha plein.
    fireEvent.click(screen.getByRole("button", { name: rc.action }));
    for (const name of [rc.confirm, rc.cancel]) {
      const el = screen.getByRole("button", { name });
      const opacity = el.style.opacity === "" ? 1 : Number(el.style.opacity);
      expect(opacity).toBe(1); // texte plein-alpha → signal « en cours » via disabled/cursor, pas l'opacité
    }
  });
});

// ───────────────────────────── a11y : titre focus-managé + outline (STACK-TRAP #222) ─────────────────────────────

describe("SettingsForm — a11y titre focus-managé (rétro 7.1 #222)", () => {
  it("le titre reçoit le focus au montage (annonce SR) SANS anneau UA (outline:none documenté)", () => {
    renderForm();
    const heading = screen.getByRole("heading", { level: 1, name: s.title });
    expect(document.activeElement).toBe(heading);
    expect(heading.style.outline).toBe("none");
  });
});

// ───────────────────────────── contraste WCAG RÉSOLU (tous glyphes, 2 thèmes, #104/#126/#226) ─────────────────────────────

describe("SettingsForm — contraste WCAG résolu (tous glyphes rendus, aucune opacity)", () => {
  const THEMES: Theme[] = ["light", "dark"];

  it("texte primary/secondary/inverse ≥ 4.5:1 sur leur fond DOM réel", () => {
    for (const theme of THEMES) {
      const surface = resolveTokenColor(theme, "color-bg-secondary"); // = card-bg + fond des selects
      // Titre, libellés de select, valeur de langue (secondary), succès (✓).
      expect(
        contrastRatio(resolveTokenColor(theme, "color-text-primary"), surface),
      ).toBeGreaterThanOrEqual(4.5);
      // Intro, consignes, segments NON sélectionnés (fantôme), switch off, retour, langue grisée.
      expect(
        contrastRatio(resolveTokenColor(theme, "color-text-secondary"), surface),
      ).toBeGreaterThanOrEqual(4.5);
      // Segments SÉLECTIONNÉS + switch ON : texte inverse sur accent plein.
      expect(
        contrastRatio(
          resolveTokenColor(theme, "color-text-inverse"),
          resolveTokenColor(theme, "color-accent-primary"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("texte d'alerte (on-warning) ≥ 4.5:1 sur le fond amber", () => {
    for (const theme of THEMES) {
      expect(
        contrastRatio(
          resolveTokenColor(theme, "color-on-warning"),
          resolveTokenColor(theme, "color-status-warning"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("aucun bouton (segment/switch/retour) ne dilue son texte par une `opacity` (rétro #226)", () => {
    renderForm({ ...SETTINGS, screenTimeHardLockEnabled: true });
    // Tous les boutons stylés de l'écran : segments (thème×3 + mondes×2), switch, retour.
    const buttons = screen.getAllByRole("button");
    const switchEl = screen.getByRole("switch", { name: s.screenTime.hardLockToggle });
    const back = screen.getByRole("link", { name: s.back });
    for (const el of [...buttons, switchEl, back]) {
      const opacity = el.style.opacity === "" ? 1 : Number(el.style.opacity);
      expect(opacity).toBe(1); // texte plein-alpha → le contraste résolu ci-dessus est le pixel réel
    }
  });
});
