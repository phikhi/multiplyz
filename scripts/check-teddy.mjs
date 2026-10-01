import { chromium } from "@playwright/test";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const origin = "http://127.0.0.1:3217";
const dir = "test-results/teddy";
await mkdir(dir, { recursive: true });
const db = new Database("data/teddy-check.sqlite", { readonly: true });
const profileId = db.prepare("SELECT id FROM profiles WHERE name = ?").get("Nova").id;
const checkpoint = () =>
  JSON.parse(
    db.prepare("SELECT state FROM adventure_sessions WHERE profile_id = ?").get(profileId).state,
  );
const count = (table) =>
  db.prepare(`SELECT count(*) AS n FROM ${table} WHERE profile_id = ?`).get(profileId).n;
const browser = await chromium.launch({ headless: true });
let context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
});
let page = await context.newPage();
page.setDefaultTimeout(25000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const snap = (name) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
const phase = (name) => page.locator(`.forest-adventure[data-phase="${name}"]`).waitFor();
const ready = () => page.locator('.forest-panel[aria-busy="false"]').waitFor();
const answerOf = (q) =>
  q.skill === "comp10"
    ? 10 - q.operands[0]
    : q.skill === "add"
      ? q.operands[0] + q.operands[1]
      : q.skill === "sub"
        ? q.operands[0] - q.operands[1]
        : q.operands[0] * q.operands[1];
async function answer(correct = true) {
  await phase("question");
  await ready();
  const q = checkpoint().game.current.question;
  if (!correct) {
    await page.getByRole("button", { name: "Un coup de patte", exact: true }).click();
    return;
  }
  const value = answerOf(q);
  if (q.format === "qcm") await page.keyboard.press(String(q.choices.indexOf(value) + 1));
  else {
    await page.getByRole("textbox", { name: "Ta réponse" }).fill(String(value));
    await page.keyboard.press("Enter");
  }
}
async function loseReply(click) {
  let lost = false;
  await page.route("**/jouer", async (route) => {
    if (!lost && route.request().method() === "POST") {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await click();
  await page.getByText("Ta réponse est gardée.", { exact: false }).waitFor();
  assert(lost);
}
try {
  await page.goto(origin);
  await page.getByRole("button", { name: "Jouer avec Nova" }).click();
  for (const digit of "7171")
    await page.getByRole("button", { name: `Chiffre ${digit}`, exact: true }).click();
  await page.waitForURL("**/carte");
  await page.locator(".forest-map .tp-scene[data-frames]").waitFor();
  assert.equal(await page.locator(".forest-map-nodes li").count(), 11);
  const nodes = await page.locator(".forest-node").evaluateAll((elements) =>
    elements.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, r: r.right, b: r.bottom };
    }),
  );
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      assert(
        nodes[i].r <= nodes[j].x ||
          nodes[j].r <= nodes[i].x ||
          nodes[i].b <= nodes[j].y ||
          nodes[j].b <= nodes[i].y,
        "map nodes overlap",
      );
  await snap("01-map");
  await page
    .getByRole("link", {
      name: /Continuer l’aventure|Reprendre mon passage|Retrouver mon souvenir/,
    })
    .click();
  await phase("arrival");
  await page.locator(".tp-scene[data-frames]").waitFor();
  await snap("02-arrival");
  await page.getByRole("button", { name: "Allons-y" }).click();
  await phase("question");
  await ready();
  assert.equal(checkpoint().game.questions.length, 10);
  const runId = checkpoint().id;
  const beforeAttempts = count("attempts");
  const beforeLedger = count("ledger");
  const beforeProgress = count("progress");
  const initialCoins =
    db.prepare("SELECT coins FROM wallet WHERE profile_id = ?").get(profileId)?.coins ?? 0;
  await loseReply(() => answer(false));
  assert.equal(checkpoint().phase, "help");
  assert.equal(count("attempts"), beforeAttempts + 1);
  await snap("03-pending");
  const storage = await context.storageState();
  await context.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
    storageState: storage,
  });
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/jouer`);
  await phase("help");
  await ready();
  assert.equal(checkpoint().id, runId);
  assert.equal(count("attempts"), beforeAttempts + 1);
  assert.equal(await page.locator(".forest-help-result").count(), 0);
  await snap("04-help");
  await page.getByRole("button", { name: "Éclairer la suite" }).click();
  await page.getByRole("button", { name: "Voir le résultat" }).click();
  await phase("reveal");
  await page.reload();
  await phase("reveal");
  await page.getByRole("button", { name: "Je réessaie" }).click();
  await answer();
  await phase("feedback");
  assert.equal(checkpoint().game.firstCorrectCount, 0);
  assert.equal(count("attempts"), beforeAttempts + 1);
  await page.getByRole("button", { name: "Continuer le chemin" }).click();
  const formats = new Set();
  let testedDraft = false;
  while (checkpoint().game.currentIndex < 10) {
    await phase("question");
    await ready();
    const q = checkpoint().game.current.question;
    formats.add(q.format);
    if (q.format !== "qcm" && !testedDraft) {
      await page.getByRole("textbox", { name: "Ta réponse" }).fill("12");
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor();
      await snap("05-pause");
      await page.getByRole("button", { name: "Je reprends", exact: true }).click();
      assert.equal(await page.getByRole("textbox", { name: "Ta réponse" }).inputValue(), "12");
      await page.reload();
      await phase("question");
      await ready();
      assert.equal(await page.getByRole("textbox", { name: "Ta réponse" }).inputValue(), "12");
      testedDraft = true;
    }
    if (checkpoint().game.currentIndex === 3) {
      await context.setOffline(true);
      await answer();
      await page.getByText("Ta réponse est gardée.", { exact: false }).waitFor();
      await context.setOffline(false);
      await phase("feedback");
    } else {
      await answer();
      await phase("feedback");
    }
    if (checkpoint().game.currentIndex === 9) break;
    await page.getByRole("button", { name: "Continuer le chemin" }).click();
  }
  await snap("06-trail");
  await loseReply(() => page.getByRole("button", { name: "Continuer le chemin" }).click());
  assert.equal(checkpoint().phase, "finale");
  assert.equal(count("ledger"), beforeLedger + 1);
  assert.equal(count("progress"), beforeProgress + 1);
  await page.unroute("**/jouer");
  await page.reload();
  await phase("finale");
  await ready();
  await page.locator('.tp-scene[data-travel="1.000"]').waitFor();
  await snap("07-encounter");
  await page.getByRole("button", { name: "Notre souvenir", exact: false }).click();
  await phase("results");
  await page.reload();
  await phase("results");
  await ready();
  await snap("08-results");
  const receipt = checkpoint().result;
  assert.equal(receipt.stars, 2);
  assert.equal(receipt.balance.coins, initialCoins + receipt.reward.total);
  assert.equal(count("ledger"), beforeLedger + 1);
  await page.getByRole("button", { name: "Retrouver mon chemin" }).click();
  await page.waitForURL("**/carte");
  assert.equal(
    Number(
      await page.locator('[data-shell-balance="coins"]').getAttribute("data-shell-balance-value"),
    ),
    receipt.balance.coins,
  );
  await snap("09-return-map");
  const layouts = [];
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await page.waitForTimeout(200);
    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert(metrics.scroll <= metrics.width, `overflow at ${width}`);
    await snap(`map-${width}`);
    layouts.push(metrics);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("link", { name: "Continuer l’aventure", exact: false }).click();
  await phase("arrival");
  await page.getByRole("button", { name: "Allons-y" }).click();
  await phase("question");
  await ready();
  const beforeFrames = Number(await page.locator(".tp-scene").getAttribute("data-frames"));
  await page.waitForFunction(
    (f) => Number(document.querySelector(".tp-scene")?.dataset.frames) > f + 2,
    beforeFrames,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor();
  const travel = await page.locator(".tp-scene").getAttribute("data-travel");
  await page.waitForTimeout(350);
  assert.equal(await page.locator(".tp-scene").getAttribute("data-travel"), travel);
  await page.getByRole("button", { name: "Moins de mouvement" }).click();
  await page.getByRole("button", { name: "Je reprends", exact: true }).click();
  await page.waitForTimeout(250);
  const frames = await page.locator(".tp-scene").getAttribute("data-frames");
  await page.waitForTimeout(350);
  assert.equal(await page.locator(".tp-scene").getAttribute("data-frames"), frames);
  for (const width of [1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await page.waitForTimeout(200);
    const bounds = await page.locator(".forest-panel").evaluate((element) => {
      const r = element.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        width: innerWidth,
        height: innerHeight,
        scroll: document.documentElement.scrollWidth,
      };
    });
    assert(
      bounds.scroll <= bounds.width &&
        bounds.left >= 0 &&
        bounds.right <= bounds.width &&
        bounds.bottom <= bounds.height,
      `question controls outside viewport ${width}: ${JSON.stringify(bounds)}`,
    );
    await snap(`question-${width}`);
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  assert(testedDraft);
  const report = {
    passed: true,
    runId,
    formats: [...formats],
    questions: 10,
    firstCorrect: 9,
    stars: receipt.stars,
    earned: receipt.reward.total,
    balance: receipt.balance.coins,
    attempts: count("attempts") - beforeAttempts,
    ledgerRows: count("ledger") - beforeLedger,
    errors,
    layouts,
  };
  await writeFile(`${dir}/verification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await snap("failure").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  db.close();
}
