import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { strings } from "../src/strings";

/**
 * E2E du parcours auth complet — onboarding 1er usage (#2.2), connexion (#2.3),
 * **écran de jeu nu** (#64 : diagnostic → niveau → résultats), récupération (#2.5).
 * **Un seul foyer single-tenant** (base E2E dédiée, wipée à froid — cf.
 * global-setup) : toutes ces stories forment une même séquence (créer → se
 * connecter → jouer → garde → déconnexion → récupérer), donc **sérialisées dans le
 * même fichier** pour un état déterministe (pas de course inter-fichiers sur le
 * foyer partagé). Cf. LEARNINGS 2026-07-01 (rétro story #31, PR #42) : « Deux specs
 * à état single-tenant OPPOSÉ ne partagent pas une base wipée-à-froid en parallèle »
 * → fusionner dans un seul `describe.serial`, ils ne peuvent PAS tourner dans des
 * fichiers séparés sous `fullyParallel`. `next-dev-loop` (vérif runtime) indispo
 * < Next 16.3 (#24) → supplée par E2E live.
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

/**
 * Saisit un PIN sur le pavé partagé (composant contrôlé, sans auto-submit). La
 * connexion (#2.3) câble l'auto-soumission au 4ᵉ chiffre côté page ; l'onboarding
 * (#2.2) et la récupération (#2.5) exigent un clic explicite ensuite.
 */
async function enterPin(page: Page, pin: string) {
  for (const d of pin) {
    await page.getByRole("button", { name: digit(d) }).click();
  }
}

// ============================================================================
// Écran de jeu nu (#64) — helpers de jeu (diagnostic + niveau, ENGINE §3/§4/§9)
// ============================================================================

/**
 * Extrait `a`/opérateur/`b` (ou `a`/cible pour un complément à 10) depuis l'énoncé
 * affiché (COPY §6, gabarits `formatEquation`) — l'E2E lit le **texte visible**,
 * source de vérité utilisateur, plutôt que d'importer la logique moteur : un test
 * boîte noire plus robuste (vérifie le rendu réel, pas l'implémentation interne).
 */
function parseEquation(
  text: string,
):
  | { readonly a: number; readonly op: string; readonly b: number }
  | { readonly a: number; readonly target: number } {
  const complement = text.match(/^(\d+) \+ \? = (\d+)$/u);
  if (complement !== null) {
    return { a: Number(complement[1]), target: Number(complement[2]) };
  }
  const twoOperands = text.match(/^(\d+) (.) (\d+) = \?$/u);
  if (twoOperands === null) {
    throw new Error(`Énoncé inattendu (E2E #64) : "${text}"`);
  }
  return { a: Number(twoOperands[1]), op: twoOperands[2], b: Number(twoOperands[3]) };
}

/** Calcule la bonne réponse depuis l'énoncé affiché (arithmétique pure, pas de dépendance moteur). */
function computeAnswer(equation: string): number {
  const parsed = parseEquation(equation);
  if ("target" in parsed) {
    return parsed.target - parsed.a; // compléments à 10
  }
  switch (parsed.op) {
    case "+":
      return parsed.a + parsed.b;
    case "−":
      return parsed.a - parsed.b;
    case "×":
      return parsed.a * parsed.b;
    default:
      throw new Error(`Opérateur inattendu (E2E #64) : "${parsed.op}"`);
  }
}

/**
 * Lit l'énoncé actuellement affiché (calcul en grand, au-dessus des réponses).
 * Couvre les 2 gabarits (COPY §6) : `"a op b = ?"` (add/sub/mult) ET
 * `"a + ? = cible"` (compléments à 10, l'inconnue au milieu, pas en fin de phrase)
 * — un filtre `hasText` trop étroit sur un seul gabarit **bloquerait
 * indéfiniment** le test dès qu'un fait `comp10` est tiré (LEARNINGS-style piège :
 * repli défensif nécessaire dès que le domaine a plus d'une forme d'énoncé).
 */
