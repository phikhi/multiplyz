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

  it("le rendu SSR utilise getServerSnapshot=false (jamais matchMedia) MÊME quand matchMedia annonce déjà un match téléphone, puis se resynchronise après hydratation (déterminisme SSR, fix #305)", () => {
    // Ce que CE test unitaire prouve : le rendu SERVEUR (`renderToString`) émet TOUJOURS la valeur
    // `getServerSnapshot` (`false` → "desktop"), sans JAMAIS lire `window.matchMedia`, MÊME quand
    // celui-ci est mocké à "téléphone" (le pire cas #305) — c'est LA propriété qui garantit que le
    // HTML serveur et le 1ᵉʳ rendu client à l'hydratation sont identiques par construction. La
    // resynchronisation post-hydratation (`useSyncExternalStore` → `getSnapshot`) applique ensuite
    // la vraie valeur ("phone") sans perte de comportement responsive.
    //
    // ⚠️ Ce que ce test NE prouve PAS (et ne PEUT pas, structurellement) : l'ABSENCE d'un
    // `console.error` de mismatch d'hydratation. Dans jsdom, `window` EXISTE pendant
    // `renderToString`, donc l'ANCIEN code (revert : `useState(getInitialIsPhone)`) lirait
    // matchMedia AU SSR AUSSI → rendus serveur et client identiques ("phone"/"phone") → AUCUN
    // mismatch React observable en jsdom. Un test « pas de `console.error` /hydrat/ » resterait
    // donc VERT sur revert = VACUOUS (#143). La preuve du mismatch console vit **EXCLUSIVEMENT dans
    // l'E2E** (`auth.spec.ts`, vrai navigateur, SSR SANS `window` → la divergence réelle) — pas ici.
    //
    // Root cause #305 : l'ANCIEN `useIsPhone` appelait `getInitialIsPhone` (lecture SYNCHRONE de
    // `matchMedia`) comme initialiseur de `useState` — en vrai navigateur le 1ᵉʳ rendu CLIENT
    // (hydratation) reflétait DÉJÀ la vraie valeur, divergeant du SSR (`window` absent → `false`)
    // dès que le viewport matchait `--bp-phone` → mismatch d'hydratation 100 % reproductible sur
    // `/carte` (`MapScreen` applique `isPhone` dans TOUS ses états, y compris `loading`, SSR'd).
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

    const container = document.createElement("div");
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      // GARDE À EFFET OBSERVABLE (#60) qui ROUGIT sur revert : le rendu SERVEUR utilise
      // `getServerSnapshot`=false → "desktop", jamais matchMedia (mocké "téléphone" ici). Sur un
      // revert vers `useState(getInitialIsPhone)`, jsdom a `window` au SSR → matchMedia est lu →
      // `renderToString` produirait "phone" → cette assertion échoue (`expected 'phone' to be
      // 'desktop'`, vérifié empiriquement au build). C'est LA garde non-vacuous de ce test unitaire.
      container.innerHTML = renderToString(<Probe />);
      expect(container.textContent).toBe("desktop");

      // Hydratation — 1ᵉʳ rendu CLIENT réel (`getServerSnapshot`), puis resynchronisation.
      act(() => {
        root = hydrateRoot(container, <Probe />);
      });

      // Le comportement responsive n'est pas perdu : après resynchronisation (`useSyncExternalStore`
      // → `getSnapshot`), le DOM reflète la vraie valeur ("phone"). Lu AVANT `unmount()` (finally).
      expect(container.textContent).toBe("phone");
    } finally {
      root?.unmount();
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
