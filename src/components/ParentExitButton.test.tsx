import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParentExitButton } from "./ParentExitButton";
import { logoutParentAction } from "@/app/parent/actions";
import { strings } from "@/strings";
import {
  contrastRatio,
  mixSrgb,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/app/parent/actions", () => ({ logoutParentAction: vi.fn() }));

const logoutParentActionMock = vi.mocked(logoutParentAction);
const THEMES: Theme[] = ["light", "dark"];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ParentExitButton", () => {
  it("clic → révoque la session parent (action) puis retourne au sélecteur", async () => {
    logoutParentActionMock.mockResolvedValue();
    render(<ParentExitButton />);

    fireEvent.click(screen.getByRole("button", { name: strings.parent.dashboard.exit }));

    await waitFor(() => expect(logoutParentActionMock).toHaveBeenCalledOnce());
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("état DÉSACTIVÉ (pending logout) : texte COMPOSITÉ peint ≥4.5:1, aria-disabled, fond atténué discriminant (#240)", async () => {
    // Rétro Frontend #226 : un `opacity` sur ce bouton (texte) composite vers le fond → sous 4.5:1.
    // `logoutParentAction` reste en attente pour capturer l'état `pending` avant résolution.
    let resolveLogout: () => void = () => {};
    logoutParentActionMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = resolve;
        }),
    );
    render(<ParentExitButton />);
    const btn = screen.getByRole("button", { name: strings.parent.dashboard.exit });

    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());

    // ROUGIT si un `opacity` diluant est réintroduit sur le sous-arbre texte.
    const opacity = btn.style.opacity === "" ? 1 : Number(btn.style.opacity);
    expect(opacity).toBe(1);
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn.style.cursor).toBe("not-allowed");
    // Fond atténué (#227-family polish) : DISCRIMINANT du `transparent` de l'état actif — ROUGIT
    // si le fond désactivé retombe à "transparent" (régression vers l'affordance border-only faible).
    expect(btn.style.backgroundColor).toBe("var(--color-bg-tertiary)");

    for (const theme of THEMES) {
      const text = resolveTokenColor(theme, "color-text-secondary");
      const bg = resolveTokenColor(theme, "color-bg-tertiary");
      const painted = opacity === 1 ? text : mixSrgb(text, bg, opacity);
      expect(contrastRatio(painted, bg)).toBeGreaterThanOrEqual(4.5);
    }

    resolveLogout();
    await waitFor(() => expect(logoutParentActionMock).toHaveBeenCalledOnce());
  });

  it("état ACTIF : fond transparent (pas de fill désactivé hors pending)", () => {
    render(<ParentExitButton />);
    const btn = screen.getByRole("button", { name: strings.parent.dashboard.exit });
    expect(btn.style.backgroundColor).toBe("transparent");
    expect(btn).not.toHaveAttribute("aria-disabled", "true");
  });
});
