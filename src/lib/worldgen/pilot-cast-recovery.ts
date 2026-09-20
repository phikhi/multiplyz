import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { CastGrowthDraft } from "./creature-cast-growth";
import { cutoutNewCreature } from "./creature-growth";
import { inspectCompletedCast, type loadCastCompletion } from "./pilot-cast-completion";
import { createWorldAssetStore } from "./runtime-assets";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const save = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const failure = "Détourage non fiable : le fond doit être blanc et dégagé aux bords.";
export const CAST_RECOVERY_UNITS = 900_000;
type Completion = ReturnType<typeof loadCastCompletion>;
type Crop = { left: number; top: number; width: number; height: number };
const refsOf = (draft: CastGrowthDraft) =>
  draft.artRefs
    .flatMap((ref, i) => [ref, draft.stageArt[i][2], draft.stageArt[i][3]])
    .filter((ref): ref is string => typeof ref === "string");

/** Explicit, visually reviewed rectangle only. Never guesses a matte or changes the general guard. */
export async function cropFramedCreature(raw: Buffer, crop: Crop) {
  if (
    !crop ||
    ![crop.left, crop.top, crop.width, crop.height].every(Number.isSafeInteger) ||
    crop.left < 0 ||
    crop.top < 0 ||
    crop.width < 32 ||
    crop.height < 32
  )
    throw new Error("Rectangle de recadrage invalide.");
  const cropped = await sharp(raw, { limitInputPixels: 40_000_000 }).extract(crop).png().toBuffer();
  const { data, info } = await sharp(cropped)
    .flatten({ background: "white" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // A clear ring all around the crop prevents cutting a foot or retaining the frame.
  const margin = Math.max(2, Math.floor(Math.min(info.width, info.height) * 0.02));
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (x >= margin && y >= margin && x < info.width - margin && y < info.height - margin)
        continue;
      const i = (y * info.width + x) * 3;
      const lo = Math.min(data[i], data[i + 1], data[i + 2]),
        hi = Math.max(data[i], data[i + 1], data[i + 2]);
      if (lo < 236 || hi - lo > 16)
        throw new Error("Recadrage refusé : marge blanche interrompue.");
    }
  return cutoutNewCreature(cropped);
}

/** Exactly the ten-image completion stopped on its final cutout, before any QA. */
function readStoppedCompletion(directory: string, completion: Completion) {
  const markerPath = "cast-completion-started.json";
  const marker = JSON.parse(readFileSync(join(directory, markerPath), "utf8"));
  const run: string = marker.runId;
  if (
    !/^[0-9a-f-]{36}$/.test(run) ||
    marker.completionRecipeSha256 !== completion.recipeSha256 ||
    marker.approvedLineageRun !== completion.sourceRun
  )
    throw new Error("Source de récupération différente de la passe approuvée.");
  const folder = join(directory, "cast-completions");
  const files = readdirSync(folder)
    .filter((file) => file.startsWith(`${run}-`))
    .sort();
  const expectedFiles = [
    ...Array.from({ length: 10 }, (_, i) => `${run}-draft-${i}.json`),
    `${run}-result.json`,
  ].sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles))
    throw new Error("La récupération exige neuf dessins enregistrés et aucune QA engagée.");
  const result = JSON.parse(readFileSync(join(folder, `${run}-result.json`), "utf8"));
  if (
    result.outcome !== "stopped" ||
    result.reason !== failure ||
    result.published !== false ||
    result.databaseWritten !== false
  )
    throw new Error("Seul cet arrêt technique de détourage est récupérable ; aucun refus QA.");
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.runId === run);
  const requests = trace.filter((entry) => entry.type),
    responses = trace.filter((entry) => entry.status !== undefined);
  if (
    trace.length !== 20 ||
    requests.length !== 10 ||
    responses.length !== 10 ||
    new Set(requests.map((entry) => entry.call)).size !== 10
  )
    throw new Error("Trace de génération incomplète ou inspections déjà engagées.");
  const steps = [3, 2].flatMap((stage) =>
    completion.prompts.map((entry) => ({ stage: stage as 2 | 3, ...entry })),
  );
  const raws = requests.map((request, i) => {
    const response = responses[i],
      entry = steps[i];
    if (
      !Number.isSafeInteger(request.call) ||
      request.call < 1 ||
      request.type !== "image" ||
      request.phase !== "cast-completion" ||
      response.phase !== "cast-completion" ||
      response.call !== request.call ||
      response.status !== 200 ||
      response.finishReason !== "STOP" ||
      response.blockReason ||
      JSON.stringify(request.prompts) !==
        JSON.stringify([entry.stage === 3 ? entry.adult : entry.adolescent]) ||
      JSON.stringify(request.referenceSha256) !== "[]"
    )
      throw new Error("Les images archivées ne correspondent pas aux dix descriptions acceptées.");
    const candidates = readdirSync(join(directory, "storage/worldgen/raw")).filter((file) =>
      file.startsWith(`${request.call}-`),
    );
    if (candidates.length !== 1 || !/^\d+-\d+\.png$/.test(candidates[0]))
      throw new Error("Image brute absente ou ambiguë.");
    return `storage/worldgen/raw/${candidates[0]}`;
  });
  const draftPaths = Array.from(
    { length: 10 },
    (_, i) => `cast-completions/${run}-draft-${i}.json`,
  );
  const expected = structuredClone(completion.source);
  for (let slot = 1; slot < 6; slot++) expected.stageArt[slot] = {};
  let draft: CastGrowthDraft = expected;
  draftPaths.forEach((path, i) => {
    draft = JSON.parse(readFileSync(join(directory, path), "utf8"));
    if (i) {
      const entry = steps[i - 1];
      expected.stageArt[entry.slot][entry.stage] = draft.stageArt?.[entry.slot]?.[entry.stage];
    }
    if (
      JSON.stringify(draft) !== JSON.stringify(expected) ||
      refsOf(draft).length !== 8 + i ||
      new Set(refsOf(draft)).size !== 8 + i
    )
      throw new Error("Brouillon modifié : bébés, Vrillou ou étapes de génération différents.");
  });
  return {
    run,
    draft,
    raws,
    steps,
    traceSha256: hash(JSON.stringify(trace)),
    paths: [markerPath, `cast-completions/${run}-result.json`, ...draftPaths, ...raws],
  };
}

