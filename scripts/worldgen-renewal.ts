/** Historical-world candidates only. No seed, migration, family writes or publication. */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import { parseEnv } from "node:util";
import * as schema from "../src/lib/db/schema";
import { loadWorldGenConfig } from "../src/config/server-config";
import { loadRenewalPlan } from "../src/lib/worldgen/creature-renewal";
import { assertNewNames } from "../src/lib/worldgen/creature-design";
import {
  catalogueSheets,
  creatureHistory,
  readCatalogueArt,
  type HistoricalCreature,
} from "../src/lib/worldgen/creature-design-runtime";
import {
  previewCreatureCast,
  repairCreatureCast,
  type CastDraft,
} from "../src/lib/worldgen/creature-cast-preview";
import { loadRenewalBabyRepair } from "../src/lib/worldgen/renewal-baby-repair";
import { loadRenewalGrowth, previewRenewalGrowth } from "../src/lib/worldgen/renewal-growth";
import { loadRenewalGrowthRecovery } from "../src/lib/worldgen/renewal-growth-recovery";
import {
  loadRenewalFaceRepair,
  previewRenewalFaceRepair,
} from "../src/lib/worldgen/renewal-face-repair";
import type { CastGrowthDraft } from "../src/lib/worldgen/creature-cast-growth";
import type { GenerateImageInput } from "../src/lib/worldgen/image-client";
import type { InspectableAsset } from "../src/lib/worldgen/qa";
import { pilotCeilingEur } from "../src/lib/worldgen/pilot-budget";
import { readPilotReservedUnits, readPilotTrace } from "../src/lib/worldgen/pilot-status";
import { createWorldAssetStore, reserveRequest } from "../src/lib/worldgen/runtime-assets";
import { generateImage } from "../src/lib/worldgen/image-client";
import { createVisionInspector } from "../src/lib/worldgen/vision-inspector";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const save = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export async function renewalBabies(options: {
  app: string;
  worldIndex: number;
  qaModel: string;
  planOnly: boolean;
  repair?: boolean;
  growth?: boolean;
  resumeGrowth?: boolean;
  faceRepair?: boolean;
  faceRepairPass?: 1 | 2;
  lock: () => () => void;
  preflight: (key: string, model: string) => Promise<void>;
}) {
  const {
    app,
    worldIndex,
    qaModel,
    planOnly,
    repair = false,
    growth = false,
    resumeGrowth = false,
    faceRepair = false,
    faceRepairPass = 1,
  } = options;
  if (
    (repair && growth) ||
    (resumeGrowth && !growth) ||
    (faceRepair && (!growth || resumeGrowth)) ||
    ![1, 2].includes(faceRepairPass) ||
    (!faceRepair && faceRepairPass !== 1)
  )
    throw new Error("Une seule passe à la fois.");
  const directory = join(app, "data/teddy-world-pilot"),
    storage = join(directory, "storage/generated");
  const facePhase = faceRepairPass === 2 ? "face-repair-2" : "face-repair";
  const phase = `renewal-${worldIndex}-${faceRepair ? facePhase : resumeGrowth ? "growth-resume" : growth ? "growth" : repair ? "baby-repair" : "babies"}`,
    folder = join(directory, "renewal", String(worldIndex));
  const marker = join(
    folder,
    faceRepair
      ? `${facePhase}-started.json`
      : resumeGrowth
        ? "growth-resume-started.json"
        : growth
          ? "growth-started.json"
          : repair
            ? "baby-repair-started.json"
            : "babies-started.json",
  );
  const source = new Database(join(app, "data/multiplyz.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  const copy = new Database(join(directory, "multiplyz.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  let release: (() => void) | undefined;
  try {
    if (!planOnly) release = options.lock();
    if (!planOnly && existsSync(marker))
      throw new Error(
        "Cette passe a déjà été engagée ; conserver les images, le bilan et le budget.",
      );
    const db = drizzle(source, { schema }),
      copyDb = drizzle(copy, { schema });
    const renewal = loadRenewalPlan(app, worldIndex, db);
    const correction = repair ? loadRenewalBabyRepair(directory, renewal) : undefined;
    const older = growth ? loadRenewalGrowth(directory, renewal) : undefined;
    const recovery =
      resumeGrowth && older ? loadRenewalGrowthRecovery(directory, older) : undefined;
    const face = faceRepair ? loadRenewalFaceRepair(directory, renewal, faceRepairPass) : undefined;
    const plan = older?.source.plan ?? correction?.plan ?? renewal.plan;
    const ceiling = pilotCeilingEur(directory),
      remaining = () => ceiling * 1_000_000 - readPilotReservedUnits(directory);
    const historyNow = () => {
      const history = new Map<string, HistoricalCreature>(),
        readers = new Map<string, Buffer>();
      for (const [database, root] of [
        [copyDb, storage],
        [db, join(app, "storage/generated")],
      ] as const)
        for (const creature of creatureHistory(database, root, -1)) {
          history.set(creature.id, creature);
          for (const ref of creature.artRefs)
            readers.set(ref, readCatalogueArt(ref, root, join(app, "public/generated")));
        }
      const cast = renewal.validated.draft;
      cast.artRefs.forEach((ref, i) => {
        const artRefs = [ref, cast.stageArt[i][2]!, cast.stageArt[i][3]!];
        history.set(`accepted-pilot-${i}`, {
          id: `accepted-pilot-${i}`,
          name: cast.plan.creatures[i].name,
          artRefs,
        });
        artRefs.forEach((art) => readers.set(art, createWorldAssetStore(storage).read(art)));
      });
      // Include already produced sibling-world candidates, even when not published.
      for (let index = 0; index < 6; index++) {
        if (index === worldIndex) continue;
        const path = join(directory, "renewal", String(index));
        if (!existsSync(path)) continue;
        const latest = readdirSync(path)
          .filter((f) => /-draft-\d+\.json$/.test(f))
          .map((f) => join(path, f))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
        if (!latest) continue;
        const draft: CastDraft & Partial<CastGrowthDraft> = JSON.parse(
          readFileSync(latest, "utf8"),
        );
        draft.artRefs.forEach((ref, i) => {
          const id = `renewal-${index}-${i}`;
          const artRefs = [ref, ...Object.values(draft.stageArt?.[i] ?? {})];
          history.set(id, { id, name: draft.plan.creatures[i].name, artRefs });
          artRefs.forEach((art) => readers.set(art, createWorldAssetStore(storage).read(art)));
        });
      }
      const list = [...history.values()].sort((a, b) => a.id.localeCompare(b.id));
      return {
        list,
        readers,
        fingerprint: hash(
          JSON.stringify(
            list.map((c) => ({ ...c, pixels: c.artRefs.map((ref) => hash(readers.get(ref)!)) })),
          ),
        ),
      };
    };
    const history = historyNow();
    if (correction && history.fingerprint !== correction.historySha256)
      throw new Error("Historique modifié depuis le lot à corriger.");
    if (older && history.fingerprint !== older.historySha256)
      throw new Error("Historique modifié depuis les bébés approuvés.");
    assertNewNames(
      plan.creatures.map((c) => c.name),
      history.list.map((c) => c.name),
    );
    const guard = () => {
      if (
        renewal.inventoryAt.slice(0, 7) !== new Date().toISOString().slice(0, 7) ||
        pilotCeilingEur(directory) !== ceiling
      )
        throw new Error("Mois ou plafond modifié ; revoir le budget.");
      if (
        loadRenewalPlan(app, worldIndex, db).recipeSha256 !== renewal.recipeSha256 ||
        historyNow().fingerprint !== history.fingerprint
      )
        throw new Error("Sources ou catalogue modifiés pendant la refonte.");
      if (
        correction &&
        loadRenewalBabyRepair(directory, renewal).recipeSha256 !== correction.recipeSha256
      )
        throw new Error("Recette de correction modifiée.");
      if (older && loadRenewalGrowth(directory, renewal).recipeSha256 !== older.recipeSha256)
        throw new Error("Plan des évolutions modifié.");
      if (
        recovery &&
        older &&
        loadRenewalGrowthRecovery(directory, older).recipeSha256 !== recovery.recipeSha256
      )
        throw new Error("Récupération des évolutions modifiée.");
      if (
        face &&
        loadRenewalFaceRepair(directory, renewal, faceRepairPass).recipeSha256 !== face.recipeSha256
      )
        throw new Error("Correction du visage modifiée.");
    };
    guard();
    const reusedOlderStages = recovery?.completedCount ?? 0;
    const images = face
      ? 1
      : older
        ? plan.creatures.length * 2 - reusedOlderStages
        : correction
          ? 1
          : plan.creatures.length;
    const inspections = older ? plan.creatures.length * 3 : plan.creatures.length;
    const cost = images * 100_000 + inspections * 50_000;
    console.log(
      JSON.stringify(
        {
          mode: phase + (planOnly ? "-plan-sans-api" : ""),
          worldIndex,
          names: face
            ? [plan.creatures[face.slot].name]
            : correction
              ? [plan.creatures[correction.slot].name]
              : plan.creatures.map((c) => c.name),
          images,
          reusedImages: face
            ? plan.creatures.length * 3 - 1
            : older
              ? plan.creatures.length + reusedOlderStages
              : correction
                ? plan.creatures.length - 1
                : 0,
          ...(recovery ? { reusedOlderStages, interruptedRun: recovery.sourceRun } : {}),
          inspections,
          ...(older
            ? {
                method: face ? "adult-face-edit" : "description-only-growth",
                generationReferences: face ? 1 : 0,
                readableFaceRequired: true,
              }
            : {}),
          ...(face
            ? { firstInspections: 3, remainingInspectionsOnlyIfLineagePasses: inspections - 3 }
            : {}),
          ...(correction
            ? {
                firstInspections: 1,
                remainingInspectionsOnlyIfRepairPasses: plan.creatures.length - 1,
              }
            : {}),
          growthGenerated: false,
          reservedEur: readPilotReservedUnits(directory) / 1_000_000,
          plannedAdditionalEur: cost / 1_000_000,
          plannedCumulativeEur: (readPilotReservedUnits(directory) + cost) / 1_000_000,
          ceilingEur: ceiling,
          published: false,
          databaseWritten: false,
        },
        null,
        2,
      ),
    );
    if (remaining() < cost)
      throw new Error("Budget insuffisant pour toutes les images et leurs inspections.");
    if (planOnly) return;
    const oldEnv = join(app, "../multiplyz/.env");
    const apiKey =
      process.env.GEMINI_API_KEY ||
      (existsSync(oldEnv) ? parseEnv(readFileSync(oldEnv, "utf8")).GEMINI_API_KEY : undefined);
    if (!apiKey) throw new Error("GEMINI_API_KEY absente.");
    const imageModel = "gemini-2.5-flash-image";
    await options.preflight(apiKey, imageModel);
    await options.preflight(apiKey, qaModel);
    const historicalSheets = await catalogueSheets(history.list, (ref) =>
      history.readers.get(ref)!,
    );
    guard();
    mkdirSync(folder, { recursive: true });
    const runId = randomUUID(),
      prefix = join(folder, runId);
    const preview = join(directory, `preview-${phase}-${runId}.html`);
    save(marker, {
      runId,
      at: new Date().toISOString(),
      recipeSha256: renewal.recipeSha256,
      ...(correction
        ? { correctionRecipeSha256: correction.recipeSha256, sourceRun: correction.sourceRun }
        : {}),
      ...(older ? { growthRecipeSha256: older.recipeSha256, sourceRun: older.sourceRun } : {}),
      ...(face
        ? {
            faceRecipeSha256: face.recipeSha256,
            sourceRun: face.sourceRun,
            repairedSlot: face.slot,
          }
        : {}),
      ...(recovery
        ? {
            recoveryRecipeSha256: recovery.recipeSha256,
            interruptedRun: recovery.sourceRun,
            reusedOlderStages,
          }
        : {}),
      validatedCastApprovalSha256: renewal.validated.approvalSha256,
      mapping: renewal.mapping,
      historySha256: history.fingerprint,
      reservedUnits: readPilotReservedUnits(directory),
    });
    let call = Math.max(0, ...readPilotTrace(directory).map((e) => e.call)),
      imageCount = 0,
      checkCount = 0;
    const config = { ...loadWorldGenConfig({}), maxRetries: 0, monthlyBudgetEur: ceiling };
    const fetchImpl: typeof fetch = async (input, init) => {
      guard();
      const body = JSON.parse(String(init?.body)),
        isImage = !!body.generationConfig?.responseModalities;
      if ((isImage ? imageCount++ : checkCount++) >= (isImage ? images : inspections))
        throw new Error("Nombre maximal d’appels de cette passe atteint.");
      const amount = isImage ? 0.1 : 0.05;
      if (remaining() < amount * 1_000_000) throw new Error("Plafond cumulé atteint.");
      reserveRequest(join(directory, "storage/worldgen/budget"), amount, ceiling, new Date());
      const id = ++call;
      const record = (entry: object) =>
        appendFileSync(
          join(directory, "requests.jsonl"),
          JSON.stringify({ call: id, runId, phase, at: new Date().toISOString(), ...entry }) + "\n",
        );
      const parts = body.contents[0].parts as { text?: string; inlineData?: { data: string } }[];
      record({
        type: isImage ? "image" : "vision",
        model: isImage ? imageModel : qaModel,
        prompts: parts.flatMap((p) => (p.text ? [p.text] : [])),
        referenceSha256: parts.flatMap((p) =>
          p.inlineData ? [hash(Buffer.from(p.inlineData.data, "base64"))] : [],
        ),
      });
      console.log(
        `[refonte] Appel ${id} · ${isImage ? (older ? "évolution" : "bébé") : "identité, milieu et originalité"}…`,
      );
      const heartbeat = setInterval(
        () => console.log(`[refonte] Appel ${id} · Gemini travaille encore…`),
        15_000,
      );
      try {
        const response = await fetch(input, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(120_000),
        });
        const output = await response
            .clone()
            .json()
            .catch(() => null),
          candidate = output?.candidates?.[0];
        for (const [i, p] of (candidate?.content?.parts ?? []).entries())
          if (p.inlineData?.data)
            writeFileSync(
              join(
                directory,
                `storage/worldgen/raw/${id}-${i}.${p.inlineData.mimeType === "image/png" ? "png" : "bin"}`,
              ),
              Buffer.from(p.inlineData.data, "base64"),
              { flag: "wx" },
            );
        record({
          status: response.status,
          finishReason: candidate?.finishReason,
          blockReason: output?.promptFeedback?.blockReason,
          responseId: output?.responseId,
        });
        console.log(`[refonte] Réponse reçue (HTTP ${response.status}).`);
        return response;
      } finally {
        clearInterval(heartbeat);
      }
    };
    const store = createWorldAssetStore(storage);
    let checkpoint = 0,
      checked = 0;
    const render = (draft: CastDraft) => {
      if (older) {
        const stages = (draft as CastGrowthDraft).stageArt;
        const cards = draft.artRefs
          .map(
            (baby, i) =>
              `<article><h2>${escape(draft.plan.creatures[i].name)}</h2><div class="ages">${[baby, stages[i][2], stages[i][3]].map((ref, age) => `<figure>${ref ? `<img src="${relative(directory, join(storage, ref))}" alt="${escape(draft.plan.creatures[i].name)} ${["bébé", "ado", "adulte"][age]}">` : '<div class="pending">À produire</div>'}<figcaption>${["Bébé conservé", "Ado", "Adulte"][age]}</figcaption></figure>`).join("")}</div></article>`,
          )
          .join("");
        writeFileSync(
          preview,
          `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TEDDy · Monde ${worldIndex} · Trois âges</title><style>body{max-width:1100px;margin:2rem auto;padding:1rem;background:#f4f0e5;color:#263e37;font:18px system-ui}article{background:white;border-radius:16px;padding:1rem;margin:1rem 0}.ages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem}figure{margin:0;text-align:center}img,.pending{width:100%;height:260px;object-fit:contain}.pending{display:grid;place-content:center;background:#eee;border-radius:12px}figcaption{padding:.7rem}@media(max-width:600px){img,.pending{height:150px}figcaption{padding:.3rem;font-size:14px}}</style><h1>Les trois âges du monde ${worldIndex}</h1><p>Sept bébés conservés, nouvelles évolutions à examiner. Consulter le bilan des inspections. Aucun compagnon remplacé dans le jeu.</p><main>${cards}</main></html>`,
          { flag: existsSync(preview) ? "w" : "wx" },
        );
        return;
      }
      const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TEDDy · Monde ${worldIndex}</title><style>body{max-width:1100px;margin:2rem auto;padding:1rem;background:#f4f0e5;color:#263e37;font:18px system-ui}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}article{background:white;border-radius:16px;padding:1rem}img{width:100%;height:240px;object-fit:contain}</style><h1>Les nouveaux habitants du monde ${worldIndex}</h1><p>Bébés à examiner. Évolutions à produire après examen des identités. Aucun compagnon remplacé dans le jeu ; consulter le bilan des inspections.</p><main>${draft.artRefs.map((ref, i) => `<article><h2>${escape(draft.plan.creatures[i].name)}</h2><img src="${relative(directory, join(storage, ref))}" alt="${escape(draft.plan.creatures[i].name)} bébé"><p>${escape(draft.plan.creatures[i].story)}</p></article>`).join("")}</main></html>`;
      writeFileSync(preview, html, { flag: existsSync(preview) ? "w" : "wx" });
    };
    try {
      const dependencies = {
        config,
        remainingUnits: remaining,
        generate: (input: GenerateImageInput) =>
          generateImage(input, { config, apiKey, model: imageModel, fetchImpl }),
        onImage: (draft: CastDraft) => {
          save(`${prefix}-draft-${++checkpoint}.json`, draft);
          render(draft);
        },
        onDraft: (draft: CastDraft) => {
          if (older) {
            const stages = (draft as CastGrowthDraft).stageArt;
            checkpoint = stages.reduce((n, s) => n + Object.keys(s).length, 0);
            save(`${prefix}-draft-${checkpoint}.json`, draft);
            render(draft);
            if (checkpoint !== plan.creatures.length * 2) return;
          }
          save(`${prefix}-draft.json`, draft);
        },
        onCheck: (check: unknown) => save(`${prefix}-check-${++checked}.json`, check),
        inspect: async (asset: InspectableAsset, draft: CastDraft) => {
          const stages = (draft as Partial<CastGrowthDraft>).stageArt;
          const slot = draft.artRefs.findIndex(
            (ref, i) => ref === asset.ref || Object.values(stages?.[i] ?? {}).includes(asset.ref),
          );
          if (slot < 0) throw new Error("Image hors du groupe prévu.");
          const peers = await catalogueSheets(
            draft.artRefs.flatMap((ref, i) =>
              i === slot
                ? []
                : [
                    {
                      id: `new-${i}`,
                      name: draft.plan.creatures[i].name,
                      artRefs: [ref, ...Object.values(stages?.[i] ?? {})],
                    },
                  ],
            ),
            store.read,
          );
          return createVisionInspector({
            apiKey,
            model: qaModel,
            style: config.prompts.style,
            readAsset: store.read,
            readMaster: () => {
              throw new Error("Teddy est conservé.");
            },
            fetchImpl,
            designContext: async () => ({
              brief: JSON.stringify(
                older
                  ? {
                      habitat: draft.plan.habitat,
                      name: draft.plan.creatures[slot].name,
                      story: draft.plan.creatures[slot].story,
                      adaptation: draft.plan.creatures[slot].adaptation,
                      role: draft.plan.creatures[slot].role,
                      reviewedAgeDescriptions: older.prompts[slot],
                      ...(face && slot === face.slot ? { adultFaceCorrection: face.prompt } : {}),
                    }
                  : { habitat: draft.plan.habitat, ...draft.plan.creatures[slot] },
              ),
              sheets: [...historicalSheets, ...peers],
            }),
          })(asset);
        },
      };
      const result = face
        ? await previewRenewalFaceRepair(face, storage, dependencies)
        : older
          ? await previewRenewalGrowth(older, storage, dependencies, recovery?.draft)
          : correction
            ? await repairCreatureCast(
                correction.source,
                plan,
                correction.slot,
                storage,
                dependencies,
              )
            : await previewCreatureCast(plan, storage, dependencies);
      guard();
      save(`${prefix}-result.json`, {
        ...result,
        preview,
        mapping: renewal.mapping,
        reservedEur: readPilotReservedUnits(directory) / 1_000_000,
        databaseWritten: false,
        ...(correction ? { sourceRun: correction.sourceRun, repairedSlot: correction.slot } : {}),
        ...(older ? { sourceRun: older.sourceRun } : {}),
        ...(face ? { sourceRun: face.sourceRun, faceRecipeSha256: face.recipeSha256 } : {}),
        ...(recovery
          ? { interruptedRun: recovery.sourceRun, recoveryRecipeSha256: recovery.recipeSha256 }
          : {}),
      });
      console.log(JSON.stringify({ ...result, bilan: `${prefix}-result.json`, preview }, null, 2));
      if (result.outcome !== "passed-for-visual-review") process.exitCode = 1;
    } catch (error) {
      const reason = (error instanceof Error ? error.message : "Passe interrompue.").replaceAll(
        apiKey,
        "<REDACTED>",
      );
      save(`${prefix}-result.json`, {
        outcome: "stopped",
        reason,
        imagesSaved: checkpoint,
        inspectionsSaved: checked,
        ...(recovery
          ? {
              reusedOlderStages,
              newlySavedImages: Math.max(0, checkpoint - reusedOlderStages),
              interruptedRun: recovery.sourceRun,
            }
          : {}),
        preview: existsSync(preview) ? preview : null,
        reservedEur: readPilotReservedUnits(directory) / 1_000_000,
        published: false,
        databaseWritten: false,
      });
      console.error(`Bilan conservé : ${prefix}-result.json`);
      throw new Error(reason);
    }
  } finally {
    release?.();
    source.close();
    copy.close();
  }
}
