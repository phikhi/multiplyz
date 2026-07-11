import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingFlow } from "./OnboardingFlow";
import { createHouseholdAction } from "./actions";
import { strings } from "@/strings";
import { AVATARS } from "@/config/avatars";
import {
  contrastRatio,
  mixSrgb,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./actions", () => ({ createHouseholdAction: vi.fn() }));

const actionMock = vi.mocked(createHouseholdAction);

const nav = strings.onboarding.nav;
// Libellé a11y du 1er portrait (AVATARS[0] = fox → « Portrait renard »).
const avatarLabel = strings.onboarding.profile.avatarOption.replace(
  "{nom}",
  strings.onboarding.profile.avatarNames.fox,
);

function pressDigits(digits: string) {
  for (const d of digits) {
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", d) }));
  }
}

/** Amène l'assistant jusqu'à l'étape parent avec un code parent complet. */
function driveToParentReady() {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
  fireEvent.click(screen.getByRole("button", { name: avatarLabel }));
  fireEvent.click(screen.getByRole("button", { name: nav.next })); // → childPin
  pressDigits("1234");
  fireEvent.click(screen.getByRole("button", { name: nav.next })); // → parentPin
  pressDigits("9876");
}

beforeEach(() => {
  actionMock.mockReset();
  refresh.mockReset();
});

describe("OnboardingFlow — gating par étape (affordance client)", () => {
  it("« Continuer » désactivé tant que prénom OU avatar manquent", () => {
    render(<OnboardingFlow />);
    const next = () => screen.getByRole("button", { name: nav.next });
    expect(next()).toBeDisabled(); // rien saisi

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    expect(next()).toBeDisabled(); // avatar manquant

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: avatarLabel }));
    expect(next()).toBeDisabled(); // prénom manquant

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    expect(next()).toBeEnabled();
  });

  it("code enfant : suivant désactivé tant que < 4 chiffres", () => {
    render(<OnboardingFlow />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    fireEvent.click(screen.getByRole("button", { name: avatarLabel }));
    fireEvent.click(screen.getByRole("button", { name: nav.next }));

    expect(screen.getByRole("button", { name: nav.next })).toBeDisabled();
    pressDigits("123");
    expect(screen.getByRole("button", { name: nav.next })).toBeDisabled();
    pressDigits("4");
    expect(screen.getByRole("button", { name: nav.next })).toBeEnabled();
  });

  it("code parent : « C'est parti » désactivé tant que < 4 chiffres", () => {
    render(<OnboardingFlow />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    fireEvent.click(screen.getByRole("button", { name: avatarLabel }));
    fireEvent.click(screen.getByRole("button", { name: nav.next }));
    pressDigits("1234");
    fireEvent.click(screen.getByRole("button", { name: nav.next }));
    expect(screen.getByRole("button", { name: nav.create })).toBeDisabled();
    pressDigits("9876");
    expect(screen.getByRole("button", { name: nav.create })).toBeEnabled();
  });
});

