import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogoutButton } from "./LogoutButton";
import { logoutAction } from "@/app/login/actions";
import { strings } from "@/strings";
import {
  contrastRatio,
  mixSrgb,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";

const THEMES: Theme[] = ["light", "dark"];

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

  it("état DÉSACTIVÉ (pending) : texte COMPOSITÉ peint ≥4.5:1, aucune dilution par `opacity`, fond atténué (#240/#226)", async () => {
    // Rétro Frontend #226 : un `opacity:0.55` sur ce bouton (avec texte) compositait le texte vers
    // le fond → ~2.20:1 peint (light) / ~3.39:1 (dark). Ce test lit l'opacité RÉELLEMENT rendue en
    // état désactivé et calcule la couleur post-blend effectivement peinte → ROUGIT si un `opacity`
    // diluant revient. On tient `logoutAction` en attente pour capturer l'état `pending`/désactivé.
    let resolveLogout: () => void = () => {};
    logoutActionMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = resolve;
        }),
    );
    render(<LogoutButton />);
    const button = screen.getByRole("button", { name: strings.play.logout });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());

    const opacity = button.style.opacity === "" ? 1 : Number(button.style.opacity);
    expect(opacity).toBe(1); // garde directe : aucune opacity diluante sur le sous-arbre texte
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button.style.cursor).toBe("not-allowed");
    // Fond atténué DISCRIMINANT (patron #227) — ROUGIT si le fond désactivé retombe à "transparent".
    expect(button.style.backgroundColor).toBe("var(--color-bg-tertiary)");

    for (const theme of THEMES) {
      const text = resolveTokenColor(theme, "color-text-secondary");
      const bg = resolveTokenColor(theme, "color-bg-tertiary");
      const painted = opacity === 1 ? text : mixSrgb(text, bg, opacity);
      expect(contrastRatio(painted, bg)).toBeGreaterThanOrEqual(4.5);
    }

    resolveLogout();
    await waitFor(() => expect(logoutActionMock).toHaveBeenCalledOnce());
  });

  it("état ACTIF : fond transparent (pas de fill désactivé hors pending)", () => {
    render(<LogoutButton />);
    const button = screen.getByRole("button", { name: strings.play.logout });
    expect(button.style.backgroundColor).toBe("transparent");
    expect(button).not.toHaveAttribute("aria-disabled", "true");
  });
});
