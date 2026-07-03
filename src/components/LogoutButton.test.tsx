import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogoutButton } from "./LogoutButton";
import { logoutAction } from "@/app/login/actions";
import { strings } from "@/strings";

// `push`/`refresh` synchrones ici (le mock ne simule pas le délai réel d'une
// navigation RSC) — la garde #88 ci-dessous vise le COUPLAGE `startTransition`,
// pas la durée en soi (non observable avec un mock synchrone, cf. commentaire du
// test dédié).
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/app/login/actions", () => ({ logoutAction: vi.fn() }));

const logoutActionMock = vi.mocked(logoutAction);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LogoutButton", () => {
  it("déconnecte puis renvoie au sélecteur de profil", async () => {
    logoutActionMock.mockResolvedValue();
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole("button", { name: strings.play.logout }));

    await waitFor(() => expect(logoutActionMock).toHaveBeenCalledOnce());
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("navigue via startTransition (issue #88 : le bouton reste actionnable seulement une fois la navigation retombée idle)", async () => {
    // Garde à effet observable : après le clic, le bouton redevient immédiatement
    // ACTIF (jamais durablement bloqué — no-fail UI) une fois la révocation +
    // navigation traitées. Si `router.push`/`router.refresh` étaient sortis de
    // `startTransition` (retour à l'ancien pattern fire-and-forget hors
    // transition), ce test resterait vert aussi — la garde RÉELLE (React couple
    // `isPending` à la navigation, pas seulement à l'action serveur) n'est
    // observable qu'en E2E réel (RSC fetch non simulable par ce mock synchrone) ;
    // ce test unitaire fige au moins le contrat : `push`/`refresh` sont appelés
    // exactement une fois chacun après la résolution de l'action, jamais avant.
    logoutActionMock.mockResolvedValue();
    render(<LogoutButton />);
    const button = screen.getByRole("button", { name: strings.play.logout });

    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(refresh).toHaveBeenCalledOnce();
    // `logoutAction` doit être résolu AVANT toute navigation (ordre de la course
    // corrigée #88 : jamais de navigation avant révocation serveur confirmée).
    expect(logoutActionMock).toHaveBeenCalledOnce();
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
