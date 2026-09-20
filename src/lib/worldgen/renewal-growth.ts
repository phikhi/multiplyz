import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorldGenConfig } from "@/config/server-config";
import type { loadRenewalPlan } from "./creature-renewal";
import { loadRenewalBabyRepair } from "./renewal-baby-repair";
import type { BabyCheck, CastDraft } from "./creature-cast-preview";
import type { CastGrowthDraft } from "./creature-cast-growth";
import { createWorldAssetStore } from "./runtime-assets";
import { assessAsset } from "./qa";
import { cutoutNewCreature } from "./creature-growth";
import { inspectCompletedCast } from "./pilot-cast-completion";
import type { previewAdultGrowthProof } from "./pilot-growth-proof";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export interface RenewalAgePrompts {
  slot: number;
  name: string;
  adolescent: string;
  adult: string;
}

/** Pins the reviewed, fully inspected repaired babies; never promotes the earlier rejected cast. */
export function loadRenewalGrowth(directory: string, renewal: ReturnType<typeof loadRenewalPlan>) {
  const correction = loadRenewalBabyRepair(directory, renewal);
  const folder = join(directory, "renewal", String(renewal.plan.worldIndex));
  const bytes = readFileSync(join(folder, "growth-plan.json"));
  const recipe = JSON.parse(bytes.toString());
  const run = recipe.sourceRun;
  if (
    recipe.version !== 1 ||
    recipe.method !== "description-only-growth" ||
    recipe.worldIndex !== renewal.plan.worldIndex ||
    recipe.correctionRecipeSha256 !== correction.recipeSha256 ||
    !/^[0-9a-f-]{36}$/.test(run)
  )
    throw new Error("Plan d’évolution non lié aux bébés corrigés.");
  const read = (name: string, sha: string) => {
    const data = readFileSync(join(folder, name));
    if (hash(data) !== sha) throw new Error("Sources des évolutions modifiées.");
    return JSON.parse(data.toString());
  };
  const approval = read("babies-approved.json", recipe.approvalSha256);
  const marker = read("baby-repair-started.json", recipe.markerSha256);
  const source: CastDraft = read(`${run}-draft.json`, recipe.draftSha256);
  const result = read(`${run}-result.json`, recipe.resultSha256);
  const count = renewal.plan.creatures.length;
  if (
    approval.visualApproved !== true ||
    approval.sourceRun !== run ||
    approval.scope !== "world-babies" ||
    marker.runId !== run ||
    marker.sourceRun !== correction.sourceRun ||
    marker.correctionRecipeSha256 !== correction.recipeSha256 ||
    marker.recipeSha256 !== renewal.recipeSha256 ||
    marker.validatedCastApprovalSha256 !== renewal.validated.approvalSha256 ||
    marker.historySha256 !== correction.historySha256 ||
    JSON.stringify(marker.mapping) !== JSON.stringify(renewal.mapping) ||
    JSON.stringify(result.mapping) !== JSON.stringify(renewal.mapping) ||
    result.sourceRun !== correction.sourceRun ||
    result.repairedSlot !== correction.slot ||
    result.outcome !== "passed-for-visual-review" ||
    result.fullValidation !== true ||
    result.images !== count ||
    result.inspectedImages !== count ||
    result.generatedImages !== 1 ||
    result.reusedImages !== count - 1 ||
    result.published !== false ||
    result.databaseWritten !== false ||
    result.growthGenerated !== false ||
    result.checks?.length !== count ||
    JSON.stringify(source.plan) !== JSON.stringify(correction.plan) ||
    source.artRefs.length !== count ||
    new Set(source.artRefs).size !== count ||
    recipe.arts?.length !== count
  )
    throw new Error("Les évolutions exigent tous les bébés exacts validés et approuvés.");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  source.artRefs.forEach((ref, i) => {
    const check: BabyCheck = result.checks[i];
    if (
      (i === correction.slot
        ? ref === correction.source.artRefs[i]
        : ref !== correction.source.artRefs[i]) ||
      recipe.arts[i]?.ref !== ref ||
      recipe.arts[i]?.sha256 !== hash(store.read(ref)) ||
      check.ref !== ref ||
      check.name !== source.plan.creatures[i].name ||
      check.verdict.ok !== true ||
      check.inspection.habitatMatches !== true ||
      check.inspection.visuallyDistinct !== true ||
      !assessAsset(check.inspection, loadWorldGenConfig({}).qa).ok
    )
      throw new Error("Pixels ou verdicts des bébés modifiés.");
  });
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((s) => JSON.parse(s))
    .filter((e) => e.runId === run);
  if (
    hash(JSON.stringify(trace)) !== recipe.traceSha256 ||
    trace.length !== (count + 1) * 2 ||
    trace[0]?.type !== "image" ||
    trace[1]?.status !== 200
  )
    throw new Error("Trace de la correction incomplète.");
  const order = [
    correction.slot,
    ...source.artRefs.map((_, i) => i).filter((i) => i !== correction.slot),
  ];
  const calls = new Set([trace[0].call]);
  order.forEach((slot, i) => {
    const request = trace[2 + i * 2],
      response = trace[3 + i * 2];
    if (
      request.type !== "vision" ||
      !Number.isSafeInteger(request.call) ||
      calls.has(request.call) ||
      request.call !== response.call ||
      response.status !== 200 ||
      request.referenceSha256?.[0] !== hash(store.read(source.artRefs[slot]))
    )
      throw new Error("Les inspections ne correspondent pas aux bébés approuvés.");
    calls.add(request.call);
  });
  const prompts: RenewalAgePrompts[] = recipe.creatures;
  if (
    !Array.isArray(prompts) ||
    prompts.length !== count ||
    prompts.some(
      (c, i) =>
        c.slot !== i ||
        c.name !== source.plan.creatures[i].name ||
        [c.adolescent, c.adult].some(
          (p) => typeof p !== "string" || p.length < 100 || p.length > 5000,
        ) ||
        c.adolescent === c.adult,
    )
  )
    throw new Error("Deux descriptions anatomiques distinctes par créature sont requises.");
  return {
    source,
    prompts,
    sourceRun: run as string,
    historySha256: correction.historySha256,
    recipeSha256: hash(bytes),
  };
}

