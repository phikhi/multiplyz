/** Explicit, single bounded correction pass on the existing isolated pilot. */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import * as schema from "../src/lib/db/schema";
import { loadWorldGenConfig } from "../src/config/server-config";
import { getApprovedMaster } from "../src/lib/worldgen/reference-assets";
import { readMasterBytesFromDisk } from "../src/lib/worldgen/socle-assets";
import { createWorldAssetStore, reserveRequest } from "../src/lib/worldgen/runtime-assets";
import { readPilotReservedUnits, readPilotTrace } from "../src/lib/worldgen/pilot-status";
import { createVisionInspector } from "../src/lib/worldgen/vision-inspector";
import { generateImage } from "../src/lib/worldgen/image-client";
import {
  loadRefinablePilot,
  recordedDiagnostic,
  refinePilotWorld,
} from "../src/lib/worldgen/pilot-refinement";
import { assessAsset } from "../src/lib/worldgen/qa";
import type { GeneratedWorld } from "../src/lib/worldgen/generate-world";

const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const save = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function gallery(path: string, world: GeneratedWorld) {
  const picture = (ref: string, label: string) =>
    `<figure><img src="storage/generated/${html(ref)}" alt="${html(label)}"><figcaption>${html(label)}</figcaption></figure>`;
  writeFileSync(
    path,
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TEDDy · Candidat corrigé</title><style>body{max-width:1100px;margin:2rem auto;padding:1rem;background:#f4f0e5;color:#263e37;font:18px system-ui}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1rem}figure{margin:0;padding:1rem;background:white;border-radius:16px}img{width:100%;height:260px;object-fit:contain}h2{margin-top:3rem}</style><h1>Monde ${world.worldIndex + 1} · Candidat corrigé</h1><p>Galerie de contrôle des images. Consulter le bilan JSON pour la QA. Aucun contenu publié dans la partie familiale.</p><section>${Object.entries(
      world.assetRefs,
    )
      .map(([label, ref]) => picture(ref, label))
      .join(
        "",
      )}</section>${world.creatures.map((c) => `<h2>${html(c.nameDefault)}</h2><section>${[c.artRef, c.stageArt![2], c.stageArt![3]].map((ref, i) => picture(ref, ["Bébé", "Adolescent", "Adulte"][i])).join("")}</section>`).join("")}</html>`,
    { flag: "wx" },
  );
}

export async function refinePilot(options: {
  app: string;
  qaModel: string;
  planOnly: boolean;
  lock: () => () => void;
  preflight: (key: string, model: string) => Promise<void>;
}) {
  const { app, qaModel, planOnly } = options;
  const directory = join(app, "data/teddy-world-pilot");
  const storage = join(directory, "storage/generated");
  const marker = join(directory, "refinement-started.json");
  if (!planOnly && existsSync(marker))
    throw new Error(
      "Cette passe de correction a déjà démarré. Consulter refinements/ ; conserver ses résultats et son budget.",
    );
  const sqlite = new Database(join(directory, "multiplyz.sqlite"), {
    readonly: planOnly,
    fileMustExist: true,
  });
  let release: (() => void) | undefined;
  try {
    if (!planOnly) release = options.lock();
    const db = drizzle(sqlite, { schema });
    const started = JSON.parse(readFileSync(join(directory, "started.json"), "utf8"));
    const month = started.at?.slice(0, 7);
    const assertMonth = () => {
      if (month !== new Date().toISOString().slice(0, 7))
        throw new Error("Changement de mois : réexaminer le budget cumulé avant correction.");
    };
    assertMonth();
    const candidate = loadRefinablePilot(db, started.target, storage);
    const master = getApprovedMaster(db);
    if (!master) throw new Error("Master Teddy approuvé requis.");
    const masterBytes = readMasterBytesFromDisk(master.assetRef, { cwd: directory });
    const config = { ...loadWorldGenConfig({}), maxRetries: 0, monthlyBudgetEur: 5 };
    const store = createWorldAssetStore(storage);
    const entries = readPilotTrace(directory);
    const missing = new Error("Diagnostic non enregistré.");
    const visionOptions = {
      apiKey: "offline-plan",
      model: qaModel,
      style: config.prompts.style,
      readAsset: store.read,
      readMaster: () => masterBytes,
    };
    const offline = createVisionInspector({
      ...visionOptions,
      fetchImpl: async (_input, init) => {
        const cached = recordedDiagnostic(entries, qaModel, JSON.parse(String(init?.body)));
        if (!cached) throw missing;
        return Response.json(cached.body);
      },
    });
    const known = [];
    let missingCount = 0;
    for (const asset of candidate.assets) {
      try {
        const inspection = await offline(asset);
        known.push({ asset: asset.ref, inspection, verdict: assessAsset(inspection, config.qa) });
      } catch (error) {
        if (error !== missing) throw error;
        missingCount++;
      }
    }
    const reservedUnits = readPilotReservedUnits(directory);
    const afterDiagnosticAndValidation =
      5_000_000 - reservedUnits - (missingCount + candidate.assets.length) * 50_000;
    console.log(
      JSON.stringify(
        {
          mode: planOnly ? "plan-sans-api" : "correction-unique",
          knownDiagnostics: known.length,
          remainingDiagnostics: missingCount,
          knownRejections: known.filter((c) => !c.verdict.ok),
          reservedEur: reservedUnits / 1_000_000,
          ceilingEur: 5,
          maxCorrectionsWithFullValidation: Math.max(
            0,
            Math.floor(afterDiagnosticAndValidation / 100_000),
          ),
          published: false,
        },
        null,
        2,
      ),
    );
    if (planOnly) return;
    if (afterDiagnosticAndValidation < 100_000)
      throw new Error(
        "Budget insuffisant pour le diagnostic, une correction et la validation complète.",
      );
    const originalPath = join(app, "../multiplyz/.env");
    const original = existsSync(originalPath) ? parseEnv(readFileSync(originalPath, "utf8")) : {};
    const apiKey = process.env.GEMINI_API_KEY || original.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY absente.");
    const imageModel = "gemini-2.5-flash-image";
    await options.preflight(apiKey, qaModel);
    await options.preflight(apiKey, imageModel);
    const runId = randomUUID();
    const audit = join(directory, "refinements");
    mkdirSync(audit, { recursive: true });
    save(marker, {
      runId,
      at: new Date().toISOString(),
      previousJob: candidate.job,
      previousAssetRefs: candidate.assetRefs,
      qaModel,
      imageModel,
      reservedUnits,
    });
    let phase = "diagnostic";
    let call = Math.max(0, ...entries.map((e) => e.call));
    const tracedFetch: typeof fetch = async (input, init) => {
      assertMonth();
      const body = JSON.parse(String(init?.body));
      const isImage = !!body.generationConfig.responseModalities;
      const model = isImage ? imageModel : qaModel;
      const amount = isImage ? 0.1 : 0.05;
      if (readPilotReservedUnits(directory) + Math.ceil(amount * 1_000_000) > 5_000_000)
        throw new Error("Plafond cumulé de 5 € atteint.");
      reserveRequest(join(directory, "storage/worldgen/budget"), amount, 5, new Date());
      const id = ++call;
      const parts = body.contents[0].parts as { text?: string; inlineData?: { data: string } }[];
      const record = (value: object) =>
        appendFileSync(
          join(directory, "requests.jsonl"),
          JSON.stringify({ call: id, at: new Date().toISOString(), runId, phase, ...value }) + "\n",
        );
      record({
        type: isImage ? "image" : "vision",
        model,
        prompts: parts.flatMap((p) => (p.text ? [p.text] : [])),
        referenceSha256: parts.flatMap((p) =>
          p.inlineData ? [hash(Buffer.from(p.inlineData.data, "base64"))] : [],
        ),
      });
      console.log(`[${phase}] Appel ${id} · ${isImage ? "correction d’image" : "inspection"}…`);
      const heartbeat = setInterval(
        () => console.log(`[${phase}] Gemini travaille encore…`),
        15_000,
      );
      try {
        const response = await fetch(input, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(120_000),
        });
        const result = await response
          .clone()
          .json()
          .catch(() => null);
        const candidate = result?.candidates?.[0];
        const output = candidate?.content?.parts ?? [];
        for (const [i, part] of output.entries())
          if (part.inlineData?.data) {
            const extension = part.inlineData.mimeType === "image/png" ? "png" : "bin";
            writeFileSync(
              join(directory, `storage/worldgen/raw/${id}-${i}.${extension}`),
              Buffer.from(part.inlineData.data, "base64"),
              { flag: "wx" },
            );
          }
        record({
          status: response.status,
          finishReason: candidate?.finishReason,
          blockReason: result?.promptFeedback?.blockReason,
          verdict: isImage
            ? undefined
            : output.flatMap((p: { text?: string }) => (p.text ? [p.text] : [])),
          providerError:
            typeof result?.error?.message === "string"
              ? result.error.message.replaceAll(apiKey, "<REDACTED>").slice(0, 500)
              : undefined,
        });
        console.log(`[${phase}] Réponse reçue (HTTP ${response.status}).`);
        return response;
      } finally {
        clearInterval(heartbeat);
      }
    };
    const fresh = createVisionInspector({ ...visionOptions, apiKey, fetchImpl: tracedFetch });
    const diagnose = createVisionInspector({
      ...visionOptions,
      apiKey,
      fetchImpl: async (input, init) => {
        const cached = recordedDiagnostic(entries, qaModel, JSON.parse(String(init?.body)));
        if (cached) {
          console.log(`[diagnostic] Verdict ${cached.call} conservé · aucun appel payant.`);
          return Response.json(cached.body);
        }
        return tracedFetch(input, init);
      },
    });
    const preview = join(directory, `preview-refinement-${runId}.html`);
    const resultPath = join(audit, `${runId}-result.json`);
    try {
      const result = await refinePilotWorld(db, started.target, storage, {
        config,
        diagnose,
        inspectFresh: fresh,
        generate: (input) =>
          generateImage(input, { apiKey, model: imageModel, config, fetchImpl: tracedFetch }),
        remainingUnits: () => 5_000_000 - readPilotReservedUnits(directory),
        onDiagnostic: (checks) => {
          save(join(audit, `${runId}-diagnostic.json`), checks);
          phase = "correction";
        },
        onCandidate: (world) => {
          gallery(preview, world);
          phase = "validation complète";
        },
        onValidation: (checks) => save(join(audit, `${runId}-validation.json`), checks),
      });
      save(resultPath, {
        ...result,
        finishedAt: new Date().toISOString(),
        preview,
        reservedEur: readPilotReservedUnits(directory) / 1_000_000,
        activeDatabaseWritten: false,
      });
      console.log(JSON.stringify({ ...result, bilan: resultPath, preview }, null, 2));
      if (result.outcome !== "done") process.exitCode = 1;
    } catch (error) {
      save(resultPath, {
        outcome: "stopped",
        phase,
        reason: error instanceof Error ? error.message : "Passe interrompue.",
        finishedAt: new Date().toISOString(),
        preview: existsSync(preview) ? preview : null,
        reservedEur: readPilotReservedUnits(directory) / 1_000_000,
        published: false,
        activeDatabaseWritten: false,
      });
      console.error(`Bilan conservé : ${resultPath}`);
      throw error;
    }
  } finally {
    release?.();
    sqlite.close();
  }
}
