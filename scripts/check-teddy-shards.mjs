import { chromium } from "@playwright/test";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const origin = "http://127.0.0.1:3217";
const dir = "docs/playthroughs/teddy-shards";
await mkdir(dir, { recursive: true });
const db = new Database("data/teddy-shards-check.sqlite", { readonly: true });
const profileId = db.prepare("SELECT id FROM profiles WHERE name = ?").get("Nova").id;
const checkpoint = () =>
  JSON.parse(
    db.prepare("SELECT state FROM adventure_sessions WHERE profile_id = ?").get(profileId).state,
  );
const balance = () =>
  db.prepare("SELECT coins, shards FROM wallet WHERE profile_id = ?").get(profileId) ?? {
    coins: 0,
    shards: 0,
  };
const eggSpends = () =>
  db
    .prepare(
      "SELECT count(*) n FROM ledger WHERE profile_id = ? AND reason = 'egg' AND currency = 'coins'",
    )
    .get(profileId).n;
const browser = await chromium.launch({ headless: true });
let context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
});
let page;
let playedQuestions = 0;
let playedLevels = 0;
const errors = [];
const geometry = [];
async function newPage() {
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.stack);
  });
}
const snap = (name) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
async function reopen(path) {
  const storageState = await context.storageState();
  await context.close();
  context = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  await newPage();
  await page.goto(`${origin}${path}`);
}
async function checkLayout(name, art = false) {
  await page.evaluate(() => document.fonts.ready);
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `no horizontal overflow: ${name}`,
  );
  const h1 = page.locator("main h1");
  const title = await h1.boundingBox();
  assert(title.x >= 0 && title.x + title.width <= page.viewportSize().width + 1);
  for (const button of await page.locator("main button:visible, main a:visible").all()) {
    const box = await button.boundingBox();
    assert(box.height >= 43.9, `target height ${await button.textContent()}`);
  }
  if (art) {
    const img = page.locator('[data-asset="shard-companion"]');
    assert.equal(await img.getAttribute("data-asset-state"), "rendered");
    await img.evaluate((el) => el.decode());
    const box = await img.boundingBox();
    assert(
      box.width >= (page.viewportSize().width < 600 ? 220 : 300),
      "creature dominates the encounter",
    );
    assert(box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1);
    geometry.push({ name, box });
  }
  await snap(name);
}
const phase = (p) => page.locator(`.forest-adventure[data-phase="${p}"]`).waitFor();
async function earnLevel() {
  await page.goto(`${origin}/jouer`);
  await phase("arrival");
  await page.getByRole("button", { name: "Allons-y" }).click();
  let questions = 0;
  while (true) {
    await phase("question");
    await page.locator('.forest-panel[aria-busy="false"]').waitFor();
    const q = checkpoint().game.current.question;
    const value =
      q.skill === "comp10"
        ? 10 - q.operands[0]
        : q.skill === "add"
          ? q.operands[0] + q.operands[1]
          : q.skill === "sub"
            ? q.operands[0] - q.operands[1]
            : q.operands[0] * q.operands[1];
    if (q.format === "qcm") await page.keyboard.press(String(q.choices.indexOf(value) + 1));
    else {
      await page.getByRole("textbox", { name: "Ta réponse" }).fill(String(value));
      await page.keyboard.press("Enter");
    }
    await phase("feedback");
    await page.locator('.forest-panel[aria-busy="false"]').waitFor();
    await page.getByRole("button", { name: "Continuer le chemin", exact: true }).click();
    await page.waitForFunction(() =>
      ["question", "finale"].includes(document.querySelector(".forest-adventure")?.dataset.phase),
    );
    questions++;
    if (await page.locator('.forest-adventure[data-phase="finale"]').count()) break;
  }
  await page.getByRole("button", { name: "Notre souvenir" }).click();
  await phase("results");
  await page.getByRole("button", { name: "Retrouver mon chemin", exact: true }).click();
  await page.waitForURL("**/carte");
  playedQuestions += questions;
  playedLevels++;
  console.log("earned", { playedLevels, playedQuestions, ...balance() });
}

const spends = () =>
  db.prepare("SELECT count(*) n FROM ledger WHERE profile_id=? AND reason='shop'").get(profileId).n;
