import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ThemeToggle, getInitialTheme } from "./ThemeToggle";

describe("getInitialTheme", () => {
  it("retourne 'light' en contexte SSR (window undefined)", () => {
    const origWindow = globalThis.window;
    // @ts-expect-error — simule l'absence de window (SSR)
    delete globalThis.window;
    expect(getInitialTheme()).toBe("light");
    globalThis.window = origWindow;
  });

  it("retourne la valeur stockée 'dark' sur data-theme", () => {
    document.documentElement.dataset.theme = "dark";
    expect(getInitialTheme()).toBe("dark");
    delete document.documentElement.dataset.theme;
  });

  it("retourne la valeur stockée 'light' sur data-theme", () => {
    document.documentElement.dataset.theme = "light";
    expect(getInitialTheme()).toBe("light");
    delete document.documentElement.dataset.theme;
  });

  it("retourne 'dark' via matchMedia quand pas de valeur stockée", () => {
    delete document.documentElement.dataset.theme;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    expect(getInitialTheme()).toBe("dark");
    // Restore stub par défaut (matches: false)
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  it("retourne 'light' via matchMedia quand pas de valeur stockée et pas dark", () => {
    delete document.documentElement.dataset.theme;
    expect(getInitialTheme()).toBe("light");
  });
});

describe("ThemeToggle", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("rend un bouton accessible", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Basculer le thème" })).toBeInTheDocument();
  });

  it("aria-pressed=false en mode clair initial", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: "Basculer le thème" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("bascule vers dark au clic : aria-pressed=true et data-theme=dark", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: "Basculer le thème" });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("bascule retour vers light au second clic", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: "Basculer le thème" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("applique data-theme sur documentElement via useEffect", () => {
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
