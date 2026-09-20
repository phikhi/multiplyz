import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingFlow } from "./OnboardingFlow";
import { createHouseholdAction } from "./actions";
import { strings } from "@/strings";
import { daily } from "@/strings/daily";
import { AVATARS } from "@/config/avatars";
import {
  contrastRatio,
  mixSrgb,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";

const style = document.createElement("style");
// jsdom ne résout pas var() dans les raccourcis background ; injecter les couleurs réelles.
style.textContent = (
  readFileSync("src/app/forest.css", "utf8") + readFileSync("src/app/daily.css", "utf8")
).replace(/var\(--(forest-(?:paper|gold|ink|muted))\)/g, (_, token: string) =>
  resolveTokenColor("light", token),
);
beforeAll(() => document.head.append(style));
afterAll(() => style.remove());
function renderFlow() {
  return render(
    <div className="forest daily-home">
      <OnboardingFlow />
    </div>,
  );
}
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
  fireEvent.click(screen.getByRole("button", { name: nav.next })); // → confirmChild
  pressDigits("1234");
  fireEvent.click(screen.getByRole("button", { name: nav.next })); // → parentPin
  pressDigits("9876");
  fireEvent.click(screen.getByRole("button", { name: nav.next })); // → confirmParent
  pressDigits("9876");
}

beforeEach(() => {
  actionMock.mockReset();
  refresh.mockReset();
});

describe("OnboardingFlow — gating par étape (affordance client)", () => {
  it("« Continuer » désactivé tant que prénom OU avatar manquent", () => {
    renderFlow();
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
    renderFlow();
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
    renderFlow();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    fireEvent.click(screen.getByRole("button", { name: avatarLabel }));
    fireEvent.click(screen.getByRole("button", { name: nav.next }));
    pressDigits("1234");
    fireEvent.click(screen.getByRole("button", { name: nav.next }));
    pressDigits("1234");
    fireEvent.click(screen.getByRole("button", { name: nav.next }));
    pressDigits("9876");
    fireEvent.click(screen.getByRole("button", { name: nav.next }));
    expect(screen.getByRole("button", { name: nav.create })).toBeDisabled();
    pressDigits("9876");
    expect(screen.getByRole("button", { name: nav.create })).toBeEnabled();
  });
});

describe("OnboardingFlow — navigation arrière", () => {
  it("retour ramène code enfant → profil, code parent → code enfant", () => {
    renderFlow();
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
    renderFlow();
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
    renderFlow();
    const heading = screen.getByRole("heading", { name: strings.onboarding.profile.title });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveFocus();
  });

  it("annonce le code de secours dans une région live (role=status)", async () => {
    actionMock.mockResolvedValue({ ok: true, recoveryCode: "ABCD2345" });
    renderFlow();
    driveToParentReady();
    fireEvent.click(screen.getByRole("button", { name: nav.create }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("ABCD2345");
  });
});

describe("OnboardingFlow — soumission", () => {
  it("succès → code de secours affiché une fois → prêt → refresh", async () => {
    actionMock.mockResolvedValue({ ok: true, recoveryCode: "ABCD2345" });
    renderFlow();
    driveToParentReady();
    fireEvent.click(screen.getByRole("button", { name: nav.create }));

    expect(await screen.findByText("ABCD2345")).toBeInTheDocument();
    expect(actionMock).toHaveBeenCalledWith({
      name: "Léa",
      avatar: AVATARS[0].id,
      childPin: "1234",
      parentPin: "9876",
    });

    expect(screen.getByRole("button", { name: strings.onboarding.recovery.done })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: daily.recoveryChecked }));
    fireEvent.click(screen.getByRole("button", { name: strings.onboarding.recovery.done }));
    fireEvent.click(screen.getByRole("button", { name: strings.onboarding.ready.cta }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("foyer déjà configuré (rejeu) → écran prêt, pas de code", async () => {
    actionMock.mockResolvedValue({ ok: true, alreadyConfigured: true });
    renderFlow();
    driveToParentReady();
    fireEvent.click(screen.getByRole("button", { name: nav.create }));

    expect(await screen.findByText(daily.configured)).toBeInTheDocument();
  });

  it("erreur PIN → reste sur code parent avec alerte (posture croissance)", async () => {
    actionMock.mockResolvedValue({ ok: false, code: "PARENT_PIN_SAME" });
    renderFlow();
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
    renderFlow();
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
    renderFlow();
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
    renderFlow();
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
    renderFlow();
    // Étape profil, rien saisi → « Continuer » DÉSACTIVÉ (canContinueProfile=false).
    const cta = screen.getByRole("button", { name: nav.next });
    expect(cta).toBeDisabled();

    const opacity =
      getComputedStyle(cta).opacity === "" ? 1 : Number(getComputedStyle(cta).opacity);
    expect(opacity).toBe(1); // garde directe : aucune opacity diluante sur le CTA plein-texte
    expect(cta).toHaveAttribute("disabled");
    expect(getComputedStyle(cta).cursor).toBe("not-allowed");
    // Registre neutre désactivé (jamais le fond accent plein sous lequel le texte inverse dilué
    // tombait sous 4.5:1) — ROUGIT si le fond désactivé repasse à `--color-accent-primary`.
    expect(cta).toHaveStyle({ backgroundColor: resolveTokenColor("light", "forest-paper") });
    expect(cta).toHaveStyle({ color: resolveTokenColor("light", "forest-muted") });

    for (const theme of THEMES) {
      const text = resolveTokenColor(theme, "forest-muted");
      const bg = resolveTokenColor(theme, "forest-paper");
      const painted = opacity === 1 ? text : mixSrgb(text, bg, opacity);
      expect(contrastRatio(painted, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("« Continuer » ACTIF : registre accent plein (texte inverse sur accent), pas le fond désactivé", () => {
    renderFlow();
    // Saisir prénom + avatar → « Continuer » ACTIF.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    fireEvent.click(screen.getByRole("button", { name: avatarLabel }));
    const cta = screen.getByRole("button", { name: nav.next });
    expect(cta).toBeEnabled();
    // ROUGIT si le style désactivé (neutre) fuit sur l'état actif : l'actif reste plein-accent.
    expect(cta).toHaveStyle({ backgroundColor: resolveTokenColor("light", "forest-gold") });
    expect(cta).toHaveStyle({ color: resolveTokenColor("light", "forest-ink") });
    for (const theme of THEMES) {
      expect(
        contrastRatio(
          resolveTokenColor(theme, "forest-ink"),
          resolveTokenColor(theme, "forest-gold"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

it("refuses a different parent confirmation, clears it and keeps the chosen PIN", () => {
  renderFlow(); driveToParentReady();
  fireEvent.click(screen.getByRole("button", { name: strings.pinPad.backspace }));
  pressDigits("5");
  fireEvent.click(screen.getByRole("button", { name: nav.create }));
  expect(screen.getByRole("alert")).toHaveTextContent(daily.mismatch);
  expect(actionMock).not.toHaveBeenCalled();
});
