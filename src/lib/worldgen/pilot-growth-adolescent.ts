import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorldGenConfig } from "@/config/server-config";
import type { CastDraft } from "./creature-cast-preview";
import type { CastGrowthDraft } from "./creature-cast-growth";
import { cutoutNewCreature } from "./creature-growth";
import { loadGrowthProof, type previewAdultGrowthProof } from "./pilot-growth-proof";
import { assessAsset, type InspectableAsset } from "./qa";
import { createWorldAssetStore } from "./runtime-assets";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const GROWTH_ADOLESCENT_UNITS = 250_000;

/** The user accepted one precise adult; no automatic approval from a positive model verdict. */
export function loadAdolescentProof(directory: string, approved: CastDraft) {
  const initial = loadGrowthProof(directory, approved);
  const bytes = readFileSync(join(directory, "growth-adolescent-approval.json"));
  const agreement = JSON.parse(bytes.toString());
  if (
    agreement.version !== 1 ||
    agreement.authorizedByUser !== true ||
    agreement.method !== "description-only-adolescent" ||
    agreement.slot !== 0 ||
    !/^[0-9a-f-]{36}$/.test(agreement.adultRun) ||
    agreement.initialRecipeSha256 !== initial.recipeSha256 ||
    typeof agreement.prompt !== "string" ||
    agreement.prompt.length < 100 ||
    agreement.prompt.length > 4000
  )
    throw new Error("Accord sur l’adulte absent ou invalide.");
  const read = (suffix: string, sha: string) => {
    const content = readFileSync(
      join(directory, "growth-proofs", `${agreement.adultRun}-${suffix}.json`),
    );
    if (hash(content) !== sha) throw new Error("Fichier de l’adulte validé modifié.");
    return JSON.parse(content.toString());
  };
  const source: CastGrowthDraft = read("draft-0", agreement.draftSha256);
  const result = read("result", agreement.resultSha256);
  const ref = source.stageArt?.[0]?.[3],
    check = result.checks?.[0];
  const expected = structuredClone(initial.source);
  expected.stageArt[0][3] = ref;
  if (
    typeof ref !== "string" ||
    ref !== agreement.adultRef ||
    JSON.stringify(source) !== JSON.stringify(expected) ||
    result.outcome !== "passed-for-visual-review" ||
    result.scope !== "single-adult-method-proof" ||
    result.checks?.length !== 1 ||
    check?.ref !== ref ||
    check.stage !== 3 ||
    check.slot !== 0 ||
    check.name !== approved.plan.creatures[0].name ||
    check.verdict?.ok !== true ||
    ![
      check.inspection?.identityMatches,
      check.inspection?.growthVisible,
      check.inspection?.habitatMatches,
      check.inspection?.visuallyDistinct,
    ].every((signal) => signal === true) ||
    !assessAsset(check.inspection, loadWorldGenConfig({}).qa).ok ||
    hash(createWorldAssetStore(join(directory, "storage/generated")).read(ref)) !==
      agreement.adultSha256
  )
    throw new Error("Adulte différent du dessin et du verdict validés.");
  return {
    source,
    prompt: agreement.prompt as string,
    recipeSha256: hash(bytes),
    sourceRun: agreement.adultRun as string,
  };
}