describe("OnboardingFlow — navigation arrière", () => {
  it("retour ramène code enfant → profil, code parent → code enfant", () => {
    render(<OnboardingFlow />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    fireEvent.click(screen.getByRole("button", { name: avatarLabel }));
    fireEvent.click(screen.getByRole("button", { name: nav.next }));

    // childPin → retour → profil
    fireEvent.click(screen.getByRole("button", { name: nav.back }));
    expect(
      screen.getByRole("heading", { name: strings.onboarding.profile.title }),
    ).toBeInTheDocument();

    // reviens, avance jusqu'à parentPin, retour → childPin
    fireEvent.click(screen.getByRole("button", { name: nav.next }));
    pressDigits("1234");
    fireEvent.click(screen.getByRole("button", { name: nav.next }));
    fireEvent.click(screen.getByRole("button", { name: nav.back }));
    expect(
      screen.getByRole("heading", { name: strings.onboarding.childPin.title }),
    ).toBeInTheDocument();
  });
});

describe("OnboardingFlow — focus & annonce (a11y)", () => {
  it("place le focus sur le titre de l'étape courante (montage + transition)", () => {
    render(<OnboardingFlow />);
    // Au montage, le titre de la 1ʳᵉ étape reçoit le focus.
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: strings.onboarding.profile.title }),
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    fireEvent.click(screen.getByRole("button", { name: avatarLabel }));
    fireEvent.click(screen.getByRole("button", { name: nav.next }));

    // Le focus suit la nouvelle étape (pas d'atterrissage sur <body>).
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: strings.onboarding.childPin.title }),
    );
  });

  // STACK-TRAP #222 (rétro 7.1/7.5/7.9) : focus programmatique hors ordre clavier (tabIndex=-1)
  // → l'anneau UA natif serait un artefact sans valeur a11y. ROUGIT si `outline:"none"` disparaît.
  it("le titre focus-managé n'a AUCUN anneau UA (outline:none documenté)", () => {
    render(<OnboardingFlow />);
    const heading = screen.getByRole("heading", { name: strings.onboarding.profile.title });
    expect(heading.style.outline).toBe("none");
  });

  it("annonce le code de secours dans une région live (role=status)", async () => {
    actionMock.mockResolvedValue({ ok: true, recoveryCode: "ABCD2345" });
    render(<OnboardingFlow />);
    driveToParentReady();
    fireEvent.click(screen.getByRole("button", { name: nav.create }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("ABCD2345");
  });
});