async function readEquation(page: Page): Promise<string> {
  const text = await page
    .locator("p", { hasText: /^\d+ .+ \?$|^\d+ \+ \? = \d+$/u })
    .first()
    .textContent();
  return (text ?? "").trim();
}

/**
 * Région `role="status"` du **feedback de jeu** (`FeedbackPanel`, ENGINE §9) —
 * distincte de la région `role="status"` toujours montée de `OfflineBanner`
 * (racine de l'app, souvent vide). Filtrer sur un texte non vide désambiguïse
 * (sinon `getByRole("status")` seul viole le mode strict de Playwright : 2 matches).
 */
function feedbackStatus(page: Page) {
  return page.getByRole("status").filter({ hasNotText: /^$/u });
}

/**
 * Répond **correctement** à la question affichée, QCM ou pavé indifféremment
 * (ENGINE §6 : le format vient du serveur, le test ne le présuppose pas).
 */
async function answerCorrectly(page: Page): Promise<void> {
  const answer = computeAnswer(await readEquation(page));
  const qcmChoice = page.getByRole("button", {
    name: strings.play.question.choiceOption.replace("{n}", String(answer)),
  });
  if (await qcmChoice.isVisible().catch(() => false)) {
    await qcmChoice.click();
    return;
  }
  for (const d of String(answer)) {
    await page.getByRole("button", { name: digit(d) }).click();
  }
  await page.getByRole("button", { name: strings.play.question.submit }).click();
}

/**
 * Joue le diagnostic de départ jusqu'au bout (ENGINE §3, ~18 calculs ⚙️, toujours
 * QCM) en répondant juste à chaque fois, puis attend l'enchaînement automatique sur
 * le 1er niveau normal (chargement → questions). Boucle bornée généreusement (30
 * tours) : robuste à un ajustement futur de `diagnosticSize` sans devenir un test
 * infini en cas de régression réelle.
 *
 * `onComp10Retry` (optionnel, story #94) : le diagnostic est ordonné par compétence
 * **canonique** (`comp10` en tête, `diagnostic.ts` §3) → c'est le point le plus
 * déterministe pour déclencher un re-essai `comp10` en E2E (chasser l'interleaving du
 * niveau normal est combinatoire et non déterministe, cf. ENGINE §7 « périmètre actif
 * bloqué sur 1 compétence » — peut rester bloqué sur une autre compétence à fort
 * volume de faits, ex. `sub`, très longtemps). Sur le **premier** fait `comp10`
 * rencontré : répond FAUX (au lieu de juste), laisse l'appelant asserter l'étayage
 * `TenFrame` monté, puis relance le re-essai en juste avant de poursuivre la boucle
 * normalement pour les faits suivants.
 */
