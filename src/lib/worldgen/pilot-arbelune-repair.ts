import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorldGenConfig } from "@/config/server-config";
import { loadCastRecovery } from "./pilot-cast-recovery";
import { inspectCompletedCast, type loadCastCompletion } from "./pilot-cast-completion";
import { cutoutNewCreature } from "./creature-growth";
import { assessAsset, type AssetInspection } from "./qa";
import { createWorldAssetStore } from "./runtime-assets";
import type { previewAdultGrowthProof } from "./pilot-growth-proof";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export const ARBELUNE_REPAIR_UNITS = 1_100_000;
/** The adult's positive machine verdict never overrides the recorded user rejection. */
export function loadArbeluneRepair(
  directory: string,
  completion: ReturnType<typeof loadCastCompletion>,
) {
  const recovery = loadCastRecovery(directory, completion);
  const bytes = readFileSync(join(directory, "arbelune-repair-plan.json"));
  const recipe = JSON.parse(bytes.toString());
  if (
    recipe.version !== 1 ||
    recipe.slot !== 5 ||
    recipe.name !== recovery.draft.plan.creatures[5].name ||
    recipe.sourceRecoverySha256 !== recovery.recipeSha256 ||
    recipe.method !== "description-only-readable-face" ||
    !/^[0-9a-f-]{36}$/.test(recipe.qaRun) ||
    [recipe.adult, recipe.adolescent].some(
      (prompt) => typeof prompt !== "string" || prompt.length < 100 || prompt.length > 5000,
    ) ||
    recipe.adult === recipe.adolescent
  )
    throw new Error("Correction d’Arbélune invalide ou source modifiée.");
  const read = (path: string, sha: string) => {
    const content = readFileSync(join(directory, path));
    if (hash(content) !== sha) throw new Error("Bilan ou retour visuel d’Arbélune modifié.");
    return JSON.parse(content.toString());
  };
  const marker = read("cast-completion-inspect-started.json", recipe.qaMarkerSha256);
  const draft = read(
    `cast-completion-inspections/${recipe.qaRun}-draft-0.json`,
    recipe.qaDraftSha256,
  );
  const result = read(
    `cast-completion-inspections/${recipe.qaRun}-result.json`,
    recipe.qaResultSha256,
  );
  const review = read("arbelune-user-review.json", recipe.reviewSha256);
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.runId === recipe.qaRun);
  if (
    hash(JSON.stringify(trace)) !== recipe.qaTraceSha256 ||
    trace.filter((entry) => entry.type).length !== 18 ||
    trace.some((entry) => entry.type && entry.type !== "vision") ||
    marker.runId !== recipe.qaRun ||
    marker.recoveryRecipeSha256 !== recovery.recipeSha256 ||
    JSON.stringify(draft) !== JSON.stringify(recovery.draft) ||
    result.outcome !== "rejected" ||
    result.published !== false ||
    result.databaseWritten !== false ||
    !Array.isArray(result.checks) ||
    result.checks.length !== 18
  )
    throw new Error(
      "Attendre le bilan complet des dix-huit inspections ; aucune reprise d’une passe active.",
    );
  const refs = recovery.draft.artRefs.flatMap((ref, i) => [
    ref,
    recovery.draft.stageArt[i][2],
    recovery.draft.stageArt[i][3],
  ]);
  result.checks.forEach(
    (
      check: {
        ref: string;
        slot: number;
        stage: number;
        name: string;
        inspection: AssetInspection;
        verdict: { ok: boolean };
      },
      i: number,
    ) => {
      if (
        check.ref !== refs[i] ||
        check.slot !== Math.floor(i / 3) ||
        check.stage !== (i % 3) + 1 ||
        check.name !== recovery.draft.plan.creatures[Math.floor(i / 3)].name ||
        JSON.stringify(assessAsset(check.inspection, loadWorldGenConfig({}).qa)) !==
          JSON.stringify(check.verdict)
      )
        throw new Error("Comparaisons sources incompatibles avec le groupe récupéré.");
    },
  );
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  if (
    review.rejectedByUser !== true ||
    review.reason !== "adult-face-unreadable" ||
    review.ref !== refs[17] ||
    review.sha256 !== hash(store.read(refs[17]!)) ||
    review.qaRun !== recipe.qaRun
  )
    throw new Error("Rejet visuel de l’adulte absent ou rattaché à un autre dessin.");
  return {
    source: recovery.draft,
    adult: recipe.adult as string,
    adolescent: recipe.adolescent as string,
    recipeSha256: hash(bytes),
    sourceRun: recipe.qaRun as string,
  };
}

