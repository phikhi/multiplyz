import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CastDraft } from "./creature-cast-preview";
import { testCreatureDesign } from "./creature-design.test-helper";
import { loadCastRedesign } from "./pilot-cast-redesign";

let directory: string, approved: CastDraft;
const run = "00000000-0000-0000-0000-000000000000";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const save = (p: string, value: unknown) => writeFileSync(p, JSON.stringify(value));
beforeEach(() => {
  directory = mkdtempSync(join(realpathSync(tmpdir()), "teddy-redesign-"));
  mkdirSync(join(directory, "cast-growths"));
  mkdirSync(join(directory, "storage/generated/world/6"), { recursive: true });
  const plan = testCreatureDesign();
  approved = { plan, artRefs: plan.creatures.map((_, i) => `world/6/baby-${i}.png`) };
  const stageArt = plan.creatures.map((_, i) => ({
    2: `world/6/ado-${i}.png`,
    3: `world/6/adult-${i}.png`,
  }));
  const refs = approved.artRefs.flatMap((ref, i) => [ref, stageArt[i][2], stageArt[i][3]]);
  refs.forEach((ref) => writeFileSync(join(directory, "storage/generated", ref), ref));
  const draftFile = `${run}-draft-12.json`;
  const draftPath = join(directory, "cast-growths", draftFile);
  const resultPath = join(directory, "cast-growths", `${run}-result.json`);
  save(draftPath, { ...approved, stageArt });
  save(resultPath, {
    outcome: "rejected",
    checks: refs.map((ref, i) => ({
      ref,
      slot: Math.floor(i / 3),
      stage: (i % 3) + 1,
      inspection: {
        detectedText: "",
        unsafeScore: 0,
        habitatMatches: true,
        visuallyDistinct: true,
        identityMatches: true,
        growthVisible: i !== 1,
      },
      verdict: { ok: i !== 1 },
    })),
  });
  save(join(directory, "cast-growth-redesign-plan.json"), {
    version: 1,
    sourceRun: run,
    draftFile,
    draftSha256: sha(readFileSync(draftPath)),
    resultSha256: sha(readFileSync(resultPath)),
    sourceArts: refs.map((ref) => ({
      ref,
      sha256: sha(readFileSync(join(directory, "storage/generated", ref))),
    })),
    corrections: Array.from({ length: 12 }, (_, i) => ({
      slot: Math.floor(i / 2),
      stage: 2 + (i % 2),
      instruction: `Redraw species ${Math.floor(i / 2)} at age ${2 + (i % 2)} with a genuinely developed body and face proportions.`,
    })),
  });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
it("honours the user's rejection of all ages, including automated passes", () => {
  const resultPath = join(directory, "cast-growths", `${run}-result.json`);
  const before = readFileSync(resultPath);
  const revision = loadCastRedesign(directory, approved);
  expect(revision.instructions).toHaveLength(12);
  expect(revision.excludedArts).toHaveLength(18);
  expect(revision.stageInstructions(5, 3)).toContain("species 5 at age 3");
  expect(readFileSync(resultPath)).toEqual(before);
});
it("refuses a modified source image before any paid work", () => {
  writeFileSync(join(directory, "storage/generated/world/6/ado-0.png"), "changed");
  expect(() => loadCastRedesign(directory, approved)).toThrow(/Source modifiée/);
});
it("refuses a recipe omitting an adolescent formerly accepted by QA", () => {
  const path = join(directory, "cast-growth-redesign-plan.json");
  const recipe = JSON.parse(readFileSync(path, "utf8"));
  recipe.corrections.splice(2, 1);
  save(path, recipe);
  expect(() => loadCastRedesign(directory, approved)).toThrow(/douze/);
});
it("does not mix another approved baby group into this correction", () => {
  expect(() =>
    loadCastRedesign(directory, { ...approved, artRefs: [...approved.artRefs].reverse() }),
  ).toThrow(/identités/);
});
