import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { strings } from "../src/strings";
import { AVATARS } from "../src/config/avatars";

/**
 * E2E onboarding 1er usage (#2.2). Sérialisé : la création mute le foyer
 * single-tenant (base E2E dédiée, wipée à froid — cf. global-setup). Le 1er test
 * capture l'écran vide, le 2nd déroule le flow complet jusqu'au code de secours.
 * `next-dev-loop` (vérif runtime) est indispo < Next 16.3 (#24) → supplée par E2E live.
 */
const nav = strings.onboarding.nav;

function digit(d: string) {
  return strings.pinPad.digit.replace("{d}", d);
}

test.beforeAll(async () => {
  await mkdir("docs/captures", { recursive: true });
});

test.describe.serial("onboarding 1er usage", () => {
  test("foyer vide → écran 1er usage (capture)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { level: 1, name: strings.onboarding.profile.title }),
    ).toBeVisible();
    await expect(page.getByRole("textbox")).toBeVisible();

    await page.screenshot({ path: "docs/captures/30-onboarding.png", fullPage: true });
  });

  test("création → code de secours affiché une fois (capture)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Étape profil : prénom + avatar.
    await page.getByRole("textbox").fill("Léa");
    await page.getByRole("button", { name: AVATARS[0].emoji }).click();
    await page.getByRole("button", { name: nav.next }).click();

    // Étape code enfant (pavé partagé).
    for (const d of ["1", "2", "3", "4"]) {
      await page.getByRole("button", { name: digit(d) }).click();
    }
    await page.getByRole("button", { name: nav.next }).click();

    // Étape code parent (distinct).
    for (const d of ["9", "8", "7", "6"]) {
      await page.getByRole("button", { name: digit(d) }).click();
    }
    await page.getByRole("button", { name: nav.create }).click();

    // Écran code de secours : titre + code 8 caractères lisibles, affiché une fois.
    await expect(
      page.getByRole("heading", { level: 1, name: strings.onboarding.recovery.title }),
    ).toBeVisible();
    await expect(page.getByText(/^[A-Z0-9]{8}$/)).toBeVisible();

    await page.screenshot({ path: "docs/captures/30-recovery.png", fullPage: true });
  });
});
