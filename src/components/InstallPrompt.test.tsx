import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InstallPrompt,
  isIOSSafari,
  isStandaloneDisplayMode,
  persistInstallPromptDismissed,
  readInstallPromptDismissed,
} from "./InstallPrompt";
import { strings } from "@/strings";
import { INSTALL_PROMPT_DISMISSED_KEY } from "@/config/pwa";
import {
  contrastRatio,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";

const THEMES: Theme[] = ["light", "dark"];

const IPHONE_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1";
const IPADOS_DESKTOP_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const DESKTOP_MAC_SAFARI_UA = IPADOS_DESKTOP_SAFARI_UA; // même UA que l'iPad desktop ; distingué par maxTouchPoints
const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

/**
 * Surcharge `navigator.userAgent`/`maxTouchPoints` — restaurer en `finally` (rétro #186/#193).
 * **Toujours `await` cet appel**, même pour un `fn` synchrone : `fn` peut être `async` (le
 * composant décide `isIOSSafari()` dans une microtâche différée, cf. `InstallPrompt.tsx` —
 * `react-hooks/set-state-in-effect`) — un `finally` qui ne récupère la valeur qu'au retour
 * synchrone de `fn()` restaurerait l'UA AVANT que cette microtâche ne s'exécute (rétro #186 :
 * un `try/finally` non gardé sur une valeur async déplace/désarme l'effet observé).
 */
async function withUserAgent<T>(
  ua: string,
  maxTouchPoints: number,
  fn: () => T | Promise<T>,
): Promise<T> {
  const origUA = window.navigator.userAgent;
  const origTouch = window.navigator.maxTouchPoints;
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    value: maxTouchPoints,
    configurable: true,
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(window.navigator, "userAgent", { value: origUA, configurable: true });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      value: origTouch,
      configurable: true,
    });
  }
}

/** Fake `beforeinstallprompt` — l'API réelle n'est pas déclenchable en test (Chromium headless). */
class FakeBeforeInstallPromptEvent extends Event {
  promptCalls = 0;
  private readonly outcome: "accepted" | "dismissed";
  private promptImpl: () => Promise<void>;

  constructor(outcome: "accepted" | "dismissed" = "accepted", promptImpl?: () => Promise<void>) {
    super("beforeinstallprompt", { cancelable: true });
    this.outcome = outcome;
    this.promptImpl = promptImpl ?? (() => Promise.resolve());
  }

  get userChoice() {
    return Promise.resolve({ outcome: this.outcome, platform: "web" });
  }

  prompt(): Promise<void> {
    this.promptCalls += 1;
    return this.promptImpl();
  }
}

afterEach(() => {
  window.localStorage.clear();
});

/**
 * Laisse s'exécuter la microtâche différée de `InstallPrompt` (react-hooks/set-state-in-effect
 * — cf. commentaire du composant) : sans ce flush, un `dispatchEvent` juste après `render()`
 * arrive AVANT que les listeners `beforeinstallprompt`/`appinstalled` ne soient attachés → événement
 * perdu. Deux `Promise.resolve()` (marge de sécurité sur le nombre de sauts de microtâche).
 */
async function flushMountMicrotask() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ─── isStandaloneDisplayMode (AC3) ──────────────────────────────────────────

