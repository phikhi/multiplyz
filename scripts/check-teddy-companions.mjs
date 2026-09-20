import { chromium } from "@playwright/test";
import Database from "better-sqlite3";
import sharp from "sharp";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const origin = "http://127.0.0.1:3217";
const dir = "docs/playthroughs/teddy-companions";
await mkdir(dir, { recursive: true });
const db = new Database("data/teddy-companions-check.sqlite", { readonly: true });
const profileId = db.prepare("SELECT id FROM profiles WHERE name = ?").get("Nova").id;
const checkpoint = () =>
  JSON.parse(
    db.prepare("SELECT state FROM adventure_sessions WHERE profile_id = ?").get(profileId).state,
  );
const browser = await chromium.launch({ headless: true });
let context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
});
let page;
const errors = [];
async function newPage() {
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(page.url(), error.stack);
  });
}
const snap = (name) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
const phase = (name) => page.locator(`.forest-adventure[data-phase="${name}"]`).waitFor();
const ready = () => page.locator('.forest-panel[aria-busy="false"]').waitFor();
const valueOf = (q) =>
  q.skill === "comp10"
    ? 10 - q.operands[0]
    : q.skill === "add"
      ? q.operands[0] + q.operands[1]
      : q.skill === "sub"
        ? q.operands[0] - q.operands[1]
        : q.operands[0] * q.operands[1];
