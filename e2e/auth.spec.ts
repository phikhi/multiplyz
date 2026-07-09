import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { strings } from "../src/strings";
import { BRAND_NAME } from "../src/config/brand";
import { SIBLING_NAME, SIBLING_SESSION_TOKEN } from "./seed-sibling";

/**
 * E2E du parcours auth complet — onboarding 1er usage (#2.2), connexion (#2.3),
 * **écran de jeu nu** (#64 : diagnostic → niveau → résultats), **écran carte** (#125 :
 * chemin de nœuds du monde courant), récupération (#2.5).
 * **Un seul foyer single-tenant** (base E2E dédiée, wipée à froid — cf.
 * global-setup) : toutes ces stories forment une même séquence (créer → se
 * connecter → jouer → voir la carte → garde → déconnexion → récupérer), donc
 * **sérialisées dans le même fichier** pour un état déterministe (pas de course
 * inter-fichiers sur le foyer partagé). Cf. LEARNINGS 2026-07-01 (rétro story #31,
 * PR #42) : « Deux specs à état single-tenant OPPOSÉ ne partagent pas une base
 * wipée-à-froid en parallèle » → fusionner dans un seul `describe.serial`, ils ne
 * peuvent PAS tourner dans des fichiers séparés sous `fullyParallel`. La carte (#125)
 * dépend du MÊME profil déjà amorcé par les tests précédents — même contrainte de
 * séquence single-tenant, donc insérée ICI plutôt que dans un fichier à part.
 * `next-dev-loop` (vérif runtime) indispo < Next 16.3 (#24) → supplée par E2E live.
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

// Helpers « Gérer les profils » (story 7.5, #218).
const manage = strings.parent.manage;
/** Libellé accessible d'une carte de profil sur l'écran de gestion. */
const manageProfileLabel = (name: string) => manage.profileLabel.replace("{prénom}", name);
/** Libellé de la carte de profil dans le sélecteur de connexion. */
const selectorLabel = (name: string) => strings.login.profileOption.replace("{prénom}", name);
/** Connexion parent (PIN 9876) → tableau de bord → écran « Gérer les profils ». */
async function goToManageAsParent(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: strings.parent.entryLabel }).click();
  await enterPin(page, "9876");
  await expect(page).toHaveURL(/\/parent$/);
  await page.getByRole("link", { name: strings.parent.dashboard.manageLink }).click();
  await expect(page).toHaveURL(/\/parent\/profils$/);
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

/** Compétence détectée depuis l'énoncé affiché (gabarit `parseEquation`). */
type EquationSkill = "comp10" | "add" | "sub" | "mult";

/** Déduit la compétence d'un énoncé affiché — miroir de `parseEquation` (E2E boîte noire). */
function equationSkill(equation: string): EquationSkill {
  const parsed = parseEquation(equation);
  if ("target" in parsed) return "comp10";
  switch (parsed.op) {
    case "+":
      return "add";
    case "−":
      return "sub";
    case "×":
      return "mult";
    default:
      throw new Error(`Opérateur inattendu (E2E #64) : "${equation}"`);
  }
}

/**
 * Nom accessible attendu de l'étayage (`role="img"` unique de `VisualScaffold`) pour
 * une compétence + énoncé donnés — miroir du registre `SCAFFOLD_BY_SKILL`
 * (`VisualScaffold.tsx`) : `comp10` → dix-cases (story #94), `add`/`sub` → droite
 * numérique (story #95, sens dérivé de l'énoncé), `mult` → matrice (story #96,
 * « {a} paquets de {b} »). Utilisé par les tests dont la compétence tirée n'est PAS
 * déterministe (interleaving du niveau normal, ENGINE §7). Épic #4 complet : plus
 * aucun skill ne retombe sur le libellé générique.
 */
function expectedScaffoldLabel(skill: EquationSkill, equation: string): string {
  const parsed = parseEquation(equation);
  if (skill === "comp10" && "target" in parsed) {
    const missing = parsed.target - parsed.a;
    return strings.play.scaffold.tenFrame.missing.replace("{n}", String(missing));
  }
  if (skill === "add" && !("target" in parsed)) {
    return strings.play.scaffold.numberLine.forward
      .replace("{a}", String(parsed.a))
      .replace("{b}", String(parsed.b));
  }
  if (skill === "sub" && !("target" in parsed)) {
    return strings.play.scaffold.numberLine.backward
      .replace("{a}", String(parsed.a))
      .replace("{b}", String(parsed.b));
  }
  // mult : "target" absent du parsed (gabarit "a op b = ?").
  const multParsed = parsed as { readonly a: number; readonly op: string; readonly b: number };
  return strings.play.scaffold.matrix.label
    .replace("{a}", String(multParsed.a))
    .replace("{b}", String(multParsed.b));
}

/** Callback de vérification déclenché sur le 1er re-essai rencontré d'une compétence. */
type RetryHook = (equation: string) => Promise<void>;

/**
 * Prédicat optionnel : le hook d'une compétence peut choisir d'IGNORER un fait trop
 * dégénéré pour une vérification visuelle démonstrative (ex. mult `1×b` = un seul
 * paquet, ne montre pas le regroupement « répété » — story #96). Sans prédicat, le
 * 1er fait rencontré déclenche toujours (comportement historique #94/#95).
 */
type RetryTrigger = (equation: string) => boolean;

/**
 * Joue le diagnostic de départ jusqu'au bout (ENGINE §3, ~18 calculs ⚙️, toujours
 * QCM) en répondant juste à chaque fois, puis attend l'enchaînement automatique sur
 * le 1er niveau normal (chargement → questions). Boucle bornée généreusement (30
 * tours) : robuste à un ajustement futur de `diagnosticSize` sans devenir un test
 * infini en cas de régression réelle.
 *
 * `onRetry` (optionnel, stories #94/#95/#96) : le diagnostic est ordonné par
 * compétence **canonique** (`comp10, add, sub, mult` — `SKILLS`, `diagnostic.ts` §3)
 * → c'est le point le plus déterministe pour déclencher un re-essai d'une compétence
 * donnée en E2E (chasser l'interleaving du niveau normal est combinatoire et non
 * déterministe, cf. ENGINE §7 « périmètre actif bloqué sur 1 compétence » — peut
 * rester bloqué sur une autre compétence à fort volume de faits, ex. `sub`, très
 * longtemps). Sur le **premier** fait rencontré de CHAQUE compétence présente dans
 * `onRetry` qui satisfait son `trigger` optionnel (§`onTrigger`) : répond FAUX (au
 * lieu de juste), laisse l'appelant asserter l'étayage monté, puis relance le
 * re-essai en juste avant de poursuivre la boucle normalement pour les faits
 * suivants. Une compétence sans hook dans `onRetry` est jouée juste dès le 1er coup
 * (comportement historique #94, rétrocompatible).
 */