describe("OnboardingFlow — soumission", () => {
  it("succès → code de secours affiché une fois → prêt → refresh", async () => {
    actionMock.mockResolvedValue({ ok: true, recoveryCode: "ABCD2345" });
    render(<OnboardingFlow />);
    driveToParentReady();
    fireEvent.click(screen.getByRole("button", { name: nav.create }));

    expect(await screen.findByText("ABCD2345")).toBeInTheDocument();
    expect(actionMock).toHaveBeenCalledWith({
      name: "Léa",
      avatar: AVATARS[0].id,
      childPin: "1234",
      parentPin: "9876",
    });

    fireEvent.click(screen.getByRole("button", { name: strings.onboarding.recovery.done }));
    fireEvent.click(screen.getByRole("button", { name: strings.onboarding.ready.cta }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("foyer déjà configuré (rejeu) → écran prêt, pas de code", async () => {
    actionMock.mockResolvedValue({ ok: true, alreadyConfigured: true });
    render(<OnboardingFlow />);
    driveToParentReady();
    fireEvent.click(screen.getByRole("button", { name: nav.create }));

    expect(
      await screen.findByRole("heading", { name: strings.onboarding.ready.title }),
    ).toBeInTheDocument();
  });

  it("erreur PIN → reste sur code parent avec alerte (posture croissance)", async () => {
    actionMock.mockResolvedValue({ ok: false, code: "PARENT_PIN_SAME" });
    render(<OnboardingFlow />);
    driveToParentReady();
    fireEvent.click(screen.getByRole("button", { name: nav.create }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(strings.onboarding.errors.PARENT_PIN_SAME);
    expect(
      screen.getByRole("heading", { name: strings.onboarding.parentPin.title }),
    ).toBeInTheDocument();
  });

  it("prénom pris → renvoie à l'étape profil avec alerte", async () => {
    actionMock.mockResolvedValue({ ok: false, code: "NAME_TAKEN" });
    render(<OnboardingFlow />);
    driveToParentReady();
    fireEvent.click(screen.getByRole("button", { name: nav.create }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      strings.onboarding.errors.NAME_TAKEN,
    );
    expect(
      screen.getByRole("heading", { name: strings.onboarding.profile.title }),
    ).toBeInTheDocument();
  });

  it("échec réseau (rejet) → alerte générique, reste sur code parent", async () => {
    actionMock.mockRejectedValue(new Error("network"));
    render(<OnboardingFlow />);
    driveToParentReady();
    fireEvent.click(screen.getByRole("button", { name: nav.create }));

    expect(await screen.findByRole("alert")).toHaveTextContent(strings.onboarding.errors.GENERIC);
  });

  it("état d'envoi : bouton libellé « … » et désactivé pendant l'appel", async () => {
    let resolveAction: (v: { ok: true; recoveryCode: string }) => void = () => {};
    actionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    render(<OnboardingFlow />);
    driveToParentReady();
    fireEvent.click(screen.getByRole("button", { name: nav.create }));

    const creating = await screen.findByRole("button", { name: nav.creating });
    expect(creating).toBeDisabled();

    resolveAction({ ok: true, recoveryCode: "WXYZ6789" });
    await waitFor(() => expect(screen.getByText("WXYZ6789")).toBeInTheDocument());
  });
});

// ============================================================================
// CTA désactivé : affordance SANS opacity diluante (#240/#226, corrigé PR #250). Le CTA primaire
// plein-accent passait à `opacity:0.55` désactivé → texte blanc composité ~2.17:1 peint (light) /
// ~2.51:1 (dark). Fix : registre neutre (texte-secondary sur bg-tertiary) ≥4.5:1 peint. Résolution
// COMPOSITÉE post-blend (patron #226, resolveTokenColor/mixSrgb) — jamais la paire de tokens seule.
// ============================================================================
describe("OnboardingFlow — CTA désactivé : contraste composité peint (#240/#226)", () => {
  const THEMES: Theme[] = ["light", "dark"];

  it("« Continuer » désactivé : texte peint ≥4.5:1, aucune opacity diluante, fond atténué + aria-disabled", () => {
    render(<OnboardingFlow />);
    // Étape profil, rien saisi → « Continuer » DÉSACTIVÉ (canContinueProfile=false).
    const cta = screen.getByRole("button", { name: nav.next });
    expect(cta).toBeDisabled();

    const opacity = cta.style.opacity === "" ? 1 : Number(cta.style.opacity);
    expect(opacity).toBe(1); // garde directe : aucune opacity diluante sur le CTA plein-texte
    expect(cta).toHaveAttribute("aria-disabled", "true");
    expect(cta.style.cursor).toBe("not-allowed");
    // Registre neutre désactivé (jamais le fond accent plein sous lequel le texte inverse dilué
    // tombait sous 4.5:1) — ROUGIT si le fond désactivé repasse à `--color-accent-primary`.
    expect(cta.style.backgroundColor).toBe("var(--color-bg-tertiary)");
    expect(cta.style.color).toBe("var(--color-text-secondary)");

    for (const theme of THEMES) {
      const text = resolveTokenColor(theme, "color-text-secondary");
      const bg = resolveTokenColor(theme, "color-bg-tertiary");
      const painted = opacity === 1 ? text : mixSrgb(text, bg, opacity);
      expect(contrastRatio(painted, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("« Continuer » ACTIF : registre accent plein (texte inverse sur accent), pas le fond désactivé", () => {
    render(<OnboardingFlow />);
    // Saisir prénom + avatar → « Continuer » ACTIF.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    fireEvent.click(screen.getByRole("button", { name: avatarLabel }));
    const cta = screen.getByRole("button", { name: nav.next });
    expect(cta).toBeEnabled();
    // ROUGIT si le style désactivé (neutre) fuit sur l'état actif : l'actif reste plein-accent.
    expect(cta.style.backgroundColor).toBe("var(--color-accent-primary)");
    expect(cta.style.color).toBe("var(--color-text-inverse)");
    for (const theme of THEMES) {
      expect(
        contrastRatio(
          resolveTokenColor(theme, "color-text-inverse"),
          resolveTokenColor(theme, "color-accent-primary"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
