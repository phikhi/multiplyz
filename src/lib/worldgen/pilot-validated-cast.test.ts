import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { testCreatureDesign } from "./creature-design.test-helper";
import { loadValidatedPilotCast } from "./pilot-validated-cast";

const state = vi.hoisted(() => ({
  stages: {} as { draft: unknown; recipeSha256: string; sourceRun: string },
}));
vi.mock("./pilot-approved-cast", () => ({ loadApprovedCast: vi.fn() }));
vi.mock("./pilot-cast-completion", () => ({ loadCastCompletion: vi.fn() }));
vi.mock("./pilot-study-stages", () => ({ loadStudyStages: () => state.stages }));
let directory: string, approval: Record<string, unknown>, result: Record<string, unknown>;
const run = "11111111-1111-1111-1111-111111111111";
const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const save = (p: string, v: unknown) => writeFileSync(join(directory, p), JSON.stringify(v));
beforeEach(() => {
  directory = mkdtempSync(join(realpathSync(tmpdir()), "teddy-final-cast-"));
  mkdirSync(join(directory, "storage/generated/world/6"), { recursive: true });
  mkdirSync(join(directory, "arbelune-study-inspections"));
  const plan = testCreatureDesign();
  const refs = Array.from({ length: 18 }, (_, i) => `world/6/runtime-${run}-creature-${i}.png`);
  refs.forEach((ref, i) =>
    writeFileSync(join(directory, "storage/generated", ref), Buffer.from(`immutable-${i}`)),
  );
  const draft = {
    plan,
    artRefs: refs.filter((_, i) => i % 3 === 0),
    stageArt: Array.from({ length: 6 }, (_, i) => ({ 2: refs[i * 3 + 1], 3: refs[i * 3 + 2] })),
  };
  state.stages = { draft, recipeSha256: "stages", sourceRun: "study" };
  save("arbelune-study-inspect-started.json", {
    runId: run,
    stagesRecipeSha256: "stages",
    stagesSourceRun: "study",
  });
  save(`arbelune-study-inspections/${run}-draft-0.json`, draft);
  result = {
    sourceRun: "study",
    outcome: "passed-for-visual-review",
    fullValidation: true,
    inspectedImages: 18,
    images: 18,
    published: false,
    databaseWritten: false,
    generatedImages: 0,
    checks: refs.map((ref, i) => ({
      ref,
      slot: Math.floor(i / 3),
      stage: (i % 3) + 1,
      name: plan.creatures[Math.floor(i / 3)].name,
      inspection: {
        habitatMatches: true,
        visuallyDistinct: true,
        identityMatches: true,
        growthVisible: true,
        faceReadable: true,
        detectedText: "",
        unsafeScore: 0,
        styleScore: 0.95,
      },
      verdict: { ok: true },
    })),
  };
  save(`arbelune-study-inspections/${run}-result.json`, result);
  const trace = [...refs.slice(15), ...refs.slice(0, 15)].flatMap((ref, i) => [
    {
      runId: run,
      call: i + 1,
      type: "vision",
      referenceSha256: [hash(readFileSync(join(directory, "storage/generated", ref)))],
    },
    { runId: run, call: i + 1, status: 200 },
  ]);
  writeFileSync(join(directory, "requests.jsonl"), trace.map((e) => JSON.stringify(e)).join("\n"));
  approval = {
    version: 1,
    scope: "six-creature-three-ages",
    visualApproved: true,
    stagesSha256: "stages",
    inspectionRun: run,
    markerSha256: hash(readFileSync(join(directory, "arbelune-study-inspect-started.json"))),
    draftSha256: hash(
      readFileSync(join(directory, `arbelune-study-inspections/${run}-draft-0.json`)),
    ),
    resultSha256: hash(
      readFileSync(join(directory, `arbelune-study-inspections/${run}-result.json`)),
    ),
    traceSha256: hash(JSON.stringify(trace)),
    arts: refs.map((ref) => ({
      ref,
      sha256: hash(readFileSync(join(directory, "storage/generated", ref))),
    })),
  };
  save("validated-cast-approval.json", approval);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
it("loads only the exact eighteen positive images and complete ordered inspection trace", () => {
  expect(loadValidatedPilotCast(directory, "unused").inspectionRun).toBe(run);
  const ref = (state.stages.draft as { artRefs: string[] }).artRefs[0];
  writeFileSync(join(directory, "storage/generated", ref), "changed");
  expect(() => loadValidatedPilotCast(directory, "unused")).toThrow(/Pixels ou verdicts/);
});
it("refuses a false identity even if the result label and approval say passed", () => {
  const checks = result.checks as { inspection: { identityMatches: boolean } }[];
  checks[1].inspection.identityMatches = false;
  save(`arbelune-study-inspections/${run}-result.json`, result);
  approval.resultSha256 = hash(
    readFileSync(join(directory, `arbelune-study-inspections/${run}-result.json`)),
  );
  save("validated-cast-approval.json", approval);
  expect(() => loadValidatedPilotCast(directory, "unused")).toThrow(/Pixels ou verdicts/);
});
it("requires visual acceptance in addition to positive QA", () => {
  save("validated-cast-approval.json", { ...approval, visualApproved: false });
  expect(() => loadValidatedPilotCast(directory, "unused")).toThrow(/Accord final/);
});
