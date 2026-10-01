import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { loadWorldGenConfig } from "@/config/server-config";
import { loadArbeluneAdolescent } from "./pilot-arbelune-repair";
import type { loadCastCompletion } from "./pilot-cast-completion";
import { assessAsset } from "./qa";
import { createWorldAssetStore } from "./runtime-assets";
import type { previewAdultGrowthProof } from "./pilot-growth-proof";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export const ARBELUNE_STUDY_UNITS = 100_000;
/** A new design study, not a retry or an approval of the failed age pair. */
export function loadArbeluneStudy(
  directory: string,
  completion: ReturnType<typeof loadCastCompletion>,
) {
  const basis = loadArbeluneAdolescent(directory, completion);
  const bytes = readFileSync(join(directory, "arbelune-study-plan.json"));
  const recipe = JSON.parse(bytes.toString());
  if (
    recipe.version !== 1 ||
    recipe.method !== "joint-two-stage-study" ||
    recipe.slot !== 5 ||
    recipe.basisSha256 !== basis.recipeSha256 ||
    !/^[0-9a-f-]{36}$/.test(recipe.sourceRun) ||
    typeof recipe.prompt !== "string" ||
    recipe.prompt.length < 100 ||
    recipe.prompt.length > 5000
  )
    throw new Error("Étude d’Arbélune invalide.");
  const read = (path: string, sha: string) => {
    const content = readFileSync(join(directory, path));
    if (hash(content) !== sha) throw new Error("Source ou rejet utilisateur de l’étude modifié.");
    return JSON.parse(content.toString());
  };
  const marker = read("arbelune-adolescent-started.json", recipe.markerSha256);
  const source: typeof basis.source = read(
    `arbelune-adolescents/${recipe.sourceRun}-draft-1.json`,
    recipe.draftSha256,
  );
  const result = read(`arbelune-adolescents/${recipe.sourceRun}-result.json`, recipe.resultSha256);
  const review = read("arbelune-ee150-user-review.json", recipe.reviewSha256);
  const expected = structuredClone(basis.source);
  expected.stageArt[5][2] = source.stageArt?.[5]?.[2];
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.runId === recipe.sourceRun);
  if (
    marker.runId !== recipe.sourceRun ||
    marker.adolescentRecipeSha256 !== basis.recipeSha256 ||
    JSON.stringify(source) !== JSON.stringify(expected) ||
    result.outcome !== "rejected" ||
    result.published !== false ||
    result.databaseWritten !== false ||
    result.generatedImages !== 1 ||
    result.reusedImages !== 17 ||
    !Array.isArray(result.checks) ||
    result.checks.length !== 18 ||
    trace.length !== 38 ||
    trace.filter((entry) => entry.type === "image").length !== 1 ||
    trace.filter((entry) => entry.type === "vision").length !== 18 ||
    hash(JSON.stringify(trace)) !== recipe.traceSha256
  )
    throw new Error("Attendre le résultat terminal de la paire refusée avant une étude.");
  const refs = source.artRefs.flatMap((ref, i) => [
    ref,
    source.stageArt[i][2],
    source.stageArt[i][3],
  ]);
  if (
    !Array.isArray(recipe.sourceArts) ||
    recipe.sourceArts.length !== 18 ||
    new Set(refs).size !== 18
  )
    throw new Error("Arts sources de l’étude incomplets.");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  refs.forEach((ref, i) => {
    const check = result.checks[i];
    if (
      typeof ref !== "string" ||
      recipe.sourceArts[i]?.ref !== ref ||
      recipe.sourceArts[i]?.sha256 !== hash(store.read(ref)) ||
      check?.ref !== ref ||
      check.slot !== Math.floor(i / 3) ||
      check.stage !== (i % 3) + 1 ||
      check.verdict?.ok !== i < 16 ||
      JSON.stringify(assessAsset(check.inspection, loadWorldGenConfig({}).qa)) !==
        JSON.stringify(check.verdict)
    )
      throw new Error("Pixels ou verdicts de la paire refusée modifiés.");
  });
  if (
    review.sourceRun !== recipe.sourceRun ||
    review.rejectedByUser !== true ||
    review.reason !== "adolescent-copies-adult" ||
    JSON.stringify(review.refs) !== JSON.stringify(refs.slice(16)) ||
    JSON.stringify(review.sha256) !==
      JSON.stringify(refs.slice(16).map((ref) => hash(store.read(ref!))))
  )
    throw new Error("Le rejet utilisateur de cette paire est requis.");
  return {
    source,
    prompt: recipe.prompt as string,
    sourceRun: recipe.sourceRun as string,
    recipeSha256: hash(bytes),
    method: "joint-two-stage-study" as const,
  };
}

