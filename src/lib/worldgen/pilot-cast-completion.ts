import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorldGenConfig } from "@/config/server-config";
import type { CastDraft } from "./creature-cast-preview";
import type { CastGrowthDraft } from "./creature-cast-growth";
import { cutoutNewCreature } from "./creature-growth";
import { loadClarifiedAdolescentProof } from "./pilot-growth-adolescent";
import type { previewAdultGrowthProof } from "./pilot-growth-proof";
import { assessAsset, type InspectableAsset } from "./qa";
import { createWorldAssetStore } from "./runtime-assets";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const CAST_COMPLETION_UNITS = 1_900_000;
interface CreaturePrompts {
  slot: number;
  name: string;
  adolescent: string;
  adult: string;
}

/** Pins the accepted lineage; the other five creatures' older stages remain unapproved. */
export function loadCastCompletion(directory: string, approved: CastDraft) {
  const basis = loadClarifiedAdolescentProof(directory, approved);
  const bytes = readFileSync(join(directory, "cast-completion-plan.json"));
  const recipe = JSON.parse(bytes.toString());
  if (
    recipe.version !== 1 ||
    recipe.lineageApprovedByUser !== true ||
    recipe.method !== "description-only-growth" ||
    recipe.basisSha256 !== basis.recipeSha256 ||
    !/^[0-9a-f-]{36}$/.test(recipe.lineageRun) ||
    approved.artRefs.length !== 6
  )
    throw new Error("Accord sur les trois âges de Vrillou absent ou invalide.");
  const read = (suffix: string, sha: string) => {
    const content = readFileSync(
      join(directory, "growth-adolescent-clarifications", `${recipe.lineageRun}-${suffix}.json`),
    );
    if (hash(content) !== sha) throw new Error("Lignée validée modifiée.");
    return JSON.parse(content.toString());
  };
  const source: CastGrowthDraft = read("draft-0", recipe.draftSha256);
  const result = read("result", recipe.resultSha256);
  const expected = structuredClone(basis.source);
  expected.stageArt[0][2] = source.stageArt?.[0]?.[2];
  if (
    JSON.stringify(source) !== JSON.stringify(expected) ||
    result.outcome !== "passed-for-visual-review" ||
    result.scope !== "single-creature-three-ages" ||
    result.checks?.length !== 3
  )
    throw new Error("Lignée différente des trois âges validés.");
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
    throw new Error("Arts sources incomplets.");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  refs.forEach((ref, i) => {
    if (
      typeof ref !== "string" ||
      recipe.sourceArts[i]?.ref !== ref ||
      hash(store.read(ref)) !== recipe.sourceArts[i].sha256
    )
      throw new Error("Pixels sources modifiés.");
  });
  result.checks.forEach(
    (
      check: {
        ref: string;
        slot: number;
        stage: number;
        name: string;
        inspection: Parameters<typeof assessAsset>[0];
        verdict?: { ok: boolean };
      },
      i: number,
    ) => {
      const signals = [
        check.inspection?.habitatMatches,
        check.inspection?.visuallyDistinct,
        ...(i ? [check.inspection?.identityMatches, check.inspection?.growthVisible] : []),
      ];
      if (
        check.ref !== refs[i] ||
        check.slot !== 0 ||
        check.stage !== i + 1 ||
        check.name !== approved.plan.creatures[0].name ||
        check.verdict?.ok !== true ||
        !signals.every((signal) => signal === true) ||
        !assessAsset(check.inspection, loadWorldGenConfig({}).qa).ok
      )
        throw new Error("Verdict des trois âges invalide.");
    },
  );
  const prompts: CreaturePrompts[] = recipe.creatures;
  if (
    !Array.isArray(prompts) ||
    prompts.length !== 5 ||
    prompts.some(
      (entry, i) =>
        entry.slot !== i + 1 ||
        entry.name !== approved.plan.creatures[i + 1].name ||
        [entry.adolescent, entry.adult].some(
          (prompt) => typeof prompt !== "string" || prompt.length < 100 || prompt.length > 5000,
        ) ||
        entry.adolescent === entry.adult,
    )
  )
    throw new Error("Les cinq créatures doivent avoir deux descriptions distinctes.");
  return { source, prompts, recipeSha256: hash(bytes), sourceRun: recipe.lineageRun as string };
}