async function playThroughDiagnostic(
  page: Page,
  onComp10Retry?: (equation: string) => Promise<void>,
) {
  let comp10RetryDone = onComp10Retry === undefined;
  for (let i = 0; i < 30; i++) {
    const stillDiagnosticQuestion = await page
      .getByRole("group", { name: strings.play.question.choicesLabel })
      .isVisible()
      .catch(() => false);
    if (!stillDiagnosticQuestion) break; // niveau normal atteint (diagnostic terminé)

    const equation = await readEquation(page);
    if (!comp10RetryDone && onComp10Retry !== undefined && /^\d+ \+ \? = \d+$/u.test(equation)) {
      comp10RetryDone = true;
      const choicesGroup = page.getByRole("group", { name: strings.play.question.choicesLabel });
      const correct = computeAnswer(equation);
      // Réponse volontairement FAUSSE (1er distracteur ≠ bonne réponse, ENGINE §9).
      for (const button of await choicesGroup.getByRole("button").all()) {
        const label = (await button.getAttribute("aria-label")) ?? "";
        if (!label.includes(String(correct))) {
          await button.click();
          break;
        }
      }
      await expect(feedbackStatus(page)).toBeVisible();
      await expect(page.getByRole("button", { name: strings.play.retry.tryAgain })).toBeVisible();
      await onComp10Retry(equation);
      // Re-essai juste → avance normalement (non compté, ENGINE §9).
      await page.getByRole("button", { name: strings.play.retry.tryAgain }).click();
      await answerCorrectly(page);
      await expect(feedbackStatus(page)).toBeVisible();
      await page.getByRole("button", { name: strings.play.correct.next }).click();
      continue;
    }

    await answerCorrectly(page);
    await expect(feedbackStatus(page)).toBeVisible();
    await page.getByRole("button", { name: strings.play.correct.next }).click();
  }
  // Chargement (amorçage + fetch du 1er niveau) puis 1re question du niveau normal.
  await expect(page.getByRole("progressbar")).toBeVisible({ timeout: 15_000 });
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
    // Profil fraîchement créé (base E2E wipée à froid) → diagnostic de départ (§3),
    // jamais de score affiché (ENGINE §3).
    await expect(
      page.getByRole("heading", { level: 1, name: strings.play.diagnostic.intro }),
    ).toBeVisible();

    await page.screenshot({ path: "docs/captures/31-connexion.png", fullPage: true });
  });

  test("diagnostic de départ → question QCM déguisée, aucun score (capture)", async ({ page }) => {
    // ~18 calculs ⚙️ à jouer un par un (ENGINE §3) → dépasse le timeout par défaut
    // (30 s) même en répondant vite ; ce test est intrinsèquement plus long qu'une
    // simple navigation.
    test.setTimeout(90_000);
    // Reconnexion (nouveau contexte de test, cookie absent) — profil encore vierge
    // (le diagnostic ne s'est pas encore joué) → même écran d'intro que précédemment.
    await page.goto("/");
    await page.getByRole("button", { name: profileLabel }).click();
    await enterPin(page, "1234");
    await expect(page).toHaveURL(/\/jouer$/);
    await expect(
      page.getByRole("heading", { level: 1, name: strings.play.diagnostic.intro }),
    ).toBeVisible();

    await page.getByRole("button", { name: strings.play.correct.next }).click();

    // 1re question du diagnostic : toujours QCM (fait jamais vu, ENGINE §6), gros
    // boutons-réponses (≥ 44 px, a11y), pas de chrono visible (ENGINE §9).
    await expect(
      page.getByRole("group", { name: strings.play.question.choicesLabel }),
    ).toBeVisible();
    await page.screenshot({ path: "docs/captures/64-question-qcm.png", fullPage: true });

    // Joue le reste du diagnostic puis atterrit sur le 1er niveau normal. Le diagnostic
    // est ordonné par compétence CANONIQUE (comp10 en tête, `diagnostic.ts` §3) : le
    // callback intercepte le 1er fait comp10 rencontré pour vérifier l'étayage
    // `TenFrame` en re-essai (story #94, ENGINE §1/§9) — seul point déterministe pour
    // ce scénario (l'interleaving du niveau normal, lui, n'est pas prévisible, cf.
    // ENGINE §7).
    await playThroughDiagnostic(page, async (equation) => {
      const parsed = parseEquation(equation);
      if (!("target" in parsed)) {
        throw new Error(
          `Fait attendu comp10 (gabarit a + ? = cible) — équation inattendue: "${equation}"`,
        );
      }
      const a = parsed.a;
      const missing = parsed.target - parsed.a;
      const tenFrameLabel = strings.play.scaffold.tenFrame.label.replace("{a}", String(a));
      const tenFrame = page.getByRole("img", { name: tenFrameLabel });
      await expect(tenFrame).toBeVisible();
      await expect(
        page.getByText(strings.play.scaffold.tenFrame.missing.replace("{n}", String(missing))),
      ).toBeVisible();
      // Effet observable du modèle (pas seulement le montage) : a cases remplies (●)
      // ET (10-a) cases vides (○), total 10 — le composant réel calcule le bon
      // partage, pas seulement un conteneur générique présent.
      await expect(tenFrame.locator("span", { hasText: "●" })).toHaveCount(a);
      await expect(tenFrame.locator("span", { hasText: "○" })).toHaveCount(missing);
      await page.screenshot({ path: "docs/captures/94-tenframe-retry.png", fullPage: true });
    });
    await page.screenshot({ path: "docs/captures/64-question-niveau.png", fullPage: true });
  });

  test("niveau normal → feedback no-fail, bonne réponse montrée, re-essai (capture)", async ({
    page,
  }) => {
    // Rejoue jusqu'à ~10 questions (ENGINE §4) → plus long qu'une navigation simple.
    test.setTimeout(60_000);
    // Reconnexion : profil désormais amorcé (diagnostic joué au test précédent) →
    // enchaîne directement sur un niveau normal (pas de re-diagnostic, ENGINE §3).
    await page.goto("/");
    await page.getByRole("button", { name: profileLabel }).click();
    await enterPin(page, "1234");
    await expect(page).toHaveURL(/\/jouer$/);
    await expect(page.getByRole("progressbar")).toBeVisible();

    // Répond volontairement FAUX (QCM : 1er distracteur ≠ bonne réponse ; pavé :
    // saisie improbable) pour capturer le feedback no-fail (ENGINE §9).
    const choicesGroup = page.getByRole("group", { name: strings.play.question.choicesLabel });
    const isQcm = await choicesGroup.isVisible().catch(() => false);
    if (isQcm) {
      const correct = computeAnswer(await readEquation(page));
      for (const button of await choicesGroup.getByRole("button").all()) {
        const label = (await button.getAttribute("aria-label")) ?? "";
        if (!label.includes(String(correct))) {
          await button.click();
          break;
        }
      }
    } else {
      await page.getByRole("button", { name: digit("9") }).click();
      await page.getByRole("button", { name: digit("9") }).click();
      await page.getByRole("button", { name: strings.play.question.submit }).click();
    }

    // Posture croissance : jamais « faux »/« erreur », bonne réponse montrée + re-essai.
    await expect(feedbackStatus(page)).toBeVisible();
    const feedbackText = (await feedbackStatus(page).textContent()) ?? "";
    expect(feedbackText.toLowerCase()).not.toMatch(/faux|erreur/u);
    await expect(page.getByRole("button", { name: strings.play.retry.tryAgain })).toBeVisible();

    // Étayage visuel monté SOUS la révélation (épic #4 fondation #93, WIREFRAMES §3d) :
    // conteneur `role="img"` labellisé, présent uniquement en re-essai. Sa présence ici
    // (mais jamais dans le feedback juste, cf. tests unitaires) prouve le montage
    // conditionnel du slot en conditions réelles (next-dev-loop indispo #24 → E2E).
    await expect(page.getByRole("img", { name: strings.play.scaffold.label })).toBeVisible();
    await page.screenshot({ path: "docs/captures/93-etayage-retry.png", fullPage: true });
    await page.screenshot({ path: "docs/captures/64-feedback-erreur.png", fullPage: true });

    // Re-essai juste → avance (non compté, ENGINE §9) puis termine le niveau en
    // répondant toujours juste. No-fail : on termine forcément, quel que soit le score.
    await page.getByRole("button", { name: strings.play.retry.tryAgain }).click();
    for (let i = 0; i < 15; i++) {
      const onResults = await page
        .getByRole("heading", { level: 1, name: strings.play.results.title })
        .isVisible()
        .catch(() => false);
      if (onResults) break;

      const feedbackVisible = await feedbackStatus(page)
        .isVisible()
        .catch(() => false);
      if (feedbackVisible) {
        await page.getByRole("button", { name: strings.play.correct.next }).click();
        continue;
      }
      await answerCorrectly(page);
    }

    await expect(
      page.getByRole("heading", { level: 1, name: strings.play.results.title }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: /étoile/u })).toBeVisible();
    await expect(page.getByRole("button", { name: strings.play.results.continue })).toBeVisible();
    await page.screenshot({ path: "docs/captures/64-resultats.png", fullPage: true });
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
