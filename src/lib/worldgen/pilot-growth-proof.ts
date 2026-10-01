import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorldGenConfig } from "@/config/server-config";
import type { CastDraft } from "./creature-cast-preview";
import type { CastGrowthDraft } from "./creature-cast-growth";
import { cutoutNewCreature } from "./creature-growth";
import type { GenerateImageInput } from "./image-client";
import { assessAsset, type AssetInspection, type InspectableAsset } from "./qa";
import { createWorldAssetStore } from "./runtime-assets";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const GROWTH_PROOF_UNITS = 150_000;

/** A separate experiment, pinned to the examined rejection. Never resumes a completed batch. */
export function loadGrowthProof(directory: string, approved: CastDraft) {
  const bytes = readFileSync(join(directory, "growth-proof-plan.json"));
  const recipe = JSON.parse(bytes.toString());
  if (
    recipe.version !== 1 ||
    recipe.method !== "description-only-adult" ||
    recipe.slot !== 0 ||
    recipe.name !== approved.plan.creatures[0].name ||
    !/^[0-9a-f-]{36}$/.test(recipe.sourceRun) ||
    typeof recipe.prompt !== "string" ||
    recipe.prompt.length < 100 ||
    recipe.prompt.length > 4000
  )
    throw new Error("Essai d’adulte invalide.");
  const read = (suffix: string, expected: string) => {
    const content = readFileSync(
      join(directory, "cast-redesigns", `${recipe.sourceRun}-${suffix}.json`),
    );
    if (hash(content) !== expected) throw new Error("Source de l’essai modifiée.");
    return JSON.parse(content.toString());
  };
  const source: CastGrowthDraft = read(`draft-${approved.artRefs.length * 2}`, recipe.draftSha256);
  const result = read("result", recipe.resultSha256);
  if (
    JSON.stringify(source.plan) !== JSON.stringify(approved.plan) ||
    JSON.stringify(source.artRefs) !== JSON.stringify(approved.artRefs) ||
    source.stageArt?.length !== approved.artRefs.length ||
    result.outcome !== "rejected" ||
    !Array.isArray(result.checks) ||
    result.checks.length !== approved.artRefs.length * 3
  )
    throw new Error("Identités ou résultat source incompatibles avec cet essai.");
  const refs = source.artRefs.flatMap((ref, slot) => [
    ref,
    source.stageArt[slot][2],
    source.stageArt[slot][3],
  ]);
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  if (
    !Array.isArray(recipe.sourceArts) ||
    recipe.sourceArts.length !== refs.length ||
    new Set(refs).size !== refs.length
  )
    throw new Error("Arts sources incomplets.");
  refs.forEach((ref, i) => {
    const entry = recipe.sourceArts[i],
      check = result.checks[i];
    if (
      typeof ref !== "string" ||
      entry?.ref !== ref ||
      hash(store.read(ref)) !== entry.sha256 ||
      check?.ref !== ref ||
      check.slot !== Math.floor(i / 3) ||
      check.stage !== (i % 3) + 1
    )
      throw new Error("Art source de l’essai modifié.");
  });
  return {
    source,
    prompt: recipe.prompt as string,
    recipeSha256: hash(bytes),
    sourceRun: recipe.sourceRun as string,
  };
}

/** One adult from text only. The canonical images remain mandatory for QA, not generation. */
export async function previewAdultGrowthProof(
  proof: ReturnType<typeof loadGrowthProof>,
  storage: string,
  deps: {
    config: WorldGenConfig;
    remainingUnits: () => number;
    generate: (input: GenerateImageInput) => Promise<Buffer>;
    inspect: (asset: InspectableAsset, draft: CastGrowthDraft) => Promise<AssetInspection>;
    onDraft: (draft: CastGrowthDraft) => void;
    onCheck: (check: unknown) => void;
    excludedArts?: readonly string[];
  },
) {
  if (deps.remainingUnits() < GROWTH_PROOF_UNITS)
    throw new Error("Budget insuffisant pour l’adulte et son inspection.");
  const store = createWorldAssetStore(storage);
  const draft: CastGrowthDraft = structuredClone(proof.source);
  const previousRef = draft.stageArt[0][2];
  if (!previousRef || !draft.stageArt[0][3]) throw new Error("Stades de comparaison absents.");
  const originals = [
    ...draft.artRefs,
    ...draft.stageArt.flatMap((stages) => [stages[2]!, stages[3]!]),
    ...(deps.excludedArts ?? []),
  ].map(store.read);
  // Changing conditioning is the experiment. Do not call the baby-anchored growth helper here.
  const pixels = await cutoutNewCreature(await deps.generate({ prompt: proof.prompt }));
  if (originals.some((old) => old.equals(pixels)))
    throw new Error("L’essai recopie les pixels d’un stade existant.");
  const ref = await store.write(draft.plan.worldIndex, "creature-0-adulte.png", pixels);
  draft.stageArt[0][3] = ref;
  deps.onDraft(draft);
  const inspection = await deps.inspect(
    { kind: "creature", ref, stage: 3, babyRef: draft.artRefs[0], previousRef },
    draft,
  );
  if (
    [
      inspection.identityMatches,
      inspection.growthVisible,
      inspection.habitatMatches,
      inspection.visuallyDistinct,
    ].some((signal) => typeof signal !== "boolean")
  )
    throw new Error("Signaux de comparaison/croissance absents.");
  const verdict = assessAsset(inspection, deps.config.qa);
  const check = { name: draft.plan.creatures[0].name, slot: 0, stage: 3, ref, inspection, verdict };
  deps.onCheck(check);
  return {
    outcome: verdict.ok ? "passed-for-visual-review" : "rejected",
    scope: "single-adult-method-proof",
    checks: [check],
    generatedImages: 1,
    reusedBabies: 1,
    published: false,
    growthGenerated: false,
    // The old adolescent is a diagnostic comparison, never promoted to an approved age.
    comparedRejectedAdolescent: previousRef,
  };
}