/** Text-only growth, no changes to approved pixels, fresh QA against all eighteen final images. */
export async function previewCastCompletion(
  completion: ReturnType<typeof loadCastCompletion>,
  storage: string,
  deps: Parameters<typeof previewAdultGrowthProof>[2],
) {
  if (deps.remainingUnits() < CAST_COMPLETION_UNITS)
    throw new Error("Budget insuffisant pour dix images et dix-huit inspections.");
  const store = createWorldAssetStore(storage),
    draft = structuredClone(completion.source);
  const originals = [
    ...draft.artRefs,
    ...draft.stageArt.flatMap((stages) => [stages[2]!, stages[3]!]),
    ...(deps.excludedArts ?? []),
  ].map(store.read);
  for (let slot = 1; slot < 6; slot++) draft.stageArt[slot] = {};
  deps.onDraft(draft);
  // Establish the mature forms first. The intermediate forms have separately written anatomy.
  for (const stage of [3, 2] as const) {
    for (const entry of completion.prompts) {
      const pixels = await cutoutNewCreature(
        await deps.generate({ prompt: stage === 3 ? entry.adult : entry.adolescent }),
      );
      if (originals.some((old) => old.equals(pixels)))
        throw new Error("Un stade recopie des pixels existants.");
      const name = entry.slot === 5 ? "legendary" : `creature-${entry.slot}`;
      const ref = await store.write(
        draft.plan.worldIndex,
        `${name}-${stage === 3 ? "adulte" : "ado"}.png`,
        pixels,
      );
      originals.push(store.read(ref));
      draft.stageArt[entry.slot][stage] = ref;
      deps.onDraft(draft);
    }
  }
  return {
    ...(await inspectCompletedCast(draft, deps)),
    generatedImages: 10,
    reusedBabies: 6,
    reusedOlderStages: 2,
  };
}

/** Shared full-group QA, also used after a locally recovered technical cutout failure. */
export async function inspectCompletedCast(
  draft: CastGrowthDraft,
  deps: Pick<Parameters<typeof previewAdultGrowthProof>[2], "inspect" | "onCheck" | "config">,
  readableFaceSlot?: number | readonly number[],
  prioritySlot?: number,
) {
  const checks = [];
  const slots = draft.artRefs.map((_, slot) => slot);
  if (prioritySlot !== undefined) {
    if (!Number.isInteger(prioritySlot) || !slots.includes(prioritySlot))
      throw new Error("Lignée prioritaire invalide.");
    slots.splice(slots.indexOf(prioritySlot), 1);
    slots.unshift(prioritySlot);
  }
  for (const slot of slots) {
    const babyRef = draft.artRefs[slot];
    const adolescentRef = draft.stageArt[slot][2]!,
      adultRef = draft.stageArt[slot][3]!;
    const assets: InspectableAsset[] = [
      { kind: "creature", ref: babyRef },
      { kind: "creature", ref: adolescentRef, stage: 2, babyRef, adultRef },
      { kind: "creature", ref: adultRef, stage: 3, babyRef, previousRef: adolescentRef },
    ];
    for (const [i, asset] of assets.entries()) {
      const readableSlots =
        typeof readableFaceSlot === "number" ? [readableFaceSlot] : (readableFaceSlot ?? []);
      const checkedAsset = readableSlots.includes(slot)
        ? { ...asset, requireReadableFace: true }
        : asset;
      const inspection = await deps.inspect(checkedAsset, draft);
      const signals = [
        inspection.habitatMatches,
        inspection.visuallyDistinct,
        ...(asset.stage ? [inspection.identityMatches, inspection.growthVisible] : []),
        ...(checkedAsset.requireReadableFace ? [inspection.faceReadable] : []),
      ];
      if (signals.some((signal) => typeof signal !== "boolean"))
        throw new Error("Signaux de comparaison/croissance absents.");
      const verdict = assessAsset(inspection, deps.config.qa);
      const check = {
        name: draft.plan.creatures[slot].name,
        slot,
        stage: i + 1,
        ref: asset.ref,
        inspection,
        verdict,
      };
      checks.push(check);
      deps.onCheck(check);
    }
    // Diagnose all three priority ages; only a passing lineage unlocks the other fifteen checks.
    if (slot === prioritySlot && checks.some((check) => !check.verdict.ok)) break;
  }
  checks.sort((a, b) => a.slot - b.slot || a.stage - b.stage);
  const imageCount = draft.artRefs.length * 3;
  return {
    outcome: checks.every((check) => check.verdict.ok) ? "passed-for-visual-review" : "rejected",
    scope:
      checks.length === imageCount
        ? imageCount === 18
          ? "six-creature-three-ages"
          : "world-creature-three-ages"
        : "single-creature-three-ages",
    checks,
    images: imageCount,
    inspectedImages: checks.length,
    fullValidation:
      imageCount > 0 && checks.length === imageCount && checks.every((check) => check.verdict.ok),
    published: false,
    growthGenerated: true,
  };
}
