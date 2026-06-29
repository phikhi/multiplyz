import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.beforeAll(async () => {
  await mkdir("docs/captures", { recursive: true });
});

test("design tokens — mode clair (capture)", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Assert état light avant capture
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { level: 1, name: "multiplyz" })).toBeVisible();

  await page.screenshot({ path: "docs/captures/11-light.png", fullPage: true });
});

test("design tokens — mode sombre (capture)", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const toggle = page.getByRole("button", { name: "Basculer le thème" });
  await toggle.click();

  // Assert état dark AVANT capture (pas de waitForTimeout)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await page.screenshot({ path: "docs/captures/11-dark.png", fullPage: true });
});
