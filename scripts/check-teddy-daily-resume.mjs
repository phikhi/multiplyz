/** Two separately authenticated browsers, no database writes or carried browser storage. */
import { chromium } from "@playwright/test";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const db = new Database("data/teddy-daily-fresh-check.sqlite", {
  readonly: true,
  fileMustExist: true,
});
const id = db.prepare("select id from profiles where name='Nova'").get().id;
const checkpoint = () =>
  JSON.parse(db.prepare("select state from adventure_sessions where profile_id=?").get(id).state);
const counts = () =>
  Object.fromEntries(
    ["attempts", "progress", "ledger"].map((t) => [
      t,
      db.prepare(`select count(*) n from ${t}`).get().n,
    ]),
  );
const before = counts(),
  errors = [];
const browser = await chromium.launch({ headless: true });
const origin = "http://127.0.0.1:3218",
  dir = "docs/playthroughs/teddy-daily/final-pass";
async function device() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(20000);
  return { context, page };
}
async function login(page) {
  await page.goto(origin);
  await page.getByRole("button", { name: "Jouer avec Nova", exact: true }).click();
  await page.keyboard.type("7171");
  await page.waitForURL(/\/(carte|repos|jouer)$/);
}
async function ready(page) {
  await page
    .locator('.forest-adventure[data-phase="question"] .forest-panel[aria-busy="false"]')
    .waitFor();
}
try {
  const first = await device();
  await login(first.page);
  await first.page.getByRole("link", { name: "Continuer l’aventure", exact: true }).click();
  await first.page.getByRole("button", { name: "Allons-y", exact: true }).click();
  await ready(first.page);
  const game = checkpoint().game;
  await first.page.keyboard.press("Escape");
  await first.page.getByRole("dialog").waitFor();
  assert(checkpoint().paused);
  const second = await device();
  await login(second.page);
  assert(second.page.url().endsWith("/repos"));
  await second.page
    .getByRole("heading", { name: "On se retrouve bientôt.", exact: true })
    .waitFor();
  await second.page.screenshot({ path: `${dir}/10-other-device-rest.png`, fullPage: true });
  await second.page.getByRole("link", { name: "Reprendre mon aventure", exact: true }).click();
  await ready(second.page);
  await second.page.getByRole("dialog").waitFor();
  assert.deepEqual(checkpoint().game, game);
  let lost = false;
  await second.page.route("**/jouer", async (route) => {
    if (route.request().method() !== "POST" || lost) return route.continue();
    lost = true;
    await route.fetch();
    await route.abort("failed");
  });
  await second.page.getByRole("button", { name: "Je reprends", exact: true }).click();
  const dialog = second.page.getByRole("dialog");
  await dialog
    .getByText("Ta réponse est gardée. On reprend dès que le réseau revient.", { exact: true })
    .waitFor();
  assert.equal(checkpoint().paused, false);
  await second.page.screenshot({ path: `${dir}/11-resume-network.png`, fullPage: true });
  await dialog.getByRole("button", { name: "Réessayer l’envoi", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(checkpoint().game, game);
  await second.page.keyboard.press("Escape");
  await second.page.getByRole("dialog").waitFor();
  await second.page.getByRole("link", { name: "M’arrêter pour aujourd’hui", exact: true }).click();
  await second.page.waitForURL("**/repos");
  for (const width of [390, 320]) {
    await second.page.setViewportSize({ width, height: 800 });
    await second.page.screenshot({ path: `${dir}/other-device-rest-${width}.png`, fullPage: true });
    assert(await second.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await first.page.reload();
  await first.page.getByRole("dialog").waitFor();
  assert(checkpoint().paused);
  assert.deepEqual(checkpoint().game, game);
  const anonymous = await device();
  await anonymous.page.goto(origin + "/reprendre");
  await anonymous.page.waitForURL(origin + "/");
  assert.equal(
    await anonymous.page.getByRole("link", { name: "Reprendre mon aventure", exact: true }).count(),
    0,
  );
  assert.deepEqual(counts(), before);
  assert.deepEqual(errors, []);
  const result = {
    separateAuthenticatedDevices: true,
    pauseReopened: true,
    resumeResponseLostAndRetried: true,
    sameQuestionsAndAnswers: true,
    unauthenticatedReturnRefused: true,
    before,
    after: counts(),
    leftPaused: true,
    pageErrors: errors,
  };
  await writeFile(`${dir}/verification-resume.json`, JSON.stringify(result, null, 2) + "\n");
  console.log("DAILY RESUME VERIFIED", JSON.stringify(result));
} finally {
  db.close();
  await browser.close();
}
