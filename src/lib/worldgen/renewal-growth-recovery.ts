import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { loadRenewalGrowth } from "./renewal-growth";
import type { CastGrowthDraft } from "./creature-cast-growth";
import { cutoutNewCreature } from "./creature-growth";
import { cropFramedCreature } from "./pilot-cast-recovery";
import { createWorldAssetStore } from "./runtime-assets";

type Growth = ReturnType<typeof loadRenewalGrowth>;
type Crop = Parameters<typeof cropFramedCreature>[1];
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const save = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const refsOf = (draft: CastGrowthDraft) =>
  draft.artRefs.flatMap((ref, i) => [ref, ...Object.values(draft.stageArt[i])]);
const failures = [
  "Détourage non fiable : inspecter le fond et la silhouette.",
  "Détourage non fiable : le fond doit être blanc et dégagé aux bords.",
];

/** Remove only bright neutral pixels on a manually reviewed frame. Coloured anatomy stays intact. */
export async function removeReviewedNeutralFrame(
  raw: Buffer,
  frame: { left: number; top: number; width: number; height: number; thickness: number },
) {
  const { data, info } = await sharp(raw).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (
    !Object.values(frame).every(Number.isSafeInteger) ||
    frame.left < 0 ||
    frame.top < 0 ||
    frame.width < 32 ||
    frame.height < 32 ||
    frame.thickness < 1 ||
    frame.thickness > 8 ||
    frame.left + frame.width > info.width ||
    frame.top + frame.height > info.height
  )
    throw new Error("Cadre de correction invalide.");
  let changed = 0;
  for (let y = frame.top; y < frame.top + frame.height; y++)
    for (let x = frame.left; x < frame.left + frame.width; x++) {
      if (
        x >= frame.left + frame.thickness &&
        x < frame.left + frame.width - frame.thickness &&
        y >= frame.top + frame.thickness &&
        y < frame.top + frame.height - frame.thickness
      )
        continue;
      const i = (y * info.width + x) * 3;
      const lo = Math.min(data[i], data[i + 1], data[i + 2]),
        hi = Math.max(data[i], data[i + 1], data[i + 2]);
      if (lo < 180 || hi - lo > 8 || lo === 255) continue;
      data[i] = data[i + 1] = data[i + 2] = 255;
      changed++;
    }
  if (!changed) throw new Error("Aucun pixel de cadre corrigé.");
  return cutoutNewCreature(await sharp(data, { raw: info }).png().toBuffer());
}