/** Offline preparation: verifies all nine saved images against their raw responses, recovers only #10. */
export async function prepareCastRecovery(directory: string, completion: Completion, crop: Crop) {
  const recipePath = join(directory, "cast-completion-recovery.json");
  if (existsSync(recipePath))
    throw new Error("Récupération déjà préparée ; conserver son résultat.");
  const source = readStoppedCompletion(directory, completion);
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  for (let i = 0; i < 9; i++) {
    const step = source.steps[i];
    const replay = await cutoutNewCreature(readFileSync(join(directory, source.raws[i])));
    const normalized = await sharp(replay).png().toBuffer();
    if (!normalized.equals(store.read(source.draft.stageArt[step.slot][step.stage]!)))
      throw new Error("Le dessin enregistré ne correspond plus à la réponse brute.");
  }
  const bytes = await cropFramedCreature(readFileSync(join(directory, source.raws[9])), crop);
  if (
    [...refsOf(source.draft), ...refsOf(completion.source)].some((ref) =>
      store.read(ref).equals(bytes),
    )
  )
    throw new Error("La récupération recopie un ancien dessin.");
  const recoveredRef = await store.write(source.draft.plan.worldIndex, "legendary-ado.png", bytes);
  const draft = structuredClone(source.draft);
  draft.stageArt[5][2] = recoveredRef;
  const folder = "cast-completion-recoveries";
  mkdirSync(join(directory, folder), { recursive: true });
  const path = `${folder}/${randomUUID()}-prepared.json`;
  save(join(directory, path), draft);
  const pins = source.paths.map((path) => ({
    path,
    sha256: hash(readFileSync(join(directory, path))),
  }));
  save(recipePath, {
    version: 1,
    method: "reviewed-white-interior-crop",
    sourceRun: source.run,
    completionSha256: completion.recipeSha256,
    traceSha256: source.traceSha256,
    crop,
    inputs: pins,
    prepared: { path, sha256: hash(readFileSync(join(directory, path))) },
    raw: source.raws[9],
    recoveredRef,
    arts: refsOf(draft).map((ref) => ({ ref, sha256: hash(store.read(ref)) })),
    published: false,
  });
  return loadCastRecovery(directory, completion);
}

