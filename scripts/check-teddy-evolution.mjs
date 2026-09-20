/** Recorded continuation after the first growth; --inspect-catalogue checks final delivery without spending. */
import { chromium } from "@playwright/test";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";

const origin = "http://127.0.0.1:3217";
const dir = "docs/playthroughs/teddy-evolution";
await mkdir(dir, { recursive: true });
const db = new Database("data/teddy-evolution-check.sqlite", { readonly: true });
const profileId = db.prepare("SELECT id FROM profiles WHERE name = ?").get("Nova").id;
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
    const img = page.locator('[data-asset="evolution-next"]');
    await img.evaluate((el) => el.decode());
    const box = await img.boundingBox();
    assert(
      box.width >= (page.viewportSize().width < 600 ? 145 : 280),
      "creature dominates the encounter",
    );
    assert(box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1);
    geometry.push({ name, box });
  }
  await snap(name);
}
const characterId = "creature:0:0";
const detailPath = `/collection/${encodeURIComponent(characterId)}`;
const growthPath = `${detailPath}/grandir`;
const spendCount = () =>
  db
    .prepare("SELECT count(*) n FROM ledger WHERE profile_id=? AND reason='evolution'")
    .get(profileId).n;
const owned = () =>
  db
    .prepare("SELECT * FROM collection WHERE profile_id=? AND character_id=?")
    .get(profileId, characterId);
