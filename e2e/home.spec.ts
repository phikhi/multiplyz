import { test, expect } from "@playwright/test";

test("la page d'accueil rend et affiche le titre", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "multiplyz" })).toBeVisible();

  // Capture systématique jointe à la PR (DoD).
  await page.screenshot({ path: "test-results/home.png", fullPage: true });
});