/** A reviewed, explicit non-human creature brief; never silently retries the refused request. */
export function loadClarifiedAdolescentProof(directory: string, approved: CastDraft) {
  const original = loadAdolescentProof(directory, approved);
  const bytes = readFileSync(join(directory, "growth-adolescent-clarification.json"));
  const recipe = JSON.parse(bytes.toString());
  if (
    recipe.version !== 1 ||
    recipe.originalAgreementSha256 !== original.recipeSha256 ||
    !/^[0-9a-f-]{36}$/.test(recipe.failedRun) ||
    typeof recipe.prompt !== "string" ||
    recipe.prompt.length < 100 ||
    recipe.prompt.length > 4000 ||
    recipe.prompt === original.prompt
  )
    throw new Error("Clarification de l’ado absente ou invalide.");
  const resultBytes = readFileSync(
    join(directory, "growth-adolescents", `${recipe.failedRun}-result.json`),
  );
  const result = JSON.parse(resultBytes.toString());
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.runId === recipe.failedRun);
  const [request, response] = trace;
  if (
    hash(resultBytes) !== recipe.resultSha256 ||
    result.outcome !== "stopped" ||
    result.preview !== null ||
    existsSync(join(directory, "growth-adolescents", `${recipe.failedRun}-draft-0.json`)) ||
    trace.length !== 2 ||
    hash(Buffer.from(JSON.stringify(trace))) !== recipe.traceSha256 ||
    request?.type !== "image" ||
    request.phase !== "growth-adolescent" ||
    request.referenceSha256?.length !== 0 ||
    JSON.stringify(request.prompts) !== JSON.stringify([original.prompt]) ||
    response?.call !== request.call ||
    response.status !== 200 ||
    response.finishReason !== "PROHIBITED_CONTENT"
  )
    throw new Error("Le diagnostic source ne correspond pas au refus sans image examiné.");
  return {
    ...original,
    prompt: recipe.prompt as string,
    recipeSha256: hash(bytes),
    sourceRun: recipe.failedRun as string,
  };
}

/** One new adolescent; BOTH accepted endpoints reused exactly; all three receive fresh QA. */
export async function previewAdolescentGrowthProof(
  proof: ReturnType<typeof loadAdolescentProof>,
  storage: string,
  deps: Parameters<typeof previewAdultGrowthProof>[2],
) {
  if (deps.remainingUnits() < GROWTH_ADOLESCENT_UNITS)
    throw new Error("Budget insuffisant pour l’ado et les trois inspections.");
  const store = createWorldAssetStore(storage),
    draft = structuredClone(proof.source);
  const babyRef = draft.artRefs[0],
    adultRef = draft.stageArt[0][3];
  if (!adultRef) throw new Error("Adulte validé absent.");
  const originals = [
    ...draft.artRefs,
    ...draft.stageArt.flatMap((stages) => [stages[2]!, stages[3]!]),
    ...(deps.excludedArts ?? []),
  ].map(store.read);
  const pixels = await cutoutNewCreature(await deps.generate({ prompt: proof.prompt }));
  if (originals.some((old) => old.equals(pixels)))
    throw new Error("L’ado recopie un stade existant.");
  const adolescentRef = await store.write(draft.plan.worldIndex, "creature-0-ado.png", pixels);
  draft.stageArt[0][2] = adolescentRef;
  deps.onDraft(draft);
  const assets: InspectableAsset[] = [
    { kind: "creature", ref: babyRef },
    { kind: "creature", ref: adolescentRef, stage: 2, babyRef, adultRef },
    { kind: "creature", ref: adultRef, stage: 3, babyRef, previousRef: adolescentRef },
  ];
  const checks = [];
  for (const [i, asset] of assets.entries()) {
    const inspection = await deps.inspect(asset, draft);
    const signals = [
      inspection.habitatMatches,
      inspection.visuallyDistinct,
      ...(asset.stage ? [inspection.identityMatches, inspection.growthVisible] : []),
    ];
    if (signals.some((signal) => typeof signal !== "boolean"))
      throw new Error("Signaux de comparaison/croissance absents.");
    const verdict = assessAsset(inspection, deps.config.qa);
    const check = {
      name: draft.plan.creatures[0].name,
      slot: 0,
      stage: i + 1,
      ref: asset.ref,
      inspection,
      verdict,
    };
    checks.push(check);
    deps.onCheck(check);
  }
  return {
    outcome: checks.every((check) => check.verdict.ok) ? "passed-for-visual-review" : "rejected",
    scope: "single-creature-three-ages",
    checks,
    generatedImages: 1,
    reusedBabies: 1,
    reusedAdults: 1,
    published: false,
    growthGenerated: false,
  };
}
