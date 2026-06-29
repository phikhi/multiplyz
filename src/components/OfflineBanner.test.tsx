import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfflineBanner } from "./OfflineBanner";
import { strings } from "@/strings";

// Helper : remplace navigator.onLine en jsdom.
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    value,
    writable: true,
    configurable: true,
  });
}

// Repart de navigator.onLine = true entre chaque test.
afterEach(() => {
  setOnline(true);
});

// ─── Région live — toujours montée ──────────────────────────────────────────

describe("OfflineBanner — région live (toujours montée)", () => {
  it("la région role=status est présente dans le DOM même quand en ligne", () => {
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("la région live est vide quand en ligne (navigator.onLine = true)", () => {
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("la région live porte aria-live=polite et aria-atomic=true", () => {
    render(<OfflineBanner />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
  });

  it("pas d'aria-label sur la région live (ne doit pas écraser le texte annoncé)", () => {
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).not.toHaveAttribute("aria-label");
  });
});

// ─── État en ligne — pas de bannière visuelle ────────────────────────────────

describe("OfflineBanner — état en ligne", () => {
  it("n'affiche pas de bannière visuelle quand en ligne", () => {
    render(<OfflineBanner />);
    expect(screen.queryByText(strings.pwa.offline)).not.toBeInTheDocument();
    expect(screen.queryByText(strings.pwa.coldStart)).not.toBeInTheDocument();
  });
});

// ─── Cold-start offline ──────────────────────────────────────────────────────

describe("OfflineBanner — cold-start offline (navigator.onLine = false au montage)", () => {
  beforeEach(() => {
    setOnline(false); // Simuler le démarrage hors-ligne AVANT le rendu
  });

  it("la région live contient le message cold-start", () => {
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(strings.pwa.coldStart);
  });

  it("la bannière visuelle affiche le message cold-start (2 occurrences : live + visuelle)", () => {
    render(<OfflineBanner />);
    // Le texte est présent dans la région live ET dans la bannière visuelle aria-hidden
    const matches = screen.getAllByText(strings.pwa.coldStart);
    expect(matches).toHaveLength(2);
    const visualBanner = matches.find((el) => el.getAttribute("aria-hidden") === "true");
    expect(visualBanner).toBeInTheDocument();
  });

  it("n'affiche PAS le message mid-session (mauvais contexte)", () => {
    render(<OfflineBanner />);
    expect(screen.queryByText(strings.pwa.offline)).not.toBeInTheDocument();
  });
});

// ─── Perte mid-session ───────────────────────────────────────────────────────

describe("OfflineBanner — perte mid-session (offline déclenché pendant la session)", () => {
  it("la région live contient le message mid-session Teddy", async () => {
    render(<OfflineBanner />); // Démarre en ligne

    // Couper le réseau : met à jour navigator.onLine PUIS déclenche l'événement
    setOnline(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByRole("status")).toHaveTextContent(strings.pwa.offline);
  });

  it("la bannière visuelle affiche le message mid-session (2 occurrences : live + visuelle)", async () => {
    render(<OfflineBanner />);

    setOnline(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });

    // Le texte est présent dans la région live ET dans la bannière visuelle aria-hidden
    const matches = screen.getAllByText(strings.pwa.offline);
    expect(matches).toHaveLength(2);
    const visualBanner = matches.find((el) => el.getAttribute("aria-hidden") === "true");
    expect(visualBanner).toBeInTheDocument();
  });

  it("n'affiche PAS le message cold-start (mauvais contexte)", async () => {
    render(<OfflineBanner />);

    setOnline(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.queryByText(strings.pwa.coldStart)).not.toBeInTheDocument();
  });
});

// ─── Retour en ligne ─────────────────────────────────────────────────────────

describe("OfflineBanner — retour en ligne", () => {
  it("vide la région live et masque la bannière visuelle", async () => {
    render(<OfflineBanner />);

    // Passe offline
    setOnline(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(strings.pwa.offline);

    // Revient en ligne
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryByText(strings.pwa.offline)).not.toBeInTheDocument();
  });
});

// ─── Nettoyage ───────────────────────────────────────────────────────────────

describe("OfflineBanner — nettoyage des listeners", () => {
  it("retire les event listeners au démontage (pas de fuite mémoire)", () => {
    const { unmount } = render(<OfflineBanner />);
    unmount();

    // Événements après démontage → ne doivent pas causer d'erreur
    expect(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    }).not.toThrow();
  });
});
