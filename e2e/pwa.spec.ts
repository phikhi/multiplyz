import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.beforeAll(async () => {
  await mkdir("docs/captures", { recursive: true });
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