/** Two images only, then fresh full-group QA with an additional face check on all three Arbélune ages. */
export async function previewArbeluneRepair(
  repair: ReturnType<typeof loadArbeluneRepair>,
  storage: string,
  deps: Parameters<typeof previewAdultGrowthProof>[2],
) {
  if (deps.remainingUnits() < ARBELUNE_REPAIR_UNITS)
    throw new Error("Budget insuffisant pour deux images et dix-huit inspections.");
  const store = createWorldAssetStore(storage),
    draft = structuredClone(repair.source);
  const originals = [
    ...draft.artRefs,
    ...draft.stageArt.flatMap((ages) => [ages[2]!, ages[3]!]),
    ...(deps.excludedArts ?? []),
  ].map(store.read);
  draft.stageArt[5] = {};
  deps.onDraft(draft);
  for (const stage of [3, 2] as const) {
    const pixels = await cutoutNewCreature(
      await deps.generate({ prompt: stage === 3 ? repair.adult : repair.adolescent }),
    );
    if (originals.some((old) => old.equals(pixels)))
      throw new Error("La correction recopie des pixels existants.");
    draft.stageArt[5][stage] = await store.write(
      draft.plan.worldIndex,
      `legendary-${stage === 3 ? "adulte" : "ado"}.png`,
      pixels,
    );
    originals.push(store.read(draft.stageArt[5][stage]!));
    deps.onDraft(draft);
  }
  return {
    ...(await inspectCompletedCast(draft, deps, 5)),
    generatedImages: 2,
    reusedImages: 16,
    repairedCreature: draft.plan.creatures[5].name,
    sourceRun: repair.sourceRun,
    readableFaceRequired: true,
  };
}

