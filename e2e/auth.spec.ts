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

// Code de secours capté à l'onboarding (aléatoire), réutilisé par la récupération
// PIN parent (#2.5) — même foyer single-tenant sérialisé.
let recoveryCode = "";

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

test.describe.serial("parcours auth (onboarding #2.2 → connexion #2.3 → récup #2.5)", () => {
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
    const code = page.getByText(/^[A-Z0-9]{8}$/);
    await expect(code).toBeVisible();
    // Capté pour la récupération PIN parent (#2.5).
    recoveryCode = (await code.textContent()) ?? "";

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

  // NB #2.4 (rate-limit + backoff, AUTH §4) : pas de test E2E dédié. Le backoff
  // est un ralentissement **court** (base 1 s) et le message d'échec reste le
  // **même** générique (aucune UI dédiée) → une démo E2E dépendrait du temps réel
  // (la fenêtre expire pendant la navigation) = flaky sur un gate. La courbe et le
  // blocage sont couverts de façon **déterministe** (horloge injectée) en unitaire :
  // `rate-limit.test.ts`, `pin-attempts.test.ts`, `login.test.ts` (guardedAuthenticateChild).

  test("récupération PIN parent via code de secours → nouveau code (capture)", async ({ page }) => {
    const rec = strings.recovery;
    expect(recoveryCode).toMatch(/^[A-Z0-9]{8}$/); // capté à l'onboarding

    // Étape 1 : saisir le code de secours.
    await page.goto("/parent/recuperation");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: rec.title })).toBeVisible();
    await page.getByRole("textbox").fill(recoveryCode);
    await page.getByRole("button", { name: rec.verify }).click();

    // Étape 2 : nouveau PIN parent (≠ PIN enfant 1234) via le pavé.
    await expect(page.getByRole("heading", { level: 1, name: rec.newPinTitle })).toBeVisible();
    await enterPin(page, "1111");
    await page.getByRole("button", { name: rec.submit }).click();

    // Étape 3 : nouveau code de secours régénéré, affiché une fois.
    await expect(page.getByRole("heading", { level: 1, name: rec.done.title })).toBeVisible();
    const fresh = page.getByText(/^[A-Z0-9]{8}$/);
    await expect(fresh).toBeVisible();
    expect(await fresh.textContent()).not.toBe(recoveryCode); // ancien code consommé

    await page.screenshot({ path: "docs/captures/33-recuperation.png", fullPage: true });
  });
});