describe("isStandaloneDisplayMode", () => {
  it("false hors standalone (matchMedia false, pas d'attribut legacy)", () => {
    expect(isStandaloneDisplayMode()).toBe(false);
  });

  it("true via la media query `display-mode: standalone`", () => {
    const original = window.matchMedia;
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    try {
      expect(isStandaloneDisplayMode()).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });

  it("true via l'attribut legacy iOS `navigator.standalone`", () => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    Object.defineProperty(nav, "standalone", { value: true, configurable: true });
    try {
      expect(isStandaloneDisplayMode()).toBe(true);
    } finally {
      Object.defineProperty(nav, "standalone", { value: undefined, configurable: true });
    }
  });

  it("false en contexte SSR (window undefined)", () => {
    const origWindow = globalThis.window;
    // @ts-expect-error — simule l'absence de window (SSR)
    delete globalThis.window;
    try {
      expect(isStandaloneDisplayMode()).toBe(false);
    } finally {
      globalThis.window = origWindow;
    }
  });

  it("false quand window.matchMedia n'est pas une fonction (navigateur ancien)", () => {
    const original = window.matchMedia;
    // @ts-expect-error — simule un navigateur sans matchMedia
    delete window.matchMedia;
    try {
      expect(isStandaloneDisplayMode()).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});

// ─── isIOSSafari (AC2) ───────────────────────────────────────────────────────

describe("isIOSSafari", () => {
  it("true sur iPhone Safari", async () => {
    await withUserAgent(IPHONE_SAFARI_UA, 5, () => {
      expect(isIOSSafari()).toBe(true);
    });
  });

  it("true sur iPadOS 13+ en UA desktop (Macintosh + maxTouchPoints > 1)", async () => {
    await withUserAgent(IPADOS_DESKTOP_SAFARI_UA, 5, () => {
      expect(isIOSSafari()).toBe(true);
    });
  });

  it("false sur un vrai Mac desktop (même UA, maxTouchPoints = 0)", async () => {
    await withUserAgent(DESKTOP_MAC_SAFARI_UA, 0, () => {
      expect(isIOSSafari()).toBe(false);
    });
  });

  it("false sur Chrome iOS (CriOS) — navigateur tiers exclu malgré le moteur WebKit", async () => {
    await withUserAgent(IPHONE_CHROME_UA, 5, () => {
      expect(isIOSSafari()).toBe(false);
    });
  });

  it("false sur Android Chrome", async () => {
    await withUserAgent(ANDROID_CHROME_UA, 5, () => {
      expect(isIOSSafari()).toBe(false);
    });
  });

  it("false en contexte SSR (navigator undefined)", () => {
    const origNavigator = globalThis.navigator;
    // @ts-expect-error — simule l'absence de navigator (SSR)
    delete globalThis.navigator;
    try {
      expect(isIOSSafari()).toBe(false);
    } finally {
      globalThis.navigator = origNavigator;
    }
  });
});

// ─── Persistance du rejet (AC1) ──────────────────────────────────────────────

describe("readInstallPromptDismissed / persistInstallPromptDismissed", () => {
  it("false par défaut (jamais rejeté)", () => {
    expect(readInstallPromptDismissed()).toBe(false);
  });

  it("persistDismissed → readDismissed retourne true (round-trip localStorage)", () => {
    persistInstallPromptDismissed();
    expect(window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY)).toBe("1");
    expect(readInstallPromptDismissed()).toBe(true);
  });

  it("dégradation douce : read silencieux (false) si localStorage lève (mode privé strict)", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(readInstallPromptDismissed()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("dégradation douce : persist silencieux (ne lève pas) si localStorage lève", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(() => persistInstallPromptDismissed()).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

// ─── Composant InstallPrompt ─────────────────────────────────────────────────

describe("InstallPrompt — AC3 déjà installée (standalone)", () => {
  it("n'affiche rien, même si un beforeinstallprompt survient ensuite", async () => {
    const original = window.matchMedia;
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    try {
      render(<InstallPrompt />);
      expect(screen.queryByRole("region")).not.toBeInTheDocument();

      await act(async () => {
        window.dispatchEvent(new FakeBeforeInstallPromptEvent());
      });
      expect(screen.queryByRole("region")).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("InstallPrompt — AC1 rejet déjà persisté", () => {
  it("n'affiche rien au montage, et n'affiche toujours rien après un beforeinstallprompt (pas de boucle)", async () => {
    window.localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, "1");
    render(<InstallPrompt />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});

describe("InstallPrompt — AC2 hint iOS Safari", () => {
  it("affiche le hint « Partager » (après la microtâche de décision), aria-label consommée", async () => {
    await withUserAgent(IPHONE_SAFARI_UA, 5, async () => {
      render(<InstallPrompt />);

      const region = await screen.findByRole("region", { name: strings.pwa.install.regionLabel });
      expect(region).toBeInTheDocument();
      expect(screen.getByText(strings.pwa.install.title)).toBeInTheDocument();
      expect(screen.getByText(strings.pwa.install.iosBody)).toBeInTheDocument();
      // Pas de bouton "Installer" côté iOS (pas de beforeinstallprompt à déclencher).
      expect(
        screen.queryByRole("button", { name: strings.pwa.install.installButton }),
      ).not.toBeInTheDocument();

      // aria-label DÉCLARÉE et CONSOMMÉE (#239 corollaire) : l'attribut est bien présent sur
      // le bouton réel, pas seulement défini en strings.
      const dismissBtn = screen.getByRole("button", {
        name: strings.pwa.install.dismissAriaLabel,
      });
      expect(dismissBtn).toHaveAttribute("aria-label", strings.pwa.install.dismissAriaLabel);
    });
  });

  it("clic sur fermer → masque le hint ET persiste le rejet", async () => {
    await withUserAgent(IPHONE_SAFARI_UA, 5, async () => {
      render(<InstallPrompt />);
      const dismissBtn = await screen.findByRole("button", {
        name: strings.pwa.install.dismissAriaLabel,
      });
      fireEvent.click(dismissBtn);

      expect(screen.queryByRole("region")).not.toBeInTheDocument();
      expect(window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY)).toBe("1");
    });
  });
});

describe("InstallPrompt — AC1 invite Chrome/Android (beforeinstallprompt)", () => {
  it("rien avant l'événement", () => {
    render(<InstallPrompt />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("un événement NON conforme (sans .prompt()) est ignoré — garde de type", async () => {
    render(<InstallPrompt />);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    await act(async () => {
      window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true }));
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("beforeinstallprompt conforme → invite affichée, preventDefault appelé (supprime la mini-infobar)", async () => {
    render(<InstallPrompt />);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    const event = new FakeBeforeInstallPromptEvent();

    await act(async () => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    const region = screen.getByRole("region", { name: strings.pwa.install.regionLabel });
    expect(region).toBeInTheDocument();
    expect(screen.getByText(strings.pwa.install.body)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: strings.pwa.install.installButton }),
    ).toBeInTheDocument();
  });

  it("clic « Installer » : déclenche prompt(), attend userChoice, masque l'invite et persiste (accepted)", async () => {
    render(<InstallPrompt />);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    let resolvePrompt: () => void = () => {};
    const event = new FakeBeforeInstallPromptEvent(
      "accepted",
      () => new Promise<void>((resolve) => (resolvePrompt = resolve)),
    );

    await act(async () => {
      window.dispatchEvent(event);
    });

    const installBtn = screen.getByRole("button", { name: strings.pwa.install.installButton });
    fireEvent.click(installBtn);

    // Pendant l'attente du prompt natif : désactivé, texte plein-alpha (#226/#260 — pas d'opacity).
    expect(installBtn).toBeDisabled();
    expect(installBtn).toHaveAttribute("aria-disabled", "true");
    expect(installBtn.style.opacity === "" ? 1 : Number(installBtn.style.opacity)).toBe(1);
    expect(event.promptCalls).toBe(1);

    await act(async () => {
      resolvePrompt();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByRole("region")).not.toBeInTheDocument());
    expect(window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY)).toBe("1");
  });

  it("clic « Installer » avec issue 'dismissed' du dialogue natif : masque et persiste quand même (AC1 anti-boucle)", async () => {
    render(<InstallPrompt />);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    const event = new FakeBeforeInstallPromptEvent("dismissed");

    await act(async () => {
      window.dispatchEvent(event);
    });

    fireEvent.click(screen.getByRole("button", { name: strings.pwa.install.installButton }));

    await waitFor(() => expect(screen.queryByRole("region")).not.toBeInTheDocument());
    expect(window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY)).toBe("1");
  });

  it("clic « Plus tard » (fermer) : masque l'invite ET persiste — un nouvel événement ne la ré-affiche PLUS", async () => {
    const { unmount } = render(<InstallPrompt />);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });

    fireEvent.click(screen.getByRole("button", { name: strings.pwa.install.dismissAriaLabel }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY)).toBe("1");

    // Simule un nouveau chargement de page (nouveau montage) : la persistance doit empêcher
    // TOUTE réapparition, même face à un nouveau beforeinstallprompt (AC1, rougit sans la
    // persistance — cf. suite "AC1 rejet déjà persisté" qui prouve la même garde au montage).
    unmount();
    render(<InstallPrompt />);
    await flushMountMicrotask();
    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("événement `appinstalled` : masque l'invite et persiste le rejet", async () => {
    render(<InstallPrompt />);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    expect(screen.getByRole("region")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY)).toBe("1");
  });

  it("démontage : retire les listeners (pas de fuite / erreur sur événement post-unmount)", async () => {
    const { unmount } = render(<InstallPrompt />);
    // Flush AVANT démontage : les listeners doivent être réellement attachés pour que ce test
    // prouve leur RETRAIT (sinon il passerait vacuously, aucun listener n'ayant jamais existé).
    await flushMountMicrotask();
    unmount();
    expect(() => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
      window.dispatchEvent(new Event("appinstalled"));
    }).not.toThrow();
  });

  it("démontage AVANT que la microtâche différée ne s'exécute : le garde `cancelled` empêche tout setState tardif", async () => {
    // ROUGIT sans le garde `if (cancelled) return` (InstallPrompt.tsx) : la microtâche
    // planifiée par l'effet (`Promise.resolve().then(...)`) résoudrait APRÈS le démontage
    // (aucun `flushMountMicrotask` avant `unmount` ici, contrairement au test précédent) et
    // appellerait `setState` sur un composant démonté → avertissement React explicite.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { unmount } = render(<InstallPrompt />);
      unmount();

      // Laisse la microtâche différée s'exécuter MAINTENANT (post-démontage).
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const stateUpdateWarning = consoleError.mock.calls.some((args) =>
        String(args[0]).includes("unmounted component"),
      );
      expect(stateUpdateWarning).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});

// ─── A11y : contraste résolu (#170/#226, glyphes rendus par CE scaffold) ────

describe("InstallPrompt — contraste WCAG résolu (tokens.css, light + dark)", () => {
  it("titre/corps (--color-text-primary) sur le fond de carte (--color-bg-secondary) ≥ 4.5:1", () => {
    for (const theme of THEMES) {
      const text = resolveTokenColor(theme, "color-text-primary");
      const bg = resolveTokenColor(theme, "color-bg-secondary");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("glyphe de fermeture ✕ (--color-text-secondary) sur le fond de carte ≥ 4.5:1", () => {
    for (const theme of THEMES) {
      const glyph = resolveTokenColor(theme, "color-text-secondary");
      const bg = resolveTokenColor(theme, "color-bg-secondary");
      expect(contrastRatio(glyph, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("bouton « Installer » (--color-text-inverse sur --color-accent-primary) ≥ 4.5:1", () => {
    for (const theme of THEMES) {
      const text = resolveTokenColor(theme, "color-text-inverse");
      const bg = resolveTokenColor(theme, "color-accent-primary");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// ─── A11y : cibles ≥44px (tokens, pas de valeur en dur) ─────────────────────

describe("InstallPrompt — cibles tactiles ≥44px (token --tap-target-min)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("bouton fermer utilise --tap-target-min en min-width/min-height", async () => {
    render(<InstallPrompt />);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    const dismissBtn = screen.getByRole("button", { name: strings.pwa.install.dismissAriaLabel });
    expect(dismissBtn.style.minWidth).toBe("var(--tap-target-min)");
    expect(dismissBtn.style.minHeight).toBe("var(--tap-target-min)");
  });

  it("bouton Installer utilise --tap-target-min en min-height", async () => {
    render(<InstallPrompt />);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    const installBtn = screen.getByRole("button", { name: strings.pwa.install.installButton });
    expect(installBtn.style.minHeight).toBe("var(--tap-target-min)");
  });
});