/** Edit the chosen study's anatomy, preserving its approved silhouette direction. */
export function loadArbeluneStudyAnatomy(
  directory: string,
  completion: ReturnType<typeof loadCastCompletion>,
) {
  const basis = loadArbeluneStudy(directory, completion);
  const bytes = readFileSync(join(directory, "arbelune-study-anatomy-plan.json"));
  const recipe = JSON.parse(bytes.toString());
  if (
    recipe.version !== 1 ||
    recipe.method !== "edit-study-anatomy" ||
    recipe.basisSha256 !== basis.recipeSha256 ||
    !/^[0-9a-f-]{36}$/.test(recipe.sourceRun) ||
    typeof recipe.prompt !== "string" ||
    recipe.prompt.length < 100 ||
    recipe.prompt.length > 5000
  )
    throw new Error("Correction anatomique de l’étude invalide.");
  const read = (path: string, sha: string) => {
    const content = readFileSync(join(directory, path));
    if (hash(content) !== sha) throw new Error("Source ou accord de l’étude modifié.");
    return JSON.parse(content.toString());
  };
  const marker = read("arbelune-study-started.json", recipe.markerSha256);
  const result = read(`arbelune-studies/${recipe.sourceRun}-result.json`, recipe.resultSha256);
  const approval = read("arbelune-study-direction-approval.json", recipe.approvalSha256);
  const editImage = readFileSync(
    join(directory, "arbelune-studies", `${recipe.sourceRun}-study.png`),
  );
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.runId === recipe.sourceRun);
  const baby = createWorldAssetStore(join(directory, "storage/generated")).read(
    basis.source.artRefs[5],
  );
  if (
    marker.runId !== recipe.sourceRun ||
    marker.studyRecipeSha256 !== basis.recipeSha256 ||
    marker.studySourceRun !== basis.sourceRun ||
    result.sourceRun !== basis.sourceRun ||
    result.outcome !== "study-ready-for-visual-review" ||
    result.generatedImages !== 1 ||
    result.proposedStages !== 2 ||
    result.inspections !== 0 ||
    result.qaPassed !== false ||
    result.growthGenerated !== false ||
    result.published !== false ||
    result.databaseWritten !== false ||
    hash(editImage) !== recipe.studySha256 ||
    trace.length !== 2 ||
    trace[0]?.type !== "image" ||
    trace[1]?.call !== trace[0]?.call ||
    trace[1]?.status !== 200 ||
    trace[1]?.finishReason !== "STOP" ||
    JSON.stringify(trace[0]?.prompts) !== JSON.stringify([basis.prompt]) ||
    JSON.stringify(trace[0]?.referenceSha256) !== JSON.stringify([hash(baby)]) ||
    hash(JSON.stringify(trace)) !== recipe.traceSha256
  )
    throw new Error("La planche source terminée et ses références exactes sont requises.");
  if (
    approval.sourceRun !== recipe.sourceRun ||
    approval.studySha256 !== recipe.studySha256 ||
    approval.directionApproved !== true ||
    approval.direction !== "slender-juvenile-tall-mature" ||
    approval.anatomyCorrectionRequired !== true ||
    approval.finalStagesApproved !== false ||
    approval.userMessage !== "Garder cette direction et corriger l’anatomie"
  )
    throw new Error("L’accord sur la direction et la correction anatomique est requis.");
  return {
    source: basis.source,
    prompt: recipe.prompt as string,
    sourceRun: recipe.sourceRun as string,
    recipeSha256: hash(bytes),
    method: "edit-study-anatomy" as const,
    editImage,
  };
}

/** A single two-stage concept image, stored outside runtime art. No cutout, QA, promotion or DB writes. */
export async function previewArbeluneStudy(
  study: ReturnType<typeof loadArbeluneStudy | typeof loadArbeluneStudyAnatomy>,
  storage: string,
  deps: Pick<Parameters<typeof previewAdultGrowthProof>[2], "remainingUnits" | "generate"> & {
    onStudy: (bytes: Buffer) => void;
  },
) {
  if (deps.remainingUnits() < ARBELUNE_STUDY_UNITS)
    throw new Error("Budget insuffisant pour une planche d’étude.");
  const baby = createWorldAssetStore(storage).read(study.source.artRefs[5]);
  const raw = await deps.generate({
    prompt: study.prompt,
    refImages: [
      ...("editImage" in study ? [{ data: study.editImage, mimeType: "image/png" }] : []),
      { data: baby, mimeType: "image/png" },
    ],
  });
  const pixels = await sharp(raw, { limitInputPixels: 40_000_000 }).png().toBuffer();
  deps.onStudy(pixels);
  return {
    outcome: "study-ready-for-visual-review",
    scope: "arbelune-two-stage-study",
    generatedImages: 1,
    proposedStages: 2,
    inspections: 0,
    method: study.method,
    sourceRun: study.sourceRun,
    published: false,
    growthGenerated: false,
    qaPassed: false,
  };
}