async function correct() {
  await phase("question");
  await ready();
  const q = checkpoint().game.current.question;
  const value = valueOf(q);
  if (q.format === "qcm") await page.keyboard.press(String(q.choices.indexOf(value) + 1));
  else {
    await page.getByRole("textbox", { name: "Ta réponse" }).fill(String(value));
    await page.keyboard.press("Enter");
  }
}
async function geometry(asset) {
  const image = page.locator(`[data-asset="${asset}"]`);
  await image.waitFor();
  assert.equal(await image.getAttribute("data-asset-state"), "rendered");
  await image.evaluate((el) => el.decode());
  const box = await image.boundingBox();
  assert(box.width >= (page.viewportSize().width < 600 ? 220 : 300), "creature art must be large");
  assert(box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  return box;
}
async function reopen(path) {
  const state = await context.storageState();
  await context.close();
  context = await browser.newContext({
    storageState: state,
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  await newPage();
  await page.goto(`${origin}${path}`);
}
try {
  await newPage();
  await page.goto(origin);
  await page.getByRole("button", { name: "Jouer avec Nova" }).click();
  for (const digit of "7171")
    await page.getByRole("button", { name: `Chiffre ${digit}`, exact: true }).click();
  await page.waitForURL("**/carte");
  await page.getByRole("link", { name: "Mes compagnons", exact: true }).click();
  await page.getByRole("heading", { name: "Mes compagnons", exact: true }).waitFor();
  assert.equal(await page.locator('[data-owned="true"]').count(), 0);
  assert((await page.locator('[data-owned="false"]').count()) > 0);
  await snap("01-empty-album");
  await page.goto(`${origin}/carte`);
  const levels = [];
  for (let level = 0; level <= 10; level++) {
    await page
      .getByRole("link", {
        name: /Continuer l’aventure|Reprendre mon passage|Retrouver mon souvenir/,
      })
      .click();
    await phase("arrival");
    await ready();
    await page.getByRole("button", { name: "Allons-y" }).click();
    await phase("question");
    await ready();
    const start = checkpoint();
    assert.equal(start.levelIndex, level);
    const boss = level === 10;
    if (boss) assert(start.game.questions.length >= 12 && start.game.questions.length <= 15);
    for (let i = 0; i < start.game.questions.length; i++) {
      if (boss) {
        await phase("question");
        await ready();
        await page.getByRole("button", { name: "Un coup de patte", exact: true }).click();
        await phase("help");
        await ready();
        await page.getByRole("button", { name: "Voir le résultat", exact: true }).click();
        await phase("reveal");
        await ready();
        await page.getByRole("button", { name: "Je réessaie", exact: true }).click();
      }
      await correct();
      await phase("feedback");
      await ready();
      const last = boss && i === start.game.questions.length - 1;
      if (last) {
        let lost = false;
        await page.route("**/jouer", async (route) => {
          if (!lost && route.request().method() === "POST") {
            lost = true;
            await route.fetch();
            await route.abort("failed");
          } else await route.continue();
        });
        await page.getByRole("button", { name: "Continuer le chemin", exact: true }).click();
        await page.getByText("Ta réponse est gardée.", { exact: false }).waitFor();
        assert.equal(checkpoint().phase, "finale");
        await reopen("/jouer");
      } else await page.getByRole("button", { name: "Continuer le chemin", exact: true }).click();
    }
    await phase("finale");
    await ready();
    if (boss) {
      assert.equal(checkpoint().result.stars, 0);
      await geometry("forest-legendary");
      await snap("02-legendary-encounter");
      for (const width of [1024, 390, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await geometry("forest-legendary");
        await snap(`encounter-${width}`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await page.getByRole("button", { name: "Notre souvenir", exact: true }).click();
    await phase("results");
    await ready();
    levels.push({
      level,
      questions: start.game.questions.length,
      stars: checkpoint().result.stars,
    });
    console.log(`Level ${level + 1} complete (${start.game.questions.length} questions)`);
    if (!boss) {
      await page.getByRole("button", { name: "Retrouver mon chemin", exact: true }).click();
      await page.waitForURL("**/carte");
    }
  }
  const reward = checkpoint().result;
  assert(reward.legendaryAdded && reward.unlockedNextWorld);
  const owned = () =>
    db
      .prepare("SELECT * FROM collection WHERE profile_id = ? AND character_id = ?")
      .get(profileId, reward.legendary.characterId);
  assert.equal(owned().count, 1);
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM ledger WHERE profile_id = ? AND ref_id = 'level:0:10'")
      .get(profileId).n,
    1,
  );
  await snap("03-receipt");
  const encounterSrc = await page.locator('[data-asset="forest-legendary"]').getAttribute("src");
  let closeReplyLost = false;
  await page.route("**/jouer", async (route) => {
    if (!closeReplyLost && route.request().method() === "POST") {
      closeReplyLost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Retrouver mon compagnon", exact: true }).click();
  await page.getByText("Ta réponse est gardée.", { exact: false }).waitFor();
  assert.equal(checkpoint().phase, "closed");
  await reopen("/jouer");
  await page.waitForURL("**/collection/**");
  await geometry("creature-detail-art");
  assert.equal(
    await page.locator('[data-asset="creature-detail-art"]').getAttribute("src"),
    encounterSrc,
  );
  await snap("04-companion-detail");
  await page.getByRole("button", { name: "Renommer", exact: true }).click();
  const input = page.getByRole("textbox");
  await input.fill("Luciolune");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await input.inputValue(), "Luciolune");
  await context.setOffline(false);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Son petit nom est enregistré." }).waitFor();
  assert.equal(owned().nickname, "Luciolune");
  await reopen(`/collection/${encodeURIComponent(reward.legendary.characterId)}`);
  await page.getByRole("heading", { name: "Luciolune", exact: true }).waitFor();
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await geometry("creature-detail-art");
    await snap(`detail-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/collection`);
  const card = page.locator(`[data-collection-card="${reward.legendary.characterId}"]`);
  await card.getByRole("link", { name: /Luciolune/ }).waitFor();
  assert.equal(await card.locator("img").getAttribute("src"), encounterSrc);
  assert.equal(await page.locator('[data-owned="true"]').count(), 1);
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await snap(`album-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press("Tab");
  const focused = card.getByRole("link", { name: /Luciolune/ });
  await focused.focus();
  await focused.scrollIntoViewIfNeeded();
  const focusStyle = await focused.evaluate((el) => ({
    color: getComputedStyle(el).outlineColor,
    style: getComputedStyle(el).outlineStyle,
    width: getComputedStyle(el).outlineWidth,
  }));
  assert.deepEqual(focusStyle, { color: "rgb(239, 210, 142)", style: "solid", width: "3px" });
  const focusBox = await focused.boundingBox();
  const shot = await page.screenshot();
  const pixel = await sharp(shot)
    .extract({
      left: Math.floor(focusBox.x - 10),
      top: Math.floor(focusBox.y + focusBox.height / 2),
      width: 1,
      height: 1,
    })
    .removeAlpha()
    .raw()
    .toBuffer();
  const luminance = (rgb) =>
    rgb
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
  const l1 = luminance([239, 210, 142]),
    l2 = luminance([...pixel]);
  const focusContrast = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  assert(focusContrast >= 3);
  await snap("06-album-keyboard-focus");
  await page.goto(`${origin}/carte`);
  await page.getByRole("link", { name: "Continuer l’aventure", exact: true }).click();
  await phase("arrival");
  await ready();
  assert.equal(checkpoint().worldIndex, 1);
  await snap("05-next-world");
  assert.deepEqual(errors, []);
  const report = {
    levels,
    reward,
    collectionCount: owned().count,
    nickname: owned().nickname,
    matchingArt: encounterSrc,
    focusContrast,
    nextWorld: checkpoint().worldIndex,
    errors,
  };
  await writeFile(`${dir}/verification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  db.close();
}
