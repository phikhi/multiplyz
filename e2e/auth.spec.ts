import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { strings } from "../src/strings";

/**
 * E2E du parcours auth complet — onboarding 1er usage (#2.2) puis connexion
 * (#2.3). **Un seul foyer single-tenant** (base E2E dédiée, wipée à froid — cf.
 * global-setup) : les deux stories forment une même séquence (créer → se
 * connecter → garde → déconnexion), donc **sérialisées dans le même fichier**
 * pour un état déterministe (pas de course inter-fichiers sur le foyer partagé).
 * `next-dev-loop` (vérif runtime) est indispo < Next 16.3 (#24) → supplée par E2E live.
 */
const nav = strings.onboarding.nav;
// Libellé a11y du 1er portrait (AVATARS[0] = fox → « Portrait renard »).
const avatarLabel = strings.onboarding.profile.avatarOption.replace(
  "{nom}",
  strings.onboarding.profile.avatarNames.fox,
);
// Carte de profil de l'enfant créée à l'onboarding (« Jouer avec Léa »).
const profileLabel = strings.login.profileOption.replace("{prénom}", "Léa");

function digit(d: string) {
  return strings.pinPad.digit.replace("{d}", d);
}

/** Saisit un PIN (auto-soumission au 4ᵉ chiffre côté sélecteur). */
async function enterPin(page: import("@playwright/test").Page, pin: string) {
  for (const d of pin) {
    await page.getByRole("button", { name: digit(d) }).click();
  }
}

test.beforeAll(async () => {
  await mkdir("docs/captures", { recursive: true });
});

// Spec MUTANT (crée le foyer) : un retry ne peut pas récupérer une écriture
// partielle (foyer déjà configuré → plus d'écran onboarding). On désactive les
// retries pour ce bloc → échec franc et lisible plutôt qu'un retry trompeur.
test.describe.configure({ retries: 0 });

test.describe.serial("parcours auth (onboarding #2.2 → connexion #2.3)", () => {
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
    await page.getByRole("button", { name: avatarLabel }).click();
    await page.getByRole("button", { name: nav.next }).click();

    // Étape code enfant (pavé partagé).
    await enterPin(page, "1234");
    await page.getByRole("button", { name: nav.next }).click();

    // Étape code parent (distinct).
    await enterPin(page, "9876");
    await page.getByRole("button", { name: nav.create }).click();

    // Écran code de secours : titre + code 8 caractères lisibles, affiché une fois.
    await expect(
      page.getByRole("heading", { level: 1, name: strings.onboarding.recovery.title }),
    ).toBeVisible();
    await expect(page.getByText(/^[A-Z0-9]{8}$/)).toBeVisible();

    await page.screenshot({ path: "docs/captures/30-recovery.png", fullPage: true });
  });

  test("foyer configuré → sélecteur de profil servi par le serveur (capture)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { level: 1, name: strings.login.title })).toBeVisible();
    await expect(page.getByRole("button", { name: profileLabel })).toBeVisible();

    await page.screenshot({ path: "docs/captures/31-selecteur.png", fullPage: true });
  });

  test("profil + bon PIN → session + redirection vers le jeu (capture)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: profileLabel }).click();
    await enterPin(page, "1234"); // auto-soumission au 4ᵉ chiffre

    await expect(page).toHaveURL(/\/jouer$/);
    await expect(
      page.getByRole("heading", { level: 1, name: strings.play.greeting }),
    ).toBeVisible();

    await page.screenshot({ path: "docs/captures/31-connexion.png", fullPage: true });
  });

  test("route jeu sans session valide → redirection vers le sélecteur (capture)", async ({
    page,
  }) => {
    // Contexte neuf (aucun cookie de session) → le garde serveur doit rediriger.
    await page.goto("/jouer");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: strings.login.title })).toBeVisible();

    await page.screenshot({ path: "docs/captures/31-guard.png", fullPage: true });
  });

  test("déconnexion → session révoquée, /jouer redirige de nouveau", async ({ page }) => {
    // Connexion.
    await page.goto("/");
    await page.getByRole("button", { name: profileLabel }).click();
    await enterPin(page, "1234");
    await expect(page).toHaveURL(/\/jouer$/);

    // Déconnexion → retour sélecteur.
    await page.getByRole("button", { name: strings.play.logout }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: strings.login.title })).toBeVisible();

    // Session révoquée serveur : la route jeu redirige à nouveau.
    await page.goto("/jouer");
    await expect(page).toHaveURL(/\/$/);
  });
});