const name = () => owned().nickname ?? "Bulle";
const initial = { ...balance(), eggs: eggSpends(), owned: owned() };
async function loseNextResponse(target = page) {
  let handled = false;
  await target.route(`**${growthPath}`, async (route) => {
    if (route.request().method() !== "POST" || handled) return route.continue();
    handled = true;
    await route.fetch();
    await route.abort("failed");
  });
}
const waitReady = async (price) => {
  const button = page.getByRole("button", { name: `Faire grandir · ${price} éclats`, exact: true });
  await button.waitFor();
  await page.waitForFunction(
    (p) =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === `Faire grandir · ${p} éclats` && !b.disabled,
      ),
    price,
  );
  return button;
};
let concurrent;
try {
  await newPage();
  await page.goto(origin);
  await page.getByRole("button", { name: "Jouer avec Nova" }).click();
  for (const digit of "7171")
    await page.getByRole("button", { name: `Chiffre ${digit}`, exact: true }).click();
  await page.waitForURL("**/carte");
  if (process.argv.includes("--inspect-catalogue")) {
    const manifest = JSON.parse(await readFile("assets/creature-stages/reviewed.json", "utf8"));
    const refs = manifest.flatMap((art) => [art.stages[2], art.stages[3]]);
    assert.equal(refs.length, 82);
    for (const art of refs) {
      const response = await context.request.get(`${origin}/generated/${art.ref}`);
      assert.equal(response.status(), 200, art.ref);
      assert.equal(
        createHash("sha256")
          .update(await response.body())
          .digest("hex"),
        art.sha256,
      );
    }
    const decoded = await page.evaluate(async (refs) => {
      for (const { ref } of refs) {
        const img = new Image();
        img.src = `/generated/${ref}`;
        await img.decode();
        if (img.naturalWidth !== 768 || img.naturalHeight !== 768) throw new Error(ref);
      }
      return refs.length;
    }, refs);
    const legendary = db
      .prepare(
        "SELECT c.character_id FROM collection c JOIN characters a ON a.id=c.character_id WHERE c.profile_id=? AND a.rarity='legendary' AND c.stage=1 LIMIT 1",
      )
      .get(profileId);
    assert(legendary);
    await page.goto(`${origin}/collection/${encodeURIComponent(legendary.character_id)}/grandir`);
    await page.locator('[data-asset="evolution-next"]').evaluate((im) => im.decode());
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await checkLayout(`legendary-preview-${width}`, true);
    }
    const keyboard = page.locator(".companion-nav a").first();
    await keyboard.focus();
    assert(await keyboard.evaluate((el) => el === document.activeElement));
    await snap("keyboard-focus");
    assert.deepEqual(balance(), { coins: initial.coins, shards: initial.shards });
    assert.deepEqual(owned(), initial.owned);
    assert.deepEqual(errors, []);
    const report = {
      servedAndDecoded: decoded,
      hashesMatch: true,
      legendaryPreview: legendary.character_id,
      geometry,
      pageErrors: errors,
    };
    await writeFile(`${dir}/catalogue-delivery.json`, JSON.stringify(report, null, 2) + "\n");
    console.log("CATALOGUE VERIFIED", JSON.stringify(report));
  } else {
    // Continue the first real playthrough: its baby-to-teen spend already committed once.
    assert.equal(owned().stage, 2);
    assert.equal(spendCount(), 1);
    const pendingTeen = db
      .prepare(
        "SELECT acknowledged FROM evolution_receipts WHERE profile_id=? AND from_stage=1 AND character_id=?",
      )
      .get(profileId, characterId);
    await page.goto(origin + growthPath);
    if (!pendingTeen.acknowledged) {
      await page.locator('[data-evolution-phase="grown"]').waitFor();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent.startsWith("Retrouver ") && !b.disabled,
        ),
      );
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await checkLayout(`teen-${width}`, true);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await loseNextResponse();
      await page.getByRole("button", { name: `Retrouver ${name()}`, exact: true }).click();
      await page.getByText("La connexion s’est interrompue.", { exact: false }).waitFor();
      await reopen(growthPath);
      await page.waitForURL(`**${detailPath}`);
    } else {
      await page.goto(origin + detailPath);
    }
    const teenArt = await page.locator('[data-asset="creature-detail-art"]').getAttribute("src");
    await snap("02-teen-detail");
    await page.getByRole("link", { name: "Faire grandir mon compagnon", exact: true }).click();
    await waitReady(100);
    const adultArt = await page.locator('[data-asset="evolution-next"]').getAttribute("src");
    assert.notEqual(adultArt, teenArt);
    for (const width of [1280, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await checkLayout(`adult-preview-${width}`, true);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    concurrent = await browser.newContext({
      storageState: await context.storageState(),
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    let second = await concurrent.newPage();
    await second.goto(origin + growthPath);
    await second.screenshot({ path: `${dir}/second-before.png`, fullPage: true });
    await second.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Faire grandir · 100 éclats" && !b.disabled,
      ),
    );
    const before = { ...balance(), owned: owned() };
    await loseNextResponse();
    await (
      await waitReady(100)
    ).evaluate((b) => {
      b.click();
      b.click();
    });
    await page.getByText("La connexion s’est interrompue.", { exact: false }).waitFor();
    assert.equal(spendCount(), 2);
    assert.equal(owned().stage, 3);
    assert.equal(balance().shards, before.shards - 100);
    await loseNextResponse(second);
    await second.getByRole("button", { name: "Faire grandir · 100 éclats", exact: true }).click();
    await second.getByText("La connexion s’est interrompue.", { exact: false }).waitFor();
    const secondStorage = await concurrent.storageState();
    await concurrent.close();
    await reopen(growthPath);
    await page.locator('[data-evolution-phase="grown"]').waitFor();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await checkLayout(`adult-${width}`, true);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent.startsWith("Retrouver ") && !b.disabled,
      ),
    );
    await loseNextResponse();
    await page.getByRole("button", { name: `Retrouver ${name()}`, exact: true }).click();
    await page.getByText("La connexion s’est interrompue.", { exact: false }).waitFor();
    await reopen(growthPath);
    await page.waitForURL(`**${detailPath}`);
    assert.equal(
      await page.locator('[data-asset="creature-detail-art"]').getAttribute("src"),
      adultArt,
    );
    assert.equal(
      await page.getByRole("link", { name: "Faire grandir mon compagnon", exact: true }).count(),
      0,
    );
    await snap("03-adult-detail");
    concurrent = await browser.newContext({ storageState: secondStorage, reducedMotion: "reduce" });
    second = await concurrent.newPage();
    await second.goto(origin + growthPath);
    await second.locator('[data-evolution-phase="grown"]').waitFor();
    assert.equal(spendCount(), 2);
    assert.equal(owned().stage, 3);
    await concurrent.close();
    await page.goto(`${origin}/collection`);
    const card = page.locator(`[data-collection-card="${characterId}"]`);
    await card.waitFor();
    assert.equal(await card.locator("img").getAttribute("src"), adultArt);
    await snap("04-adult-album");
    assert.deepEqual(owned(), { ...before.owned, stage: 3 });
    assert.deepEqual(balance(), { coins: before.coins, shards: before.shards - 100 });
    assert.deepEqual(errors, []);
    const baseline = new Database("data/teddy-shards-check.sqlite", { readonly: true });
    const baselineCounts = {
      attempts: baseline
        .prepare("select count(*) n from attempts where profile_id=?")
        .get(profileId).n,
      levels: baseline.prepare("select count(*) n from progress where profile_id=?").get(profileId)
        .n,
      eggs: baseline
        .prepare(
          "select count(*) n from ledger where profile_id=? and reason='egg' and currency='coins'",
        )
        .get(profileId).n,
    };
    const report = {
      resumedAfterFirstGrowth: initial,
      beforeAdultEvolution: before,
      after: { ...balance(), owned: owned() },
      totalNewAttempts:
        db.prepare("select count(*) n from attempts where profile_id=?").get(profileId).n -
        baselineCounts.attempts,
      totalNewLevels:
        db.prepare("select count(*) n from progress where profile_id=?").get(profileId).n -
        baselineCounts.levels,
      additionalEggs: eggSpends() - baselineCounts.eggs,
      evolutionLedger: db
        .prepare(
          "select amount,reason,currency,ref_id from ledger where profile_id=? and reason='evolution'",
        )
        .all(profileId),
      teenArt,
      adultArt,
      geometry,
      pageErrors: errors,
    };
    baseline.close();
    await writeFile(`${dir}/verification.json`, JSON.stringify(report, null, 2));
    console.log("VERIFIED", JSON.stringify(report));
  }
} catch (error) {
  await snap("failure").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  db.close();
}