async function loseNextResponse(target = page) {
  let handled = false;
  await target.route("**/boutique/eclats", async (route) => {
    if (route.request().method() !== "POST" || handled) return route.continue();
    handled = true;
    await route.fetch();
    await route.abort("failed");
  });
}
let concurrentContext;
try {
  await newPage();
  await page.goto(origin);
  await page.getByRole("button", { name: "Jouer avec Nova" }).click();
  for (const digit of "7171")
    await page.getByRole("button", { name: `Chiffre ${digit}`, exact: true }).click();
  await page.waitForURL("**/carte");
  await page.goto(`${origin}/boutique`);
  await page
    .getByRole("link", { name: "Choisir un compagnon avec mes éclats", exact: true })
    .click();
  await page.locator("[data-shard-choice]").first().waitFor();
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await checkLayout(`catalogue-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator("[data-shard-choice]").filter({ hasText: "60 éclats" }).first().click();
  await page.getByText("Encore 50 éclats", { exact: false }).waitFor();
  assert.equal(await page.locator("[data-shard-buy]").count(), 0);
  await checkLayout("01-not-enough", true);
  const initial = { ...balance(), eggs: eggSpends() };
  while (balance().shards < 60) {
    assert(playedLevels < 60, "bounded playthrough");
    while (balance().coins < 50) await earnLevel();
    await page.goto(`${origin}/boutique`);
    await page.locator("[data-egg-buy]").click();
    await page.locator("[data-egg-open]").click();
    await page.locator("[data-egg-reveal]").waitFor();
    console.log("egg", { count: eggSpends(), ...balance() });
    await page.getByRole("button", { name: "Revenir à la clairière", exact: true }).click();
    await page.locator('[data-shop-phase="shop"]').waitFor();
  }
  await page.goto(`${origin}/boutique/eclats`);
  const choice = page.locator("[data-shard-choice]").filter({ hasText: "60 éclats" }).first();
  await choice.waitFor();
  const creature = await choice.getAttribute("data-shard-choice");
  concurrentContext = await browser.newContext({
    storageState: await context.storageState(),
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  let second = await concurrentContext.newPage();
  await second.goto(`${origin}/boutique/eclats`);
  const otherChoice = second.locator("[data-shard-choice]").filter({ hasText: "60 éclats" }).last();
  await otherChoice.click();
  await choice.focus();
  await page.keyboard.press("Enter");
  const art = await page.locator('[data-asset="shard-companion"]').getAttribute("src");
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await checkLayout(`choice-${width}`, true);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  const before = balance();
  await loseNextResponse();
  await page.locator("[data-shard-buy]").evaluate((button) => {
    button.click();
    button.click();
  });
  await page.getByText("La connexion a été interrompue.", { exact: false }).waitFor();
  assert.equal(spends(), 1);
  assert.deepEqual(balance(), { coins: before.coins, shards: before.shards - 60 });
  await loseNextResponse(second);
  await second.locator("[data-shard-buy]").click();
  await second.getByText("La connexion a été interrompue.", { exact: false }).waitFor();
  assert.equal(spends(), 1);
  const secondStorage = await concurrentContext.storageState();
  await concurrentContext.close();
  await reopen("/boutique/eclats");
  await page.locator('[data-shard-phase="encounter"]').waitFor();
  assert.equal(
    await page.locator("[data-shard-character]").getAttribute("data-shard-character"),
    creature,
  );
  assert.equal(await page.locator('[data-asset="shard-companion"]').getAttribute("src"), art);
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await checkLayout(`encounter-${width}`, true);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await loseNextResponse();
  await page.getByRole("button", { name: "Retrouver mon compagnon", exact: true }).click();
  await page.getByText("La connexion a été interrompue.", { exact: false }).waitFor();
  await reopen("/boutique/eclats");
  await page.waitForURL(`**/collection/${encodeURIComponent(creature)}`);
  const detailArt = page.locator('[data-asset="creature-detail-art"]');
  await detailArt.waitFor();
  assert.equal(await detailArt.getAttribute("src"), art);
  await snap("02-companion");
  concurrentContext = await browser.newContext({
    storageState: secondStorage,
    reducedMotion: "reduce",
  });
  second = await concurrentContext.newPage();
  await second.goto(`${origin}/boutique/eclats`);
  await second.locator('[data-shard-phase="encounter"]').waitFor();
  assert.equal(
    await second.locator("[data-shard-character]").getAttribute("data-shard-character"),
    creature,
  );
  assert.equal(spends(), 1);
  await concurrentContext.close();
  await page.goto(`${origin}/collection`);
  const card = page.locator(`[data-collection-card="${creature}"]`);
  await card.getByRole("link").waitFor();
  assert.equal(await card.locator("img").getAttribute("src"), art);
  await snap("03-collection");
  await page.goto(`${origin}/boutique/eclats`);
  await page.locator('[data-shard-phase="catalogue"]').waitFor();
  assert.equal(await page.locator(`[data-shard-choice="${creature}"]`).count(), 0);
  assert.equal(
    db
      .prepare("SELECT count FROM collection WHERE profile_id=? AND character_id=?")
      .get(profileId, creature).count,
    1,
  );
  assert.equal(errors.length, 0);
  const report = {
    ok: true,
    initial,
    playedLevels,
    playedQuestions,
    eggsOpened: eggSpends() - initial.eggs,
    before,
    after: balance(),
    targetedSpends: spends(),
    creature,
    art,
    concurrentReplay: true,
    geometry,
    errors,
  };
  await writeFile(`${dir}/verification.json`, JSON.stringify(report, null, 2));
  console.log(report);
} catch (error) {
  console.log("FAILURE URL", page.url(), await page.locator("main").innerText());
  await snap("debug-failure");
  throw error;
} finally {
  db.close();
  await browser.close();
}