/** Only the completed prefix of a generation interrupted at cutout, before any QA. */
function stoppedGrowth(directory: string, growth: Growth) {
  const index = growth.source.plan.worldIndex;
  const folder = `renewal/${index}`;
  const markerPath = `${folder}/growth-started.json`;
  const marker = JSON.parse(readFileSync(join(directory, markerPath), "utf8"));
  const run = marker.runId;
  if (
    !/^[0-9a-f-]{36}$/.test(run) ||
    marker.growthRecipeSha256 !== growth.recipeSha256 ||
    marker.sourceRun !== growth.sourceRun ||
    marker.historySha256 !== growth.historySha256
  )
    throw new Error("Source de récupération différente de la passe prévue.");
  const resultPath = `${folder}/${run}-result.json`;
  const result = JSON.parse(readFileSync(join(directory, resultPath), "utf8"));
  if (
    result.outcome !== "stopped" ||
    !failures.includes(result.reason) ||
    !Number.isInteger(result.imagesSaved) ||
    result.imagesSaved < 0 ||
    result.inspectionsSaved !== 0 ||
    result.published !== false ||
    result.databaseWritten !== false
  )
    throw new Error("Seul un arrêt technique de détourage avant la QA est récupérable.");
  const count = result.imagesSaved + 1;
  const steps = ([3, 2] as const).flatMap((stage) =>
    growth.prompts.map((entry) => ({ stage, ...entry })),
  );
  if (count > steps.length) throw new Error("Nombre d’images récupérables invalide.");
  const draftPaths = Array.from({ length: count }, (_, i) => `${folder}/${run}-draft-${i}.json`);
  const expectedFiles = [
    ...draftPaths.map((p) => p.slice(folder.length + 1)),
    `${run}-result.json`,
  ].sort();
  const files = readdirSync(join(directory, folder))
    .filter((f) => f.startsWith(`${run}-`))
    .sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles))
    throw new Error("Brouillons ou inspections inattendus pour la récupération.");
  const trace = readFileSync(join(directory, "requests.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.runId === run);
  if (trace.length !== count * 2) throw new Error("Trace de génération incomplète.");
  const seen = new Set<number>();
  const raws = Array.from({ length: count }, (_, i) => {
    const request = trace[i * 2],
      response = trace[i * 2 + 1],
      step = steps[i];
    if (
      !Number.isSafeInteger(request.call) ||
      request.call < 1 ||
      seen.has(request.call) ||
      request.type !== "image" ||
      request.phase !== `renewal-${index}-growth` ||
      response.call !== request.call ||
      response.status !== 200 ||
      response.finishReason !== "STOP" ||
      response.blockReason ||
      JSON.stringify(request.referenceSha256) !== "[]" ||
      JSON.stringify(request.prompts) !==
        JSON.stringify([step.stage === 3 ? step.adult : step.adolescent])
    )
      throw new Error("Réponse brute détachée des descriptions de la passe arrêtée.");
    seen.add(request.call);
    const raw = readdirSync(join(directory, "storage/worldgen/raw")).filter((f) =>
      f.startsWith(`${request.call}-`),
    );
    if (raw.length !== 1 || !/^\d+-\d+\.png$/.test(raw[0]))
      throw new Error("Image brute absente ou ambiguë.");
    return `storage/worldgen/raw/${raw[0]}`;
  });
  const expected: CastGrowthDraft = {
    ...structuredClone(growth.source),
    stageArt: growth.source.artRefs.map(() => ({})),
  };
  let draft = expected;
  draftPaths.forEach((path, i) => {
    draft = JSON.parse(readFileSync(join(directory, path), "utf8"));
    if (i) {
      const step = steps[i - 1];
      const ref = draft.stageArt?.[step.slot]?.[step.stage];
      if (typeof ref !== "string") throw new Error("Stade enregistré absent.");
      expected.stageArt[step.slot][step.stage] = ref;
    }
    if (
      JSON.stringify(draft) !== JSON.stringify(expected) ||
      refsOf(draft).length !== growth.source.artRefs.length + i ||
      new Set(refsOf(draft)).size !== refsOf(draft).length
    )
      throw new Error("Le groupe arrêté ne conserve pas les bébés et le préfixe généré.");
  });
  return {
    run: run as string,
    folder,
    count,
    draft,
    raws,
    steps,
    failure: result.reason as string,
    paths: [markerPath, resultPath, ...draftPaths, ...raws],
    traceSha256: hash(JSON.stringify(trace)),
  };
}

/** Offline, explicit crop only. General cutout guards are unchanged. All saved ages are replayed first. */
export async function prepareRenewalGrowthRecovery(directory: string, growth: Growth, crop: Crop) {
  const path = join(
    directory,
    "renewal",
    String(growth.source.plan.worldIndex),
    "growth-recovery.json",
  );
  if (existsSync(path)) throw new Error("Récupération déjà préparée ; conserver son résultat.");
  const source = stoppedGrowth(directory, growth);
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  for (let i = 0; i < source.count - 1; i++) {
    const replay = await sharp(
      await cutoutNewCreature(readFileSync(join(directory, source.raws[i]))),
    )
      .png()
      .toBuffer();
    const step = source.steps[i];
    if (!replay.equals(store.read(source.draft.stageArt[step.slot][step.stage]!)))
      throw new Error("Le dessin enregistré diffère de sa réponse brute.");
  }
  const raw = readFileSync(join(directory, source.raws[source.count - 1]));
  let error: string | undefined;
  try {
    await cutoutNewCreature(raw);
  } catch (e) {
    error = e instanceof Error ? e.message : "unknown";
  }
  if (error !== source.failure)
    throw new Error("L’erreur de détourage source n’est pas reproduite.");
  const bytes = await cropFramedCreature(raw, crop);
  if (refsOf(source.draft).some((ref) => bytes.equals(store.read(ref))))
    throw new Error("La récupération recopie un compagnon existant.");
  const step = source.steps[source.count - 1];
  const name =
    step.slot === growth.source.artRefs.length - 1 ? "legendary" : `creature-${step.slot}`;
  const recoveredRef = await store.write(
    growth.source.plan.worldIndex,
    `${name}-${step.stage === 3 ? "adulte" : "ado"}.png`,
    bytes,
  );
  const draft = structuredClone(source.draft);
  draft.stageArt[step.slot][step.stage] = recoveredRef;
  const output = `${source.folder}/growth-recoveries/${randomUUID()}-prepared.json`;
  mkdirSync(join(directory, source.folder, "growth-recoveries"), { recursive: true });
  save(join(directory, output), draft);
  save(path, {
    version: 1,
    method: "reviewed-white-interior-crop",
    growthRecipeSha256: growth.recipeSha256,
    sourceRun: source.run,
    traceSha256: source.traceSha256,
    crop,
    completedCount: source.count,
    raw: source.raws[source.count - 1],
    recoveredRef,
    inputs: source.paths.map((path) => ({
      path,
      sha256: hash(readFileSync(join(directory, path))),
    })),
    prepared: { path: output, sha256: hash(readFileSync(join(directory, output))) },
    arts: refsOf(draft).map((ref) => ({ ref, sha256: hash(store.read(ref)) })),
    published: false,
  });
  return loadRenewalGrowthRecovery(directory, growth);
}

export function loadRenewalGrowthRecovery(directory: string, growth: Growth) {
  const source = stoppedGrowth(directory, growth);
  const bytes = readFileSync(join(directory, source.folder, "growth-recovery.json"));
  const recipe = JSON.parse(bytes.toString());
  if (
    recipe.version !== 1 ||
    recipe.method !== "reviewed-white-interior-crop" ||
    recipe.growthRecipeSha256 !== growth.recipeSha256 ||
    recipe.sourceRun !== source.run ||
    recipe.traceSha256 !== source.traceSha256 ||
    recipe.completedCount !== source.count ||
    recipe.raw !== source.raws[source.count - 1] ||
    recipe.published !== false ||
    recipe.inputs?.length !== source.paths.length
  )
    throw new Error("Récupération détachée de l’arrêt original.");
  source.paths.forEach((path, i) => {
    if (
      recipe.inputs[i]?.path !== path ||
      recipe.inputs[i]?.sha256 !== hash(readFileSync(join(directory, path)))
    )
      throw new Error("Source de récupération modifiée.");
  });
  if (
    typeof recipe.prepared?.path !== "string" ||
    !new RegExp(`^${source.folder}/growth-recoveries/[0-9a-f-]{36}-prepared\\.json$`).test(
      recipe.prepared.path,
    )
  )
    throw new Error("Chemin du groupe récupéré invalide.");
  const prepared = readFileSync(join(directory, recipe.prepared.path));
  if (hash(prepared) !== recipe.prepared.sha256) throw new Error("Groupe récupéré modifié.");
  const draft: CastGrowthDraft = JSON.parse(prepared.toString());
  const expected = structuredClone(source.draft),
    step = source.steps[source.count - 1];
  expected.stageArt[step.slot][step.stage] = recipe.recoveredRef;
  const refs = refsOf(draft),
    store = createWorldAssetStore(join(directory, "storage/generated"));
  if (
    JSON.stringify(draft) !== JSON.stringify(expected) ||
    refs.length !== growth.source.artRefs.length + source.count ||
    new Set(refs).size !== refs.length ||
    recipe.arts?.length !== refs.length
  )
    throw new Error("La récupération doit conserver tous les autres arts exacts.");
  refs.forEach((ref, i) => {
    if (recipe.arts[i]?.ref !== ref || recipe.arts[i]?.sha256 !== hash(store.read(ref)))
      throw new Error("Pixels du groupe récupéré modifiés.");
  });
  // A separate reviewed matte repair preserves the initial recovery and all original files.
  const mattePath = join(directory, source.folder, "growth-matte-repair.json");
  const matteBytes = existsSync(mattePath) ? readFileSync(mattePath) : undefined;
  if (matteBytes) {
    const matte = JSON.parse(matteBytes.toString());
    if (
      matte.version !== 1 ||
      matte.method !== "reviewed-neutral-frame" ||
      matte.sourceRecoverySha256 !== hash(bytes) ||
      matte.published !== false ||
      !Number.isSafeInteger(matte.slot) ||
      matte.stage !== 3 ||
      matte.slot < 0 ||
      matte.slot >= source.count - 1 ||
      matte.sourceRef !== draft.stageArt[matte.slot][3] ||
      matte.raw !== source.raws[matte.slot] ||
      matte.rawSha256 !== hash(readFileSync(join(directory, matte.raw))) ||
      typeof matte.ref !== "string" ||
      refs.includes(matte.ref) ||
      matte.sha256 !== hash(store.read(matte.ref))
    )
      throw new Error("Correction du fond détachée du groupe récupéré.");
    draft.stageArt[matte.slot][3] = matte.ref;
  }
  return {
    draft,
    completedCount: source.count,
    sourceRun: source.run,
    recipeSha256: matteBytes ? hash(Buffer.concat([bytes, matteBytes])) : hash(bytes),
    preparedPath: recipe.prepared.path as string,
  };
}
