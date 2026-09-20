/** Review six new identities within the existing pilot budget; no world/character DB writes. */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { parseEnv } from "node:util";
import * as schema from "../src/lib/db/schema";
import { loadWorldGenConfig } from "../src/config/server-config";
import { validateCreatureDesign } from "../src/lib/worldgen/creature-design";
import {
  catalogueSheets,
  creatureHistory,
  readCatalogueArt,
} from "../src/lib/worldgen/creature-design-runtime";
import { previewCastGrowth, type CastGrowthDraft } from "../src/lib/worldgen/creature-cast-growth";
import { loadApprovedCast } from "../src/lib/worldgen/pilot-approved-cast";
import { loadCastRedesign } from "../src/lib/worldgen/pilot-cast-redesign";
import {
  GROWTH_ADOLESCENT_UNITS,
  loadAdolescentProof,
  loadClarifiedAdolescentProof,
  previewAdolescentGrowthProof,
} from "../src/lib/worldgen/pilot-growth-adolescent";
import {
  GROWTH_PROOF_UNITS,
  loadGrowthProof,
  previewAdultGrowthProof,
} from "../src/lib/worldgen/pilot-growth-proof";
import { pilotCeilingEur } from "../src/lib/worldgen/pilot-budget";
import {
  CAST_COMPLETION_UNITS,
  loadCastCompletion,
  previewCastCompletion,
} from "../src/lib/worldgen/pilot-cast-completion";
import {
  CAST_RECOVERY_UNITS,
  loadCastRecovery,
  inspectRecoveredCast,
} from "../src/lib/worldgen/pilot-cast-recovery";
import {
  ARBELUNE_REPAIR_UNITS,
  ARBELUNE_ADOLESCENT_UNITS,
  loadArbeluneAdolescent,
  previewArbeluneAdolescent,
  loadArbeluneRepair,
  previewArbeluneRepair,
} from "../src/lib/worldgen/pilot-arbelune-repair";
import {
  ARBELUNE_STUDY_UNITS,
  loadArbeluneStudy,
  loadArbeluneStudyAnatomy,
  previewArbeluneStudy,
} from "../src/lib/worldgen/pilot-arbelune-study";
import {
  loadStudyStages,
  inspectStudyStages,
  STUDY_INSPECTION_UNITS,
} from "../src/lib/worldgen/pilot-study-stages";
import type { CastDraft } from "../src/lib/worldgen/creature-cast-preview";
import type { InspectableAsset } from "../src/lib/worldgen/qa";
import { previewCreatureCast } from "../src/lib/worldgen/creature-cast-preview";
import { createVisionInspector } from "../src/lib/worldgen/vision-inspector";
import { generateImage } from "../src/lib/worldgen/image-client";
import { createWorldAssetStore, reserveRequest } from "../src/lib/worldgen/runtime-assets";
import { readPilotReservedUnits, readPilotTrace } from "../src/lib/worldgen/pilot-status";
import { assertFutureWorld, futureWorldTheme } from "../src/lib/worldgen/future-worlds";

