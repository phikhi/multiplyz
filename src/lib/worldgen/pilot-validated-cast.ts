import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorldGenConfig } from "@/config/server-config";
import { loadApprovedCast } from "./pilot-approved-cast";
import { loadCastCompletion } from "./pilot-cast-completion";
import { loadStudyStages } from "./pilot-study-stages";
import { createWorldAssetStore } from "./runtime-assets";
import { assessAsset } from "./qa";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
/** The final six lineages, bound to their full QA and the user's acceptance. No publication. */
export function loadValidatedPilotCast(directory: string, growthPlanPath: string) {
  const approved = loadApprovedCast(directory, growthPlanPath);
  const stages = loadStudyStages(directory, loadCastCompletion(directory, approved));
  const bytes = readFileSync(join(directory, "validated-cast-approval.json"));
  const approval = JSON.parse(bytes.toString());
  if (
    approval.version !== 1 ||
    approval.visualApproved !== true ||
    approval.scope !== "six-creature-three-ages" ||
    approval.stagesSha256 !== stages.recipeSha256 ||
    !/^[0-9a-f-]{36}$/.test(approval.inspectionRun)
  )
    throw new Error("Accord final sur les six lignées absent ou invalide.");
  const run = approval.inspectionRun;
  const read = (path: string, sha: string) => {
    const content = readFileSync(join(directory, path));
    if (hash(content) !== sha) throw new Error("Source du groupe validé modifiée.");
    return JSON.parse(content.toString());
  };
  const marker = read("arbelune-study-inspect-started.json", approval.markerSha256);
  const draft = read(`arbelune-study-inspections/${run}-draft-0.json`, approval.draftSha256);
  const result = read(`arbelune-study-inspections/${run}-result.json`, approval.resultSha256);
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.runId === run);
  const refs = stages.draft.artRefs.flatMap((ref, i) => [
    ref,
    stages.draft.stageArt[i][2]!,
    stages.draft.stageArt[i][3]!,
  ]);
  if (
    marker.runId !== run ||
    marker.stagesRecipeSha256 !== stages.recipeSha256 ||
    marker.stagesSourceRun !== stages.sourceRun ||
    JSON.stringify(draft) !== JSON.stringify(stages.draft) ||
    result.sourceRun !== stages.sourceRun ||
    result.outcome !== "passed-for-visual-review" ||
    result.fullValidation !== true ||
    result.inspectedImages !== 18 ||
    result.images !== 18 ||
    result.published !== false ||
    result.databaseWritten !== false ||
    result.generatedImages !== 0 ||
    result.checks?.length !== 18 ||
    approval.arts?.length !== 18 ||
    new Set(refs).size !== 18 ||
    trace.length !== 36 ||
    hash(JSON.stringify(trace)) !== approval.traceSha256
  )
    throw new Error("La validation complète du groupe exact est requise.");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  refs.forEach((ref, i) => {
    const check = result.checks[i];
    const signals = [
      check?.inspection?.habitatMatches,
      check?.inspection?.visuallyDistinct,
      ...(i % 3 ? [check?.inspection?.identityMatches, check?.inspection?.growthVisible] : []),
      ...(i >= 15 ? [check?.inspection?.faceReadable] : []),
    ];
    if (
      approval.arts[i]?.ref !== ref ||
      approval.arts[i]?.sha256 !== hash(store.read(ref)) ||
      check?.ref !== ref ||
      check.slot !== Math.floor(i / 3) ||
      check.stage !== (i % 3) + 1 ||
      check.name !== stages.draft.plan.creatures[Math.floor(i / 3)].name ||
      check.verdict?.ok !== true ||
      signals.some((s) => s !== true) ||
      !assessAsset(check.inspection, loadWorldGenConfig({}).qa).ok
    )
      throw new Error("Pixels ou verdicts du groupe final différents.");
  });
  const orderedRefs = [...refs.slice(15), ...refs.slice(0, 15)];
  const calls = new Set();
  orderedRefs.forEach((ref, i) => {
    const request = trace[i * 2],
      response = trace[i * 2 + 1];
    if (
      request.type !== "vision" ||
      !Number.isSafeInteger(request.call) ||
      calls.has(request.call) ||
      response.call !== request.call ||
      response.status !== 200 ||
      request.referenceSha256?.[0] !== hash(store.read(ref))
    )
      throw new Error("Trace des dix-huit inspections incohérente.");
    calls.add(request.call);
  });
  return { draft: stages.draft, approvalSha256: hash(bytes), inspectionRun: run as string };
}
