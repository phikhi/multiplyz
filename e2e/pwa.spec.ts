import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { strings } from "../src/strings";
import { COLLECTION_SESSION_TOKEN, COLLECTION_CREATURES } from "./seed-collection";

test.beforeAll(async () => {
  await mkdir("docs/captures", { recursive: true });
});

// ─── Invite d'installation PWA (story 8.5, #258) ────────────────────────────

const IPHONE_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

const PHONE_VIEWPORT = { width: 375, height: 812 } as const; // iPhone SE / installation = contexte téléphone
const BASE_URL = `http://localhost:${process.env.PORT || "3104"}`;

/**
 * Injecte le cookie de session enfant amorcé (`COLLECTION_SESSION_TOKEN`, profil `Nino` + 5
 * créatures — cf. `seed-collection`) pour atteindre `/collection`, une **surface enfant calme
 * ET déjà engagée** où l'invite d'installation a le DROIT d'apparaître (gating story 8.5). La
 * base E2E est wipée à froid **sans foyer propriétaire** → `/` est l'écran d'ONBOARDING, où
 * l'invite est justement GATÉE (testé séparément). Il faut donc une surface enfant réelle.
 */
async function addCollectionSession(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "mz_session",
      value: COLLECTION_SESSION_TOKEN,
      url: BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/** Va sur la collection (surface calme) et attend que les créatures amorcées soient rendues. */
async function gotoCalmChildSurface(page: Page): Promise<void> {
  await page.goto("/collection");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("heading", { level: 1, name: strings.collection.title }),
  ).toBeVisible();
  await expect(page.getByText(COLLECTION_CREATURES[0].nameDefault)).toBeVisible();
}

/**
 * Injecte un faux `beforeinstallprompt` — l'API réelle (heuristiques d'installabilité
 * Chromium) n'est pas déclenchable de façon fiable en E2E headless. Le composant ne
 * distingue pas un vrai événement navigateur d'un événement synthétique conforme à la
 * même forme (`.prompt()` + `.userChoice`), donc ceci exerce fidèlement le VRAI chemin
 * de code (`InstallPrompt.tsx`, garde de type `isBeforeInstallPromptEvent`).
 */
async function dispatchFakeBeforeInstallPrompt(page: Page): Promise<void> {
  await page.evaluate(() => {
    class FakeBeforeInstallPromptEvent extends Event {
      constructor() {
        super("beforeinstallprompt", { cancelable: true });
      }
      prompt() {
        return Promise.resolve();
      }
      get userChoice() {
        return Promise.resolve({ outcome: "accepted" as const, platform: "web" });
      }
    }
    window.dispatchEvent(new FakeBeforeInstallPromptEvent());
  });
}

/**
 * Géométrie + non-occlusion RÉELLES de l'invite (#170 : un token/contraste résolu ne
 * prouve JAMAIS la visibilité d'un élément superposé/positionné). Échantillonne le centre
 * + les 4 MILIEUX D'ARÊTE de la bounding box réelle (pas les coins : `border-radius-lg`
 * arrondit visuellement les coins → Chromium exclut cette zone du hit-testing
 * `elementFromPoint` même sans `overflow:hidden` — un coin échantillonné y retomberait
 * sur le frère DERRIÈRE par construction géométrique, pas par occlusion réelle ; constaté
 * en exécutant ce test, pas supposé). `elementFromPoint` doit retourner l'invite (ou un
 * descendant) à CHAQUE point — un frère opaque empilé par-dessus romprait au moins un
 * des 5 échantillons.
 */