const save = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export async function castPreview(options: {
  app: string;
  qaModel: string;
  planOnly: boolean;
  growth?: boolean;
  redesign?: boolean;
  proof?: boolean;
  adolescent?: boolean;
  clarify?: boolean;
  complete?: boolean;
  recover?: boolean;
  arbelune?: boolean;
  arbeluneAdolescent?: boolean;
  arbeluneStudy?: boolean;
  arbeluneStudyAnatomy?: boolean;
  arbeluneStudyInspect?: boolean;
  lock: () => () => void;
  preflight: (key: string, model: string) => Promise<void>;
}) {
  const {
    app,
    qaModel,
    planOnly,
    growth = false,
    redesign = false,
    proof = false,
    adolescent = false,
    clarify = false,
    complete = false,
    recover = false,
    arbelune = false,
    arbeluneAdolescent = false,
    arbeluneStudy = false,
    arbeluneStudyAnatomy = false,
    arbeluneStudyInspect = false,
  } = options;
  const single = proof || adolescent;
  const directory = join(app, "data/teddy-world-pilot");
  const storage = join(directory, "storage/generated");
  if (recover && !complete) throw new Error("La récupération nécessite le groupe complet.");
  if (arbelune && (!complete || recover))
    throw new Error("Correction ciblée incompatible avec ce mode.");
  if (arbeluneAdolescent && !arbelune) throw new Error("L’ado ciblé nécessite le mode Arbélune.");
  if (arbeluneStudy && (!arbelune || arbeluneAdolescent))
    throw new Error("Étude incompatible avec ce mode.");
  if (arbeluneStudyAnatomy && !arbeluneStudy)
    throw new Error("La correction anatomique nécessite le mode étude.");
  if (arbeluneStudyInspect && (!arbelune || arbeluneStudy || recover || arbeluneAdolescent))
    throw new Error("Inspection des stades incompatible avec ce mode.");
  const phase = arbeluneStudyInspect
    ? "arbelune-study-inspect"
    : arbeluneStudyAnatomy
      ? "arbelune-study-anatomy"
      : arbeluneStudy
        ? "arbelune-study"
        : arbeluneAdolescent
          ? "arbelune-adolescent"
          : arbelune
            ? "arbelune-repair"
            : recover
              ? "cast-completion-inspect"
              : complete
                ? "cast-completion"
                : clarify
                  ? "growth-adolescent-clarification"
                  : adolescent
                    ? "growth-adolescent"
                    : proof
                      ? "growth-proof"
                      : redesign
                        ? "cast-redesign"
                        : growth
                          ? "cast-growth"
                          : "cast-preview";
  const marker = join(directory, `${phase}-started.json`);
  const ceiling = pilotCeilingEur(directory);
  const growthPlanPath = join(
    app,
    "docs/playthroughs/teddy-creature-diversity/approved-magic-growth.json",
  );
  const approved = growth ? loadApprovedCast(directory, growthPlanPath) : undefined;
  const revision =
    (redesign || single || complete) && approved
      ? loadCastRedesign(directory, approved)
      : undefined;
  const completion = complete && approved ? loadCastCompletion(directory, approved) : undefined;
  if (complete && !completion) throw new Error("La passe nécessite la lignée validée.");
  const recovery = recover && completion ? loadCastRecovery(directory, completion) : undefined;
  const repair = arbelune && completion ? loadArbeluneRepair(directory, completion) : undefined;
  const middle =
    arbeluneAdolescent && completion ? loadArbeluneAdolescent(directory, completion) : undefined;
  const loadStudy = () =>
    arbeluneStudyAnatomy
      ? loadArbeluneStudyAnatomy(directory, completion!)
      : loadArbeluneStudy(directory, completion!);
  const study = arbeluneStudy && completion ? loadStudy() : undefined;
  const studyStages =
    arbeluneStudyInspect && completion ? loadStudyStages(directory, completion) : undefined;
  const loadExperiment = () =>
    clarify
      ? loadClarifiedAdolescentProof(directory, approved!)
      : adolescent
        ? loadAdolescentProof(directory, approved!)
        : loadGrowthProof(directory, approved!);
  const experiment = single && approved ? loadExperiment() : undefined;
  if (single && !experiment) throw new Error("L’essai nécessite les bébés approuvés.");
  if (redesign && !revision) throw new Error("La refonte nécessite les bébés approuvés.");
  if (!planOnly && existsSync(marker))
    throw new Error(
      "Cette passe de faune a déjà démarré ; conserver son bilan, ses images et son budget.",
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
    const activeDb = drizzle(source, { schema }),
      copyDb = drizzle(copy, { schema });
    const target = JSON.parse(readFileSync(join(directory, "started.json"), "utf8"));
    const historyNow = () => {
      const combined = new Map(creatureHistory(copyDb, storage, -1).map((c) => [c.id, c]));
      for (const c of creatureHistory(activeDb, join(app, "storage/generated"), -1))
        combined.set(c.id, c);
      return [...combined.values()];
    };
    const history = historyNow();
    const historySnapshot = JSON.stringify(history);
    const guard = () => {
      if (target.at?.slice(0, 7) !== new Date().toISOString().slice(0, 7))
        throw new Error("Changement de mois : réexaminer le budget cumulé.");
      assertFutureWorld(activeDb, target.target);
      assertFutureWorld(copyDb, target.target);
      if (JSON.stringify(historyNow()) !== historySnapshot)
        throw new Error("Catalogue modifié pendant la passe ; comparaison à réexaminer.");
      if (growth) loadApprovedCast(directory, growthPlanPath);
      if (revision && loadCastRedesign(directory, approved!).recipeSha256 !== revision.recipeSha256)
        throw new Error("Consignes de refonte modifiées pendant la passe.");
      if (experiment && loadExperiment().recipeSha256 !== experiment.recipeSha256)
        throw new Error("Consignes de l’essai modifiées pendant la passe.");
      if (
        completion &&
        loadCastCompletion(directory, approved!).recipeSha256 !== completion.recipeSha256
      )
        throw new Error("Lignée ou descriptions modifiées pendant la passe.");
      if (
        recovery &&
        loadCastRecovery(directory, completion!).recipeSha256 !== recovery.recipeSha256
      )
        throw new Error("Sources de la récupération modifiées pendant la passe.");
      if (repair && loadArbeluneRepair(directory, completion!).recipeSha256 !== repair.recipeSha256)
        throw new Error("Source ou consignes de correction d’Arbélune modifiées.");
      if (
        middle &&
        loadArbeluneAdolescent(directory, completion!).recipeSha256 !== middle.recipeSha256
      )
        throw new Error("Références ou consignes du nouvel ado modifiées.");
      if (
        studyStages &&
        loadStudyStages(directory, completion!).recipeSha256 !== studyStages.recipeSha256
      )
        throw new Error("Stades extraits ou accord visuel modifiés.");
      if (study && loadStudy().recipeSha256 !== study.recipeSha256)
        throw new Error("Sources ou consignes de l’étude modifiées.");
    };
    guard();
    if (futureWorldTheme(copyDb, target.target).slug !== "magic")
      throw new Error(
        "Cette proposition de jardins suspendus ne correspond pas au thème du pilote.",
      );
    const proposal = approved
      ? Buffer.from(JSON.stringify(approved.plan))
      : readFileSync(
          join(app, "docs/playthroughs/teddy-creature-diversity/proposition-magic.json"),
        );
    const plan = validateCreatureDesign(
      JSON.parse(proposal.toString()),
      target.target,
      "magic",
      history.map((c) => c.name),
    );
    const remaining = () => ceiling * 1_000_000 - readPilotReservedUnits(directory);
    const expected = arbeluneStudyInspect
      ? STUDY_INSPECTION_UNITS
      : arbeluneStudy
        ? ARBELUNE_STUDY_UNITS
        : arbeluneAdolescent
          ? ARBELUNE_ADOLESCENT_UNITS
          : arbelune
            ? ARBELUNE_REPAIR_UNITS
            : recover
              ? CAST_RECOVERY_UNITS
              : complete
                ? CAST_COMPLETION_UNITS
                : adolescent
                  ? GROWTH_ADOLESCENT_UNITS
                  : proof
                    ? GROWTH_PROOF_UNITS
                    : plan.creatures.length * (growth ? 350_000 : 150_000);
    console.log(
      JSON.stringify(
        {
          mode: `${phase}${planOnly ? "-plan-sans-api" : ""}`,
          names: (arbelune
            ? plan.creatures.slice(5)
            : recover
              ? plan.creatures
              : complete
                ? plan.creatures.slice(1)
                : single
                  ? plan.creatures.slice(0, 1)
                  : plan.creatures
          ).map((c) => c.name),
          images: arbeluneStudy
            ? 1
            : arbeluneAdolescent
              ? 1
              : arbelune
                ? 2
                : recover
                  ? 0
                  : complete
                    ? 10
                    : single
                      ? 1
                      : plan.creatures.length * (growth ? 2 : 1),
          reusedBabies: arbeluneStudy ? 1 : single ? 1 : growth ? plan.creatures.length : 0,
          ...(adolescent ? { reusedAdults: 1 } : {}),
          ...(complete
            ? {
                reusedOlderStages: arbeluneStudy
                  ? 0
                  : arbeluneAdolescent
                    ? 11
                    : arbelune
                      ? 10
                      : recover
                        ? 12
                        : 2,
                preservedLineage: plan.creatures[0].name,
                method: arbeluneStudy
                  ? study!.method
                  : arbeluneAdolescent
                    ? "two-endpoint-adolescent"
                    : arbelune
                      ? "description-only-readable-face"
                      : recover
                        ? "inspection-only-after-local-crop"
                        : "description-only-growth",
                generationReferences: arbeluneStudyAnatomy
                  ? 2
                  : arbeluneStudy
                    ? 1
                    : arbeluneAdolescent
                      ? 2
                      : 0,
              }
            : {}),
          ...(arbeluneStudy
            ? { studyOnly: true, proposedStages: 2, currentImagesUnchanged: 18 }
            : arbelune
              ? { reusedImages: arbeluneAdolescent ? 17 : 16, readableFaceRequired: true }
              : recover
                ? { reusedImages: 18 }
                : {}),
          ...(arbeluneStudyAnatomy
            ? { directionApproved: true, anatomyCorrectionRequired: true }
            : {}),
          inspections: arbeluneStudy
            ? 0
            : adolescent
              ? 3
              : proof
                ? 1
                : plan.creatures.length * (growth ? 3 : 1),
          ...(experiment
            ? {
                method: adolescent ? "description-only-adolescent" : "description-only-adult",
                generationReferences: 0,
                prompt: experiment.prompt,
              }
            : {}),
          ...(studyStages
            ? {
                images: 0,
                reusedImages: 18,
                reusedOlderStages: 12,
                method: "inspection-only-priority-lineage",
                inspections: 18,
                firstInspections: 3,
                remainingInspectionsOnlyIfLineagePasses: 15,
                generationReferences: 0,
                extractedStages: 2,
              }
            : {}),
          reservedEur: (ceiling * 1_000_000 - remaining()) / 1_000_000,
          plannedAdditionalEur: expected / 1_000_000,
          plannedCumulativeEur: (ceiling * 1_000_000 - remaining() + expected) / 1_000_000,
          ceilingEur: ceiling,
          published: false,
          growthGenerated: recover || arbeluneStudyInspect,
        },
        null,
        2,
      ),
    );
    if (planOnly) return;
    if (remaining() < expected)
      throw new Error("Budget insuffisant pour cet aperçu et toute sa QA.");
    const historicalSheets = arbeluneStudy
      ? []
      : await catalogueSheets(history, (ref) =>
          readCatalogueArt(
            ref,
            ref.startsWith(`world/${plan.worldIndex}/`) ? storage : join(app, "storage/generated"),
            join(app, "public/generated"),
          ),
        );
    const originalPath = join(app, "../multiplyz/.env");
    const original = existsSync(originalPath) ? parseEnv(readFileSync(originalPath, "utf8")) : {};
    const apiKey = process.env.GEMINI_API_KEY || original.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY absente.");
    const imageModel = "gemini-2.5-flash-image";
    if (!recover && !arbeluneStudyInspect) await options.preflight(apiKey, imageModel);
    if (!arbeluneStudy) await options.preflight(apiKey, qaModel);
    const runId = randomUUID(),
      audit = join(
        directory,
        arbeluneStudyInspect
          ? "arbelune-study-inspections"
          : arbeluneStudyAnatomy
            ? "arbelune-study-anatomies"
            : arbeluneStudy
              ? "arbelune-studies"
              : arbeluneAdolescent
                ? "arbelune-adolescents"
                : arbelune
                  ? "arbelune-repairs"
                  : recover
                    ? "cast-completion-inspections"
                    : complete
                      ? "cast-completions"
                      : clarify
                        ? "growth-adolescent-clarifications"
                        : adolescent
                          ? "growth-adolescents"
                          : proof
                            ? "growth-proofs"
                            : redesign
                              ? "cast-redesigns"
                              : growth
                                ? "cast-growths"
                                : "cast-previews",
      );
    mkdirSync(audit, { recursive: true });
    save(marker, {
      runId,
      at: new Date().toISOString(),
      proposalSha256: hash(proposal),
      ...(studyStages
        ? { stagesRecipeSha256: studyStages.recipeSha256, stagesSourceRun: studyStages.sourceRun }
        : {}),
      ...(study ? { studyRecipeSha256: study.recipeSha256, studySourceRun: study.sourceRun } : {}),
      ...(middle
        ? { adolescentRecipeSha256: middle.recipeSha256, adolescentSourceRun: middle.sourceRun }
        : {}),
      ...(repair
        ? { repairRecipeSha256: repair.recipeSha256, repairSourceRun: repair.sourceRun }
        : {}),
      ...(recovery
        ? { recoveryRecipeSha256: recovery.recipeSha256, recoveredSourceRun: recovery.sourceRun }
        : {}),
      ...(completion
        ? {
            completionRecipeSha256: completion.recipeSha256,
            approvedLineageRun: completion.sourceRun,
          }
        : {}),
      ...(experiment
        ? { proofRecipeSha256: experiment.recipeSha256, proofSourceRun: experiment.sourceRun }
        : {}),
      ...(revision
        ? {
            recipeSha256: revision.recipeSha256,
            sourceRun: revision.sourceRun,
            instructions: revision.instructions,
          }
        : {}),
      plan,
      reservedUnits: ceiling * 1_000_000 - remaining(),
    });
    let call = Math.max(0, ...readPilotTrace(directory).map((e) => e.call));
    const fetchImpl: typeof fetch = async (input, init) => {
      guard();
      const body = JSON.parse(String(init?.body)),
        isImage = !!body.generationConfig.responseModalities;
      if (arbeluneStudy && !isImage) throw new Error("Cette étude ne lance aucune inspection.");
      if ((recover || arbeluneStudyInspect) && isImage)
        throw new Error("La reprise est limitée aux inspections ; aucune génération permise.");
      const amount = isImage ? 0.1 : 0.05;
      if (remaining() < Math.ceil(amount * 1_000_000)) throw new Error("Plafond cumulé atteint.");
      reserveRequest(join(directory, "storage/worldgen/budget"), amount, ceiling, new Date());
      const id = ++call;
      const parts = body.contents[0].parts as { text?: string; inlineData?: { data: string } }[];
      const record = (value: object) =>
        appendFileSync(
          join(directory, "requests.jsonl"),
          JSON.stringify({
            call: id,
            runId,
            phase,
            at: new Date().toISOString(),
            ...value,
          }) + "\n",
        );
      record({
        type: isImage ? "image" : "vision",
        model: isImage ? imageModel : qaModel,
        prompts: parts.flatMap((p) => (p.text ? [p.text] : [])),
        referenceSha256: parts.flatMap((p) =>
          p.inlineData ? [hash(Buffer.from(p.inlineData.data, "base64"))] : [],
        ),
      });
      console.log(
        `[faune] Appel ${id} · ${isImage ? (growth ? "évolution" : "nouveau bébé") : "identité, milieu et ressemblance"}…`,
      );
      const heartbeat = setInterval(
        () => console.log(`[faune] Appel ${id} · Gemini travaille encore…`),
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
          .catch(() => null);
        const result = output?.candidates?.[0];
        for (const [part, value] of (result?.content?.parts ?? []).entries())
          if (value.inlineData?.data)
            writeFileSync(
              join(
                directory,
                `storage/worldgen/raw/${id}-${part}.${value.inlineData.mimeType === "image/png" ? "png" : "bin"}`,
              ),
              Buffer.from(value.inlineData.data, "base64"),
              { flag: "wx" },
            );
        record({
          status: response.status,
          finishReason: result?.finishReason,
          blockReason: output?.promptFeedback?.blockReason,
          finishMessage:
            typeof result?.finishMessage === "string"
              ? result.finishMessage.replaceAll(apiKey, "<REDACTED>").slice(0, 1500)
              : undefined,
          safetyRatings: result?.safetyRatings,
          promptSafetyRatings: output?.promptFeedback?.safetyRatings,
          responseId: output?.responseId,
          modelVersion: output?.modelVersion,
          verdict: isImage
            ? undefined
            : result?.content?.parts?.flatMap((p: { text?: string }) => (p.text ? [p.text] : [])),
          providerError:
            typeof output?.error?.message === "string"
              ? output.error.message.replaceAll(apiKey, "<REDACTED>").slice(0, 500)
              : undefined,
        });
        console.log(`[faune] Réponse reçue (HTTP ${response.status}).`);
        return response;
      } finally {
        clearInterval(heartbeat);
      }
    };
    const config = { ...loadWorldGenConfig({}), maxRetries: 0, monthlyBudgetEur: ceiling };
    const store = createWorldAssetStore(storage);
    const preview = join(
        directory,
        `preview-${arbeluneStudy || arbeluneStudyInspect ? phase : arbeluneAdolescent ? "arbelune-adolescent" : arbelune ? "arbelune-repair" : recover ? "cast-completion-inspect" : complete ? "cast-completion" : clarify ? "growth-adolescent-clarification" : adolescent ? "growth-adolescent" : proof ? "growth-proof" : redesign ? "cast-redesign" : growth ? "cast-growth" : "cast"}-${runId}.html`,
      ),
      bilan = join(audit, `${runId}-result.json`);
    try {
      let checkpoint = 0,
        checked = 0;
      const onDraft = (draft: CastDraft | CastGrowthDraft) => {
        const number = checkpoint++;
        save(join(audit, `${runId}-${growth ? `draft-${number}` : "draft"}.json`), draft);
        const stageArt = "stageArt" in draft ? draft.stageArt : undefined;
        const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TEDDy · Nouvelle faune</title><style>body{max-width:1200px;margin:2rem auto;padding:1rem;font:18px system-ui;background:#f4f0e5;color:#263e37}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}article{background:white;padding:1rem;border-radius:16px}.ages{display:flex}figure{flex:1;min-width:0;margin:0;text-align:center}img{width:100%;height:240px;object-fit:contain}</style><h1>Les habitants des jardins suspendus</h1><p>${arbeluneStudyInspect ? "Les deux stades d’Arbélune ont été extraits de la planche acceptée. Ses trois âges sont contrôlés en premier ; les quinze autres images sont inspectées seulement si cette lignée passe. Aucune génération." : arbeluneAdolescent ? "Seul l’ado d’Arbélune est refait entre son bébé et son adulte, avec une arche ouverte. Les dix-sept autres arts sont conservés, les dix-huit sont réinspectés." : arbelune ? "Seuls l’ado et l’adulte d’Arbélune sont refaits : visage expressif lisible en vignette, même espèce aux trois âges. Les seize autres images sont conservées et les dix-huit sont réinspectées." : recover ? "Dix-huit images existantes conservées ; ado d’Arbélune recadré localement pour retirer son cadre. Inspections complètes, aucune régénération." : complete ? "Vrillou est conservé aux trois âges ; nouvelles évolutions des cinq autres habitants. Les dix-huit images sont réinspectées ensemble." : adolescent ? "Vrillou : bébé et adulte validés, nouvel ado à examiner entre les deux. Aucun autre compagnon refait." : proof ? "Essai sur Vrillou : bébé validé, ancien ado refusé comme repère, nouvel adulte à examiner. La lignée complète reste à refaire." : growth ? "Bébés validés et leurs évolutions." : "Aperçu des six bébés."} Aucun personnage publié. Consulter le bilan de QA avant validation.</p><main>${(single
          ? draft.artRefs.slice(0, 1)
          : draft.artRefs
        )
          .map((ref, i) => {
            const refs = [ref, ...(stageArt ? [stageArt[i][2], stageArt[i][3]] : [])];
            return `<article><h2>${escape(plan.creatures[i].name)}</h2><div class="ages">${refs.map((art, age) => `<figure>${art ? `<img src="storage/generated/${escape(art)}" alt="${escape(plan.creatures[i].name)} — ${["bébé", "ado", "adulte"][age]}">` : "<p>À produire</p>"}<figcaption>${["Bébé", "Ado", "Adulte"][age]}</figcaption></figure>`).join("")}</div><p>${escape(plan.creatures[i].story)}</p></article>`;
          })
          .join("")}</main></html>`;
        // Only this run's gallery is refreshed; every intermediate draft remains immutable.
        writeFileSync(preview, html, { flag: number === 0 ? "wx" : "w" });
      };
      const inspect = async (asset: InspectableAsset, draft: CastDraft | CastGrowthDraft) => {
        const stageArt = "stageArt" in draft ? draft.stageArt : undefined;
        const slot = draft.artRefs.findIndex(
          (ref, i) =>
            ref === asset.ref || stageArt?.[i][2] === asset.ref || stageArt?.[i][3] === asset.ref,
        );
        if (slot < 0) throw new Error("Créature inspectée hors du groupe validé.");
        const peers = await catalogueSheets(
          draft.artRefs.flatMap((ref, i) =>
            i === slot
              ? []
              : [
                  {
                    id: `new-${i}`,
                    name: plan.creatures[i].name,
                    artRefs: [ref, ...(stageArt ? [stageArt[i][2]!, stageArt[i][3]!] : [])],
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
            throw new Error("Cet aperçu ne génère pas Teddy.");
          },
          fetchImpl,
          designContext: async () => ({
            brief: JSON.stringify({
              habitat: plan.habitat,
              ...plan.creatures[slot],
              ...(studyStages && slot === 5
                ? {
                    adolescent:
                      "Low supple open wooden arch, slender gently bent root legs and a friendly central face. Preserve the baby species: four upper openings and six separate root supports. Clearly intermediate between the short-rooted baby and tall substantial adult.",
                    adult:
                      "Tall upright open wooden arch with long thick developed root legs and a readable central face. Preserve the baby identity, four upper openings and six root supports; check these against the actual images, as well as obvious growth from the new adolescent.",
                  }
                : middle && slot === 5
                  ? { adolescent: middle.prompt, adult: middle.adult }
                  : repair && slot === 5
                    ? { adolescent: repair.adolescent, adult: repair.adult }
                    : completion && slot > 0
                      ? {
                          adolescent: completion.prompts[slot - 1].adolescent,
                          adult: completion.prompts[slot - 1].adult,
                        }
                      : {}),
            }),
            sheets: [...historicalSheets, ...peers],
          }),
        })(asset);
      };
      const deps = {
        config,
        ...(revision
          ? { stageInstructions: revision.stageInstructions, excludedArts: revision.excludedArts }
          : {}),
        remainingUnits: remaining,
        generate: (input: Parameters<typeof generateImage>[0]) =>
          generateImage(input, { config, apiKey, model: imageModel, fetchImpl }),
        onDraft,
        inspect,
        onCheck: (check: unknown) => save(join(audit, `${runId}-check-${++checked}.json`), check),
      };
      const result = studyStages
        ? await inspectStudyStages(studyStages, deps)
        : study
          ? await previewArbeluneStudy(study, storage, {
              ...deps,
              onStudy: (pixels) => {
                const filename = `${runId}-study.png`;
                writeFileSync(join(audit, filename), pixels, { flag: "wx", mode: 0o600 });
                writeFileSync(
                  preview,
                  `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TEDDy · Étude d’Arbélune</title><style>body{max-width:1100px;margin:2rem auto;padding:1rem;font:18px system-ui;background:#f4f0e5;color:#263e37}img{max-width:100%;height:auto}figure{margin:1rem 0}.baby{width:180px}.study{width:100%;max-height:900px;object-fit:contain}</style><h1>Arbélune · Deux silhouettes à examiner</h1><p>Étude de l’ado à gauche et de l’adulte à droite. Le bébé ci-dessous est conservé. ${arbeluneStudyAnatomy ? "Direction retenue : ado fin, adulte haut et massif. Correction demandée : quatre ouvertures et six racines distinctes à chaque âge. " : ""}Vérifier d’abord que les formes sont nettement différentes, restent la même espèce et gardent un visage lisible. Aucun stade extrait, aucune QA ni publication.</p><figure><img class="baby" src="storage/generated/${escape(study.source.artRefs[5])}" alt="Bébé approuvé inchangé"><figcaption>Bébé approuvé inchangé</figcaption></figure><figure><img class="study" src="${basename(audit)}/${filename}" alt="Étude des deux évolutions"><figcaption>Étude : ado bas et souple · adulte haut aux racines développées</figcaption></figure></html>`,
                  { flag: "wx" },
                );
              },
            })
          : middle
            ? await previewArbeluneAdolescent(middle, storage, deps)
            : repair
              ? await previewArbeluneRepair(repair, storage, deps)
              : recovery
                ? await inspectRecoveredCast(recovery, deps)
                : completion
                  ? await previewCastCompletion(completion, storage, deps)
                  : experiment
                    ? adolescent
                      ? await previewAdolescentGrowthProof(experiment, storage, deps)
                      : await previewAdultGrowthProof(experiment, storage, deps)
                    : approved
                      ? await previewCastGrowth({ ...approved, plan }, storage, deps)
                      : await previewCreatureCast(plan, storage, deps);
      guard();
      save(bilan, {
        ...result,
        preview,
        reservedEur: (ceiling * 1_000_000 - remaining()) / 1_000_000,
        databaseWritten: false,
      });
      console.log(JSON.stringify({ ...result, bilan, preview }, null, 2));
      if (!["passed-for-visual-review", "study-ready-for-visual-review"].includes(result.outcome))
        process.exitCode = 1;
    } catch (error) {
      save(bilan, {
        outcome: "stopped",
        reason: error instanceof Error ? error.message : "Aperçu interrompu.",
        preview: existsSync(preview) ? preview : null,
        reservedEur: (ceiling * 1_000_000 - remaining()) / 1_000_000,
        published: false,
        databaseWritten: false,
      });
      console.error(`Bilan conservé : ${bilan}`);
      throw error;
    }
  } finally {
    release?.();
    source.close();
    copy.close();
  }
}
