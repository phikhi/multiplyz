import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// jsdom ne fournit pas window.matchMedia — stub minimal pour les tests.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom ne fournit pas Element.prototype.scrollIntoView (`undefined`, jamais un no-op) — stub
// minimal **configurable** (ancrage auto-scroll vers le nœud courant, story #268, `MapScreen.tsx`) :
// `vi.spyOn(Element.prototype, "scrollIntoView")` exige une fonction PRÉEXISTANTE à espionner
// (throw sinon), donc ce stub doit exister globalement avant tout test qui l'espionne.
Object.defineProperty(Element.prototype, "scrollIntoView", {
  writable: true,
  configurable: true,
  value: () => {},
});
