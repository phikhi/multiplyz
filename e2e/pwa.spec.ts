import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.beforeAll(async () => {
  await mkdir("docs/captures", { recursive: true });
});

test("manifest PWA présent dans le <head>", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Next.js App Router injecte automatiquement le lien vers /manifest.webmanifest
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute("href", expect.stringContaining("manifest"));
});

test("offline — message doux Teddy affiché si coupure réseau", async ({ page, context }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Vérifier que la bannière est absente en ligne
  await expect(page.getByRole("status")).not.toBeVisible();

  // Simuler la coupure réseau — émet l'événement offline dans le navigateur
  await context.setOffline(true);

  // Attendre que la bannière offline apparaisse
  const banner = page.getByRole("status");
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText("réseau");

  // Capture : critère d'acceptation DoD (cf. issue #13)
  await page.screenshot({ path: "docs/captures/13-offline-banner.png", fullPage: true });
});

test("online — la bannière disparaît dès que la connexion est rétablie", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Passe offline
  await context.setOffline(true);
  await expect(page.getByRole("status")).toBeVisible({ timeout: 5000 });

  // Rétablit la connexion
  await context.setOffline(false);
  await expect(page.getByRole("status")).not.toBeVisible({ timeout: 5000 });

  // Capture : état retour en ligne
  await page.screenshot({ path: "docs/captures/13-back-online.png", fullPage: true });
});
