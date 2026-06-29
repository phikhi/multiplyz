import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test.beforeAll(async () => {
  await mkdir(join(process.cwd(), "docs/captures"), { recursive: true });
});

test("design tokens — mode clair (capture)", async ({ page }) => {
  await page.goto("/");
  // Force light theme (neutralise la préférence système)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: "multiplyz" })).toBeVisible();
  await page.screenshot({
    path: "docs/captures/11-light.png",
    fullPage: true,
  });
});

test("design tokens — mode sombre (capture)", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // Click the theme toggle button to switch to dark
  const toggle = page.getByRole("button", { name: "Basculer le thème" });
  await toggle.click();
  // Wait for transition
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "docs/captures/11-dark.png",
    fullPage: true,
  });
});
