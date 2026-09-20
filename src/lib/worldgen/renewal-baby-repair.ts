import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorldGenConfig } from "@/config/server-config";
import { validateCreatureDesign } from "./creature-design";
import type { loadRenewalPlan } from "./creature-renewal";
import type { CastDraft, BabyCheck } from "./creature-cast-preview";
import { createWorldAssetStore } from "./runtime-assets";
import { assessAsset } from "./qa";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

/** One reviewed batch with one originality refusal. Never rewrite its draft, verdicts or images. */
export function loadRenewalBabyRepair(
  directory: string,
  renewal: ReturnType<typeof loadRenewalPlan>,
) {
  const index = renewal.plan.worldIndex;
  const folder = join(directory, "renewal", String(index));
  const bytes = readFileSync(join(folder, "baby-repair-plan.json"));
  const recipe = JSON.parse(bytes.toString());
  const run = recipe.sourceRun;
  if (
    recipe.version !== 1 ||
    recipe.worldIndex !== index ||
    !/^[0-9a-f-]{36}$/.test(run) ||
    recipe.sourceRecipeSha256 !== renewal.recipeSha256 ||
    !Number.isInteger(recipe.slot) ||
    recipe.slot < 0 ||
    recipe.slot >= renewal.plan.creatures.length
  )
    throw new Error("Recette de correction de bébé invalide.");
  const read = (name: string, sha: string) => {
    const data = readFileSync(join(folder, name));
    if (hash(data) !== sha) throw new Error("Source de correction modifiée.");
    return JSON.parse(data.toString());
  };
  const marker = read("babies-started.json", recipe.markerSha256);
  const source: CastDraft = read(`${run}-draft.json`, recipe.draftSha256);
  const result = read(`${run}-result.json`, recipe.resultSha256);
  const review = read("baby-visual-review.json", recipe.visualReviewSha256);
  if (
    marker.runId !== run ||
    marker.recipeSha256 !== renewal.recipeSha256 ||
    marker.validatedCastApprovalSha256 !== renewal.validated.approvalSha256 ||
    JSON.stringify(marker.mapping) !== JSON.stringify(renewal.mapping) ||
    JSON.stringify(result.mapping) !== JSON.stringify(renewal.mapping) ||
    review.sourceRun !== run ||
    review.visualApproved !== true ||
    review.qaPassed !== false ||
    JSON.stringify(source.plan) !== JSON.stringify(renewal.plan) ||
    source.artRefs.length !== renewal.plan.creatures.length ||
    new Set(source.artRefs).size !== source.artRefs.length ||
    recipe.arts?.length !== source.artRefs.length ||
    result.checks?.length !== source.artRefs.length ||
    result.outcome !== "rejected" ||
    result.published !== false ||
    result.databaseWritten !== false ||
    result.growthGenerated !== false
  )
    throw new Error("Groupe source ou accord visuel différent de la correction prévue.");
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.runId === run);
  if (
    hash(JSON.stringify(trace)) !== recipe.traceSha256 ||
    trace.length !== source.artRefs.length * 4 ||
    trace.filter((e) => e.type === "image").length !== source.artRefs.length ||
    trace.filter((e) => e.type === "vision").length !== source.artRefs.length ||
    trace.filter((e) => e.status === 200).length !== source.artRefs.length * 2
  )
    throw new Error("Trace de génération et d’inspection source incohérente.");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  source.artRefs.forEach((ref, i) => {
    const check: BabyCheck = result.checks[i];
    if (
      recipe.arts[i]?.ref !== ref ||
      recipe.arts[i]?.sha256 !== hash(store.read(ref)) ||
      check.ref !== ref ||
      check.name !== source.plan.creatures[i].name ||
      check.inspection.habitatMatches !== true ||
      check.inspection.visuallyDistinct !== (i !== recipe.slot) ||
      JSON.stringify(check.verdict) !==
        JSON.stringify(assessAsset(check.inspection, loadWorldGenConfig({}).qa)) ||
      (i === recipe.slot && (check.verdict.ok || check.verdict.failedRule !== "style_coherence")) ||
      check.verdict.ok !== (i !== recipe.slot)
    )
      throw new Error("La correction exige un seul refus de ressemblance et six arts conservés.");
  });
  const proposed = {
    creatures: source.plan.creatures.map((c, i) => (i === recipe.slot ? recipe.creature : c)),
  };
  const plan = validateCreatureDesign(proposed, index, source.plan.theme, []);
  plan.habitat = source.plan.habitat;
  if (plan.creatures[recipe.slot].name !== source.plan.creatures[recipe.slot].name)
    throw new Error("Le nom et la correspondance de la créature corrigée sont conservés.");
  return {
    source,
    plan,
    slot: recipe.slot as number,
    recipeSha256: hash(bytes),
    historySha256: marker.historySha256 as string,
    sourceRun: run as string,
  };
}
