import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { CastGrowthDraft } from "./creature-cast-growth";
import { loadArbeluneStudyAnatomy } from "./pilot-arbelune-study";
import { cropFramedCreature } from "./pilot-cast-recovery";
import { inspectCompletedCast, type loadCastCompletion } from "./pilot-cast-completion";
import { createWorldAssetStore } from "./runtime-assets";

type Completion = ReturnType<typeof loadCastCompletion>;
type Crop = Parameters<typeof cropFramedCreature>[1];
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const save = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const refsOf = (draft: CastGrowthDraft) =>
  draft.artRefs.flatMap((ref, i) => [ref, draft.stageArt[i][2]!, draft.stageArt[i][3]!]);
export const STUDY_INSPECTION_UNITS = 900_000;

/** Visual acceptance pins pixels; it never stands in for identity/growth/content QA. */
function readAcceptedStudy(directory: string, completion: Completion) {
  const basis = loadArbeluneStudyAnatomy(directory, completion);
  const approvalBytes = readFileSync(join(directory, "arbelune-study-visual-approval.json"));
  const approval = JSON.parse(approvalBytes.toString());
  const sourceRun = approval.sourceRun;
  if (
    approval.version !== 1 ||
    !/^[0-9a-f-]{36}$/.test(sourceRun) ||
    approval.basisSha256 !== basis.recipeSha256 ||
    approval.visualApproved !== true ||
    approval.qaPassed !== false ||
    approval.userMessage !== "ok c'est bon"
  )
    throw new Error("Accord visuel sur cette étude absent ou invalide.");
  const read = (path: string, sha: string) => {
    const bytes = readFileSync(join(directory, path));
    if (hash(bytes) !== sha) throw new Error("Source de l’étude acceptée modifiée.");
    return JSON.parse(bytes.toString());
  };
  const marker = read("arbelune-study-anatomy-started.json", approval.markerSha256);
  const result = read(`arbelune-study-anatomies/${sourceRun}-result.json`, approval.resultSha256);
  const pixels = readFileSync(
    join(directory, "arbelune-study-anatomies", `${sourceRun}-study.png`),
  );
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.runId === sourceRun);
  const baby = createWorldAssetStore(join(directory, "storage/generated")).read(
    basis.source.artRefs[5],
  );
  if (
    marker.runId !== sourceRun ||
    marker.studyRecipeSha256 !== basis.recipeSha256 ||
    marker.studySourceRun !== basis.sourceRun ||
    result.sourceRun !== basis.sourceRun ||
    result.method !== "edit-study-anatomy" ||
    result.outcome !== "study-ready-for-visual-review" ||
    result.generatedImages !== 1 ||
    result.proposedStages !== 2 ||
    result.inspections !== 0 ||
    result.qaPassed !== false ||
    result.growthGenerated !== false ||
    result.published !== false ||
    result.databaseWritten !== false ||
    hash(pixels) !== approval.studySha256 ||
    trace.length !== 2 ||
    trace[0]?.type !== "image" ||
    trace[1]?.call !== trace[0]?.call ||
    trace[1]?.status !== 200 ||
    trace[1]?.finishReason !== "STOP" ||
    JSON.stringify(trace[0]?.prompts) !== JSON.stringify([basis.prompt]) ||
    JSON.stringify(trace[0]?.referenceSha256) !==
      JSON.stringify([hash(basis.editImage), hash(baby)]) ||
    hash(JSON.stringify(trace)) !== approval.traceSha256
  )
    throw new Error("L’étude acceptée et sa réponse d’origine doivent rester exactes.");
  return { basis, pixels, sourceRun: sourceRun as string, approvalSha256: hash(approvalBytes) };
}

