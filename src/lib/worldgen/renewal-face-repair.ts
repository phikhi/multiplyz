import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { loadRenewalPlan } from "./creature-renewal";
import { loadRenewalGrowth } from "./renewal-growth";
import { loadRenewalGrowthRecovery } from "./renewal-growth-recovery";
import type { CastGrowthDraft } from "./creature-cast-growth";
import { createWorldAssetStore } from "./runtime-assets";
import { assessAsset } from "./qa";
import { loadWorldGenConfig } from "@/config/server-config";
import { cutoutNewCreature } from "./creature-growth";
import { inspectCompletedCast } from "./pilot-cast-completion";
import type { previewAdultGrowthProof } from "./pilot-growth-proof";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

interface FaceRepair {
  source: CastGrowthDraft;
  slot: number;
  prompt: string;
  sourceRun: string;
  recipeSha256: string;
  historySha256: string;
}

/** One face-only refusal in the completed resumed group; all previous attempts stay immutable. */
export function loadRenewalFaceRepair(
  directory: string,
  renewal: ReturnType<typeof loadRenewalPlan>,
  pass: 1 | 2 = 1,
): FaceRepair {
  if (pass !== 1 && pass !== 2) throw new Error("Passe de visage non préparée.");
  const previous = pass === 2 ? loadRenewalFaceRepair(directory, renewal) : undefined;
  const growth = loadRenewalGrowth(directory, renewal);
  const recovery = loadRenewalGrowthRecovery(directory, growth);
  const index = renewal.plan.worldIndex,
    folder = join(directory, "renewal", String(index));
  const bytes = readFileSync(
    join(folder, pass === 2 ? "face-repair-2-plan.json" : "face-repair-plan.json"),
  );
  const recipe = JSON.parse(bytes.toString()),
    run = recipe.sourceRun,
    count = growth.source.artRefs.length;
  if (
    recipe.version !== 1 ||
    recipe.method !== "adult-face-edit" ||
    recipe.worldIndex !== index ||
    recipe.recoveryRecipeSha256 !== recovery.recipeSha256 ||
    (previous &&
      (recipe.previousRecipeSha256 !== previous.recipeSha256 || recipe.slot === previous.slot)) ||
    !/^[0-9a-f-]{36}$/.test(run) ||
    !Number.isSafeInteger(recipe.slot) ||
    recipe.slot < 0 ||
    recipe.slot >= count ||
    recipe.stage !== 3 ||
    typeof recipe.prompt !== "string" ||
    recipe.prompt.length < 100 ||
    recipe.prompt.length > 5000
  )
    throw new Error("Plan de correction du visage invalide.");
  const read = (file: string, sha: string) => {
    const data = readFileSync(join(folder, file));
    if (hash(data) !== sha) throw new Error("Source de correction du visage modifiée.");
    return JSON.parse(data.toString());
  };
  const marker = read(
    previous ? "face-repair-started.json" : "growth-resume-started.json",
    recipe.markerSha256,
  );
  const source: CastGrowthDraft = read(`${run}-draft.json`, recipe.draftSha256);
  const result = read(`${run}-result.json`, recipe.resultSha256);
  const review = read(
    previous ? "face-repair-2-review.json" : "growth-visual-review.json",
    recipe.visualReviewSha256,
  );
  if (
    marker.runId !== run ||
    marker.growthRecipeSha256 !== growth.recipeSha256 ||
    (!previous && marker.recoveryRecipeSha256 !== recovery.recipeSha256) ||
    marker.historySha256 !== growth.historySha256 ||
    marker.validatedCastApprovalSha256 !== renewal.validated.approvalSha256 ||
    JSON.stringify(marker.mapping) !== JSON.stringify(renewal.mapping) ||
    JSON.stringify(result.mapping) !== JSON.stringify(renewal.mapping) ||
    (previous
      ? marker.faceRecipeSha256 !== previous.recipeSha256 ||
        marker.repairedSlot !== previous.slot ||
        marker.sourceRun !== previous.sourceRun ||
        result.faceRecipeSha256 !== previous.recipeSha256 ||
        result.sourceRun !== previous.sourceRun ||
        result.repairedSlot !== previous.slot ||
        result.repairedStage !== 3 ||
        result.method !== "adult-face-edit" ||
        result.generatedImages !== 1 ||
        result.reusedImages !== count * 3 - 1
      : result.interruptedRun !== recovery.sourceRun ||
        result.recoveryRecipeSha256 !== recovery.recipeSha256 ||
        result.sourceRun !== growth.sourceRun ||
        result.generatedImages !== count * 2 - recovery.completedCount ||
        result.reusedBabies !== count ||
        result.reusedOlderStages !== recovery.completedCount) ||
    result.outcome !== "rejected" ||
    result.fullValidation !== false ||
    result.images !== count * 3 ||
    result.inspectedImages !== count * 3 ||
    result.checks?.length !== count * 3 ||
    result.growthGenerated !== true ||
    result.published !== false ||
    result.databaseWritten !== false ||
    review.sourceRun !== run ||
    review.visualApproved !== true ||
    review.qaPassed !== false ||
    JSON.stringify(source.plan) !== JSON.stringify(growth.source.plan) ||
    JSON.stringify(source.artRefs) !== JSON.stringify(growth.source.artRefs) ||
    source.stageArt?.length !== count
  )
    throw new Error(
      "La correction exige le groupe terminé et son avis visuel, avec un refus de visage.",
    );
  const refs = source.artRefs.flatMap((baby, i) => [
    baby,
    source.stageArt[i][2],
    source.stageArt[i][3],
  ]);
  if (
    refs.some((ref) => typeof ref !== "string") ||
    new Set(refs).size !== count * 3 ||
    recipe.arts?.length !== refs.length
  )
    throw new Error("Groupe des trois âges incomplet.");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  if (previous) {
    const expected = structuredClone(previous.source);
    expected.stageArt[previous.slot][3] = source.stageArt[previous.slot][3];
    if (
      source.stageArt[previous.slot][3] === previous.source.stageArt[previous.slot][3] ||
      JSON.stringify(expected) !== JSON.stringify(source)
    )
      throw new Error(
        "La première correction doit être conservée avec les vingt autres arts exacts.",
      );
  } else {
    recovery.draft.stageArt.forEach((ages, i) => {
      for (const stage of [2, 3] as const)
        if (ages[stage] && ages[stage] !== source.stageArt[i][stage])
          throw new Error("Un âge récupéré a été remplacé.");
    });
  }
  refs.forEach((ref, i) => {
    const slot = Math.floor(i / 3),
      stage = (i % 3) + 1,
      check = result.checks[i];
    const target = slot === recipe.slot && stage === 3;
    if (
      recipe.arts[i]?.ref !== ref ||
      recipe.arts[i]?.sha256 !== hash(store.read(ref!)) ||
      check.slot !== slot ||
      check.stage !== stage ||
      check.ref !== ref ||
      check.name !== source.plan.creatures[slot].name ||
      check.inspection?.habitatMatches !== true ||
      check.inspection?.visuallyDistinct !== true ||
      (stage > 1 &&
        (check.inspection.identityMatches !== true || check.inspection.growthVisible !== true)) ||
      check.inspection.faceReadable !== !target ||
      check.verdict.ok !== !target ||
      JSON.stringify(check.verdict) !==
        JSON.stringify(assessAsset(check.inspection, loadWorldGenConfig({}).qa))
    )
      throw new Error("La correction exige un seul visage refusé et vingt arts conservés.");
  });
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((s) => JSON.parse(s))
    .filter((e) => e.runId === run);
  const images = previous ? 1 : count * 2 - recovery.completedCount;
  const inspectionRefs = previous
    ? [
        previous.slot,
        ...source.artRefs.map((_, i) => i).filter((i) => i !== previous.slot),
      ].flatMap((slot) => refs.slice(slot * 3, slot * 3 + 3))
    : refs;
  if (
    hash(JSON.stringify(trace)) !== recipe.traceSha256 ||
    trace.length !== (images + refs.length) * 2
  )
    throw new Error("Trace de la reprise modifiée.");
  const calls = new Set<number>();
  for (let i = 0; i < trace.length; i += 2) {
    const request = trace[i],
      response = trace[i + 1],
      visionIndex = i / 2 - images;
    if (
      !Number.isSafeInteger(request.call) ||
      calls.has(request.call) ||
      request.call !== response.call ||
      response.status !== 200 ||
      request.phase !== `renewal-${index}-${previous ? "face-repair" : "growth-resume"}` ||
      request.type !== (visionIndex < 0 ? "image" : "vision") ||
      (visionIndex >= 0 &&
        request.referenceSha256?.[0] !== hash(store.read(inspectionRefs[visionIndex]!))) ||
      (previous &&
        visionIndex < 0 &&
        (JSON.stringify(request.referenceSha256) !==
          JSON.stringify([hash(store.read(previous.source.stageArt[previous.slot][3]!))]) ||
          JSON.stringify(request.prompts) !== JSON.stringify([previous.prompt]) ||
          response.finishReason !== "STOP" ||
          response.blockReason))
    )
      throw new Error("Inspections détachées des images du groupe terminé.");
    calls.add(request.call);
  }
  return {
    source,
    slot: recipe.slot as number,
    prompt: recipe.prompt as string,
    sourceRun: run as string,
    recipeSha256: hash(bytes),
    historySha256: growth.historySha256,
  };
}

