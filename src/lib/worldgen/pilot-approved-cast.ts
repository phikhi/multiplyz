import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCreatureDesign } from "./creature-design";
import type { CastDraft } from "./creature-cast-preview";
import { createWorldAssetStore } from "./runtime-assets";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Bind the user's artistic approval to the exact reviewed files, never whichever run is latest. */
export function loadApprovedCast(directory: string, growthPlanPath: string): CastDraft {
  const approval = JSON.parse(readFileSync(join(directory, "cast-growth-approval.json"), "utf8"));
  if (
    approval.version !== 1 ||
    approval.authorizedByUser !== true ||
    typeof approval.approvedCastId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(approval.approvedCastId)
  )
    throw new Error("Accord sur les identités absent ou invalide.");
  const read = (path: string, sha256: string) => {
    const bytes = readFileSync(path);
    if (hash(bytes) !== sha256) throw new Error("Fichier validé modifié ; examen nécessaire.");
    return JSON.parse(bytes.toString());
  };
  const prefix = join(directory, "cast-previews", approval.approvedCastId);
  const original = read(`${prefix}-draft.json`, approval.draftSha256);
  const result = read(`${prefix}-result.json`, approval.resultSha256);
  const plan = validateCreatureDesign(
    read(growthPlanPath, approval.growthPlanSha256),
    original.plan.worldIndex,
    original.plan.theme,
    [],
  );
  const refs: unknown = original.artRefs;
  if (
    !Array.isArray(refs) ||
    refs.length !== plan.creatures.length ||
    new Set(refs).size !== refs.length ||
    result.outcome !== "passed-for-visual-review" ||
    !Array.isArray(result.checks) ||
    result.checks.length !== refs.length ||
    !Array.isArray(approval.babies) ||
    approval.babies.length !== refs.length
  )
    throw new Error("Aperçu validé incomplet ou refusé.");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  const artRefs = refs.map((ref, slot) => {
    const check = result.checks[slot];
    if (
      typeof ref !== "string" ||
      ref !== approval.babies[slot]?.ref ||
      ref !== check?.ref ||
      check.name !== plan.creatures[slot].name ||
      original.plan.creatures[slot]?.name !== plan.creatures[slot].name ||
      check.verdict?.ok !== true ||
      check.inspection?.habitatMatches !== true ||
      check.inspection?.visuallyDistinct !== true ||
      hash(store.read(ref)) !== approval.babies[slot].sha256
    )
      throw new Error("Bébé ou verdict différent de l’identité validée.");
    return ref;
  });
  return { plan, artRefs };
}