/** Reviewed crop, existing cutout guard, then centred square with 10% margin. No redrawing. */
export async function extractStudyStage(pixels: Buffer, crop: Crop) {
  const cutout = await cropFramedCreature(pixels, crop);
  const { data, info } = await sharp(cutout)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width,
    top = info.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3]) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
  if (right < left || bottom < top) throw new Error("Stade extrait vide.");
  const width = right - left + 1,
    height = bottom - top + 1;
  const side = Math.ceil(Math.max(width, height) / 0.8);
  const horizontal = side - width,
    vertical = side - height;
  const square = await sharp(cutout)
    .extract({ left, top, width, height })
    .extend({
      left: Math.floor(horizontal / 2),
      right: Math.ceil(horizontal / 2),
      top: Math.floor(vertical / 2),
      bottom: Math.ceil(vertical / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp(square).resize(1024, 1024).png().toBuffer();
}

/** Local preparation only: two new immutable files, sixteen unchanged candidates, no database. */
export async function prepareStudyStages(
  directory: string,
  completion: Completion,
  crops: [Crop, Crop],
) {
  const recipePath = join(directory, "arbelune-study-stages.json");
  if (existsSync(recipePath))
    throw new Error("Stades de l’étude déjà préparés ; conserver les fichiers.");
  const source = readAcceptedStudy(directory, completion);
  if (crops.length !== 2 || crops[0].left + crops[0].width > crops[1].left)
    throw new Error("Les deux zones d’étude doivent être séparées, ado puis adulte.");
  // Validate both crops before writing either candidate.
  const images = [
    await extractStudyStage(source.pixels, crops[0]),
    await extractStudyStage(source.pixels, crops[1]),
  ];
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  const old = refsOf(source.basis.source).map(store.read);
  if (
    images[0].equals(images[1]) ||
    images.some((image) => old.some((bytes) => bytes.equals(image)))
  )
    throw new Error("Un stade extrait recopie un autre art.");
  const draft = structuredClone(source.basis.source);
  draft.stageArt[5][2] = await store.write(draft.plan.worldIndex, "legendary-ado.png", images[0]);
  draft.stageArt[5][3] = await store.write(
    draft.plan.worldIndex,
    "legendary-adulte.png",
    images[1],
  );
  const folder = "arbelune-study-stages";
  mkdirSync(join(directory, folder), { recursive: true });
  const path = `${folder}/${randomUUID()}-prepared.json`;
  save(join(directory, path), draft);
  save(recipePath, {
    version: 1,
    method: "local-study-extraction",
    sourceRun: source.sourceRun,
    approvalSha256: source.approvalSha256,
    crops,
    prepared: { path, sha256: hash(readFileSync(join(directory, path))) },
    arts: refsOf(draft).map((ref) => ({ ref, sha256: hash(store.read(ref)) })),
    published: false,
    qaPassed: false,
  });
  return loadStudyStages(directory, completion);
}

export function loadStudyStages(directory: string, completion: Completion) {
  const source = readAcceptedStudy(directory, completion);
  const bytes = readFileSync(join(directory, "arbelune-study-stages.json"));
  const recipe = JSON.parse(bytes.toString());
  if (
    recipe.version !== 1 ||
    recipe.method !== "local-study-extraction" ||
    recipe.sourceRun !== source.sourceRun ||
    recipe.approvalSha256 !== source.approvalSha256 ||
    recipe.published !== false ||
    recipe.qaPassed !== false ||
    !/^arbelune-study-stages\/[0-9a-f-]{36}-prepared\.json$/.test(recipe.prepared?.path)
  )
    throw new Error("Stades détachés de l’étude acceptée.");
  const prepared = readFileSync(join(directory, recipe.prepared.path));
  if (hash(prepared) !== recipe.prepared.sha256) throw new Error("Groupe extrait modifié.");
  const draft: CastGrowthDraft = JSON.parse(prepared.toString());
  const expected = structuredClone(source.basis.source);
  expected.stageArt[5] = draft.stageArt?.[5];
  if (
    JSON.stringify(expected) !== JSON.stringify(draft) ||
    new Set(refsOf(draft)).size !== 18 ||
    !Array.isArray(recipe.arts) ||
    recipe.arts.length !== 18
  )
    throw new Error("L’extraction doit conserver les seize autres arts exacts.");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  refsOf(draft).forEach((ref, i) => {
    if (recipe.arts[i]?.ref !== ref || recipe.arts[i]?.sha256 !== hash(store.read(ref)))
      throw new Error("Pixels extraits modifiés.");
  });
  return { draft, sourceRun: source.sourceRun, recipeSha256: hash(bytes) };
}

/** Inspect Arbélune first; only its three passing checks unlock the other fifteen. No generator. */
export async function inspectStudyStages(
  stages: ReturnType<typeof loadStudyStages>,
  deps: Parameters<typeof inspectCompletedCast>[1] & {
    remainingUnits: () => number;
    onDraft: (draft: CastGrowthDraft) => void;
  },
) {
  if (deps.remainingUnits() < STUDY_INSPECTION_UNITS)
    throw new Error("Budget insuffisant pour la validation complète du groupe.");
  deps.onDraft(stages.draft);
  return {
    ...(await inspectCompletedCast(stages.draft, deps, 5, 5)),
    method: "inspection-only-priority-lineage",
    generatedImages: 0,
    reusedImages: 18,
    extractedStages: 2,
    sourceRun: stages.sourceRun,
  };
}