/** Redraw only the refused adult from its own reference, then diagnose its lineage before peers. */
export async function previewRenewalFaceRepair(
  repair: ReturnType<typeof loadRenewalFaceRepair>,
  storage: string,
  deps: Parameters<typeof previewAdultGrowthProof>[2],
) {
  const count = repair.source.artRefs.length;
  if (deps.remainingUnits() < 100_000 + count * 150_000)
    throw new Error("Budget insuffisant pour le visage et la validation complète.");
  const store = createWorldAssetStore(storage),
    sourceRef = repair.source.stageArt[repair.slot][3]!;
  const draft = structuredClone(repair.source);
  delete draft.stageArt[repair.slot][3];
  deps.onDraft(structuredClone(draft));
  const pixels = await cutoutNewCreature(
    await deps.generate({
      prompt: repair.prompt,
      refImages: [{ data: store.read(sourceRef), mimeType: "image/png" }],
    }),
  );
  const refs = repair.source.artRefs.flatMap((ref, i) => [
    ref,
    ...Object.values(repair.source.stageArt[i]),
  ]);
  if (refs.some((ref) => pixels.equals(store.read(ref))))
    throw new Error("La correction recopie un dessin existant.");
  const name = repair.slot === count - 1 ? "legendary" : `creature-${repair.slot}`;
  draft.stageArt[repair.slot][3] = await store.write(
    draft.plan.worldIndex,
    `${name}-adulte.png`,
    pixels,
  );
  deps.onDraft(structuredClone(draft));
  return {
    ...(await inspectCompletedCast(
      draft,
      deps,
      draft.artRefs.map((_, i) => i),
      repair.slot,
    )),
    generatedImages: 1,
    reusedImages: count * 3 - 1,
    repairedSlot: repair.slot,
    repairedStage: 3,
    method: "adult-face-edit",
  };
}
