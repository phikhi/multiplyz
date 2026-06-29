import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegistration } from "./ServiceWorkerRegistration";

describe("ServiceWorkerRegistration", () => {
  it("rend null (aucun élément DOM)", () => {
    const { container } = render(<ServiceWorkerRegistration />);
    expect(container).toBeEmptyDOMElement();
  });

  describe("quand navigator.serviceWorker est absent (navigateur sans support SW)", () => {
    it("ne lance pas de registration et ne jette pas d'erreur", () => {
      // jsdom ne définit pas navigator.serviceWorker par défaut → branche early-return
      expect("serviceWorker" in navigator).toBe(false);
      expect(() => render(<ServiceWorkerRegistration />)).not.toThrow();
    });
  });

  describe("quand navigator.serviceWorker est disponible", () => {
    const mockRegister = vi.fn();

    beforeEach(() => {
      Object.defineProperty(navigator, "serviceWorker", {
        value: { register: mockRegister },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      // Réinitialiser la propriété après chaque test
      Object.defineProperty(navigator, "serviceWorker", {
        value: undefined,
        writable: true,
        configurable: true,
      });
      mockRegister.mockReset();
    });

    it("appelle navigator.serviceWorker.register('/sw.js')", async () => {
      mockRegister.mockResolvedValue(undefined);
      render(<ServiceWorkerRegistration />);
      // useEffect est synchrone dans le test (React 18 flushes effects)
      await vi.waitFor(() => expect(mockRegister).toHaveBeenCalledWith("/sw.js"));
    });

    it("logue silencieusement si l'enregistrement échoue (dégradation douce)", async () => {
      mockRegister.mockRejectedValue(new Error("SW blocked"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(<ServiceWorkerRegistration />);

      await vi.waitFor(() =>
        expect(consoleSpy).toHaveBeenCalledWith("[SW] Échec d'enregistrement :", expect.any(Error)),
      );

      consoleSpy.mockRestore();
    });
  });
});
