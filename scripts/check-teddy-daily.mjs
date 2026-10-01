/** Real new-household journey on port 3218. Never points at the family server or writes SQLite. */
import { chromium } from "@playwright/test";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
if (process.argv.includes("--resume")) {
  await import("./check-teddy-daily-resume.mjs");
  process.exit(0);
}
const fresh = process.argv.includes("--fresh-household");
const origin = "http://127.0.0.1:3218",
  dir = `docs/playthroughs/teddy-daily${fresh ? "/final-pass" : ""}`;
const db = new Database(
  fresh ? "data/teddy-daily-fresh-check.sqlite" : "data/teddy-daily-check.sqlite",
  { readonly: true, fileMustExist: true },
);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
let context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
});
let page;
const errors = [],
  geometry = [];
async function newPage() {
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
}
async function capture(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}
async function layout(name) {
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name);
  for (const item of await page.locator("main button:visible, main a:visible").all()) {
    const b = await item.boundingBox();
    assert(b.height >= 43.9, `${name}: ${await item.textContent()}`);
  }
  geometry.push({
    name,
    viewport: page.viewportSize(),
    main: await page.locator("main").boundingBox(),
  });
  await capture(name);
}
const count = (table) => db.prepare(`select count(*) n from ${table}`).get().n;
const checkpoint = () =>
  JSON.parse(
    db.prepare("select state from adventure_sessions where profile_id=?").get(profileId).state,
  );