async function playThroughDiagnostic(
  page: Page,
  onRetry?: Partial<Record<EquationSkill, RetryHook>>,
  onTrigger?: Partial<Record<EquationSkill, RetryTrigger>>,
) {
  const retryDone = new Set<EquationSkill>();
  for (let i = 0; i < 30; i++) {
    const stillDiagnosticQuestion = await page
      .getByRole("group", { name: strings.play.question.choicesLabel })
      .isVisible()
      .catch(() => false);
    if (!stillDiagnosticQuestion) break; // niveau normal atteint (diagnostic terminé)

    const equation = await readEquation(page);
    const skill = equationSkill(equation);
    const hook = onRetry?.[skill];
    const trigger = onTrigger?.[skill];
    if (
      hook !== undefined &&
      !retryDone.has(skill) &&
      (trigger === undefined || trigger(equation))
    ) {
      retryDone.add(skill);
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
      await hook(equation);
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
    // simple navigation. 3 re-essais interceptés (comp10 story #94, add+sub story
    // #95) allongent encore la séquence → marge généreuse.
    test.setTimeout(120_000);
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
    // est ordonné par compétence CANONIQUE (`comp10, add, sub, mult` — `SKILLS`,
    // `diagnostic.ts` §3) : chaque hook intercepte le 1er fait de sa compétence pour
    // vérifier l'étayage en re-essai — `TenFrame` (story #94), `NumberLine`
    // (story #95, add ET sub partagent le même composant, PRODUCT §3.4) et `Matrix`
    // (story #96, groupes répétés) — seul point déterministe pour ce scénario
    // (l'interleaving du niveau normal, lui, n'est pas
    // prévisible, cf. ENGINE §7).
    await playThroughDiagnostic(
      page,
      {
        comp10: async (equation) => {
          const parsed = parseEquation(equation);
          if (!("target" in parsed)) {
            throw new Error(
              `Fait attendu comp10 (gabarit a + ? = cible) — équation inattendue: "${equation}"`,
            );
          }
          const a = parsed.a;
          const missing = parsed.target - parsed.a;
          // Unique `role="img"` de l'étayage, dont le NOM ACCESSIBLE porte l'info numérique
          // « il manque {n} pour faire 10 » (rétro #94 : pas de `role="img"` imbriqué ; le
          // libellé spécifique EST annoncé, pas un générique). En conditions réelles
          // (next-dev-loop indispo #24 → E2E).
          const missingText = strings.play.scaffold.tenFrame.missing.replace(
            "{n}",
            String(missing),
          );
          const tenFrame = page.getByRole("img", { name: missingText });
          await expect(tenFrame).toBeVisible();
          // Le même texte est aussi visible sous la grille (double canal, bénéfice voyants).
          await expect(page.getByText(missingText)).toBeVisible();
          // Effet observable du modèle (pas seulement le montage) : a cases remplies (●)
          // ET (10-a) cases vides (○), total 10 — le composant réel calcule le bon
          // partage, pas seulement un conteneur générique présent.
          await expect(tenFrame.locator("span", { hasText: "●" })).toHaveCount(a);
          await expect(tenFrame.locator("span", { hasText: "○" })).toHaveCount(missing);
          await page.screenshot({ path: "docs/captures/94-tenframe-retry.png", fullPage: true });
        },
        add: async (equation) => {
          const parsed = parseEquation(equation);
          if ("target" in parsed || parsed.op !== "+") {
            throw new Error(
              `Fait attendu add (gabarit a + b = ?) — équation inattendue: "${equation}"`,
            );
          }
          // Unique `role="img"` dont le NOM ACCESSIBLE porte le sens du saut AVANT
          // (story #95 : NumberLine partagé add/sub, le sens est dérivé de l'arithmétique
          // réelle, jamais du skill en dur — rétro #94 : pas de role="img" imbriqué).
          const label = strings.play.scaffold.numberLine.forward
            .replace("{a}", String(parsed.a))
            .replace("{b}", String(parsed.b));
          const numberLine = page.getByRole("img", { name: label });
          await expect(numberLine).toBeVisible();
          // Doublé texte visible (bénéfice voyants, jamais couleur seule — daltonisme).
          await expect(page.getByText(label)).toBeVisible();
          // Icône flèche AVANT visible (doublage texte+icône, jamais couleur seule).
          await expect(page.getByText("→")).toBeVisible();
          await page.screenshot({
            path: "docs/captures/95-numberline-add-retry.png",
            fullPage: true,
          });
        },
        sub: async (equation) => {
          const parsed = parseEquation(equation);
          if ("target" in parsed || parsed.op !== "−") {
            throw new Error(
              `Fait attendu sub (gabarit a − b = ?) — équation inattendue: "${equation}"`,
            );
          }
          // Sens ARRIÈRE (recul) — libellé et icône distincts de l'addition (story #95).
          const label = strings.play.scaffold.numberLine.backward
            .replace("{a}", String(parsed.a))
            .replace("{b}", String(parsed.b));
          const numberLine = page.getByRole("img", { name: label });
          await expect(numberLine).toBeVisible();
          await expect(page.getByText(label)).toBeVisible();
          await expect(page.getByText("←")).toBeVisible();
          await page.screenshot({
            path: "docs/captures/95-numberline-sub-retry.png",
            fullPage: true,
          });
        },
        mult: async (equation) => {
          const parsed = parseEquation(equation);
          if ("target" in parsed || parsed.op !== "×") {
            throw new Error(
              `Fait attendu mult (gabarit a × b = ?) — équation inattendue: "${equation}"`,
            );
          }
          // Unique `role="img"` dont le NOM ACCESSIBLE porte le regroupement « a paquets
          // de b » (story #96, groupes répétés — rétro #94 : pas de role="img" imbriqué).
          const label = strings.play.scaffold.matrix.label
            .replace("{a}", String(parsed.a))
            .replace("{b}", String(parsed.b));
          const matrix = page.getByRole("img", { name: label });
          await expect(matrix).toBeVisible();
          // Doublé texte visible (bénéfice voyants, jamais couleur seule — daltonisme).
          await expect(page.getByText(label)).toBeVisible();
          // Effet observable du modèle « groupes répétés » (pas seulement le montage) :
          // a conteneurs de PAQUET distincts (regroupement spatial/bordure), chacun
          // portant b points — pas juste a×b points alignés en grille uniforme.
          const packets = matrix.locator("[data-scaffold-packet]");
          await expect(packets).toHaveCount(parsed.a);
          await expect(packets.first().getByText("●")).toHaveCount(parsed.b);
          await page.screenshot({ path: "docs/captures/96-matrix-retry.png", fullPage: true });
        },
      },
      {
        // `a ≥ 2` : capture le regroupement « répété » de façon démonstrative (un
        // paquet unique, ex. 1×8, ne montrerait pas visuellement la RÉPÉTITION du
        // modèle — feed-forward game-design rétro #95 : le modèle doit être VU, pas
        // seulement correct). Diagnostic borné (30 tours, boucle appelante) → si
        // aucun fait mult ne satisfait jamais ce trigger, la compétence est jouée
        // juste jusqu'au bout (no-fail, pas de blocage).
        mult: (equation) => {
          const parsed = parseEquation(equation);
          return !("target" in parsed) && parsed.a >= 2;
        },
      },
    );
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
    // saisie improbable) pour capturer le feedback no-fail (ENGINE §9). L'interleaving
    // du niveau normal n'est PAS déterministe (ENGINE §7) → la compétence tirée ici
    // peut être n'importe laquelle des 4 ; l'étayage attendu est donc dérivé de
    // l'énoncé réellement affiché, pas présumé.
    const equation = await readEquation(page);
    const skill = equationSkill(equation);
    const choicesGroup = page.getByRole("group", { name: strings.play.question.choicesLabel });
    const isQcm = await choicesGroup.isVisible().catch(() => false);
    if (isQcm) {
      const correct = computeAnswer(equation);
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

    // Étayage visuel monté AU-DESSUS de la révélation (ordre inversé issue #100, ADR
    // 0007, WIREFRAMES §3d — l'étayage-découverte d'abord, le chiffre en synthèse dessous ;
    // épic #4 fondation #93) : conteneur `role="img"` labellisé, présent uniquement en
    // re-essai. Sa présence ici (mais jamais dans le feedback juste, cf. tests unitaires)
    // prouve le montage conditionnel du slot en conditions réelles (next-dev-loop indispo
    // #24 → E2E). Le nom accessible attendu dépend de la compétence tirée (comp10/add/sub/
    // mult tous câblés sur un étayage concret, épic #4 complet).
    const expectedLabel = expectedScaffoldLabel(skill, equation);
    const scaffold = page.getByRole("img", { name: expectedLabel });
    await expect(scaffold).toBeVisible();
    // Ordre observable en conditions réelles (issue #100) : la révélation numérique
    // (« et voilà, ça fait {n} ») suit l'étayage dans le DOM. Effet observable — échoue
    // si l'ordre est remis à l'ancien (révélation au-dessus de l'étayage).
    const reveal = page.getByText(
      strings.play.retry.answerReveal.replace("{n}", String(computeAnswer(equation))),
    );
    await expect(reveal).toBeVisible();
    const revealHandle = await reveal.elementHandle();
    expect(revealHandle).not.toBeNull();
    const orderOk = await scaffold.evaluate(
      (el, revealEl) =>
        Boolean(el.compareDocumentPosition(revealEl) & Node.DOCUMENT_POSITION_FOLLOWING),
      revealHandle!,
    );
    expect(orderOk).toBe(true);
    // Capture du nouvel ordre (étayage au-dessus, révélation en synthèse) — DoD épic #4.
    await page.screenshot({
      path: "docs/captures/100-etayage-avant-revelation.png",
      fullPage: true,
    });
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
    // Gains de pièces (#126, ferme #136) : la fin de niveau persiste la progression ET
    // crédite les pièces (base + étoiles) → l'écran de résultats affiche les pièces gagnées
    // (solde serveur, source de vérité). Doublage a11y : `role="img"` au nom accessible
    // « … pièce(s) 🪙 ». On attend son apparition (la persistance/crédit est async, no-fail).
    await expect(page.getByRole("img", { name: /pièce/u })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: strings.play.results.continue })).toBeVisible();
    await page.screenshot({ path: "docs/captures/126-resultats.png", fullPage: true });
  });

  test("carte du monde → nœud 0 COMPLÉTÉ (boucle jouer→résultats→carte, #136), suivant courant (capture)", async ({
    page,
  }) => {
    // Reconnexion (nouveau contexte de test, cookie absent — même profil, déjà amorcé).
    // CÂBLAGE #136 (story #126) : le test précédent a terminé un niveau via l'écran de jeu
    // → `finishLevelAction` a PERSISTÉ la progression (5.3) ET crédité les pièces (ECONOMY
    // §4.1) dans une transaction atomique. La carte reflète donc l'état SERVEUR réel : le
    // nœud 0 est désormais **COMPLÉTÉ** (une ligne `progress` existe), le nœud 1 devient
    // **COURANT** (déblocage linéaire, MAP §1). C'est la boucle jouer→résultats→carte
    // complète, vérifiée en conditions réelles (next-dev-loop indispo < Next 16.3, #24).
    await page.goto("/");
    await page.getByRole("button", { name: profileLabel }).click();
    await enterPin(page, "1234");
    await expect(page).toHaveURL(/\/jouer$/);

    // Story #189/#190 : les chemins assets réels (`background/tiles/teddy !== null`) sont réveillés
    // AU BOOT du serveur (`e2e/seed-world-assets.ts` dans la commande webServer) — le socle[0] pointe
    // des fixtures PNG committées, donc `resolveWorld(0)` sert des assets réels → scrim + tint (#189)
    // ET bande de décor + avatar Teddy per-monde (#190) exercés ci-dessous.
    await page.goto("/carte");
    await page.waitForLoadState("networkidle");

    // Titre THÉMATISÉ (câblage carte↔monde, story 6.7, WIREFRAMES §2 « Monde 3 · La Forêt ») :
    // en base E2E fraîche aucun monde généré `active` → le résolveur retombe sur le SOCLE de
    // secours (WORLDGEN §7), dont le thème atteint réellement l'enfant dans le titre. On matche
    // le préfixe « Monde 1 · » + un libellé de thème non vide (le thème exact = socle[0], dérivé).
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    const headingText = ((await heading.textContent()) ?? "").trim();
    expect(headingText).toMatch(/^Monde 1 · .+/u);

    // Géométrie 5.2 par défaut (⚙️ non surchargé en E2E) : levelsPerWorld=10 → 11
    // nœuds (le dernier = boss, MAP §6). Le nom accessible complet suffixe le
    // libellé de TYPE (« — Niveau », doublage a11y, `nodeAccessibleName`).
    const total = "11";

    // Nœud 0 (position 1) : COMPLÉTÉ (#136 câblé) — le niveau terminé au test précédent est
    // persisté (une ligne `progress`). Reste navigable (rejoue monotone, MAP §1). Le nom
    // accessible inclut les étoiles obtenues (`nodeCompleted`) — on matche sur le préfixe
    // « terminé » (les étoiles varient selon le score réel du niveau joué).
    const completedNode = page
      .getByRole("link", { name: new RegExp(`^Nœud 1 sur ${total} — terminé`, "u") })
      .first();
    await expect(completedNode).toBeVisible();
    await expect(completedNode).toHaveAttribute("href", "/jouer");

    // Nœud 1 (position 2) : désormais COURANT (le nœud 0 complété a ouvert le suivant,
    // déblocage linéaire MAP §1) — lien navigable vers /jouer.
    const currentName = `${strings.map.nodeCurrent
      .replace("{n}", "2")
      .replace("{total}", total)} — ${strings.map.type.normal}`;
    const currentNode = page.getByRole("link", { name: currentName });
    await expect(currentNode).toBeVisible();
    await expect(currentNode).toHaveAttribute("href", "/jouer");

    // Nœud 2 (position 3) : VERROUILLÉ — jamais un lien (déblocage linéaire, MAP §1).
    const lockedName = `${strings.map.nodeLocked
      .replace("{n}", "3")
      .replace("{total}", total)} — ${strings.map.type.normal}`;
    await expect(page.getByRole("img", { name: lockedName })).toBeVisible();

    // Nœud trésor (position 4, cadence ⚙️ tous les 4 nœuds, MAP §3) : type doublé du
    // libellé « Trésor » dans le nom accessible (a11y daltonisme, jamais couleur seule).
    const treasureName = `${strings.map.nodeLocked
      .replace("{n}", "4")
      .replace("{total}", total)} — ${strings.map.type.treasure}`;
    await expect(page.getByRole("img", { name: treasureName })).toBeVisible();

    // Boss (dernier nœud, position 11, MAP §6) : type doublé du libellé « Boss ».
    const bossName = `${strings.map.nodeLocked
      .replace("{n}", total)
      .replace("{total}", total)} — ${strings.map.type.boss}`;
    await expect(page.getByRole("img", { name: bossName })).toBeVisible();

    // Régression invisibilité #169 (playtest owner) : le trait du chemin doit être VISIBLE,
    // pas peint derrière le médaillon opaque. Garde sur la GÉOMÉTRIE RENDUE RÉELLE (jsdom ne
    // fait pas de layout ; ici Playwright le fait) : le connecteur doit vivre dans la
    // gouttière SOUS la pastille (son sommet ≥ le bas du médaillon), donc jamais recouvert.
    // Casse si on régresse vers `top: calc(--map-node-size / 2)` (le trait dans le nœud).
    const connectorOcclusion = await page.evaluate(() => {
      const svg = document.querySelector("[data-map-connector]");
      if (svg === null) return null;
      const li = svg.closest("li");
      const badge = li?.querySelector("[data-map-node-status]");
      if (badge == null) return null;
      const s = svg.getBoundingClientRect();
      const b = badge.getBoundingClientRect();
      return { svgTop: s.top, svgHeight: s.height, badgeBottom: b.bottom };
    });
    expect(connectorOcclusion).not.toBeNull();
    // Le connecteur commence AU BAS de la pastille (à ~1px près) et a une hauteur non nulle
    // (il occupe la gouttière) → il n'est pas noyé dans le médaillon.
    expect(connectorOcclusion!.svgTop).toBeGreaterThanOrEqual(connectorOcclusion!.badgeBottom - 1);
    expect(connectorOcclusion!.svgHeight).toBeGreaterThan(0);

    // ── Thématisation per-monde câblée — PREUVE PIXEL en vrai navigateur (story 6.7, piège #170) ──
    // « Token vert » (jsdom) prouve la MÉCANIQUE, jamais la VISIBILITÉ. Ici Playwright résout le
    // CSS réel : on vérifie que (a) `--world-accent` est réellement POSÉ sur `<main>` et **diffère
    // du défaut neutre** `--color-accent-secondary` (donc un vrai accent per-monde est appliqué,
    // pas le repli), (b) le **bandeau d'accent** PEINT cette couleur (sa couleur calculée == l'accent
    // résolu, pas la neutre), (c) le bandeau est **visible** (dimensions non nulles, dans le cadre)
    // et **ne recouvre pas** le nœud courant (anti-occlusion : contenu lisible par-dessus le thème).
    const themed = await page.evaluate(() => {
      const main = document.querySelector("main");
      const bar = document.querySelector("[data-world-accent-bar]");
      const currentLink = document.querySelector('a[data-map-node-status="current"]');
      if (main === null || bar === null || currentLink === null) return null;
      const resolve = (value: string) => {
        // Résout une valeur CSS (hex OU var()) en rgb calculé via un élément sonde.
        const probe = document.createElement("span");
        probe.style.color = value;
        document.body.appendChild(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        return rgb;
      };
      const cs = getComputedStyle(main);
      const worldAccent = cs.getPropertyValue("--world-accent").trim();
      const neutralDefault = cs.getPropertyValue("--color-accent-secondary").trim();
      const barRect = bar.getBoundingClientRect();
      const nodeRect = currentLink.getBoundingClientRect();
      return {
        dataWorld: main.getAttribute("data-world"),
        worldAccentResolved: resolve(worldAccent),
        neutralResolved: resolve(neutralDefault),
        barColor: getComputedStyle(bar).backgroundColor,
        barW: barRect.width,
        barH: barRect.height,
        barTop: barRect.top,
        nodeVisible: nodeRect.width > 0 && nodeRect.height > 0,
      };
    });
    expect(themed).not.toBeNull();
    // (a) un vrai accent per-monde est appliqué (data-world posé + accent ≠ neutre par défaut).
    expect(themed!.dataWorld).not.toBeNull();
    expect(themed!.worldAccentResolved).not.toBe(themed!.neutralResolved);
    // (b) le bandeau PEINT réellement l'accent per-monde (pixel), pas la couleur neutre.
    expect(themed!.barColor).toBe(themed!.worldAccentResolved);
    // (c) le bandeau est visible (non nul, dans le cadre) et le nœud courant reste rendu (non occulté).
    expect(themed!.barW).toBeGreaterThan(0);
    expect(themed!.barH).toBeGreaterThan(0);
    expect(themed!.barTop).toBeGreaterThanOrEqual(0);
    expect(themed!.nodeVisible).toBe(true);

    // ── Scrim de contraste du titre — PREUVE GÉOMÉTRIE en vrai navigateur (story #189, piège #170) ──
    // Le fond-image réel du monde étant rendu (socle[0] seedé sur la fixture committée), le titre est
    // posé sur une carte scrim OPAQUE (`--world-surface`). jsdom ne fait AUCUN layout → ici Playwright
    // résout la géométrie réelle : (a) le fond-image du monde est bien peint sur <main>, (b) le scrim
    // est rendu + visible, (c) il COUVRE la zone du titre (enveloppe son rect), (d) le titre reste
    // visible (dimensions non nulles) → jamais occulté par le fond de carte.
    const scrim = await page.evaluate(() => {
      const el = document.querySelector("[data-world-scrim]");
      const h1 = el?.querySelector("h1");
      const main = document.querySelector("main");
      if (el === null || h1 == null || main === null) return null;
      const s = el.getBoundingClientRect();
      const t = h1.getBoundingClientRect();
      return {
        bgImage: getComputedStyle(main).backgroundImage,
        s: { top: s.top, bottom: s.bottom, left: s.left, right: s.right, w: s.width, h: s.height },
        t: { top: t.top, bottom: t.bottom, left: t.left, right: t.right, w: t.width, h: t.height },
      };
    });
    expect(scrim).not.toBeNull();
    // (a) le fond-image réel du monde est bien peint sur <main> (chemin `background !== null` actif).
    expect(scrim!.bgImage).toContain("world/e2e/background.png");
    // (b) scrim rendu + visible.
    expect(scrim!.s.w).toBeGreaterThan(0);
    expect(scrim!.s.h).toBeGreaterThan(0);
    // (c) le scrim ENVELOPPE le rect du titre (couvre bien sa zone, à ~1px près).
    expect(scrim!.s.top).toBeLessThanOrEqual(scrim!.t.top + 1);
    expect(scrim!.s.bottom).toBeGreaterThanOrEqual(scrim!.t.bottom - 1);
    expect(scrim!.s.left).toBeLessThanOrEqual(scrim!.t.left + 1);
    expect(scrim!.s.right).toBeGreaterThanOrEqual(scrim!.t.right - 1);
    // (d) le titre reste rendu + visible (jamais height:0 / occulté).
    expect(scrim!.t.w).toBeGreaterThan(0);
    expect(scrim!.t.h).toBeGreaterThan(0);

    // ── Tint de fond per-monde — PREUVE de dérivation en vrai navigateur (fix #184, story #189) ──
    // jsdom ne résout pas `color-mix` ; Chromium oui. On compare le `--world-bg-tint` calculé sur
    // <main> (re-déclaré inline avec l'accent DU MONDE) au `--world-bg-tint` d'un élément NEUTRE hors
    // <main> (qui hérite celui de `:root`, dérivé de l'accent PAR DÉFAUT). S'ils DIFFÈRENT, la
    // re-dérivation per-monde fonctionne réellement. Rougit si on retire la re-déclaration inline
    // (piège #184 : <main> hériterait alors le tint NEUTRE de `:root` → égalité, faux-dérivé dormant).
    const tint = await page.evaluate(() => {
      const main = document.querySelector("main");
      if (main === null) return null;
      // backgroundColor de <main> = `var(--world-bg-tint)` résolu (posé sous l'image du monde).
      const mainTint = getComputedStyle(main).backgroundColor;
      const probe = document.createElement("div"); // enfant de <body>, HORS <main> → hérite :root
      probe.style.backgroundColor = "var(--world-bg-tint)";
      document.body.appendChild(probe);
      const neutralTint = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { mainTint, neutralTint };
    });
    expect(tint).not.toBeNull();
    // Le tint de <main> dérive de l'accent DU MONDE → distinct du tint neutre de `:root` (per-monde réel).
    expect(tint!.mainTint).not.toBe(tint!.neutralTint);

    // ── Richesse visuelle per-monde (story #190) — URL CÂBLÉE + GÉOMÉTRIE NON-OCCLUSION (vrai layout) ──
    // ⚠️ Ces asserts prouvent le CÂBLAGE (URL de l'asset émise) + la GÉOMÉTRIE de boîte (visibilité,
    // non-occlusion) — PAS les pixels peints : `getComputedStyle().backgroundImage` renvoie la chaîne
    // URL même si le PNG ne décode pas. La **vraie preuve pixel #170** = la **capture Playwright
    // OUVERTE et regardée** en review (`docs/captures/190-carte-richesse.png` + capture réelle locale).
    // Ici Playwright fait le layout (jsdom non) → on garde ce que jsdom ne peut pas : la géométrie.
    const richness = await page.evaluate(() => {
      const tiles = document.querySelector("[data-world-tiles]");
      const teddy = document.querySelector("[data-world-teddy]");
      const currentLink = document.querySelector('a[data-map-node-status="current"]');
      const currentLi = currentLink?.closest("li");
      const medallion = currentLink?.querySelector("[data-map-medallion]");
      // Nœud AMONT (visuellement AU-DESSUS du courant) : le chemin est en `column-reverse` (départ
      // en bas, boss en haut) → le nœud rendu au-dessus est le `<li>` SUIVANT dans l'ordre DOM.
      const upstreamLi = currentLi?.nextElementSibling;
      const upstreamMed = upstreamLi?.querySelector("[data-map-medallion]");
      if (tiles === null || teddy === null || medallion == null) return null;
      const tilesRect = tiles.getBoundingClientRect();
      const teddyRect = teddy.getBoundingClientRect();
      const medRect = medallion.getBoundingClientRect();
      return {
        tilesBg: getComputedStyle(tiles).backgroundImage,
        tilesW: tilesRect.width,
        tilesH: tilesRect.height,
        tilesTop: tilesRect.top,
        teddyBg: getComputedStyle(teddy).backgroundImage,
        teddyW: teddyRect.width,
        teddyH: teddyRect.height,
        teddyTop: teddyRect.top,
        teddyBottom: teddyRect.bottom,
        // Le nœud COURANT ne porte qu'UN avatar Teddy (marqueur unique « tu es ici »).
        teddyCount: document.querySelectorAll("[data-world-teddy]").length,
        medCenterY: medRect.top + medRect.height / 2,
        // Bas du médaillon AMONT (ou `null` si le courant est le nœud le plus haut — pas d'amont).
        upstreamMedBottom: upstreamMed == null ? null : upstreamMed.getBoundingClientRect().bottom,
      };
    });
    expect(richness).not.toBeNull();
    // (a) BANDE DE DÉCOR : émet l'URL de l'image de tuiles du monde (câblage), visible, dans le cadre.
    expect(richness!.tilesBg).toContain("world/e2e/tiles.png");
    expect(richness!.tilesW).toBeGreaterThan(0);
    expect(richness!.tilesH).toBeGreaterThan(0);
    expect(richness!.tilesTop).toBeGreaterThanOrEqual(0);
    // (b) AVATAR TEDDY per-monde : émet l'URL de l'image Teddy du monde (câblage), un SEUL marqueur.
    expect(richness!.teddyBg).toContain("world/e2e/teddy.png");
    expect(richness!.teddyCount).toBe(1);
    // (c) VISIBLE + DANS LE CADRE : dimensions non nulles, sommet ≥ 0 (jamais clippé hors du haut).
    expect(richness!.teddyW).toBeGreaterThan(0);
    expect(richness!.teddyH).toBeGreaterThan(0);
    expect(richness!.teddyTop).toBeGreaterThanOrEqual(0);
    // (d) NON-OCCLUSION AVAL (#170) : l'avatar FLOTTE au-dessus du médaillon COURANT — son bas reste
    // au-dessus du CENTRE de la pastille, donc il ne recouvre jamais le glyphe de statut centré (▶).
    // Casse si on régresse la position (ex. Teddy centré SUR la pastille, recouvrant le glyphe).
    expect(richness!.teddyBottom).toBeLessThanOrEqual(richness!.medCenterY);
    // (e) NON-OCCLUSION AMONT (robustesse #170, Frontend) : l'avatar ne DÉBORDE pas sur le nœud
    // du DESSUS — son sommet reste SOUS le bas du médaillon amont. Aux tokens actuels la marge est
    // large ; cet assert rougirait si un futur resserrement de `--map-node-gap` ou agrandissement de
    // `--map-node-teddy-size` faisait chevaucher l'avatar sur la pastille amont.
    expect(richness!.upstreamMedBottom).not.toBeNull();
    expect(richness!.teddyTop).toBeGreaterThanOrEqual(richness!.upstreamMedBottom!);

    // ── Contraste des glyphes de bas d'écran sur photo (story #202) — RENDU + GÉOMÉTRIE vrai layout ──
    // Sur la photo IA arbitraire, deux éléments étaient peints SANS fond opaque (contraste ~1.21:1 sur
    // la fixture rayée, #170) : le bouton « Changer de joueur » (ghost) et le trait du chemin (peint
    // dans la gouttière de <main>, backmost). #202 pose un scrim/casing opaque `--world-surface` sous
    // chacun. jsdom ne fait pas de layout → ici on vérifie en vrai navigateur que (a) le scrim de footer
    // ENVELOPPE le bouton (couvre son rect, fond opaque résolu) et le bouton reste visible, (b) la casing
    // du trait est peinte, plus large que le trait, avec la MÊME géométrie (gouttière) → aucune occlusion
    // nouvelle, fond de référence du trait = un token opaque, pas la photo.
    const footer = await page.evaluate(() => {
      const scrim = document.querySelector("[data-world-footer-scrim]");
      const button = scrim?.querySelector("button");
      const casing = document.querySelector("[data-map-connector-casing]");
      const line = document.querySelector(
        "[data-map-connector] line:not([data-map-connector-casing])",
      );
      const casingSvg = casing?.closest("svg");
      const casingBadge = casingSvg?.closest("li")?.querySelector("[data-map-node-status]");
      if (
        scrim == null ||
        button == null ||
        casing == null ||
        line == null ||
        casingBadge == null
      ) {
        return null;
      }
      const s = scrim.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      const casingRect = casing.getBoundingClientRect();
      const svgRect = casingSvg!.getBoundingClientRect();
      const badgeRect = casingBadge.getBoundingClientRect();
      const px = (v: string) => Number.parseFloat(v);
      return {
        // (a) scrim de footer : fond opaque résolu (non transparent) + enveloppe le bouton + bouton visible.
        scrimBg: getComputedStyle(scrim).backgroundColor,
        scrimCoversButton:
          s.top <= b.top + 1 &&
          s.bottom >= b.bottom - 1 &&
          s.left <= b.left + 1 &&
          s.right >= b.right - 1,
        buttonVisible: b.width > 0 && b.height > 0,
        // (b) casing du trait : plus large que le trait coloré + couleur ≠ celle du trait + opaque.
        casingWidth: px(getComputedStyle(casing).strokeWidth),
        lineWidth: px(getComputedStyle(line).strokeWidth),
        casingStroke: getComputedStyle(casing).stroke,
        lineStroke: getComputedStyle(line).stroke,
        // Non-occlusion : le SVG (casing incluse) vit dans la gouttière SOUS la pastille (sommet ≥ bas
        // du médaillon), donc ni recouvert par le nœud ni recouvrant un glyphe (même invariant que #169).
        casingInGutter: svgRect.top >= badgeRect.bottom - 1 && casingRect.height > 0,
      };
    });
    expect(footer).not.toBeNull();
    // (a) le scrim de footer est opaque (jamais transparent → contraste garanti) et enveloppe le bouton.
    expect(footer!.scrimBg).not.toBe("rgba(0, 0, 0, 0)");
    expect(footer!.scrimBg).not.toBe("transparent");
    expect(footer!.scrimCoversButton).toBe(true);
    expect(footer!.buttonVisible).toBe(true);
    // (b) la casing est PLUS LARGE que le trait (halo visible de part et d'autre) et d'une couleur
    // DISTINCTE (opaque `--world-surface` vs `--map-node-path-color`) → le fond de référence du trait
    // n'est plus la photo. Non-occlusion : la casing partage la gouttière du connecteur (sous la pastille).
    expect(footer!.casingWidth).toBeGreaterThan(footer!.lineWidth);
    expect(footer!.casingStroke).not.toBe(footer!.lineStroke);
    expect(footer!.casingInGutter).toBe(true);

    await page.screenshot({ path: "docs/captures/126-carte-progression.png", fullPage: true });
    // Capture dédiée story 6.7 (thématisation per-monde) — OUVERTE et analysée (pixels) en review.
    await page.screenshot({ path: "docs/captures/182-carte-theme.png", fullPage: true });
    // Capture dédiée story #189 (fond-image réel + scrim titre + tint per-monde) — OUVERTE en review.
    await page.screenshot({ path: "docs/captures/189-carte-scrim.png", fullPage: true });
    // Capture dédiée story #190 (bande de décor tuiles + avatar Teddy per-monde) — OUVERTE + pixels
    // analysés en review (garde-fou #170 : générer ne suffit pas, on regarde que c'est visible).
    await page.screenshot({ path: "docs/captures/190-carte-richesse.png", fullPage: true });
    // Capture dédiée story #202 (scrim opaque du bouton « Changer de joueur » + casing du trait sur
    // photo) — OUVERTE + pixels analysés en review (garde-fou #170 : glyphes lisibles sur la photo).
    await page.screenshot({ path: "docs/captures/202-carte-footer-contraste.png", fullPage: true });

    // Navigation nœud → niveau (MAP §1, point de reprise sur le nœud courant, #125) :
    // cliquer le nœud courant ramène bien à l'écran de jeu.
    await currentNode.click();
    await expect(page).toHaveURL(/\/jouer$/);
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

    // Déconnexion (fix flaky #88, cause-racine) : le clic déclenche l'action serveur
    // (révocation + effacement cookie, `logoutChild` — déjà awaited et donc DÉJÀ
    // effective quand `LogoutButton` enchaîne la navigation) PUIS une navigation
    // client (`router.push("/")`, englobée dans `startTransition` depuis le fix
    // #88 — `LogoutButton.tsx`). Cette navigation n'est PAS instantanée (RSC
    // fetch + render de `/`) : sous charge CI, elle peut dépasser le timeout par
    // défaut (5 s) de `toHaveURL` alors même que rien n'est cassé — c'était
    // EXACTEMENT le flake observé (issue #88). Fix ici (LEARNINGS #42 : attendre
    // l'état RÉEL, jamais un timeout gonflé en aveugle) : on attend un **état
    // observable** du DOM cible (le titre du sélecteur de profil, contenu réel de
    // `/`) avec une marge généreuse et EXPLICITE plutôt que le timeout implicite
    // par défaut — la garde échoue si la navigation ne se termine JAMAIS
    // (véritable régression), pas si elle prend simplement plus de 5 s.
    await page.getByRole("button", { name: strings.play.logout }).click();
    await expect(page.getByRole("heading", { level: 1, name: strings.login.title })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/$/);

    // Session révoquée serveur (déjà purgée avant même la navigation ci-dessus,
    // cf. `logoutChild` awaited dans la server action) : la route jeu redirige à
    // nouveau — navigation serveur complète (`page.goto`), pas de course possible
    // ici (le garde lit la session à CHAQUE requête, ENGINE/AUTH §2).
    await page.goto("/jouer");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/$/);
  });

  // NB #2.4 (rate-limit + backoff, AUTH §4) : pas de test E2E dédié. Le backoff
  // est un ralentissement **court** (base 1 s) et le message d'échec reste le
  // **même** générique (aucune UI dédiée) → une démo E2E dépendrait du temps réel
  // (la fenêtre expire pendant la navigation) = flaky sur un gate. La courbe et le
  // blocage sont couverts de façon **déterministe** (horloge injectée) en unitaire :
  // `rate-limit.test.ts`, `pin-attempts.test.ts`, `login.test.ts` (guardedAuthenticateChild).

  // ==========================================================================
  // Espace parent (story 7.1, épic #7) — entrée sélecteur + en-tête marque, gate
  // PIN parent, séparation stricte enfant/parent. Le PIN parent est 9876 (posé à
  // l'onboarding) — ces tests s'exécutent AVANT la récupération (qui le change).
  // ==========================================================================

  test("sélecteur : en-tête marque + entrée 🔒 Parent visibles NON recouvertes (capture)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // En-tête de marque « multiplyz 🧸 » rendu (WIREFRAMES §1a) au-dessus du titre.
    await expect(page.getByText(BRAND_NAME, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: strings.login.title })).toBeVisible();

    // Entrée « 🔒 Parent » (nom accessible neutre) visible.
    const parentEntry = page.getByRole("button", { name: strings.parent.entryLabel });
    await expect(parentEntry).toBeVisible();

    // NON-OCCLUSION (#170/#190) — la géométrie RAISONNÉE ne prouve rien : on vérifie en VRAI
    // navigateur que l'entrée n'est pas recouverte (l'élément le plus haut au CENTRE du bouton
    // est le bouton lui-même ou un de ses descendants), dans le cadre, cible ≥ 44 px.
    const geom = await page.evaluate((label) => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label,
      );
      if (btn == null) return null;
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      return {
        width: r.width,
        height: r.height,
        inViewport:
          r.top >= 0 &&
          r.left >= 0 &&
          r.bottom <= window.innerHeight &&
          r.right <= window.innerWidth,
        notOccluded: topEl != null && (topEl === btn || btn.contains(topEl)),
      };
    }, strings.parent.entryLabel);
    expect(geom).not.toBeNull();
    expect(geom!.width).toBeGreaterThanOrEqual(44); // cible tactile a11y (largeur)
    expect(geom!.height).toBeGreaterThanOrEqual(44); // cible tactile a11y (hauteur)
    expect(geom!.inViewport).toBe(true);
    expect(geom!.notOccluded).toBe(true);

    await page.screenshot({ path: "docs/captures/214-selecteur-parent.png", fullPage: true });
  });

  test("code parent correct → espace parent (stub) (capture)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: strings.parent.entryLabel }).click();
    // Vue pavé PIN parent (registre neutre, distinct du pavé enfant).
    await expect(
      page.getByRole("heading", { level: 1, name: strings.parent.pinTitle }),
    ).toBeVisible();
    // Capture du pavé PIN parent (titre `:285`) — vérif pixels : aucun outline UA parasite
    // autour du titre programmatiquement focus (tabIndex=-1), cf. fix Frontend PR #221.
    await page.screenshot({ path: "docs/captures/214-pave-pin-parent.png", fullPage: true });
    await enterPin(page, "9876"); // PIN parent posé à l'onboarding, auto-soumission au 4ᵉ

    await expect(page).toHaveURL(/\/parent$/);
    // Stub du tableau de bord : bandeau « Espace parent » + placeholder neutre (dashboard = 7.7).
    await expect(
      page.getByRole("heading", { level: 1, name: strings.parent.dashboard.title }),
    ).toBeVisible();
    await expect(page.getByText(strings.parent.dashboard.placeholder)).toBeVisible();

    await page.screenshot({ path: "docs/captures/214-espace-parent.png", fullPage: true });
  });

  test("« code parent oublié » depuis le pavé parent → /parent/recuperation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: strings.parent.entryLabel }).click();
    await page.getByRole("button", { name: strings.parent.forgot }).click();
    await expect(page).toHaveURL(/\/parent\/recuperation$/);
    await expect(
      page.getByRole("heading", { level: 1, name: strings.recovery.title }),
    ).toBeVisible();
  });

  test("SÉCU : une session ENFANT ne peut pas ouvrir /parent (redirigée)", async ({ page }) => {
    // Connexion enfant → session kind=child.
    await page.goto("/");
    await page.getByRole("button", { name: profileLabel }).click();
    await enterPin(page, "1234");
    await expect(page).toHaveURL(/\/jouer$/);

    // Le garde de /parent filtre kind==='parent' → une session enfant est redirigée au sélecteur.
    await page.goto("/parent");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: strings.login.title })).toBeVisible();
  });

  test("SÉCU : une session PARENT ne peut pas ouvrir le jeu enfant (redirigée)", async ({
    page,
  }) => {
    // Connexion parent → session kind=parent.
    await page.goto("/");
    await page.getByRole("button", { name: strings.parent.entryLabel }).click();
    await enterPin(page, "9876");
    await expect(page).toHaveURL(/\/parent$/);

    // Le garde du jeu filtre kind==='child' → une session parent est redirigée au sélecteur.
    await page.goto("/jouer");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: strings.login.title })).toBeVisible();
  });

  test("/parent sans session valide → redirection vers le sélecteur", async ({ page }) => {
    // Contexte neuf (aucun cookie) → le garde parent redirige au sélecteur.
    await page.goto("/parent");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: strings.login.title })).toBeVisible();
  });

  test("quitter l'espace parent → session parent révoquée, /parent redirige de nouveau", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: strings.parent.entryLabel }).click();
    await enterPin(page, "9876");
    await expect(page).toHaveURL(/\/parent$/);

    // Sortie (✕ du wireframe §7) : révoque la session serveur puis retourne au sélecteur.
    await page.getByRole("button", { name: strings.parent.dashboard.exit }).click();
    await expect(page.getByRole("heading", { level: 1, name: strings.login.title })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/$/);

    // Session révoquée serveur : /parent redirige à nouveau (le garde lit la session à chaque requête).
    await page.goto("/parent");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/$/);
  });

  // ==========================================================================
  // Gérer les profils (story 7.5, #218) — renommer / réinitialiser le PIN enfant /
  // supprimer = purge + révocation de session. Sous garde session PARENT (9876, encore
  // valide ici — AVANT la récupération qui le change). La création d'un frère/sœur est v2
  // (pas d'UI) → on amorce `Zoé` en base pour prouver la suppression sur un profil NON
  // propriétaire ; le propriétaire (Léa) n'est JAMAIS muté (rename/reset/delete ciblent Zoé).
  // ==========================================================================

  test("gérer les profils : propriétaire non-supprimable + frère/sœur supprimable (capture + non-occlusion)", async ({
    page,
  }) => {
    // Zoé (frère/sœur) + sa session sont amorcés par la chaîne `webServer` (seed-sibling.cli).
    await goToManageAsParent(page);
    await expect(page.getByRole("heading", { level: 1, name: manage.title })).toBeVisible();

    // Propriétaire (Léa) : badge « Compte parent » + suppression DÉSACTIVÉE (garde OWNER).
    const ownerRegion = page.getByRole("region", { name: manageProfileLabel("Léa") });
    await expect(ownerRegion.getByText(manage.ownerBadge)).toBeVisible();
    await expect(ownerRegion.getByRole("button", { name: manage.delete.action })).toBeDisabled();

    // Frère/sœur (Zoé) : suppression ACTIVE.
    const siblingRegion = page.getByRole("region", { name: manageProfileLabel(SIBLING_NAME) });
    const siblingDelete = siblingRegion.getByRole("button", { name: manage.delete.action });
    await expect(siblingDelete).toBeEnabled();

    // NON-OCCLUSION (#170/#190) — assert de layout RÉEL : le bouton de suppression est cliquable
    // (non recouvert au centre), dans le cadre, cible ≥ 44 px. Le raisonnement géométrique ne
    // suffit pas (rétro #190) → on vérifie en vrai navigateur.
    const geom = await siblingDelete.evaluate((btn) => {
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      return {
        width: r.width,
        height: r.height,
        inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight,
        notOccluded: topEl != null && (topEl === btn || btn.contains(topEl)),
      };
    });
    expect(geom.height).toBeGreaterThanOrEqual(44);
    expect(geom.width).toBeGreaterThanOrEqual(44);
    expect(geom.inViewport).toBe(true);
    expect(geom.notOccluded).toBe(true);

    // Masque l'indicateur dev Next.js (badge « N » coin bas-gauche) pour une preuve pixel propre.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({ path: "docs/captures/218-gerer-profils.png", fullPage: true });
  });

  test("SÉCU : une session ENFANT ne peut pas ouvrir /parent/profils (redirigée)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: profileLabel }).click(); // Léa
    await enterPin(page, "1234");
    await expect(page).toHaveURL(/\/jouer$/);

    // Le garde de groupe `(espace)` filtre kind==='parent' → une session enfant est redirigée.
    await page.goto("/parent/profils");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: strings.login.title })).toBeVisible();
  });

  test("renommer un frère/sœur (Zoé → Zoélie)", async ({ page }) => {
    await goToManageAsParent(page);
    const region = page.getByRole("region", { name: manageProfileLabel(SIBLING_NAME) });
    await region.getByRole("button", { name: manage.rename.action }).click();
    await page.getByRole("textbox").fill("Zoélie");
    await page.getByRole("button", { name: manage.rename.save }).click();

    await expect(page.getByText(manage.rename.success)).toBeVisible();
    // La liste (servie par le serveur) reflète le nouveau prénom.
    await expect(page.getByRole("region", { name: manageProfileLabel("Zoélie") })).toBeVisible();
  });

  test("réinitialiser le PIN enfant : le NOUVEAU code marche, l'ANCIEN non", async ({ page }) => {
    await goToManageAsParent(page);
    const region = page.getByRole("region", { name: manageProfileLabel("Zoélie") });
    await region.getByRole("button", { name: manage.resetPin.action }).click();
    await enterPin(page, "3333"); // pavé de réinitialisation (pas d'auto-soumission)
    await page.getByRole("button", { name: manage.resetPin.save }).click();
    await expect(page.getByText(manage.resetPin.success)).toBeVisible();

    // Preuve bout-en-bout : l'ANCIEN code (2222) échoue, le NOUVEAU (3333) ouvre le jeu.
    await page.goto("/");
    await page.getByRole("button", { name: selectorLabel("Zoélie") }).click();
    await enterPin(page, "2222"); // auto-soumission au 4ᵉ → échec générique, pavé réinitialisé
    await expect(page.getByText(strings.login.error)).toBeVisible();
    await enterPin(page, "3333"); // nouveau code → session enfant → jeu
    await expect(page).toHaveURL(/\/jouer$/);
  });

  test("supprimer un frère/sœur = purge + session révoquée (cascade)", async ({ page }) => {
    const cookie = {
      name: "mz_session",
      value: SIBLING_SESSION_TOKEN,
      url: `http://localhost:${process.env.PORT || "3104"}`,
      httpOnly: true,
      sameSite: "Lax" as const,
    };

    // AVANT : la session amorcée de Zoélie est valide (le token ouvre le jeu).
    await page.context().addCookies([cookie]);
    await page.goto("/jouer");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/jouer$/);
    await page.context().clearCookies();

    // Suppression via l'UI parent (confirmation destructive).
    await goToManageAsParent(page);
    const region = page.getByRole("region", { name: manageProfileLabel("Zoélie") });
    await region.getByRole("button", { name: manage.delete.action }).click();
    await expect(
      page.getByText(manage.delete.confirmBody.replace("{prénom}", "Zoélie")),
    ).toBeVisible();
    await page.getByRole("button", { name: manage.delete.confirm }).click();
    await expect(page.getByText(manage.delete.success)).toBeVisible();
    // La carte du profil a disparu (purge).
    await expect(page.getByRole("region", { name: manageProfileLabel("Zoélie") })).toHaveCount(0);

    // APRÈS : la session amorcée est révoquée par la cascade FK → le token n'ouvre plus rien.
    await page.context().clearCookies();
    await page.context().addCookies([cookie]);
    await page.goto("/jouer");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/$/);
  });

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
