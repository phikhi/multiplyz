import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { strings } from "../src/strings";

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
    await expect(page.getByRole("button", { name: strings.play.results.continue })).toBeVisible();
    await page.screenshot({ path: "docs/captures/64-resultats.png", fullPage: true });
  });

  test("carte du monde → nœud courant navigable, nœuds suivants verrouillés (capture)", async ({
    page,
  }) => {
    // Reconnexion (nouveau contexte de test, cookie absent — même profil, déjà amorcé).
    // NB (discovered, hors scope #125) : `/jouer` (#64) ne câble pas encore
    // `finishLevelAction` (5.3/#124) — jouer un niveau via l'écran de jeu nu n'écrit
    // donc pas encore de ligne `progress` (ce câblage arrive avec l'écran de résultats
    // économique, story #5.5, ECONOMY §4.1). La carte affiche donc fidèlement l'état
    // SERVEUR réel du profil à ce stade : nœud 0 encore COURANT (aucun niveau
    // persisté), tous les suivants VERROUILLÉS (déblocage linéaire, MAP §1) — la
    // composition serveur (`currentMapAction` → `loadCurrentWorldMap`, 5.2+5.3+moteur)
    // est vérifiée sur base réelle par `current-map.test.ts` (y compris le cas
    // "nœud complété" scénarisé en intégration) ; cet E2E vérifie le rendu + la
    // navigation en conditions réelles (next-dev-loop indispo < Next 16.3, #24).
    await page.goto("/");
    await page.getByRole("button", { name: profileLabel }).click();
    await enterPin(page, "1234");
    await expect(page).toHaveURL(/\/jouer$/);

    await page.goto("/carte");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { level: 1, name: strings.map.title.replace("{n}", "1") }),
    ).toBeVisible();

    // Géométrie 5.2 par défaut (⚙️ non surchargé en E2E) : levelsPerWorld=10 → 11
    // nœuds (le dernier = boss, MAP §6). Le nom accessible complet suffixe le
    // libellé de TYPE (« — Niveau », doublage a11y, `nodeAccessibleName`).
    const total = "11";

    // Nœud 0 (position 1) : COURANT — point de reprise, lien navigable vers /jouer.
    const currentName = `${strings.map.nodeCurrent
      .replace("{n}", "1")
      .replace("{total}", total)} — ${strings.map.type.normal}`;
    const currentNode = page.getByRole("link", { name: currentName });
    await expect(currentNode).toBeVisible();
    await expect(currentNode).toHaveAttribute("href", "/jouer");

    // Nœud 1 (position 2) : VERROUILLÉ — jamais un lien (déblocage linéaire, MAP §1).
    const lockedName = `${strings.map.nodeLocked
      .replace("{n}", "2")
      .replace("{total}", total)} — ${strings.map.type.normal}`;
    const lockedNode = page.getByRole("img", { name: lockedName });
    await expect(lockedNode).toBeVisible();

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

    await page.screenshot({ path: "docs/captures/125-carte.png", fullPage: true });

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
