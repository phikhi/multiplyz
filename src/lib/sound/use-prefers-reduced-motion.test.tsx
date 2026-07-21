import { act, renderHook } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

  it("le rendu SSR utilise getServerSnapshot=false (jamais matchMedia) MÊME quand matchMedia annonce déjà reduce, puis se resynchronise après hydratation (déterminisme SSR, fix #305/#353)", () => {
    // Ce que CE test unitaire prouve : le rendu SERVEUR (`renderToString`) émet TOUJOURS la valeur
    // `getServerSnapshot` (`false` → "full-motion"), sans JAMAIS lire `window.matchMedia`, MÊME quand
    // celui-ci est mocké à "reduce" (le pire cas #305) — c'est LA propriété qui garantit que le HTML
    // serveur et le 1ᵉʳ rendu client à l'hydratation sont identiques par construction. La
    // resynchronisation post-hydratation (`useSyncExternalStore` → `getSnapshot`) applique ensuite la
    // vraie valeur ("reduce") sans perte de comportement.
    //
    // ⚠️ Ce que ce test NE prouve PAS (et ne PEUT pas, structurellement) : l'ABSENCE d'un
    // `console.error` de mismatch d'hydratation. Dans jsdom, `window` EXISTE pendant `renderToString`,
    // donc l'ANCIEN code (revert : `useState(getInitialPrefersReducedMotion)`) lirait matchMedia AU SSR
    // AUSSI → rendus serveur et client identiques ("reduce"/"reduce") → AUCUN mismatch React observable
    // en jsdom. Un test « pas de `console.error` /hydrat/ » resterait donc VERT sur revert = VACUOUS
    // (#143). La preuve du mismatch console vit **EXCLUSIVEMENT dans l'E2E** (vrai navigateur, SSR SANS
    // `window`) — et ici, préventif (#353) : le seul consommateur (`SoundProvider`) ne rend PAS cette
    // valeur au DOM (logique audio seule), donc aucun mismatch n'est observable aujourd'hui même en
    // vrai navigateur ; cet unit prouve l'EFFET DE SORTIE (`getServerSnapshot` utilisé), pas l'absence
    // de mismatch (cf. CLAUDE.md, règle #305 : l'unit prouve l'effet de sortie, jamais le mismatch).
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true, // matchMedia annonce "reduce" DÈS le tout 1ᵉʳ appel (le pire cas #305).
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    function Probe() {
      return <span>{usePrefersReducedMotion() ? "reduce" : "full-motion"}</span>;
    }

    const container = document.createElement("div");
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      // GARDE À EFFET OBSERVABLE (#60) qui ROUGIT sur revert : le rendu SERVEUR utilise
      // `getServerSnapshot`=false → "full-motion", jamais matchMedia (mocké "reduce" ici). Sur un revert
      // vers `useState(getInitialPrefersReducedMotion)`, jsdom a `window` au SSR → matchMedia est lu →
      // `renderToString` produirait "reduce" → cette assertion échoue (`expected 'reduce' to be
      // 'full-motion'`). C'est LA garde non-vacuous de ce test unitaire (effet de sortie #305/#353).
      container.innerHTML = renderToString(<Probe />);
      expect(container.textContent).toBe("full-motion");

      // Hydratation — 1ᵉʳ rendu CLIENT réel (`getServerSnapshot`), puis resynchronisation.
      act(() => {
        root = hydrateRoot(container, <Probe />);
      });

      // Après resynchronisation (`useSyncExternalStore` → `getSnapshot`), le DOM reflète la vraie valeur
      // ("reduce"). Lu AVANT `unmount()` (finally).
      expect(container.textContent).toBe("reduce");
    } finally {
      root?.unmount();
      window.matchMedia = original;
    }
  });

  it("se met à jour au changement (listener `change`)", () => {
    const original = window.matchMedia;
    let changeHandler: (() => void) | null = null;
    let currentMatches = false;
    window.matchMedia = ((query: string) => ({
      get matches() {
        return currentMatches;
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, handler: () => void) => {
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
        // Garde à effet observable : si le listener `change` n'est jamais câblé (branché sur
        // `addEventListener` dans `subscribe`), ce dispatch resterait sans effet et l'assertion
        // suivante échouerait. `useSyncExternalStore` notifie via ce callback puis relit `getSnapshot`.
        changeHandler?.();
      });
      expect(result.current).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });

  it("désabonne le listener au démontage (cleanup de subscribe)", () => {
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
