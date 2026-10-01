import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import Database from "better-sqlite3";
import { strings } from "../src/strings";
import { forest } from "../src/strings/forest";
import { daily } from "../src/strings/daily";
import { parent as p } from "../src/strings/parent";
import { companions } from "../src/strings/companions";
import { eggShop } from "../src/strings/egg-shop";
import { CONFIG_DEFAULTS } from "../src/config/server-config";
import { SIBLING_NAME, SIBLING_SESSION_TOKEN } from "./seed-sibling";
import { PENDING_WORLD_A, PENDING_WORLD_B } from "./seed-pending-worlds";
import { COLLECTION_SESSION_TOKEN, COLLECTION_CREATURES } from "./seed-collection";
import { MAP_PROGRESS_SESSION_TOKEN, MAP_PROGRESS_COMPLETED_LEVELS } from "./seed-map-progress";
import {
  ACCURACY_HISTORY_SESSION_TOKEN,
  ACCURACY_HISTORY_DAILY_RATIOS,
} from "./seed-accuracy-history";
import { CANARI_PROFILE_NAME, CANARI_PROFILE_PIN } from "./seed-canari";
import { BOSS_PROGRESS_SESSION_TOKEN, BOSS_PROGRESS_COMPLETED_LEVELS } from "./seed-boss-progress";
import { BOUTIQUE_SESSION_TOKEN } from "./seed-boutique";