/** Adult bodies first, then separately authored juveniles. Canonical babies are QA references only. */
export async function previewRenewalGrowth(
  growth: Pick<ReturnType<typeof loadRenewalGrowth>, "source" | "prompts">,
  storage: string,
  deps: Parameters<typeof previewAdultGrowthProof>[2],
  completed?: CastGrowthDraft,
) {
  const count = growth.source.artRefs.length;
  if (
    !count ||
    growth.prompts.length !== count ||
    growth.source.plan.creatures.length !== count ||
    new Set(growth.source.artRefs).size !== count
  )
    throw new Error("Groupe incomplet pour les évolutions.");
  const store = createWorldAssetStore(storage);
  const draft: CastGrowthDraft = completed
    ? structuredClone(completed)
    : {
        ...structuredClone(growth.source),
        stageArt: Array.from({ length: count }, () => ({})),
      };
  if (
    JSON.stringify(draft.plan) !== JSON.stringify(growth.source.plan) ||
    JSON.stringify(draft.artRefs) !== JSON.stringify(growth.source.artRefs) ||
    draft.stageArt.length !== count ||
    draft.stageArt.some((ages) =>
      Object.entries(ages).some(
        ([age, ref]) => !["2", "3"].includes(age) || typeof ref !== "string" || !ref,
      ),
    )
  )
    throw new Error("Groupe récupéré incompatible avec les évolutions prévues.");
  let missing = false;
  const reused = [3, 2].flatMap((stage) => draft.stageArt.map((ages) => ages[stage as 2 | 3]));
  for (const ref of reused) {
    if (!ref) missing = true;
    else if (missing) throw new Error("Les âges récupérés doivent former un préfixe complet.");
  }
  const reusedRefs = reused.filter((ref): ref is string => !!ref);
  const allRefs = [...draft.artRefs, ...reusedRefs];
  if (new Set(allRefs).size !== allRefs.length)
    throw new Error("Des âges récupérés partagent la même image.");
  const images = count * 2 - reusedRefs.length;
  if (deps.remainingUnits() < images * 100_000 + count * 150_000)
    throw new Error("Budget insuffisant pour les évolutions et la validation complète.");
  const originals = [...allRefs, ...(deps.excludedArts ?? [])].map(store.read);
  deps.onDraft(structuredClone(draft));
  for (const stage of [3, 2] as const) {
    for (const entry of growth.prompts) {
      if (draft.stageArt[entry.slot][stage]) continue;
      const bytes = await cutoutNewCreature(
        await deps.generate({ prompt: stage === 3 ? entry.adult : entry.adolescent }),
      );
      if (originals.some((old) => old.equals(bytes)))
        throw new Error("Un âge recopie des pixels existants.");
      const name = entry.slot === count - 1 ? "legendary" : `creature-${entry.slot}`;
      const ref = await store.write(
        draft.plan.worldIndex,
        `${name}-${stage === 3 ? "adulte" : "ado"}.png`,
        bytes,
      );
      originals.push(store.read(ref));
      draft.stageArt[entry.slot][stage] = ref;
      deps.onDraft(structuredClone(draft));
    }
  }
  return {
    ...(await inspectCompletedCast(
      draft,
      deps,
      draft.artRefs.map((_, i) => i),
    )),
    generatedImages: images,
    reusedBabies: count,
    reusedOlderStages: reusedRefs.length,
    method: "description-only-growth",
  };
}
