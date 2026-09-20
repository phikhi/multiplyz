/** Browser/pixel capture pass on the standalone real-component workbench. No DB or game writes. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
const dir = "docs/playthroughs/teddy-worlds";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
});
const errors = [],
  captures = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(pathToFileURL(path.resolve(dir, "preview.html")).href);
  const ready = async () => page.waitForSelector(".tp-scene[data-frames]");
  const layout = async (name) => {
    await ready();
    await page.evaluate(() => document.fonts.ready);
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      name + ": overflow",
    );
    for (const el of await page.locator(".world-preview-controls :is(button,select)").all()) {
      const r = await el.boundingBox();
      assert(r.height >= 44, name + ": small control");
    }
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    captures.push(name);
  };
  for (const slug of ["forest", "ocean", "magic", "galaxy", "candy", "snow", "forest:4"]) {
    await page.getByLabel("Décor", { exact: true }).selectOption(slug);
    await ready();
    assert.equal(
      await page.locator(".tp-scene").getAttribute("data-biome"),
      slug === "forest:4" ? "grove" : slug,
    );
    for (const completed of ["0", "5", "10"]) {
      await page.getByLabel("Avancée", { exact: true }).selectOption(completed);
      await page.waitForFunction(
        (value) => document.querySelector(".tp-scene").dataset.travel === value,
        (Number(completed) / 10).toFixed(3),
      );
      await layout(`${slug}-${completed}-1280`);
    }
    await page.getByLabel("Vue", { exact: true }).selectOption("map");
    await layout(`${slug}-map-1280`);
    await page.getByLabel("Vue", { exact: true }).selectOption("adventure");
  }
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const slug of ["ocean", "magic", "galaxy", "candy", "snow"]) {
      await page.getByLabel("Décor", { exact: true }).selectOption(slug);
      await page.getByLabel("Avancée", { exact: true }).selectOption("0");
      await layout(`${slug}-0-${width}`);
      await page.getByLabel("Vue", { exact: true }).selectOption("map");
      await layout(`${slug}-map-${width}`);
      await page.getByLabel("Vue", { exact: true }).selectOption("adventure");
    }
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByLabel("Avancée", { exact: true }).selectOption("5");
  await page.getByRole("button", { name: "Figer le décor", exact: true }).click();
  const frozen = await page.locator(".tp-scene").getAttribute("data-frames");
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".tp-scene").getAttribute("data-frames"), frozen);
  await page.getByRole("button", { name: "Animer le décor", exact: true }).click();
  await page.waitForFunction(
    (frames) => document.querySelector(".tp-scene").dataset.frames !== frames,
    frozen,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${dir}/browser-check.json`,
    JSON.stringify(
      {
        captures,
        errors,
        geometryChecked: true,
        pauseChecked: true,
        manualPixelInspectionStillRequired: true,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
