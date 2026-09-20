import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { CastDraft } from "./creature-cast-preview";
import type { CastGrowthDraft } from "./creature-cast-growth";
import { createWorldAssetStore } from "./runtime-assets";

interface StageInstruction {
  slot: number;
  stage: 2 | 3;
  instruction: string;
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** User's all-stage rejection supersedes QA passes; the failed run stays immutable. */
export function loadCastRedesign(directory: string, approved: CastDraft) {
  const planBytes = readFileSync(join(directory, "cast-growth-redesign-plan.json"));
  const plan = JSON.parse(planBytes.toString());
  if (
    plan.version !== 1 ||
    !/^[0-9a-f-]{36}$/.test(plan.sourceRun) ||
    plan.draftFile !== `${plan.sourceRun}-draft-${approved.artRefs.length * 2}.json`
  )
    throw new Error("Source de refonte des évolutions invalide.");
  const read = (file: string, sha: string) => {
    const bytes = readFileSync(join(directory, "cast-growths", file));
    if (hash(bytes) !== sha) throw new Error("Résultat de croissance source modifié.");
    return JSON.parse(bytes.toString());
  };
  const source: CastGrowthDraft = read(plan.draftFile, plan.draftSha256);
  const result = read(`${plan.sourceRun}-result.json`, plan.resultSha256);
  if (
    JSON.stringify(source.plan) !== JSON.stringify(approved.plan) ||
    JSON.stringify(source.artRefs) !== JSON.stringify(approved.artRefs) ||
    source.stageArt.length !== approved.artRefs.length ||
    result.outcome !== "rejected" ||
    !Array.isArray(result.checks) ||
    result.checks.length !== approved.artRefs.length * 3
  )
    throw new Error("La refonte ne correspond pas aux identités et au résultat examinés.");
  const refs = source.artRefs.flatMap((ref, slot) => [
    ref,
    source.stageArt[slot][2],
    source.stageArt[slot][3],
  ]);
  if (
    refs.some((ref) => typeof ref !== "string") ||
    new Set(refs).size !== refs.length ||
    !Array.isArray(plan.sourceArts) ||
    plan.sourceArts.length !== refs.length
  )
    throw new Error("Arts sources incomplets.");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  refs.forEach((ref, index) => {
    const proof = plan.sourceArts.find((p: { ref: string }) => p.ref === ref);
    const check = result.checks[index];
    if (
      !proof ||
      hash(store.read(ref!)) !== proof.sha256 ||
      check.ref !== ref ||
      check.slot !== Math.floor(index / 3) ||
      check.stage !== (index % 3) + 1 ||
      check.inspection.detectedText !== "" ||
      check.inspection.unsafeScore !== 0 ||
      check.inspection.habitatMatches !== true ||
      check.inspection.visuallyDistinct !== true
    )
      throw new Error("Source modifiée ou refus hors du périmètre de croissance.");
  });
  const instructions: StageInstruction[] = plan.corrections;
  if (
    !Array.isArray(instructions) ||
    instructions.length !== approved.artRefs.length * 2 ||
    instructions.some(
      (c, i) =>
        c.slot !== Math.floor(i / 2) ||
        c.stage !== 2 + (i % 2) ||
        typeof c.instruction !== "string" ||
        c.instruction.length < 30 ||
        c.instruction.length > 2500,
    )
  )
    throw new Error("Les douze évolutions doivent toutes avoir une consigne distincte.");
  return {
    sourceRun: plan.sourceRun,
    recipeSha256: hash(planBytes),
    excludedArts: refs.filter((ref): ref is string => typeof ref === "string"),
    instructions,
    stageInstructions: (slot: number, stage: 2 | 3) =>
      instructions[slot * 2 + stage - 2].instruction,
  };
}
