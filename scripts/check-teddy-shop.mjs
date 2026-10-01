import { chromium } from "@playwright/test";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const origin = "http://127.0.0.1:3217";
const dir = "docs/playthroughs/teddy-shop";
await mkdir(dir, { recursive: true });
const db = new Database("data/teddy-shop-check.sqlite", { readonly: true });
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
const spends = () =>
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
    const img = page.locator('[data-asset="egg-reveal-creature"]');
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
  console.log("earned", { questions, ...balance() });
}
async function loseNextResponse() {
  let handled = false;
  await page.route("**/boutique", async (route) => {
    if (route.request().method() !== "POST" || handled) return route.continue();
    handled = true;
    await route.fetch();
    await route.abort("failed");
  });
}
try {
  await newPage();
  await page.goto(origin);
  await page.getByRole("button", { name: "Jouer avec Nova" }).click();
  for (const digit of "7171")
    await page.getByRole("button", { name: `Chiffre ${digit}`, exact: true }).click();
  await page.waitForURL("**/carte");
  await page.getByRole("link", { name: "La cabane aux œufs", exact: true }).click();
  await page.getByText("Encore 50 pièces", { exact: false }).waitFor();
  await checkLayout("01-not-enough");
  await earnLevel();
  await earnLevel();
  assert.equal(balance().coins, 50);
  await page.getByRole("link", { name: "La cabane aux œufs", exact: true }).click();
  await page.locator("[data-egg-buy]").waitFor();
  await checkLayout("02-shop");
  await loseNextResponse();
  await page.locator("[data-egg-buy]").evaluate((button) => {
    button.click();
    button.click();
  });
  await page.getByText("La connexion a été interrompue.", { exact: false }).waitFor();
  assert.equal(spends(), 1);
  assert.equal(balance().coins, 0);
  await reopen("/boutique");
  await page.locator("[data-egg-open]").waitFor();
  await checkLayout("03-egg-restored");
  assert.equal(spends(), 1);
  await page.locator("[data-egg-open]").click();
  await page.locator("[data-egg-reveal]").waitFor();
  const creature = await page.locator("[data-egg-character]").getAttribute("data-egg-character");
  const art = await page.locator('[data-asset="egg-reveal-creature"]').getAttribute("src");
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await checkLayout(`encounter-${width}`, true);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await loseNextResponse();
  await page.getByRole("button", { name: "Retrouver mon compagnon", exact: true }).click();
  await page.getByText("La connexion a été interrompue.", { exact: false }).waitFor();
  await reopen("/boutique");
  await page.waitForURL(`**/collection/${encodeURIComponent(creature)}`);
  const detailArt = page.locator('[data-asset="creature-detail-art"]');
  await detailArt.waitFor();
  assert.equal(await detailArt.getAttribute("src"), art);
  await snap("04-companion");
  assert.equal(spends(), 1);
  let duplicate = false;
  for (let draw = 2; draw <= 12 && !duplicate; draw++) {
    while (balance().coins < 50) await earnLevel();
    await page.goto(`${origin}/boutique`);
    await page.locator("[data-egg-buy]").click();
    await page.locator("[data-egg-open]").click();
    await page.locator("[data-egg-reveal]").waitFor();
    duplicate = (await page.locator("[data-egg-shards]").count()) > 0;
    if (duplicate) {
      await checkLayout("05-duplicate", true);
      assert(balance().shards > 0);
    }
    await page.getByRole("button", { name: "Revenir à la clairière", exact: true }).click();
    await page.locator('[data-shop-phase="shop"]').waitFor();
  }
  assert(duplicate, "observed a real random duplicate");
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await checkLayout(`shop-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal(
    await page.locator(".egg-shell").evaluate((el) => getComputedStyle(el).animationName),
    "egg-float",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page.locator(".egg-shell").evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.getByRole("link", { name: "Mes compagnons", exact: true }).click();
  await page.locator(`[data-collection-card="${creature}"]`).waitFor();
  await snap("06-collection");
  assert.equal(errors.length, 0);
  const report = {
    ok: true,
    earnedLevels: db
      .prepare(
        "SELECT count(*) n FROM ledger WHERE profile_id=? AND reason IN ('level','boss') AND currency='coins'",
      )
      .get(profileId).n,
    purchases: spends(),
    balance: balance(),
    creature,
    art,
    duplicate,
    geometry,
    errors,
  };
  await writeFile(`${dir}/verification.json`, JSON.stringify(report, null, 2));
  console.log(report);
} catch (error) {
  console.log(
    "FAILURE URL",
    page.url(),
    await page.locator("main").innerText(),
    await page.evaluate(() => ({ ...localStorage })),
  );
  await snap("debug-failure");
  throw error;
} finally {
  db.close();
  await browser.close();
}
