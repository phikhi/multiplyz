import { render, screen, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OfflineBanner } from "./OfflineBanner";
import { strings } from "@/strings";

describe("OfflineBanner", () => {
  it("n'affiche rien quand le réseau est disponible (état initial)", () => {
    // jsdom : navigator.onLine = true par défaut
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("affiche le message doux Teddy quand l'événement offline se déclenche", async () => {
    render(<OfflineBanner />);

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });

    const banner = screen.getByRole("status");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(strings.pwa.offline);
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(banner).toHaveAttribute("aria-label", strings.pwa.offlineRole);
  });

  it("masque la bannière quand la connexion est rétablie (événement online)", async () => {
    render(<OfflineBanner />);

    // Passe offline d'abord
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Rétablit la connexion
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("nettoie les event listeners au démontage (pas de fuite mémoire)", async () => {
    const { unmount } = render(<OfflineBanner />);
    unmount();

    // Déclencher offline après démontage → ne doit pas causer d'erreur
    expect(() => {
      window.dispatchEvent(new Event("offline"));
    }).not.toThrow();
  });
});
