/** Continue a copy of the played daily check. No SQL writes, no seed, no family URL. */
import { chromium } from "@playwright/test";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const origin = "http://127.0.0.1:3218",
  dir = "docs/playthroughs/teddy-parent";
await mkdir(dir, { recursive: true });
const db = new Database("data/teddy-parent-check.sqlite", { readonly: true, fileMustExist: true });
const protectedTables = [
  "adventure_sessions",
  "attempts",
  "mastery",
  "progress",
  "ledger",
  "wallet",
  "collection",
];
const snapshot = () =>
  Object.fromEntries(
    protectedTables.map((t) => [t, db.prepare(`select * from ${t} order by rowid`).all()]),
  );
let report;
try {
  report = JSON.parse(await readFile(`${dir}/browser-progress.json`, "utf8"));
} catch {
  report = { before: snapshot(), done: [], geometry: [], errors: [] };
}
const save = () => writeFile(`${dir}/browser-progress.json`, JSON.stringify(report, null, 2));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (e) => report.errors.push(e.message));
const ownerId = db.prepare("select id from profiles where name_key='nova'").get().id;
async function login() {
  await page.goto(origin);
  await page.getByRole("button", { name: "Espace parent", exact: true }).click();
  await page.keyboard.type("8181");
  await page.waitForURL("**/parent");
}
async function capture(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}
async function layout(name) {
  await page.evaluate(() => document.fonts.ready);
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `${name}: horizontal overflow`,
  );
  const controls = [];
  for (const item of await page
    .locator(
      ".parent-shell button:visible,.parent-shell a:visible,.parent-shell select:visible,.parent-recovery button:visible,.parent-recovery a:visible",
    )
    .all()) {
    if ((await item.getAttribute("class"))?.includes("parent-skip")) continue;
    const box = await item.boundingBox();
    assert(box.height >= 43.9, `${name}: short target ${await item.textContent()} ${box.height}`);
    controls.push({ text: (await item.textContent()).trim(), box });
  }
  report.geometry.push({ name, width: page.viewportSize().width, controls });
  await capture(name);
}
async function phase(name, fn) {
  if (report.done.includes(name)) return;
  await fn();
  report.done.push(name);
  await save();
}
try {
  report.completed = false;
  await login();
  if (process.argv.includes("--final") || process.argv.includes("--motion-only")) {
    if (!process.argv.includes("--motion-only")) {
      const contrast = async (name) => {
        const failures = await page.evaluate(() => {
          const rgb = (v) => {
            const values = v.match(/[\d.]+/g)?.map(Number);
            return values && values.length >= 3 ? values : [0, 0, 0, 0];
          };
          const luminance = (c) =>
            c
              .slice(0, 3)
              .map((x) => {
                x /= 255;
                return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
              })
              .reduce((n, x, i) => n + x * [0.2126, 0.7152, 0.0722][i], 0);
          const issues = [];
          for (const element of document.querySelectorAll(".parent-shell *, .parent-recovery *")) {
            if (
              ![...element.childNodes].some(
                (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
              ) ||
              element.tagName === "OPTION"
            )
              continue;
            const rect = element.getBoundingClientRect(),
              style = getComputedStyle(element);
            if (
              rect.height === 0 ||
              rect.width === 0 ||
              rect.bottom < 0 ||
              style.visibility === "hidden"
            )
              continue;
            let background = [255, 255, 255],
              parent = element;
            while (parent) {
              const color = rgb(getComputedStyle(parent).backgroundColor);
              if (color[3] !== 0) {
                background = color;
                break;
              }
              parent = parent.parentElement;
            }
            const foreground = rgb(style.color),
              a = luminance(foreground),
              b = luminance(background),
              ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            if (ratio < 4.49)
              issues.push({
                text: element.textContent.trim().slice(0, 80),
                ratio,
                foreground,
                background,
              });
          }
          return issues;
        });
        report.contrast ??= [];
        report.contrast.push({ name, failures });
        assert.deepEqual(failures, [], name + " text contrast");
      };
      for (const [name, path] of [
        ["dashboard", "/parent"],
        ["settings", "/parent/reglages"],
        ["profiles", "/parent/profils"],
        ["mondes", "/parent/mondes"],
        ["acces", "/parent/acces"],
        ["recovery", "/parent/recuperation"],
      ]) {
        await page.goto(origin + path);
        for (const width of [1280, 640, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await layout(`final-${name}-${width}`);
        }
        await contrast(name);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(origin + "/parent/reglages");
      await page.getByRole("button", { name: "Sombre", exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      for (const [name, path] of [
        ["dashboard", "/parent"],
        ["settings", "/parent/reglages"],
        ["recovery", "/parent/recuperation"],
      ]) {
        await page.goto(origin + path);
        await layout(`final-${name}-dark`);
        await contrast(name + " dark");
      }
      await page.goto(origin + "/parent/reglages");
      await page.getByRole("button", { name: "Clair", exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      const childContext = await browser.newContext({
          viewport: { width: 390, height: 844 },
          reducedMotion: "reduce",
        }),
        childPage = await childContext.newPage();
      await childPage.goto(origin);
      await childPage.getByRole("button", { name: "Jouer avec Nova", exact: true }).click();
      await childPage.keyboard.type("7171");
      await childPage.waitForURL(/\/(repos|carte|jouer)$/);
      await childPage.goto(origin + "/reprendre");
      await childPage.waitForURL("**/repos");
      await childPage.goto(origin + "/parent");
      await childPage.waitForURL("**/parent/connexion");
      await childPage.getByText(/Cet espace est réservé aux parents/).waitFor();
      await childPage.screenshot({ path: `${dir}/final-parent-required.png`, fullPage: true });
      await childContext.close();
      await page.goto(origin + "/parent/profils");
      const region = page.getByRole("region", { name: "Profil de Comète", exact: true });
      await region.getByRole("button", { name: "Réinitialiser le code", exact: true }).click();
      await page.setViewportSize({ width: 320, height: 900 });
      await layout("final-reset-code-320");
      await contrast("code pad");
      await page.goto(origin + "/parent/reglages");
      const limitSwitch = page.getByRole("switch", { name: "Limite quotidienne", exact: true });
      await limitSwitch.click();
      await page.getByRole("status").filter({ hasText: "Réglage enregistré." }).waitFor();
      const timeValues = await page.locator("select").evaluateAll((selects) =>
        selects
          .flatMap((select) =>
            [...select.options].map((option) => ({
              label: option.textContent,
              value: option.value,
            })),
          )
          .filter((option) => option.label.includes("minutes"))
          .map((option) => Number(option.value)),
      );
      assert(timeValues.every((value) => value <= 75));
      await limitSwitch.click();
      await page.getByRole("status").filter({ hasText: "Réglage enregistré." }).waitFor();
    }
    const motionContext = await browser.newContext({ reducedMotion: "no-preference" });
    const motionPage = await motionContext.newPage();
    await motionPage.goto(origin + "/parent/connexion");
    for (const digit of "8181")
      await motionPage
        .locator(".pin-grid button")
        .filter({ hasText: new RegExp(`^${digit}$`) })
        .click();
    await motionPage.waitForURL("**/parent");
    await motionPage.goto(origin + "/parent/reglages");
    const motionSwitch = motionPage.getByRole("switch", { name: "Mouvements réduits" });
    await motionSwitch.click();
    assert.equal(await motionSwitch.getAttribute("aria-checked"), "true");
    assert.equal(await motionPage.evaluate(() => localStorage.getItem("teddy:reduced")), "true");
    await motionPage.reload();
    await motionPage.waitForFunction(
      () =>
        document.querySelector('button[role="switch"]')?.getAttribute("aria-checked") === "true",
    );
    await motionContext.close();
    report.done = [...new Set([...report.done, "final-visual", "manual-reduced-motion"])];
  } else {
    await phase("dashboard", async () => {
      for (const width of [1280, 1024, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await layout(`dashboard-${width}`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByLabel("Période des réponses").selectOption("all");
      await page.getByRole("button", { name: "Afficher", exact: true }).click();
      await page.waitForURL(/period=all/);
      assert((await page.locator("main").innerText()).includes("2 sur 2 premières réponses"));
    });
    await phase("settings", async () => {
      await page.goto(origin + "/parent/reglages");
      const nudge = page.getByLabel("Pause suggérée après");
      const initial = await nudge.inputValue();
      let blocked = false;
      await page.route("**/parent/reglages", (route) => {
        if (route.request().method() === "POST" && !blocked) {
          blocked = true;
          return route.abort("failed");
        }
        return route.continue();
      });
      await nudge.selectOption(initial === "15" ? "20" : "15");
      await page.getByText(/Enregistrement non confirmé/).waitFor();
      assert.equal(await nudge.inputValue(), initial);
      await page.unroute("**/parent/reglages");
      await nudge.selectOption(initial === "15" ? "20" : "15");
      await page.getByRole("status").filter({ hasText: "Réglage enregistré." }).waitFor();
      assert.equal(
        db.prepare("select screen_time_nudge_minutes n from household_settings").get().n,
        initial === "15" ? 20 : 15,
      );
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await layout(`settings-${width}`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole("button", { name: "Sombre", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Réglage enregistré." }).waitFor();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await page.goto(origin + "/parent");
      await layout("dashboard-dark");
      await page.goto(origin + "/parent/reglages");
      await page.getByRole("button", { name: "Clair", exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    });
    await phase("create", async () => {
      await page.goto(origin + "/parent/profils");
      if (!db.prepare("select id from profiles where name_key in ('astro','comète')").get()) {
        await page.getByRole("button", { name: "Ajouter un profil", exact: true }).click();
        await page.getByLabel("Prénom", { exact: true }).fill("Astro");
        await page.getByRole("button", { name: "Continuer", exact: true }).click();
        await page.keyboard.type("4242");
        await page.getByRole("button", { name: "Continuer", exact: true }).click();
        await page.keyboard.type("4141");
        await page.getByRole("button", { name: "Ajouter un profil", exact: true }).click();
        await page.getByText("Les deux codes doivent être identiques.").waitFor();
        assert(!db.prepare("select id from profiles where name_key='astro'").get());
        for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
        await page.keyboard.type("4242");
        await page.getByRole("button", { name: "Ajouter un profil", exact: true }).click();
        await page.getByText(/Profil créé/).waitFor();
      }
    });
    await phase("rename-pin", async () => {
      await page.goto(origin + "/parent/profils");
      let profile = page.getByRole("region", { name: "Profil de Astro", exact: true });
      if (db.prepare("select id from profiles where name_key='astro'").get()) {
        await profile.getByRole("button", { name: "Renommer", exact: true }).click();
        await profile.getByRole("textbox").fill("Comète");
        await profile.getByRole("button", { name: "Enregistrer", exact: true }).click();
      }
      profile = page.getByRole("region", { name: "Profil de Comète", exact: true });
      await profile.waitFor();
      await profile.getByRole("button", { name: "Réinitialiser le code", exact: true }).click();
      await page.keyboard.type("4343");
      await profile.getByRole("button", { name: "Continuer", exact: true }).click();
      await page.keyboard.type("4343");
      await profile.getByRole("button", { name: "Enregistrer ce code", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Code enfant réinitialisé." }).waitFor();
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await layout(`profiles-${width}`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await phase("empty-profile", async () => {
      const child = db.prepare("select id from profiles where name_key='comète'").get().id;
      await page.goto(origin + `/parent?profile=${child}`);
      await page.getByRole("heading", { name: "Le voyage de Comète" }).waitFor();
      await page.getByText(/Le voyage commence/).waitFor();
      await layout("dashboard-empty");
    });
    await phase("recalibration", async () => {
      await page.goto(origin + `/parent/reglages?profile=${ownerId}`);
      await page.getByRole("button", { name: "Recalibrer", exact: true }).click();
      await page.getByRole("button", { name: "Annuler", exact: true }).click();
      assert.equal(
        db.prepare("select recalibration_requested r from profiles where id=?").get(ownerId).r,
        0,
      );
      await page.getByRole("button", { name: "Recalibrer", exact: true }).click();
      await capture("recalibrate-confirm");
      await page.getByRole("button", { name: "Oui, recalibrer", exact: true }).click();
      await page.getByText(/Recalibrage demandé/).waitFor();
      assert.equal(
        db.prepare("select recalibration_requested r from profiles where id=?").get(ownerId).r,
        1,
      );
      assert.deepEqual(snapshot(), report.before);
    });
    await phase("worlds-access", async () => {
      for (const path of ["mondes", "acces"]) {
        await page.goto(origin + `/parent/${path}`);
        for (const width of [1280, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await layout(`${path}-${width}`);
        }
      }
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(origin + "/parent/recuperation");
      await layout("recovery-320");
      await page.setViewportSize({ width: 1280, height: 900 });
      await layout("recovery-1280");
    });
    await phase("child-guard", async () => {
      const childContext = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        reducedMotion: "reduce",
      });
      const childPage = await childContext.newPage();
      await childPage.goto(origin);
      await childPage.getByRole("button", { name: "Jouer avec Nova", exact: true }).click();
      await childPage.keyboard.type("7171");
      await childPage.waitForURL(/\/(repos|carte|jouer)$/);
      await childPage.goto(origin + "/reprendre");
      await childPage.waitForURL("**/repos");
      await childPage.screenshot({
        path: `dir`.replace("dir", dir) + "/child-still-paused.png",
        fullPage: true,
      });
      await childPage.goto(origin + "/parent");
      await childPage.waitForURL(origin + "/");
      assert.deepEqual(snapshot(), report.before);
      await childContext.close();
    });
    await phase("delete-cancel", async () => {
      await page.goto(origin + "/parent/profils");
      const region = page.getByRole("region", { name: "Profil de Comète", exact: true });
      await region.getByRole("button", { name: "Supprimer", exact: true }).click();
      await capture("delete-confirm");
      await region.getByRole("button", { name: "Annuler", exact: true }).click();
      assert(db.prepare("select id from profiles where name_key='comète'").get());
    });
  }
  report.after = snapshot();
  assert.deepEqual(report.after, report.before);
  assert.deepEqual(report.errors, []);
  report.completed = true;
  await save();
  console.log(
    JSON.stringify({
      completed: true,
      phases: report.done,
      protectedTables: protectedTables.length,
      captures: report.geometry.length,
    }),
  );
} catch (error) {
  await save();
  console.error(error.message);
  console.error((await page.locator("main").innerText()).slice(0, 4500));
  throw error;
} finally {
  await context.close();
  await browser.close();
  db.close();
}
