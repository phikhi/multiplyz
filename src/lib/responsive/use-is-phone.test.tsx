import { act, renderHook } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

  it("aucun mismatch d'hydratation RÉEL (renderToString → hydrateRoot), même quand matchMedia annonce déjà un match téléphone (déterminisme SSR=1ᵉʳ rendu client, fix #305)", () => {
    // `renderHook`/`render()` (RTL) montent via `createRoot` — un rendu CLIENT PUR, qui n'appelle
    // JAMAIS `getServerSnapshot` et ne peut donc PAS prouver le déterminisme SSR→hydratation (la
    // nature même du bug #305). Seule une VRAIE hydratation (`renderToString` = ce que le serveur
    // produit, puis `hydrateRoot` = le 1ᵉʳ rendu client qui compare au HTML reçu) exerce le
    // mécanisme réellement en cause — même patron que l'E2E `auth.spec.ts` (« AUCUN mismatch
    // d'hydratation React (fix #305) »), reproduit ici au niveau unitaire (rapide, sans navigateur).
    //
    // Root cause #305 : l'ANCIEN `useIsPhone` appelait `getInitialIsPhone` (lecture SYNCHRONE de
    // `matchMedia`) comme initialiseur de `useState` — le 1ᵉʳ rendu CLIENT (hydratation) reflétait
    // alors DÉJÀ la vraie valeur, divergeant du SSR (`window` absent → toujours `false`) dès que
    // le viewport réel matchait `--bp-phone` → mismatch d'hydratation React 100 % reproductible
    // sur `/carte` (`MapScreen` applique `isPhone` dans TOUS ses états, y compris `loading`,
    // lui-même SSR'd).
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true, // matchMedia annonce "téléphone" DÈS le tout 1ᵉʳ appel (le pire cas #305).
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    function Probe() {
      return <span>{useIsPhone() ? "phone" : "desktop"}</span>;
    }

    const consoleErrors: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args);
    };

    const container = document.createElement("div");
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      // 1) SSR — `getServerSnapshot` (TOUJOURS `false`) produit le HTML serveur, sans jamais lire
      // `window.matchMedia` (mocké à `true` ci-dessus — preuve que le SSR l'ignore complètement).
      container.innerHTML = renderToString(<Probe />);
      expect(container.textContent).toBe("desktop");

      // 2) Hydratation — 1ᵉʳ rendu CLIENT réel, comparé par React au HTML serveur ci-dessus.
      act(() => {
        root = hydrateRoot(container, <Probe />);
      });

      // Garde à effet observable PRINCIPALE : ROUGIT si React logue un mismatch d'hydratation —
      // reproduit EXACTEMENT la condition #305 (matchMedia=téléphone dès le 1ᵉʳ appel) au niveau
      // unitaire. Vérifié rouge en revertant temporairement `useIsPhone` vers l'ancien
      // initialiseur synchrone pendant le build (`expected true to be false`, cf. reçu de PR).
      const hydrationMismatch = consoleErrors.some((args) =>
        args.some((arg) => typeof arg === "string" && /hydrat/i.test(arg)),
      );
      expect(hydrationMismatch).toBe(false);
      // Le comportement responsive n'est pas perdu : après resynchronisation
      // (`useSyncExternalStore` vers `getSnapshot`), le DOM reflète bien la vraie valeur (`true`,
      // mockée) — pas seulement « aucun warning », mais le résultat visuel attendu. Lu AVANT
      // `unmount()` (le `finally` ci-dessous), qui viderait sinon le conteneur.
      expect(container.textContent).toBe("phone");
    } finally {
      root?.unmount();
      console.error = originalConsoleError;
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