export const ARBELUNE_ADOLESCENT_UNITS = 1_000_000;
/** Pins the completed repair: keep its positive adult, replace only the rejected middle age. */
export function loadArbeluneAdolescent(
  directory: string,
  completion: ReturnType<typeof loadCastCompletion>,
) {
  const basis = loadArbeluneRepair(directory, completion);
  const bytes = readFileSync(join(directory, "arbelune-adolescent-plan.json"));
  const recipe = JSON.parse(bytes.toString());
  if (
    recipe.version !== 1 ||
    recipe.slot !== 5 ||
    recipe.stage !== 2 ||
    recipe.method !== "two-endpoint-adolescent" ||
    recipe.basisSha256 !== basis.recipeSha256 ||
    JSON.stringify(recipe.referenceOrder) !== '["baby","adult"]' ||
    !/^[0-9a-f-]{36}$/.test(recipe.sourceRun) ||
    typeof recipe.prompt !== "string" ||
    recipe.prompt.length < 100 ||
    recipe.prompt.length > 5000
  )
    throw new Error("Plan de l’ado d’Arbélune invalide.");
  const read = (path: string, sha: string) => {
    const content = readFileSync(join(directory, path));
    if (hash(content) !== sha) throw new Error("Source de l’ado d’Arbélune modifiée.");
    return JSON.parse(content.toString());
  };
  const marker = read("arbelune-repair-started.json", recipe.markerSha256);
  const source: typeof basis.source = read(
    `arbelune-repairs/${recipe.sourceRun}-draft-2.json`,
    recipe.draftSha256,
  );
  const result = read(`arbelune-repairs/${recipe.sourceRun}-result.json`, recipe.resultSha256);
  const expected = structuredClone(basis.source);
  expected.stageArt[5] = source.stageArt?.[5];
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.runId === recipe.sourceRun);
  if (
    marker.runId !== recipe.sourceRun ||
    marker.repairRecipeSha256 !== basis.recipeSha256 ||
    JSON.stringify(source) !== JSON.stringify(expected) ||
    result.outcome !== "rejected" ||
    result.published !== false ||
    result.databaseWritten !== false ||
    result.generatedImages !== 2 ||
    result.reusedImages !== 16 ||
    !Array.isArray(result.checks) ||
    result.checks.length !== 18 ||
    trace.length !== 40 ||
    trace.filter((entry) => entry.type === "image").length !== 2 ||
    trace.filter((entry) => entry.type === "vision").length !== 18 ||
    hash(JSON.stringify(trace)) !== recipe.traceSha256
  )
    throw new Error(
      "La correction précédente doit être terminée et les seize autres arts conservés.",
    );
  const refs = source.artRefs.flatMap((ref, slot) => [
    ref,
    source.stageArt[slot][2],
    source.stageArt[slot][3],
  ]);
  if (
    !Array.isArray(recipe.sourceArts) ||
    recipe.sourceArts.length !== 18 ||
    new Set(refs).size !== 18
  )
    throw new Error("Les dix-huit arts sources sont obligatoires.");
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
      check.name !== source.plan.creatures[Math.floor(i / 3)].name ||
      check.verdict?.ok !== (i !== 16) ||
      JSON.stringify(assessAsset(check.inspection, loadWorldGenConfig({}).qa)) !==
        JSON.stringify(check.verdict) ||
      (i >= 15 && check.inspection.faceReadable !== true) ||
      (i === 17 &&
        (check.inspection.identityMatches !== true || check.inspection.growthVisible !== true))
    )
      throw new Error("Les pixels ou verdicts ne permettent pas de conserver ce bébé/adulte.");
  });
  return {
    source,
    prompt: recipe.prompt as string,
    adult: basis.adult,
    recipeSha256: hash(bytes),
    sourceRun: recipe.sourceRun as string,
  };
}

/** The two exact age endpoints constrain the open arch; QA still refuses either endpoint copied. */
export async function previewArbeluneAdolescent(
  revision: ReturnType<typeof loadArbeluneAdolescent>,
  storage: string,
  deps: Parameters<typeof previewAdultGrowthProof>[2],
) {
  if (deps.remainingUnits() < ARBELUNE_ADOLESCENT_UNITS)
    throw new Error("Budget insuffisant pour un ado et dix-huit inspections.");
  const store = createWorldAssetStore(storage),
    draft = structuredClone(revision.source);
  const baby = store.read(draft.artRefs[5]),
    adult = store.read(draft.stageArt[5][3]!);
  const originals = [
    ...draft.artRefs,
    ...draft.stageArt.flatMap((ages) => [ages[2]!, ages[3]!]),
    ...(deps.excludedArts ?? []),
  ].map(store.read);
  delete draft.stageArt[5][2];
  deps.onDraft(draft);
  const pixels = await cutoutNewCreature(
    await deps.generate({
      prompt: revision.prompt,
      refImages: [
        { data: baby, mimeType: "image/png" },
        { data: adult, mimeType: "image/png" },
      ],
    }),
  );
  if (originals.some((old) => old.equals(pixels)))
    throw new Error("L’ado recopie les pixels d’un stade existant.");
  draft.stageArt[5][2] = await store.write(draft.plan.worldIndex, "legendary-ado.png", pixels);
  deps.onDraft(draft);
  return {
    ...(await inspectCompletedCast(draft, deps, 5)),
    generatedImages: 1,
    reusedImages: 17,
    repairedCreature: draft.plan.creatures[5].name,
    sourceRun: revision.sourceRun,
    readableFaceRequired: true,
    method: "two-endpoint-adolescent",
  };
}
