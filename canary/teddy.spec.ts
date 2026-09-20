import { test, expect } from "@playwright/test";
import { forest } from "../src/strings/forest";
import { strings } from "../src/strings";
import { CANARI_PROFILE_NAME, CANARI_PROFILE_PIN } from "../e2e/seed-canari";

test("connexion → carte → passage repris → souvenir → carte → collection", async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await request.get("/api/health")).status()).toBe(200);
  await page.goto("/");
  await page.getByRole("button", { name: strings.login.profileOption.replace("{prénom}", CANARI_PROFILE_NAME) }).click();
  for (const digit of CANARI_PROFILE_PIN)
    await page.getByRole("button", { name: strings.pinPad.digit.replace("{d}", digit), exact: true }).click();
  await expect(page).toHaveURL(/\/carte$/);
  await expect(page.locator('[aria-current="step"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("carte.png"), fullPage: true });
  await page.locator('[aria-current="step"]').click();
  await expect(page).toHaveURL(/\/jouer$/);
  await page.getByRole("button", { name: forest.begin }).click();
  await expect(page.locator('[data-phase="question"]')).toBeVisible();
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: forest.resumePlay }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  let answered = 0;
  for (let step = 0; step < 40; step++) {
    const main = page.locator("main.forest-adventure");
    await expect(main).toHaveAttribute("data-phase", /^(question|feedback|finale)$/);
    const phase = await main.getAttribute("data-phase");
    if (phase === "finale") break;
    if (phase === "feedback") {
      await page.getByRole("button", { name: forest.next }).click();
      await expect(main).not.toHaveAttribute("data-phase", "feedback");
      continue;
    }
    const text = await page.locator(".forest-equation").innerText();
    const operands = text.match(/\d+/g)!.map(Number);
    const answer = text.includes("+ ?") ? 10 - operands[0] : text.includes("×") ? operands[0] * operands[1] : text.includes("−") ? operands[0] - operands[1] : operands[0] + operands[1];
    const input = page.getByRole("textbox", { name: forest.answerLabel });
    if (await input.isVisible()) { await input.fill(String(answer)); await page.getByRole("button", { name: forest.submit }).click(); }
    else await page.getByRole("group", { name: forest.answerLabel }).getByRole("button", { name: String(answer), exact: true }).click();
    answered++;
    await expect(main).toHaveAttribute("data-phase", "feedback");
  }
  expect(answered).toBeGreaterThan(0);
  await expect(page.locator("main.forest-adventure")).toHaveAttribute("data-phase", "finale");
  await page.getByRole("button", { name: forest.results }).click();
  await expect(page.getByRole("heading", { name: forest.resultTitle })).toBeVisible();
  await expect(page.getByText(forest.saved)).toBeVisible();
  const rewards = await page.locator(".forest-rewards").innerText();
  expect(rewards).toMatch(/\+\d+/);
  await page.reload();
  await expect(page.getByRole("heading", { name: forest.resultTitle })).toBeVisible();
  await expect(page.locator(".forest-rewards")).toHaveText(rewards);
  await page.screenshot({ path: testInfo.outputPath("souvenir.png"), fullPage: true });
  await page.getByRole("button", { name: forest.returnMap }).click();
  await expect(page).toHaveURL(/\/carte$/);
  await expect(page.locator('[aria-current="step"]')).toHaveAttribute("aria-label", /Étape 2/);
  await page.goto("/collection");
  await expect(page.locator("main")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("collection.png"), fullPage: true });
  expect(errors).toEqual([]);
});