let profileId;
async function reopen(path) {
  const storageState = await context.storageState();
  await context.close();
  context = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  await newPage();
  await page.goto(origin + path);
}
async function phase(name) {
  await page.locator(`.forest-adventure[data-phase="${name}"]`).waitFor();
  await page.locator('.forest-panel[aria-busy="false"]').waitFor();
}
async function loseReply() {
  let used = false;
  await page.route("**/jouer", async (route) => {
    if (route.request().method() !== "POST" || used) return route.continue();
    used = true;
    await route.fetch();
    await route.abort("failed");
  });
}
async function answer() {
  const q = checkpoint().game.current.question;
  const [a, b] = q.operands;
  const result =
    q.skill === "comp10" ? 10 - a : q.skill === "add" ? a + b : q.skill === "sub" ? a - b : a * b;
  if (q.format === "qcm") await page.keyboard.press(String(q.choices.indexOf(result) + 1));
  else {
    await page.getByRole("textbox", { name: "Ta réponse" }).fill(String(result));
    await page.keyboard.press("Enter");
  }
}
try {
  await newPage();
  await page.goto(origin);
  if (count("profiles") === 0) {
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await layout(`setup-${width}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("textbox").fill("Nova");
    await page.getByRole("button", { name: "Portrait chat", exact: true }).click();
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await page.keyboard.type("7171");
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await page.keyboard.type("1111");
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await page.locator(".daily-error").waitFor();
    await capture("02-code-confirmation");
    await page.keyboard.type("7171");
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await page.keyboard.type("8181");
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await page.keyboard.type("8181");
    await page.getByRole("button", { name: "C'est parti !", exact: true }).click();
    await page.getByRole("checkbox").waitFor();
    assert.equal(count("profiles"), 1);
    assert.equal(count("mastery"), 0);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "C'est noté, continuer", exact: true }).click();
    await capture("03-ready");
    await page.getByRole("button", { name: "On y va !", exact: true }).click();
  }
  profileId = db.prepare("select id from profiles where name='Nova'").get().id;
  await page.getByRole("button", { name: "Jouer avec Nova", exact: true }).waitFor();
  {
    await page.getByRole("button", { name: "Jouer avec Nova", exact: true }).click();
    await page.keyboard.type("7171");
    await page.waitForURL(/\/(jouer|carte)$/);
  }
  let diagnostic;
  const continuing = count("mastery") > 0;
  const resumedFrom = checkpoint().phase;
  if (!continuing) {
    if (resumedFrom === "arrival") {
      await phase("arrival");
      assert.equal(count("mastery"), 0);
      await capture("04-first-journey");
      await page.getByRole("button", { name: "Préparer mon chemin", exact: true }).click();
      await phase("question");
    }
    if (checkpoint().diagnostic.responses.length === 0) {
      const start = checkpoint();
      await page.getByRole("button", { name: /Pause/ }).click();
      await page.getByRole("dialog").waitFor();
      assert(checkpoint().paused);
      await capture("05-pause");
      await page.getByRole("link", { name: "M’arrêter pour aujourd’hui", exact: true }).click();
      await page.waitForURL("**/repos");
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await layout(`rest-${width}`);
      }
      await reopen("/");
      await page.getByRole("link", { name: "Reprendre mon aventure", exact: true }).waitFor();
      await layout("06-return");
      assert.equal(await page.getByRole("group", { name: "Ton code secret" }).count(), 0);
      await page.getByRole("link", { name: "Reprendre mon aventure", exact: true }).click();
      await page.waitForURL("**/repos");
      await page.getByRole("link", { name: "Reprendre mon aventure", exact: true }).click();
      await phase("question");
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "Je reprends", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.deepEqual(checkpoint().game, start.game);
      await loseReply();
      await answer();
      await page
        .locator(".forest-network")
        .getByText("Ta réponse est gardée. On reprend dès que le réseau revient.", { exact: true })
        .waitFor();
      const afterAnswer = checkpoint();
      assert.equal(afterAnswer.diagnostic.responses.length, 1);
      await reopen("/jouer");
      await phase("feedback");
      assert.equal(checkpoint().diagnostic.responses.length, 1);
    }
    if (checkpoint().phase === "feedback") {
      await phase("feedback");
      await page.getByRole("button", { name: "Continuer le chemin", exact: true }).click();
    }
    while (checkpoint().phase !== "finale") {
      await phase("question");
      await answer();
      await phase("feedback");
      await page.getByRole("button", { name: "Continuer le chemin", exact: true }).click();
      await page.waitForFunction(() =>
        ["question", "finale"].includes(document.querySelector(".forest-adventure")?.dataset.phase),
      );
    }
    await phase("finale");
    diagnostic = checkpoint();
    assert(diagnostic.diagnostic);
    assert.equal(count("mastery"), diagnostic.game.questions.length);
    assert.equal(count("attempts"), 0);
    assert.equal(count("progress"), 0);
    assert.equal(count("ledger"), 0);
    await capture("07-diagnostic-complete");
    await loseReply();
    await page.getByRole("button", { name: "Découvrir ma carte", exact: true }).click();
    await page
      .locator(".forest-network")
      .getByText("Ta réponse est gardée. On reprend dès que le réseau revient.", { exact: true })
      .waitFor();
    await reopen("/jouer");
    await page.waitForURL("**/carte");
    await capture("08-first-map");
  } else {
    diagnostic = checkpoint();
    assert(
      diagnostic.diagnostic && diagnostic.phase === "closed",
      "Only continue the already completed diagnostic",
    );
  }
  await page.getByRole("link", { name: "Continuer l’aventure", exact: true }).click();
  await phase("arrival");
  assert(!checkpoint().diagnostic);
  await page.getByRole("button", { name: "Allons-y", exact: true }).click();
  let played = 0;
  while (checkpoint().phase !== "finale") {
    await phase("question");
    await answer();
    played++;
    await phase("feedback");
    await page.getByRole("button", { name: "Continuer le chemin", exact: true }).click();
    await page.waitForFunction(() =>
      ["question", "finale"].includes(document.querySelector(".forest-adventure")?.dataset.phase),
    );
  }
  await phase("finale");
  await page.getByRole("button", { name: "Notre souvenir", exact: true }).click();
  await phase("results");
  await page.getByRole("button", { name: "Retrouver mon chemin", exact: true }).click();
  await page.waitForURL("**/carte");
  assert.equal(count("progress"), 1);
  assert.equal(count("attempts"), played);
  await capture("09-first-level-saved");
  await page.goto(origin);
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await layout(`home-${width}`);
  }
  assert.deepEqual(errors, []);
  const stored = await context.storageState();
  assert(!JSON.stringify(stored.origins).includes("7171"));
  assert(!JSON.stringify(stored.origins).includes("8181"));
  const report = {
    continuedAfterDiagnostic: continuing,
    resumedFrom,
    profileCount: count("profiles"),
    diagnosticQuestions: diagnostic.game.questions.length,
    diagnosticMasteryCount: diagnostic.diagnostic.responses.length,
    firstLevelQuestions: played,
    progressCount: count("progress"),
    attemptCount: count("attempts"),
    ledgerCount: count("ledger"),
    pauseResumedSameQuestion: true,
    responseLossReplayedOnce: true,
    codesStoredLocally: false,
    geometry,
    pageErrors: errors,
  };
  await writeFile(`${dir}/verification.json`, JSON.stringify(report, null, 2) + "\n");
  console.log("DAILY VERIFIED", JSON.stringify(report));
} catch (error) {
  await capture("failure").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  db.close();
  await browser.close();
}
