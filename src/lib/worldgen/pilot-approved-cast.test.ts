import { afterEach, beforeEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { testCreatureDesign } from "./creature-design.test-helper";
import { loadApprovedCast } from "./pilot-approved-cast";
import { pilotCeilingEur } from "./pilot-budget";
import { readPilotReservedUnits } from "./pilot-status";

let directory: string, planPath: string, refs: string[];
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const id = "00000000-0000-0000-0000-000000000000";
beforeEach(async () => {
  directory = mkdtempSync(join(realpathSync(tmpdir()), "teddy-approved-cast-"));
  mkdirSync(join(directory, "cast-previews"));
  mkdirSync(join(directory, "storage/generated/world/6"), { recursive: true });
  const plan = testCreatureDesign();
  refs = plan.creatures.map((_, i) => `world/6/creature-${i}.png`);
  for (const ref of refs)
    writeFileSync(
      join(directory, "storage/generated", ref),
      await sharp({ create: { width: 8, height: 8, channels: 4, background: "green" } })
        .png()
        .toBuffer(),
    );
  planPath = join(directory, "plan.json");
  save(planPath, plan);
  const draftPath = join(directory, "cast-previews", `${id}-draft.json`);
  const resultPath = join(directory, "cast-previews", `${id}-result.json`);
  save(draftPath, { plan, artRefs: refs });
  save(resultPath, {
    outcome: "passed-for-visual-review",
    checks: refs.map((ref, i) => ({
      ref,
      name: plan.creatures[i].name,
      verdict: { ok: true },
      inspection: { habitatMatches: true, visuallyDistinct: true },
    })),
  });
  save(join(directory, "cast-growth-approval.json"), {
    version: 1,
    authorizedByUser: true,
    approvedCastId: id,
    draftSha256: sha(readFileSync(draftPath)),
    resultSha256: sha(readFileSync(resultPath)),
    growthPlanSha256: sha(readFileSync(planPath)),
    babies: refs.map((ref) => ({
      ref,
      sha256: sha(readFileSync(join(directory, "storage/generated", ref))),
    })),
  });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
it("loads the exact approved cast even if an unrelated later preview exists", () => {
  save(join(directory, "cast-previews", "later-result.json"), { outcome: "rejected" });
  expect(loadApprovedCast(directory, planPath).artRefs).toEqual(refs);
});
it.each(["baby", "draft", "result", "plan"])(
  "refuses a changed approved %s before any generation",
  (changed) => {
    const file =
      changed === "baby"
        ? join(directory, "storage/generated", refs[0])
        : changed === "plan"
          ? planPath
          : join(directory, "cast-previews", `${id}-${changed}.json`);
    writeFileSync(file, "changed");
    expect(() => loadApprovedCast(directory, planPath)).toThrow(/modifié|différent/);
  },
);
it("requires explicit approval and refuses paths outside the approved run", () => {
  const path = join(directory, "cast-growth-approval.json");
  const approval = JSON.parse(readFileSync(path, "utf8"));
  save(path, { ...approval, authorizedByUser: false });
  expect(() => loadApprovedCast(directory, planPath)).toThrow(/Accord/);
  save(path, { ...approval, approvedCastId: "../other" });
  expect(() => loadApprovedCast(directory, planPath)).toThrow(/Accord/);
});
it("raises only the authorized cumulative ceiling without discarding any old reservations", () => {
  expect(pilotCeilingEur(directory)).toBe(5);
  const ledger = join(directory, "storage/worldgen/budget/2026-09");
  mkdirSync(ledger, { recursive: true });
  save(join(ledger, "old.json"), { units: 4_200_000 });
  const path = join(directory, "budget-authorization.json");
  const approval = {
    version: 1,
    authorizedByUser: true,
    previousCeilingEur: 5,
    ceilingEur: 10,
    scope: "cumulative-pilot",
  };
  save(path, approval);
  expect(pilotCeilingEur(directory) * 1_000_000 - readPilotReservedUnits(directory)).toBe(
    5_800_000,
  );
  save(path, { ...approval, ceilingEur: 20 });
  expect(() => pilotCeilingEur(directory)).toThrow(/invalide/);
});
it("counts existing spending under the second explicit 30 EUR authorization", () => {
  const authorization = { version: 1, authorizedByUser: true, scope: "cumulative-pilot" };
  const later = join(directory, "budget-authorization-30.json");
  save(later, { ...authorization, previousCeilingEur: 10, ceilingEur: 30 });
  expect(() => pilotCeilingEur(directory)).toThrow(/invalide/);
  save(join(directory, "budget-authorization.json"), {
    ...authorization,
    previousCeilingEur: 5,
    ceilingEur: 10,
  });
  const ledger = join(directory, "storage/worldgen/budget/2026-09");
  mkdirSync(ledger, { recursive: true });
  save(join(ledger, "old.json"), { units: 6_300_000 });
  expect(pilotCeilingEur(directory) * 1_000_000 - readPilotReservedUnits(directory)).toBe(
    23_700_000,
  );
  save(later, {
    ...authorization,
    authorizedByUser: false,
    previousCeilingEur: 10,
    ceilingEur: 30,
  });
  expect(() => pilotCeilingEur(directory)).toThrow(/invalide/);
});

it("accepts the authorized 40 EUR ceiling only after the 10 and 30 EUR agreements, retaining all spending", () => {
  const authorization = { version: 1, authorizedByUser: true, scope: "cumulative-pilot" };
  const latest = join(directory, "budget-authorization-40.json");
  save(latest, { ...authorization, previousCeilingEur: 30, ceilingEur: 40 });
  expect(() => pilotCeilingEur(directory)).toThrow(/invalide/);
  save(join(directory, "budget-authorization.json"), {
    ...authorization,
    previousCeilingEur: 5,
    ceilingEur: 10,
  });
  expect(() => pilotCeilingEur(directory)).toThrow(/invalide/);
  save(join(directory, "budget-authorization-30.json"), {
    ...authorization,
    previousCeilingEur: 10,
    ceilingEur: 30,
  });
  const ledger = join(directory, "storage/worldgen/budget/2026-09");
  mkdirSync(ledger, { recursive: true });
  save(join(ledger, "old.json"), { units: 8_900_000 });
  expect(pilotCeilingEur(directory)).toBe(40);
  expect(readPilotReservedUnits(directory)).toBe(8_900_000);
  save(latest, {
    ...authorization,
    authorizedByUser: false,
    previousCeilingEur: 30,
    ceilingEur: 40,
  });
  expect(() => pilotCeilingEur(directory)).toThrow(/invalide/);
});
