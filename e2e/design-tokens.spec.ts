import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.beforeAll(async () => {
  await mkdir("docs/captures", { recursive: true });
});

test("design tokens — mode clair (capture)", async ({ page }) => {
  await page.goto("/styleguide");
  await page.waitForLoadState("networkidle");

  // Assert état light avant capture
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { level: 1, name: "multiplyz" })).toBeVisible();

  await page.screenshot({ path: "docs/captures/11-light.png", fullPage: true });
});

test("design tokens — mode sombre (capture)", async ({ page }) => {
  await page.goto("/styleguide");
  await page.waitForLoadState("networkidle");

  const toggle = page.getByRole("button", { name: "Basculer le thème" });
  await toggle.click();

  // Assert état dark AVANT capture (pas de waitForTimeout)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await page.screenshot({ path: "docs/captures/11-dark.png", fullPage: true });
});

test("utilitaire :focus-visible partagé — anneau visible au clavier (issue #38, capture)", async ({
  page,
}) => {
  // Preuve visuelle du changement #38 : le bouton `ThemeToggle` (comme tous les
  // contrôles interactifs, cf. `mz-focusable` appliqué projet-wide) affiche
  // désormais l'anneau tokenisé partagé (`--shadow-focus`) au focus CLAVIER
  // (`:focus-visible`, pas au simple survol/clic souris). `page.keyboard.press`
  // (Tab) déclenche un vrai focus clavier — contrairement à `.focus()` JS qui ne
  // déclenche pas toujours `:focus-visible` selon le navigateur.
  await page.goto("/styleguide");
  await page.waitForLoadState("networkidle");

  const toggle = page.getByRole("button", { name: "Basculer le thème" });
  await page.keyboard.press("Tab"); // 1er élément focusable de la page = le toggle (styleguide minimal)
  await expect(toggle).toBeFocused();

  await page.screenshot({ path: "docs/captures/38-focus-visible.png", fullPage: true });
});
