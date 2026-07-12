import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InstallPrompt,
  isIOSSafari,
  isStandaloneDisplayMode,
  persistInstallPromptDismissed,
  readInstallPromptDismissed,
  shouldShowInstallPromptOnSurface,
} from "./InstallPrompt";
import { strings } from "@/strings";
import { INSTALL_PROMPT_DISMISSED_KEY } from "@/config/pwa";
import {
  contrastRatio,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";

// `usePathname` mock — pilotable par test via `mockNav.pathname` (hoisté avant la factory).
// Défaut `/carte` = surface enfant calme où l'invite PEUT s'afficher (gating story 8.5).
const mockNav = vi.hoisted(() => ({ pathname: "/carte" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mockNav.pathname,
}));

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

beforeEach(() => {
  mockNav.pathname = "/carte"; // surface calme par défaut (l'invite peut s'afficher)
});

afterEach(() => {
  window.localStorage.clear();
});

/** Rend l'invite sur une surface calme (`/carte`) avec foyer présent, sauf override. */
function renderPrompt(householdExists = true) {
  return render(<InstallPrompt householdExists={householdExists} />);
}

/**
 * Laisse s'exécuter la microtâche différée de `InstallPrompt` (react-hooks/set-state-in-effect
 * — cf. commentaire du composant) : sans ce flush, un `dispatchEvent` juste après `render()`
 * arrive AVANT que les listeners `beforeinstallprompt`/`appinstalled` ne soient attachés → événement
 * perdu, ET les gardes standalone/dismissed lues dans la microtâche ne se sont pas encore
 * exécutées (course qui rendrait l'assertion vacuous, rétro #143). Deux `Promise.resolve()`
 * (marge de sécurité sur le nombre de sauts de microtâche).
 */
async function flushMountMicrotask() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ─── shouldShowInstallPromptOnSurface (gating AC1 « discrète ») ──────────────

describe("shouldShowInstallPromptOnSurface — gating de surface (AC1)", () => {
  it("carte : surface calme session-gated → true (foyer présent ou non, la session l'implique)", () => {
    expect(shouldShowInstallPromptOnSurface("/carte", true)).toBe(true);
    expect(shouldShowInstallPromptOnSurface("/carte", false)).toBe(true);
  });

  it("collection : surface calme session-gated → true", () => {
    expect(shouldShowInstallPromptOnSurface("/collection", true)).toBe(true);
  });

  it("racine `/` AVEC foyer (sélecteur / retour quotidien) → true", () => {
    expect(shouldShowInstallPromptOnSurface("/", true)).toBe(true);
  });

  it("racine `/` SANS foyer (onboarding premier-run) → false (ne recouvre pas Teddy, PRODUCT §1.1)", () => {
    expect(shouldShowInstallPromptOnSurface("/", false)).toBe(false);
  });

  it("jouer : partie active → false (PRODUCT §3.5, zéro pression)", () => {
    expect(shouldShowInstallPromptOnSurface("/jouer", true)).toBe(false);
  });

  it("espace parent → false (COPY §5, voix Teddy ne fuite pas dans le registre neutre)", () => {
    expect(shouldShowInstallPromptOnSurface("/parent", true)).toBe(false);
    expect(shouldShowInstallPromptOnSurface("/parent/reglages", true)).toBe(false);
    expect(shouldShowInstallPromptOnSurface("/parent/mondes", true)).toBe(false);
  });

  it("route inconnue / dev (styleguide) → false (allowlist stricte, pas de fuite)", () => {
    expect(shouldShowInstallPromptOnSurface("/styleguide", true)).toBe(false);
    expect(shouldShowInstallPromptOnSurface("/une-route-future", true)).toBe(false);
  });
});

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

// ─── Composant — gating de surface (AC1 « discrète ») ────────────────────────

describe("InstallPrompt — gating de surface (rendu)", () => {
  it("onboarding premier-run (`/` sans foyer) : le hint iOS est CAPTURÉ mais PAS rendu (ne recouvre pas Teddy)", async () => {
    mockNav.pathname = "/";
    await withUserAgent(IPHONE_SAFARI_UA, 5, async () => {
      renderPrompt(false); // householdExists=false → onboarding
      await flushMountMicrotask();
      expect(screen.queryByRole("region")).not.toBeInTheDocument();
    });
  });

  it("partie active (`/jouer`) : `beforeinstallprompt` capturé mais invite PAS rendue", async () => {
    mockNav.pathname = "/jouer";
    renderPrompt(true);
    await flushMountMicrotask();
    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("espace parent (`/parent/reglages`) : invite PAS rendue (registre neutre, COPY §5)", async () => {
    mockNav.pathname = "/parent/reglages";
    renderPrompt(true);
    await flushMountMicrotask();
    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("navigation partie active → carte : l'événement CAPTURÉ sur `/jouer` s'affiche une fois `/carte` atteint", async () => {
    mockNav.pathname = "/jouer";
    const { rerender } = render(<InstallPrompt householdExists />);
    await flushMountMicrotask();
    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    // Capturé mais gaté sur `/jouer`.
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    // Le joueur revient à la carte (boucle jouer→résultats→carte) → l'invite apparaît.
    mockNav.pathname = "/carte";
    rerender(<InstallPrompt householdExists />);
    expect(
      screen.getByRole("region", { name: strings.pwa.install.regionLabel }),
    ).toBeInTheDocument();
  });
});

// ─── Composant — AC3 déjà installée (standalone) ────────────────────────────

describe("InstallPrompt — AC3 déjà installée (standalone)", () => {
  it("n'affiche rien, même si un beforeinstallprompt survient ensuite", async () => {
    const original = window.matchMedia;
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    try {
      renderPrompt(true);
      await flushMountMicrotask();
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

// ─── Composant — AC1 rejet déjà persisté ────────────────────────────────────

describe("InstallPrompt — AC1 rejet déjà persisté", () => {
  it("n'affiche rien au montage, et n'affiche toujours rien après un beforeinstallprompt (pas de boucle)", async () => {
    window.localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, "1");
    renderPrompt(true);
    await flushMountMicrotask();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});

// ─── Composant — AC2 hint iOS Safari ────────────────────────────────────────

describe("InstallPrompt — AC2 hint iOS Safari", () => {
  it("affiche le hint « Partager » (après la microtâche de décision), aria-label consommée", async () => {
    await withUserAgent(IPHONE_SAFARI_UA, 5, async () => {
      renderPrompt(true);

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
      renderPrompt(true);
      const dismissBtn = await screen.findByRole("button", {
        name: strings.pwa.install.dismissAriaLabel,
      });
      fireEvent.click(dismissBtn);

      expect(screen.queryByRole("region")).not.toBeInTheDocument();
      expect(window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY)).toBe("1");
    });
  });
});

// ─── Composant — AC1 invite Chrome/Android (beforeinstallprompt) ────────────

describe("InstallPrompt — AC1 invite Chrome/Android (beforeinstallprompt)", () => {
  it("rien avant l'événement", async () => {
    renderPrompt(true);
    await flushMountMicrotask();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("un événement NON conforme (sans .prompt()) est ignoré — garde de type", async () => {
    renderPrompt(true);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    await act(async () => {
      window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true }));
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("beforeinstallprompt conforme → invite affichée, preventDefault appelé (supprime la mini-infobar)", async () => {
    renderPrompt(true);
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
    renderPrompt(true);
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
    renderPrompt(true);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    const event = new FakeBeforeInstallPromptEvent("dismissed");

    await act(async () => {
      window.dispatchEvent(event);
    });

    fireEvent.click(screen.getByRole("button", { name: strings.pwa.install.installButton }));

    await waitFor(() => expect(screen.queryByRole("region")).not.toBeInTheDocument());
    expect(window.localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY)).toBe("1");
  });

  it("bouton « Installer » opérable au CLAVIER (Enter déclenche l'install) — bouton natif, pas un div", async () => {
    renderPrompt(true);
    await flushMountMicrotask();
    let resolvePrompt: () => void = () => {};
    const event = new FakeBeforeInstallPromptEvent(
      "accepted",
      () => new Promise<void>((resolve) => (resolvePrompt = resolve)),
    );
    await act(async () => {
      window.dispatchEvent(event);
    });

    const installBtn = screen.getByRole("button", { name: strings.pwa.install.installButton });
    installBtn.focus();
    expect(installBtn).toHaveFocus();
    // Un <button> natif focalisé traduit Enter en `click` (comportement UA que jsdom ne simule
    // pas seul) → on prouve l'opérabilité clavier via la combinaison focus + activation. Le rôle
    // "button" + l'élément <button> garantit cette traduction dans un vrai navigateur (doublé par
    // l'E2E qui presse réellement Enter).
    fireEvent.keyDown(installBtn, { key: "Enter", code: "Enter" });
    fireEvent.click(installBtn);
    expect(event.promptCalls).toBe(1);

    await act(async () => {
      resolvePrompt();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole("region")).not.toBeInTheDocument());
  });

  it("clic « Plus tard » (fermer) : masque l'invite ET persiste — un nouvel événement ne la ré-affiche PLUS", async () => {
    const { unmount } = renderPrompt(true);
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
    renderPrompt(true);
    await flushMountMicrotask();
    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("événement `appinstalled` : masque l'invite et persiste le rejet", async () => {
    renderPrompt(true);
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
});

// ─── Composant — cycle de vie de l'effet (gardes anti-fuite, mutation-prouvées) ──

describe("InstallPrompt — cycle de vie de l'effet", () => {
  it("garde `cancelled` : démontage AVANT la microtâche → AUCUN listener attaché (rougit si le garde est retiré)", async () => {
    // Observable robuste = spy `addEventListener` (React 19 a SUPPRIMÉ l'avertissement
    // « setState on unmounted component », donc une assertion console.error serait elle-même
    // vacuous, rétro #143). Sans le garde `if (cancelled) return`, la microtâche différée
    // s'exécute APRÈS le démontage et attache quand même les listeners → ce spy voit ≥1 appel.
    const addSpy = vi.spyOn(window, "addEventListener");
    try {
      const { unmount } = renderPrompt(true);
      unmount(); // AVANT le flush → la microtâche verra `cancelled === true`
      await flushMountMicrotask();

      const bipAdds = addSpy.mock.calls.filter(([type]) => type === "beforeinstallprompt");
      const appAdds = addSpy.mock.calls.filter(([type]) => type === "appinstalled");
      expect(bipAdds).toHaveLength(0);
      expect(appAdds).toHaveLength(0);
    } finally {
      addSpy.mockRestore();
    }
  });

  it("cleanup `removeListeners` : démontage APRÈS la microtâche → listeners RETIRÉS (rougit si le cleanup est retiré)", async () => {
    // Observable robuste = spy `removeEventListener` (même raison React 19 que ci-dessus). Sans
    // `removeListeners?.()` dans le cleanup, les listeners attachés par la microtâche restent
    // branchés après démontage → `removeEventListener` n'est JAMAIS appelé pour eux.
    const removeSpy = vi.spyOn(window, "removeEventListener");
    try {
      const { unmount } = renderPrompt(true);
      await flushMountMicrotask(); // listeners RÉELLEMENT attachés
      unmount(); // cleanup → removeListeners?.()

      const bipRemoves = removeSpy.mock.calls.filter(([type]) => type === "beforeinstallprompt");
      const appRemoves = removeSpy.mock.calls.filter(([type]) => type === "appinstalled");
      expect(bipRemoves.length).toBeGreaterThanOrEqual(1);
      expect(appRemoves.length).toBeGreaterThanOrEqual(1);
    } finally {
      removeSpy.mockRestore();
    }
  });

  it("démontage après attachement : un événement post-unmount ne ré-affiche rien (pas de throw non plus)", async () => {
    const { unmount } = renderPrompt(true);
    await flushMountMicrotask();
    unmount();
    expect(() => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
      window.dispatchEvent(new Event("appinstalled"));
    }).not.toThrow();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
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
  it("bouton fermer utilise --tap-target-min en min-width/min-height", async () => {
    renderPrompt(true);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    const dismissBtn = screen.getByRole("button", { name: strings.pwa.install.dismissAriaLabel });
    expect(dismissBtn.style.minWidth).toBe("var(--tap-target-min)");
    expect(dismissBtn.style.minHeight).toBe("var(--tap-target-min)");
  });

  it("bouton Installer utilise --tap-target-min en min-height", async () => {
    renderPrompt(true);
    await flushMountMicrotask(); // listeners attachés avant de dispatcher
    await act(async () => {
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    const installBtn = screen.getByRole("button", { name: strings.pwa.install.installButton });
    expect(installBtn.style.minHeight).toBe("var(--tap-target-min)");
  });
});
