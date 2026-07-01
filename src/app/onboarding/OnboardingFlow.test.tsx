import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingFlow } from "./OnboardingFlow";
import { createHouseholdAction } from "./actions";
import { strings } from "@/strings";
import { AVATARS } from "@/config/avatars";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./actions", () => ({ createHouseholdAction: vi.fn() }));

const actionMock = vi.mocked(createHouseholdAction);

const nav = strings.onboarding.nav;

function pressDigits(digits: string) {
  for (const d of digits) {
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", d) }));
  }
}

/** Amène l'assistant jusqu'à l'étape parent avec un code parent complet. */
function driveToParentReady() {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
  fireEvent.click(screen.getByRole("button", { name: AVATARS[0].emoji }));
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
    fireEvent.click(screen.getByRole("button", { name: AVATARS[0].emoji }));
    expect(next()).toBeDisabled(); // prénom manquant

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    expect(next()).toBeEnabled();
  });

  it("code enfant : suivant désactivé tant que < 4 chiffres", () => {
    render(<OnboardingFlow />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Léa" } });
    fireEvent.click(screen.getByRole("button", { name: AVATARS[0].emoji }));
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
    fireEvent.click(screen.getByRole("button", { name: AVATARS[0].emoji }));
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
    fireEvent.click(screen.getByRole("button", { name: AVATARS[0].emoji }));
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