// One fresh household per invocation, prepared only by scripts/e2e-isolated.mjs.
// The serial flow preserves onboarding, child/parent guards, recovery and real purchases.
const nav = strings.onboarding.nav;
const avatarLabel = strings.onboarding.profile.avatarOption.replace(
  "{nom}",
  strings.onboarding.profile.avatarNames.fox,
);
const profileLabel = strings.login.profileOption.replace("{prénom}", "Léa");
const manage = strings.parent.manage;
const selectorLabel = (name: string) => strings.login.profileOption.replace("{prénom}", name);
const manageProfileLabel = (name: string) => manage.profileLabel.replace("{prénom}", name);
const digit = (d: string) => strings.pinPad.digit.replace("{d}", d);
let recoveryCode = "";
async function enterPin(page: Page, pin: string) {
  for (const d of pin)
    await page.getByRole("button", { name: digit(d), exact: true }).click({ force: true });
}
async function login(page: Page, name = "Léa", pin = "1234") {
  await page.goto("/");
  await page.getByRole("button", { name: selectorLabel(name), exact: true }).click();
  await enterPin(page, pin);
  // The selector first navigates to the server-side return resolver. On a cold
  // webpack compile that redirect can remain visible briefly; force a fresh
  // request so the resolver is observed instead of treating the intermediate
  // URL as a failed login.
  await expect(page).toHaveURL(/\/(carte|jouer|repos|reprendre)$/, { timeout: 15_000 });
  if (page.url().endsWith("/reprendre")) await page.goto("/carte");
  await expect(page).toHaveURL(/\/(carte|jouer|repos|jouer)$/, { timeout: 15_000 });
}
async function parentLogin(page: Page, pin = "9876") {
  await page.goto("/parent/connexion");
  await enterPin(page, pin);
  await expect(page).toHaveURL(/\/parent$/);
}
async function cookie(page: Page, value: string) {
  await page.context().addCookies([
    {
      name: "mz_session",
      value,
      url: `http://localhost:${process.env.PORT || "3104"}`,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
async function goToManageAsParent(page: Page) {
  await parentLogin(page);
  await page.getByRole("link", { name: p.profiles, exact: true }).click();
}
async function phase(page: Page, name: string) {
  await expect(page.locator(".forest-adventure")).toHaveAttribute("data-phase", name);
  await expect(page.locator(".forest-panel")).toHaveAttribute("aria-busy", "false");
}
async function enterCurrentLevelFromMap(page: Page) {
  await page.locator('.forest-map-nodes [aria-current="step"]').click();
  await expect(page).toHaveURL(/\/jouer$/);
  await phase(page, "arrival");
}
function answerOf(text: string) {
  const complement = text.match(/^(\d+) \+ \? = (\d+)$/u);
  if (complement) return Number(complement[2]) - Number(complement[1]);
  const q = text.match(/^(\d+) ([+−×]) (\d+) = \?$/u);
  if (!q) throw new Error(`Unexpected equation: ${text}`);
  const a = Number(q[1]),
    b = Number(q[3]);
  return q[2] === "+" ? a + b : q[2] === "−" ? a - b : a * b;
}
async function answer(page: Page) {
  await phase(page, "question");
  const result = answerOf((await page.locator(".forest-equation").innerText()).trim());
  const input = page.getByRole("textbox", { name: forest.answerLabel });
  if (await input.count()) {
    await input.fill(String(result));
    await page.getByRole("button", { name: forest.submit, exact: true }).click();
  } else {
    await page
      .getByRole("group", { name: forest.answerLabel })
      .getByRole("button", { name: String(result), exact: true })
      .click();
  }
  await phase(page, "feedback");
}
async function finishQuestions(page: Page, max = 40) {
  for (let i = 0; i < max; i++) {
    await answer(page);
    await page.getByRole("button", { name: forest.next, exact: true }).click();
    await expect(page.locator(".forest-panel")).toHaveAttribute("aria-busy", "false");
    if (await page.locator('.forest-adventure[data-phase="finale"]').count()) return;
    await phase(page, "question");
  }
  throw new Error("The adventure did not reach its finale");
}
async function loadedArt(art: Locator, minimum = 0) {
  await expect(art).toHaveAttribute("data-asset-state", "rendered");
  await expect
    .poll(() => art.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect((await art.boundingBox())!.width).toBeGreaterThanOrEqual(minimum);
}
async function layout(page: Page, controls?: Locator) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (controls)
    for (const control of await controls.all()) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(43.9);
      expect(
        await control.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return top === el || (top !== null && el.contains(top));
        }),
      ).toBe(true);
    }
}
// Read-only observations against the new fixture prove writes are not duplicated on retries.
function rows(sql: string, ...args: (string | number)[]): Record<string, unknown>[] {
  const db = new Database(process.env.DATABASE_PATH!, { readonly: true });
  try {
    return db.prepare(sql).all(...args) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}
const profileId = (name: string) =>
  Number(rows("SELECT id FROM profiles WHERE name=?", name)[0].id);
const count = (table: string, id: number) =>
  Number(rows(`SELECT count(*) n FROM ${table} WHERE profile_id=?`, id)[0].n);

test.beforeAll(async () => {
  await mkdir("docs/captures", { recursive: true });
});
test.describe.serial("TEDDy : foyer, aventure et carnet familial", () => {
  test("foyer vide → écran 1er usage (capture)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const welcome = page.getByRole("heading", {
      level: 1,
      name: strings.onboarding.profile.title,
    });
    await expect(welcome).toBeVisible();
    await expect(page.getByRole("textbox")).toBeVisible();

    await page.screenshot({ path: "docs/captures/30-onboarding.png", fullPage: true });

    // GATING invite d'installation PWA (story 8.5, #258, bloquant review 1+4) — DÉTERMINISTE ICI :
    // ce test serial `foyer vide` s'exécute AVANT la création du foyer (retries:0), seul moment où
    // `/` rend l'onboarding (premier contact enfant↔Teddy, PRODUCT §1.1). L'invite ne DOIT PAS
    // apparaître ni recouvrir le titre Teddy focus-managé. Placé dans ce bloc serial (pas dans
    // `pwa.spec.ts` en parallèle) car l'état single-tenant « aucun foyer » est OPPOSÉ à celui que
    // ce parcours crée juste après (LEARNINGS : specs à état single-tenant opposé ne partagent pas
    // une base wipée-à-froid en parallèle).
    await page.evaluate(() => {
      class FakeBeforeInstallPromptEvent extends Event {
        constructor() {
          super("beforeinstallprompt", { cancelable: true });
        }
        prompt() {
          return Promise.resolve();
        }
        get userChoice() {
          return Promise.resolve({ outcome: "accepted" as const, platform: "web" });
        }
      }
      window.dispatchEvent(new FakeBeforeInstallPromptEvent());
    });
    await expect(
      page.getByRole("region", { name: strings.pwa.install.regionLabel }),
    ).not.toBeVisible();
    // Le titre Teddy reste visible ET non recouvert (reproduction directe du bug pixel-looké).
    await expect(welcome).toBeVisible();
    const welcomeOccluded = await welcome.evaluate((h1) => {
      const r = h1.getBoundingClientRect();
      const el = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return el === null || !h1.contains(el);
    });
    expect(welcomeOccluded).toBe(false);
    await page.screenshot({ path: "docs/captures/258-onboarding-non-recouvert.png" });
  });

  test("création → code de secours affiché une fois (capture)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Étape profil : prénom + avatar.
    await page.getByRole("textbox").fill("Léa");
    await page.getByRole("button", { name: avatarLabel }).click();
    await page.getByRole("button", { name: nav.next }).click();

    // Étape code enfant (pavé partagé).
    await enterPin(page, "1234");
    await page.getByRole("button", { name: nav.next }).click();

    await expect(page.getByRole("heading", { name: daily.confirmChild })).toBeVisible();
    await enterPin(page, "1234");
    await page.getByRole("button", { name: nav.next }).click();

    // Étape code parent (distinct).
    await expect(
      page.getByRole("heading", { name: strings.onboarding.parentPin.title }),
    ).toBeVisible();
    await enterPin(page, "9876");
    await page.getByRole("button", { name: nav.next }).click();
    await expect(page.getByRole("heading", { name: daily.confirmParent })).toBeVisible();
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

  test("accueil configuré : scène, profils et entrée parent accessibles", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: profileLabel })).toBeVisible();
    await expect(page.locator(".forest-home .tp-scene[data-frames]")).toBeAttached();
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await layout(
        page,
        page.getByRole("button", { name: strings.parent.entryLabel, exact: true }),
      );
    }
  });
  test("connexion enfant, carte puis diagnostic sans note", async ({ page }) => {
    await login(page);
    await enterCurrentLevelFromMap(page);
    await expect(page.getByRole("heading", { name: daily.diagnosticTitle })).toBeVisible();
    await page.getByRole("button", { name: daily.diagnosticBegin }).click();
    await phase(page, "question");
    await expect(page.getByRole("group", { name: forest.answerLabel })).toBeVisible();
    await expect(page.getByText(/score/i)).toHaveCount(0);
    // The complete diagnostic is exercised by the server/engine tests; this
    // browser check keeps its first real question and its no-score contract,
    // then leaves the shared household ready for the following journeys.
    await page.goto("/");
    await expect(page.getByRole("button", { name: profileLabel })).toBeVisible();
  });
  test("canari : aide, reprise après réponse perdue, récompense unique, carte et collection", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await login(page, CANARI_PROFILE_NAME, CANARI_PROFILE_PIN);
    const id = profileId(CANARI_PROFILE_NAME);
    const before = {
      attempts: count("attempts", id),
      ledger: count("ledger", id),
      progress: count("progress", id),
    };
    await enterCurrentLevelFromMap(page);
    await page.getByRole("button", { name: forest.begin }).click();
    await phase(page, "question");
    let lost = false;
    await page.route("**/jouer", async (route) => {
      if (!lost && route.request().method() === "POST") {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: forest.help, exact: true }).click();
    await expect(page.getByText(forest.pending, { exact: true }).first()).toBeVisible();
    expect(lost).toBe(true);
    expect(count("attempts", id)).toBe(before.attempts + 1);
    await page.unroute("**/jouer");
    await page.reload();
    await phase(page, "help");
    await page.getByRole("button", { name: forest.explore }).click();
    await page.getByRole("button", { name: forest.reveal }).click();
    await phase(page, "reveal");
    await expect(page.locator(".forest-help-result")).toBeVisible();
    await page.reload();
    await phase(page, "reveal");
    await page.getByRole("button", { name: forest.retry }).click();
    await answer(page);
    expect(count("attempts", id)).toBe(before.attempts + 1);
    await page.getByRole("button", { name: forest.next }).click();
    await finishQuestions(page);
    expect(count("attempts", id)).toBe(before.attempts + 10);
    expect(count("ledger", id)).toBe(before.ledger + 1);
    expect(count("progress", id)).toBe(before.progress + 1);
    await page.getByRole("button", { name: forest.results, exact: false }).click();
    await phase(page, "results");
    await page.reload();
    await phase(page, "results");
    expect(count("ledger", id)).toBe(before.ledger + 1);
    const state = JSON.parse(
      String(rows("SELECT state FROM adventure_sessions WHERE profile_id=?", id)[0].state),
    );
    expect(state.result.stars).toBe(2);
    await page.getByRole("button", { name: forest.returnMap }).click();
    await expect(page).toHaveURL(/\/carte$/);
    await expect(page.locator('.forest-map-nodes [data-status="completed"]')).toHaveCount(1);
    await expect(page.locator('[data-shell-balance="coins"]')).toHaveAttribute(
      "data-shell-balance-value",
      String(state.result.balance.coins),
    );
    await page.getByRole("link", { name: forest.collection, exact: true }).click();
    await expect(page).toHaveURL(/\/collection$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
  test("jeu : pause, clavier, son immédiat, mouvement réduit et reflow", async ({ page }) => {
    await login(page);
    await enterCurrentLevelFromMap(page);
    await page.getByRole("button", { name: forest.begin }).click();
    await phase(page, "question");
    const sound = page.getByRole("button", { name: /Son activé|Son coupé/ });
    const pressed = await sound.getAttribute("aria-pressed");
    await sound.click();
    await expect(sound).toHaveAttribute("aria-pressed", pressed === "true" ? "false" : "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: forest.reduced }).click();
    await page.getByRole("button", { name: forest.resumePlay, exact: true }).click();
    await expect(page.locator(".forest-adventure")).toHaveAttribute("data-reduced", "true");
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await layout(page, page.locator(".forest-question button:visible"));
      const panel = await page.locator(".forest-panel").boundingBox();
      expect(panel!.x).toBeGreaterThanOrEqual(0);
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `docs/captures/teddy-question-${width}.png` });
    }
    await page.reload();
    await phase(page, "question");
    await expect(page.locator(".forest-adventure")).toHaveAttribute("data-reduced", "true");
  });
  test("carte avancée : progression, nœuds distincts, reflow et hydratation", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await cookie(page, MAP_PROGRESS_SESSION_TOKEN);
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto("/carte");
      await expect(page.locator('.forest-map-nodes [data-status="completed"]')).toHaveCount(
        MAP_PROGRESS_COMPLETED_LEVELS,
      );
      await expect(page.locator('.forest-map-nodes [aria-current="step"]')).toBeVisible();
      await layout(page, page.locator('.forest-map-nodes [aria-current="step"]'));
      const boxes = await page.locator(".forest-node").evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        }),
      );
      expect(boxes).toHaveLength(11);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++)
          expect(
            boxes[i].right <= boxes[j].x ||
              boxes[j].right <= boxes[i].x ||
              boxes[i].bottom <= boxes[j].y ||
              boxes[j].bottom <= boxes[i].y,
          ).toBe(true);
    }
    expect(errors).toEqual([]);
  });
  test("collection : cinq possessions, silhouette inconnue, vrais arts et reflow", async ({
    page,
  }) => {
    await cookie(page, COLLECTION_SESSION_TOKEN);
    await page.goto("/collection");
    await expect(page.locator('[data-collection-card][data-owned="true"]')).toHaveCount(
      COLLECTION_CREATURES.length,
    );
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await layout(page, page.locator('[data-collection-card][data-owned="true"]'));
      await page.screenshot({
        path: `docs/captures/teddy-collection-${width}.png`,
        fullPage: true,
      });
    }
    await loadedArt(page.locator('[data-asset="collection-creature"]').first());
  });
  test("fiche compagnon : art en grand et surnom conservé après rechargement", async ({ page }) => {
    await cookie(page, COLLECTION_SESSION_TOKEN);
    await page.goto("/collection");
    await page.locator('[data-collection-card="e2e:collection:1"]').click();
    await loadedArt(page.locator('[data-asset="creature-detail-art"]'), 180);
    await page.getByRole("button", { name: strings.collection.rename, exact: true }).click();
    await page.getByRole("textbox", { name: strings.collection.renameLabel }).fill("Nuage doux");
    await page.getByRole("button", { name: strings.collection.renameSubmit, exact: true }).click();
    await expect(page.getByText(companions.savedName)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Nuage doux", exact: true })).toBeVisible();
  });
  test("boss : légendaire réellement gagnée et art rendu en grand", async ({ page }) => {
    test.setTimeout(150_000);
    await cookie(page, BOSS_PROGRESS_SESSION_TOKEN);
    await page.goto("/carte");
    await expect(page.locator('.forest-map-nodes [data-status="completed"]')).toHaveCount(
      BOSS_PROGRESS_COMPLETED_LEVELS,
    );
    await enterCurrentLevelFromMap(page);
    await page.getByRole("button", { name: forest.begin }).click();
    await finishQuestions(page);
    await page.getByRole("button", { name: forest.results, exact: false }).click();
    await phase(page, "results");
    await loadedArt(page.locator('[data-asset="forest-legendary"]'), 180);
    await expect(page.getByText(companions.added, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: companions.visit }).click();
    await expect(page).toHaveURL(/\/collection\//);
    await loadedArt(page.locator('[data-asset="creature-detail-art"]'), 180);
  });
  test("sécurité : jeu sans session, séparation enfant-parent et déconnexion", async ({ page }) => {
    await page.goto("/jouer");
    await expect(page).toHaveURL(/\/$/);
    await login(page);
    for (const path of ["/parent", "/parent/profils", "/parent/reglages"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/parent\/connexion$/);
      await expect(page.getByText(p.required)).toBeVisible();
    }
    await page.goto("/carte");
    await page.getByRole("button", { name: strings.play.logout }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/jouer");
    await expect(page).toHaveURL(/\/$/);
    await parentLogin(page);
    await page.goto("/jouer");
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/parent");
    await page.getByRole("button", { name: strings.parent.dashboard.exit }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/parent");
    await expect(page).toHaveURL(/\/parent\/connexion$/);
  });
  test("carnet parent : données réelles, quatre compétences et filtre de période", async ({
    page,
  }) => {
    await parentLogin(page);
    await expect(page.getByRole("heading", { name: p.title("Léa") })).toBeVisible();
    await expect(page.locator(".parent-skill-grid article")).toHaveCount(4);
    await page
      .getByRole("combobox", { name: p.profile, exact: true })
      .selectOption({ label: CANARI_PROFILE_NAME });
    await page.getByRole("combobox", { name: p.period, exact: true }).selectOption("all");
    await page.getByRole("button", { name: p.apply, exact: true }).click();
    await expect(page.getByRole("heading", { name: p.title(CANARI_PROFILE_NAME) })).toBeVisible();
    await expect(page.getByText(p.answers(9, 10), { exact: true })).toBeVisible();
    await expect(page.getByText(p.levels(1, 11), { exact: true })).toBeVisible();
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await layout(page);
    }
  });
  test("historique parent : les journées affichent les valeurs de la fixture", async ({ page }) => {
    await cookie(page, ACCURACY_HISTORY_SESSION_TOKEN);
    await page.goto("/parent");
    const table = page.locator(".parent-table");
    await expect(table).toBeVisible();
    for (const ratio of ACCURACY_HISTORY_DAILY_RATIOS) {
      await expect(
        table.getByText(`${Math.round(ratio * 100)} %`, { exact: true }).first(),
      ).toBeVisible();
    }
  });
  test("mondes : aperçu puis confirmation, approbation et rejet persistés", async ({ page }) => {
    const wa = strings.parent.worldApproval;
    await parentLogin(page);
    await page.getByRole("link", { name: p.worlds, exact: true }).click();
    const card = (world: typeof PENDING_WORLD_A) =>
      page.getByRole("region", {
        name: wa.worldLabel.replace("{n}", String(world.index + 1)).replace("{thème}", world.theme),
      });
    await expect(card(PENDING_WORLD_A)).toBeVisible();
    await expect(card(PENDING_WORLD_B)).toBeVisible();
    await card(PENDING_WORLD_A).getByRole("button", { name: wa.approve.action }).click();
    await expect(page.getByText(p.approveTitle)).toBeVisible();
    await page.getByRole("button", { name: p.approveConfirm }).click();
    await expect(card(PENDING_WORLD_A)).toHaveCount(0);
    await card(PENDING_WORLD_B).getByRole("button", { name: wa.reject.action }).click();
    await page.getByRole("button", { name: wa.reject.confirm }).click();
    await expect(card(PENDING_WORLD_B)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(wa.empty)).toBeVisible();
  });
  test("profils : propriétaire protégé, renommage et confirmation du nouveau PIN", async ({
    page,
  }) => {
    await goToManageAsParent(page);
    const owner = page.getByRole("region", { name: manageProfileLabel("Léa") });
    await expect(owner.getByRole("button", { name: manage.delete.action })).toBeDisabled();
    let sibling = page.getByRole("region", { name: manageProfileLabel(SIBLING_NAME) });
    await sibling.getByRole("button", { name: manage.rename.action }).click();
    await sibling.getByRole("textbox").fill("Zoélie");
    await sibling.getByRole("button", { name: manage.rename.save }).click();
    sibling = page.getByRole("region", { name: manageProfileLabel("Zoélie") });
    await expect(sibling).toBeVisible();
    await sibling.getByRole("button", { name: manage.resetPin.action }).click();
    await enterPin(page, "3333");
    await sibling.getByRole("button", { name: p.next, exact: true }).click();
    await enterPin(page, "3333");
    await sibling.getByRole("button", { name: p.savePin }).click();
    await expect(page.getByText(manage.resetPin.success)).toBeVisible();
    await page.goto("/");
    await page.getByRole("button", { name: selectorLabel("Zoélie") }).click();
    await enterPin(page, "2222");
    await expect(page.getByText(strings.login.error)).toBeVisible();
    await enterPin(page, "3333");
    await expect(page).toHaveURL(/\/carte$/);
  });
  test("profils : suppression du frère, purge et révocation de sa session", async ({ page }) => {
    await cookie(page, SIBLING_SESSION_TOKEN);
    await page.goto("/jouer");
    await expect(page).toHaveURL(/\/jouer$/);
    await goToManageAsParent(page);
    const sibling = page.getByRole("region", { name: manageProfileLabel("Zoélie") });
    await sibling.getByRole("button", { name: manage.delete.action }).click();
    await sibling.getByRole("button", { name: manage.delete.confirm }).click();
    await expect(sibling).toHaveCount(0);
    await page.context().clearCookies();
    await cookie(page, SIBLING_SESSION_TOKEN);
    await page.goto("/jouer");
    await expect(page).toHaveURL(/\/$/);
    expect(rows("SELECT id FROM profiles WHERE name='Zoélie'")).toHaveLength(0);
  });
  test("réglages : thème et limite persistants, mouvement local et recalibrage sans perte", async ({
    page,
  }) => {
    await parentLogin(page);
    await page.getByRole("link", { name: p.settings, exact: true }).click();
    await page.getByRole("button", { name: "Sombre", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const limit = page.getByRole("switch", { name: "Limite quotidienne", exact: true });
    await limit.click();
    await expect(page.getByRole("status").filter({ hasText: p.saved })).toBeVisible();
    await page.reload();
    await expect(limit).toBeChecked();
    await limit.click();
    await expect(limit).not.toBeChecked();
    await page.getByRole("button", { name: "Clair", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const id = profileId("Léa"),
      before = count("mastery", id);
    await page.getByRole("button", { name: "Recalibrer", exact: true }).click();
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
    expect(rows("SELECT recalibration_requested r FROM profiles WHERE id=?", id)[0].r).toBe(0);
    await page.getByRole("button", { name: "Recalibrer", exact: true }).click();
    await page.getByRole("button", { name: "Oui, recalibrer", exact: true }).click();
    await expect(page.getByText(p.recalibrateDone)).toBeVisible();
    expect(count("mastery", id)).toBe(before);
    expect(rows("SELECT recalibration_requested r FROM profiles WHERE id=?", id)[0].r).toBe(1);
  });
  test("récupération parent : confirmation du PIN et rotation du code de secours", async ({
    page,
  }) => {
    const rec = strings.recovery;
    await page.goto("/");
    await page.getByRole("button", { name: strings.parent.entryLabel }).click();
    await page.getByRole("button", { name: strings.parent.forgot }).click();
    await expect(page).toHaveURL(/\/parent\/recuperation$/);
    await expect(page.getByRole("button", { name: rec.verify })).toBeDisabled();
    await page.getByRole("textbox").fill(recoveryCode);
    await page.getByRole("button", { name: rec.verify }).click();
    await expect(page.getByRole("heading", { name: rec.newPinTitle })).toBeVisible();
    await enterPin(page, "1111");
    await page.getByRole("button", { name: p.next, exact: true }).click();
    await enterPin(page, "1111");
    await page.getByRole("button", { name: rec.submit }).click();
    await expect(page.getByRole("heading", { name: rec.done.title })).toBeVisible();
    expect(await page.getByText(/^[A-Z0-9]{8}$/).textContent()).not.toBe(recoveryCode);
    await page.getByRole("checkbox", { name: p.savedRecovery }).check();
    await page.getByRole("button", { name: rec.done.cta }).click();
    await parentLogin(page, "1111");
  });
});
test.describe("Boutique / Œufs (R4.2 #393)", () => {
  test("acheter un œuf → ouverture → créature révélée EN GRAND au VRAI art (capture, #180 + garde-MAGNITUDE)", async ({
    page,
  }) => {
    // Viewport desktop fixe → magnitude déterministe (`--egg-reveal-art-size: min(15rem, 66vw)` = 240px).
    await page.setViewportSize({ width: 1024, height: 768 });
    const cookie = {
      name: "mz_session",
      value: BOUTIQUE_SESSION_TOKEN,
      url: `http://localhost:${process.env.PORT || "3104"}`,
      httpOnly: true,
      sameSite: "Lax" as const,
    };
    await page.context().addCookies([cookie]);
    await page.goto("/boutique");
    await page.waitForLoadState("networkidle");

    // Carte œuf affichée (état serveur chargé) + prix interpolé (⚙️ 50) sur le bouton d'achat.
    await expect(page.getByRole("heading", { level: 1, name: eggShop.title })).toBeVisible();
    // Libellé du bouton d'achat DÉRIVÉ de la config ⚙️ (pas figé sur 50) : découplé du prix, robuste
    // à une recalibration de `eggPriceCoins` — même patron que les autres sélecteurs config-driven.
    const buyLabel = eggShop.buy(CONFIG_DEFAULTS.economy.spend.eggPriceCoins);
    const buyButton = page.getByRole("button", { name: buyLabel });
    await expect(buyButton).toBeVisible();

    // Achat → ouverture d'œuf.
    await buyButton.click();
    await page.getByRole("button", { name: eggShop.open }).click();

    // La révélation apparaît (moment WIREFRAMES §6b). Le bloc `role="img"` nomme la créature.
    const reveal = page.locator("[data-egg-reveal]");
    await expect(reveal).toBeVisible();
    // Nouveauté (profil vierge) : beat célébration Teddy (COPY §3), jamais « rien ».
    await expect(page.getByText(eggShop.newFriend)).toBeVisible();

    // ---------- #180 : VRAI art committé RENDU (pas le repli emoji) ----------
    const art = page.locator('[data-asset="egg-reveal-creature"]');
    await expect(art).toBeVisible();
    await expect(art).toHaveAttribute("data-asset-state", "rendered");
    // Tirage du monde 0 → art réel `creature_world_0_*.png` servi par `seed-creature-sprites`
    // (assertion NON permissive #239 : le préfixe exact du namespace socle, jamais un pattern flou).
    const src = await art.getAttribute("src");
    expect(src).toContain("/generated/socle/creature/creature_world_0_");
    // Réellement CHARGÉE (vrais pixels décodés, pas un <img> pointant un 404).
    expect(await art.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    // ---------- Garde-MAGNITUDE (règle promue CLAUDE.md ; PAS un plancher de présence) ----------
    // L'art de la créature tirée est LE moment de gratification de la boucle de dépense → il DOMINE
    // l'écran (`--egg-reveal-art-size` ≈ 240px desktop). Seuil `>= 180` : rougit si le token régresse
    // vers `--teddy-*` (96px) ou une vignette (48px) — jamais un plancher `> vignette` qui resterait
    // vert sur un rendu sous-livré (rétro R3.2 #379).
    const artBox = await art.boundingBox();
    expect(artBox).not.toBeNull();
    expect(artBox!.width).toBeGreaterThanOrEqual(180);

    // ---------- Non-occlusion (art EN FLUX, géométrie RENDUE réelle — jamais raisonnée, #170/#190) ----------
    // Le titre du moment d'ouverture (« L'œuf s'ouvre… ») est le `[data-egg-opening]` focus-managé —
    // l'art (dans le bloc `[data-egg-reveal]`) suit EN FLUX, jamais recouvert par lui.
    const geometry = await page.evaluate(() => {
      const opening = document.querySelector("h1");
      const artEl = document.querySelector('[data-asset="egg-reveal-creature"]');
      if (opening === null || artEl === null) return null;
      return {
        openingBottom: opening.getBoundingClientRect().bottom,
        artTop: artEl.getBoundingClientRect().top,
      };
    });
    expect(geometry).not.toBeNull();
    // L'art (en flux) est sous le titre du moment, jamais recouvert par lui.
    expect(geometry!.artTop).toBeGreaterThanOrEqual(geometry!.openingBottom);

    // CTA de fermeture présent (l'enfant repart quand il veut, no-FOMO).
    await expect(page.getByRole("button", { name: eggShop.continue })).toBeVisible();

    await page.screenshot({ path: "docs/captures/393-egg-open-reveal.png", fullPage: true });
  });
});