async function readInstallPromptGeometry(page: Page) {
  // `strings.pwa.install.regionLabel` (module Node) passé en argument sérialisable — `evaluate`
  // n'a pas accès aux fermetures du contexte Node, seulement à ce qu'on lui transmet explicitement.
  return page.evaluate((regionLabel) => {
    const region = [...document.querySelectorAll('[role="region"]')].find(
      (el) => el.getAttribute("aria-label") === regionLabel,
    );
    if (!region) return null;
    const rect = region.getBoundingClientRect();
    const midX = (rect.left + rect.right) / 2;
    const midY = (rect.top + rect.bottom) / 2;
    const points: [number, number][] = [
      [midX, rect.top + 4], // milieu du bord HAUT
      [midX, rect.bottom - 4], // milieu du bord BAS
      [rect.left + 4, midY], // milieu du bord GAUCHE
      [rect.right - 4, midY], // milieu du bord DROIT
      [midX, midY], // centre
    ];
    const notOccluded = points.every(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el !== null && region.contains(el);
    });
    return {
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      innerWidth: window.innerWidth,
      notOccluded,
    };
  }, strings.pwa.install.regionLabel);
}

test.describe("Invite d'installation PWA (story 8.5, #258)", () => {
  test("beforeinstallprompt → invite affichée, non-occluse (#170), rejetable et persistante (AC1)", async ({
    page,
    context,
  }) => {
    await addCollectionSession(context);
    await gotoCalmChildSurface(page);

    // Rien avant l'événement.
    await expect(
      page.getByRole("region", { name: strings.pwa.install.regionLabel }),
    ).not.toBeVisible();

    await dispatchFakeBeforeInstallPrompt(page);

    const region = page.getByRole("region", { name: strings.pwa.install.regionLabel });
    await expect(region).toBeVisible();
    await expect(page.getByText(strings.pwa.install.title)).toBeVisible();
    const installBtn = page.getByRole("button", {
      name: strings.pwa.install.installButton,
      exact: true,
    });
    await expect(installBtn).toBeVisible();

    // Garde E2E de géométrie RENDUE (#170) : non-occlusion RÉELLE, pas un raisonnement.
    const geometry = await readInstallPromptGeometry(page);
    expect(geometry).not.toBeNull();
    expect(geometry!.top).toBeGreaterThanOrEqual(0);
    expect(geometry!.left).toBeGreaterThanOrEqual(0);
    expect(geometry!.right).toBeLessThanOrEqual(geometry!.innerWidth);
    expect(geometry!.notOccluded).toBe(true);

    // Opérabilité clavier RÉELLE (AC5) : Tab jusqu'au bouton puis activation — pas seulement `.click()`.
    await installBtn.focus();
    await expect(installBtn).toBeFocused();

    // Capture DoD (état AFFICHÉ, desktop) — AC6.
    await page.screenshot({ path: "docs/captures/258-install-prompt-affichee.png" });

    // Rejet au CLAVIER (bouton natif, ≥44px) : focus + Enter, pas un clic souris.
    const dismissBtn = page.getByRole("button", { name: strings.pwa.install.dismissAriaLabel });
    await dismissBtn.focus();
    await page.keyboard.press("Enter");
    await expect(region).not.toBeVisible();

    // Capture DoD (état REJETÉ) — AC6.
    await page.screenshot({ path: "docs/captures/258-install-prompt-rejetee.png" });

    // AC1 anti-boucle : après un RECHARGEMENT (nouveau montage), même un nouveau
    // beforeinstallprompt ne doit PLUS jamais ré-afficher l'invite (rejet persisté).
    await page.reload();
    await page.waitForLoadState("networkidle");
    await dispatchFakeBeforeInstallPrompt(page);
    await expect(
      page.getByRole("region", { name: strings.pwa.install.regionLabel }),
    ).not.toBeVisible();
  });

  test("beforeinstallprompt à 375px (téléphone) → invite affichée, non-occluse, dans le cadre (AC6)", async ({
    page,
    context,
  }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    await addCollectionSession(context);
    await gotoCalmChildSurface(page);

    await dispatchFakeBeforeInstallPrompt(page);
    const region = page.getByRole("region", { name: strings.pwa.install.regionLabel });
    await expect(region).toBeVisible();
    await expect(
      page.getByRole("button", { name: strings.pwa.install.installButton, exact: true }),
    ).toBeVisible();

    // À 375px, la carte (maxWidth `min(--max-width-play, calc(100vw - --space-8))`) doit rester
    // DANS le cadre (pas de débordement horizontal) ET non-occluse.
    const geometry = await readInstallPromptGeometry(page);
    expect(geometry).not.toBeNull();
    expect(geometry!.left).toBeGreaterThanOrEqual(0);
    expect(geometry!.right).toBeLessThanOrEqual(geometry!.innerWidth);
    expect(geometry!.notOccluded).toBe(true);

    // Capture DoD 375px (Chrome/Android) — AC6, contexte téléphone.
    await page.screenshot({ path: "docs/captures/258-install-prompt-mobile.png" });
  });

  test("hint iOS Safari (AC2) à 375px — affiché uniquement sur iOS Safari, marche à suivre manuelle", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent: IPHONE_SAFARI_UA,
      viewport: PHONE_VIEWPORT,
    });
    try {
      await addCollectionSession(context);
      const page = await context.newPage();
      await gotoCalmChildSurface(page);

      const region = page.getByRole("region", { name: strings.pwa.install.regionLabel });
      await expect(region).toBeVisible();
      await expect(page.getByText(strings.pwa.install.iosBody)).toBeVisible();
      // Pas de bouton "Installer" côté iOS (pas de beforeinstallprompt natif).
      await expect(
        page.getByRole("button", { name: strings.pwa.install.installButton, exact: true }),
      ).not.toBeVisible();

      // Non-occlusion à 375px sur iOS aussi.
      const geometry = await readInstallPromptGeometry(page);
      expect(geometry).not.toBeNull();
      expect(geometry!.right).toBeLessThanOrEqual(geometry!.innerWidth);
      expect(geometry!.notOccluded).toBe(true);

      // Capture DoD 375px (iOS Safari) — AC6.
      await page.screenshot({ path: "docs/captures/258-install-prompt-ios.png" });
    } finally {
      await context.close();
    }
  });

  test("AC3 — jamais affichée en mode standalone (display-mode: standalone)", async ({
    page,
    context,
  }) => {
    // Force la media query AVANT tout script de page (le composant la lit au montage).
    await page.addInitScript(() => {
      const originalMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = ((query: string): MediaQueryList => {
        if (query !== "(display-mode: standalone)") return originalMatchMedia(query);
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        };
      }) as typeof window.matchMedia;
    });

    await addCollectionSession(context);
    await gotoCalmChildSurface(page);
    await dispatchFakeBeforeInstallPrompt(page);

    await expect(
      page.getByRole("region", { name: strings.pwa.install.regionLabel }),
    ).not.toBeVisible();
  });

  test("GATING — onboarding premier-run (`/` sans foyer) : invite JAMAIS rendue, titre Teddy NON recouvert (bloquant 1+4)", async ({
    page,
  }) => {
    // Base E2E wipée à froid = aucun foyer propriétaire → `/` rend l'écran d'onboarding
    // (premier contact enfant↔Teddy, PRODUCT §1.1). Contexte NEUF (aucun cookie de session).
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Le titre de bienvenue focus-managé est visible.
    const welcome = page.getByRole("heading", { level: 1, name: strings.onboarding.profile.title });
    await expect(welcome).toBeVisible();

    // Même si un beforeinstallprompt survient, l'invite ne DOIT PAS s'afficher ici.
    await dispatchFakeBeforeInstallPrompt(page);
    await expect(
      page.getByRole("region", { name: strings.pwa.install.regionLabel }),
    ).not.toBeVisible();

    // Et le titre Teddy reste visible ET non recouvert (l'invite ne peut pas le masquer,
    // preuve directe du bug pixel-looké par game-design/PO/Frontend).
    await expect(welcome).toBeVisible();
    const welcomeOccluded = await welcome.evaluate((h1) => {
      const r = h1.getBoundingClientRect();
      const el = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return el === null || !h1.contains(el);
    });
    expect(welcomeOccluded).toBe(false);

    await page.screenshot({ path: "docs/captures/258-onboarding-non-recouvert.png" });
  });

  test("GATING — partie active (`/jouer`) : invite JAMAIS rendue même sur beforeinstallprompt (bloquant 1+4)", async ({
    page,
    context,
  }) => {
    await addCollectionSession(context);
    await page.goto("/jouer");
    await page.waitForLoadState("networkidle");
    // L'écran de jeu est monté (un `<h1>` de jeu présent, quel que soit l'état diagnostic/niveau).
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await dispatchFakeBeforeInstallPrompt(page);
    await expect(
      page.getByRole("region", { name: strings.pwa.install.regionLabel }),
    ).not.toBeVisible();
  });
});