/** Read-only pins are revalidated before every paid QA request. Appending the new run's trace is allowed. */
export function loadCastRecovery(directory: string, completion: Completion) {
  const bytes = readFileSync(join(directory, "cast-completion-recovery.json"));
  const recipe = JSON.parse(bytes.toString());
  const source = readStoppedCompletion(directory, completion);
  if (
    recipe.version !== 1 ||
    recipe.method !== "reviewed-white-interior-crop" ||
    recipe.sourceRun !== source.run ||
    recipe.completionSha256 !== completion.recipeSha256 ||
    recipe.traceSha256 !== source.traceSha256 ||
    recipe.raw !== source.raws[9] ||
    recipe.published !== false ||
    !Array.isArray(recipe.inputs) ||
    recipe.inputs.length !== source.paths.length
  )
    throw new Error("Récupération détachée de l’arrêt technique original.");
  source.paths.forEach((path, i) => {
    if (
      recipe.inputs[i]?.path !== path ||
      recipe.inputs[i]?.sha256 !== hash(readFileSync(join(directory, path)))
    )
      throw new Error("Source de récupération modifiée.");
  });
  if (!/^cast-completion-recoveries\/[0-9a-f-]{36}-prepared\.json$/.test(recipe.prepared?.path))
    throw new Error("Chemin du groupe récupéré invalide.");
  const prepared = readFileSync(join(directory, recipe.prepared.path));
  if (hash(prepared) !== recipe.prepared.sha256) throw new Error("Groupe récupéré modifié.");
  const draft: CastGrowthDraft = JSON.parse(prepared.toString());
  const expected = structuredClone(source.draft);
  expected.stageArt[5][2] = recipe.recoveredRef;
  if (
    JSON.stringify(expected) !== JSON.stringify(draft) ||
    refsOf(draft).length !== 18 ||
    new Set(refsOf(draft)).size !== 18 ||
    !Array.isArray(recipe.arts) ||
    recipe.arts.length !== 18
  )
    throw new Error("La récupération doit conserver les dix-sept autres arts exacts.");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  refsOf(draft).forEach((ref, i) => {
    if (recipe.arts[i]?.ref !== ref || recipe.arts[i]?.sha256 !== hash(store.read(ref)))
      throw new Error("Pixels du groupe récupéré modifiés.");
  });
  return {
    draft,
    recipeSha256: hash(bytes),
    sourceRun: source.run,
    preparedPath: recipe.prepared.path as string,
  };
}

/** No generator dependency and no writes: eighteen fresh comparisons, never recycling an old verdict. */
export async function inspectRecoveredCast(
  recovery: ReturnType<typeof loadCastRecovery>,
  deps: Parameters<typeof inspectCompletedCast>[1] & {
    remainingUnits: () => number;
    onDraft: (draft: CastGrowthDraft) => void;
  },
) {
  if (deps.remainingUnits() < CAST_RECOVERY_UNITS)
    throw new Error("Budget insuffisant pour dix-huit inspections.");
  deps.onDraft(recovery.draft);
  return {
    ...(await inspectCompletedCast(recovery.draft, deps)),
    generatedImages: 0,
    reusedImages: 18,
    sourceRun: recovery.sourceRun,
    method: "inspection-only-after-local-crop",
  };
}
