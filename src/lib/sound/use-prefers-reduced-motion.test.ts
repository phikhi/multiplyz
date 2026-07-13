import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  getInitialPrefersReducedMotion,
  usePrefersReducedMotion,
} from "./use-prefers-reduced-motion";

describe("getInitialPrefersReducedMotion", () => {
  it("retourne false en contexte SSR (window absent)", () => {
    const origWindow = globalThis.window;
    // @ts-expect-error — simule l'absence de window (SSR)
    delete globalThis.window;
    try {
      expect(getInitialPrefersReducedMotion()).toBe(false);
    } finally {
      globalThis.window = origWindow;
    }
  });

  it("lit matchMedia quand window est présent (stub global matches:false, vitest.setup.ts)", () => {
    expect(getInitialPrefersReducedMotion()).toBe(false);
  });
});

describe("usePrefersReducedMotion", () => {
  it("retourne false par défaut (stub matchMedia global, matches:false)", () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("retourne true quand matchMedia signale prefers-reduced-motion: reduce", () => {
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
      const { result } = renderHook(() => usePrefersReducedMotion());
      expect(result.current).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });

  it("se met à jour au changement (listener `change`)", () => {
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
      const { result } = renderHook(() => usePrefersReducedMotion());
      expect(result.current).toBe(false);

      currentMatches = true;
      act(() => {
        // Garde à effet observable : si le listener `change` n'est jamais câblé, ce dispatch
        // resterait sans effet et l'assertion suivante échouerait.
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
      const { unmount } = renderHook(() => usePrefersReducedMotion());
      unmount();
      expect(removed).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });
});