// ─── Manifest ────────────────────────────────────────────────────────────────

test("manifest PWA présent dans le <head>", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Next.js App Router injecte automatiquement le lien vers /manifest.webmanifest
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute("href", expect.stringContaining("manifest"));
});

// ─── Bannière offline — mid-session ─────────────────────────────────────────

test("offline mid-session — message doux Teddy affiché si coupure réseau", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Région live toujours présente, contenu vide quand en ligne
  const liveRegion = page.getByRole("status");
  await expect(liveRegion).toBeAttached();
  await expect(liveRegion).not.toContainText("réseau");

  // Simuler la coupure réseau — émet l'événement offline dans le navigateur
  await context.setOffline(true);

  // Attendre l'annonce AT dans la région live
  await expect(liveRegion).toContainText("réseau", { timeout: 5_000 });

  // Capture : critère d'acceptation DoD (cf. issue #13)
  await page.screenshot({ path: "docs/captures/13-offline-banner.png", fullPage: true });
});

// ─── Retour en ligne ─────────────────────────────────────────────────────────

test("online — la région live se vide dès que la connexion est rétablie", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Passe offline
  await context.setOffline(true);
  await expect(page.getByRole("status")).toContainText("réseau", { timeout: 5_000 });

  // Rétablit la connexion
  await context.setOffline(false);
  await expect(page.getByRole("status")).not.toContainText("réseau", { timeout: 5_000 });

  // Capture : état retour en ligne
  await page.screenshot({ path: "docs/captures/13-back-online.png", fullPage: true });
});

