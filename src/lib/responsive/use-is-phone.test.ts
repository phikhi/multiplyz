import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getInitialIsPhone, phoneMediaQuery, useIsPhone } from "./use-is-phone";

describe("getInitialIsPhone", () => {
  it("retourne false en contexte SSR (window absent)", () => {
    const origWindow = globalThis.window;
    // @ts-expect-error — simule l'absence de window (SSR)
    delete globalThis.window;
    try {
      expect(getInitialIsPhone()).toBe(false);
    } finally {
      globalThis.window = origWindow;
    }
  });

  it("lit matchMedia quand window est présent (stub global matches:false)", () => {
    expect(getInitialIsPhone()).toBe(false);
  });
});

describe("phoneMediaQuery", () => {
  it("retourne le repli SSR quand window est absent", () => {
    const origWindow = globalThis.window;
    // @ts-expect-error — simule l'absence de window (SSR, ne matche jamais)
    delete globalThis.window;
    try {
      expect(phoneMediaQuery()).toBe("(max-width: 0px)");
    } finally {
      globalThis.window = origWindow;
    }
  });

  it("retourne la sentinelle « ne matche jamais » quand --bp-phone n'est pas résolvable (jsdom sans tokens.css), SANS breakpoint fabriqué", () => {
    // jsdom ne charge pas tokens.css importé par un fichier externe → getPropertyValue vide ici
    // (comportement par défaut de l'environnement de test, aucun setup nécessaire). Le repli est
    // la sentinelle 0px (jamais un nombre de breakpoint dupliqué) → useIsPhone retombe sur false.
    expect(phoneMediaQuery()).toBe("(max-width: 0px)");
  });

  it("lit la valeur RÉSOLUE de --bp-phone quand posée sur documentElement (source de vérité tokens.css)", () => {
    document.documentElement.style.setProperty("--bp-phone", "20rem");
    try {
      // Garde à effet observable : si `phoneMediaQuery` retombe sur le repli en dur au lieu de
      // lire le token, cette valeur (20rem, distincte du repli 30rem) ne serait jamais retournée.
      expect(phoneMediaQuery()).toBe("(max-width: 20rem)");
    } finally {
      document.documentElement.style.removeProperty("--bp-phone");
    }
  });
});

describe("useIsPhone", () => {
  it("retourne false par défaut (stub matchMedia global, vitest.setup.ts, matches:false)", () => {
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
  });

  it("retourne true quand matchMedia signale un match téléphone", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { result } = renderHook(() => useIsPhone());
      expect(result.current).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });

  it("se met à jour au changement de breakpoint (listener `change`)", () => {
    const original = window.matchMedia;
    let changeHandler: ((event: { matches: boolean }) => void) | null = null;
    let currentMatches = false;
    window.matchMedia = ((query: string) => ({
      get matches() {
        return currentMatches;
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, handler: (event: { matches: boolean }) => void) => {
        changeHandler = handler;
      },
      removeEventListener: () => {
        changeHandler = null;
      },
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { result } = renderHook(() => useIsPhone());
      expect(result.current).toBe(false);

      currentMatches = true;
      act(() => {
        // Garde à effet observable : si le listener `change` n'est jamais câblé (branché sur
        // `addEventListener`), ce dispatch resterait sans effet et l'assertion suivante échouerait.
        changeHandler?.({ matches: true });
      });
      expect(result.current).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });

  it("désabonne le listener au démontage (nettoyage useEffect)", () => {
    const original = window.matchMedia;
    let removed = false;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {
        removed = true;
      },
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { unmount } = renderHook(() => useIsPhone());
      unmount();
      expect(removed).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });
});