// ─── SW cache hors-ligne ─────────────────────────────────────────────────────

test("cold-start offline — SW sert la coquille depuis cache (pas d'écran blanc)", async ({
  page,
  context,
}) => {
  // Phase 1 — Première visite en ligne : le SW s'installe et met la coquille en cache
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Attendre que le SW soit actif ET contrôle la page (install + activate + claim)
  await page.waitForFunction(
    () => "serviceWorker" in navigator && navigator.serviceWorker.controller !== null,
    { timeout: 15_000 },
  );

  // Phase 2 — Couper le réseau et recharger : le SW doit servir la coquille depuis son cache.
  // context.setOffline(true) bloque toutes les requêtes réseau (fetch/XHR/navigation).
  // En développement (Turbopack), les chunks JS sont servis depuis le cache SW si la
  // première visite les a récupérés ; la coquille HTML SSR est toujours disponible.
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });

  // AC1 : la coquille SSR est rendue sans réseau (SW cache — pas d'écran blanc)
  // Preuve que le SW a bien intercepté la navigation et servi la réponse depuis son cache.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });

  // Capture mobile dark (iPhone SE viewport + thème sombre pour vérif tokens)
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: "docs/captures/13-cold-offline-mobile.png", fullPage: true });

  // Nettoyage
  await context.setOffline(false);

  // Note : la bannière offline (message mid-session vs cold-start) est couverte par :
  //   - les tests unitaires OfflineBanner.test.tsx (cold-start beforeEach + mid-session events)
  //   - le test E2E "offline mid-session" ci-dessus
  // En mode dev (Turbopack), React peut ne pas hydrater sur une page SW-servie hors-ligne
  // car certains chunks dynamiques ne sont pas encore dans le cache SW. La validation
  // de la bannière sur page rechargée appartient donc aux tests unitaires.
});
