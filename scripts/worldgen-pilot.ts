/** One real candidate on a coherent family snapshot. No seed, migration or active DB writes. */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import * as schema from "../src/lib/db/schema";
import { loadWorldGenConfig } from "../src/config/server-config";
import { getApprovedMaster } from "../src/lib/worldgen/reference-assets";
import { readMasterBytesFromDisk } from "../src/lib/worldgen/socle-assets";
import { futureWorldTheme, lastReservedWorld, socleSize } from "../src/lib/worldgen/future-worlds";
import { deriveCreatureSplit } from "../src/lib/worldgen/creature-catalog";
import { writeHouseholdSettings } from "../src/lib/parent/settings";
import { createWorldRuntime } from "../src/lib/worldgen/runtime";
import { readRuntimeCatalogue } from "../src/lib/worldgen/runtime-catalogue";
import { describePilotStatus, readPilotTrace } from "../src/lib/worldgen/pilot-status";
import { loadPilotImageCache } from "../src/lib/worldgen/pilot-cache";
import { loadInspectablePilot, reinspectPilotWorld } from "../src/lib/worldgen/pilot-inspection";
import { createVisionInspector } from "../src/lib/worldgen/vision-inspector";
import { createWorldAssetStore, reserveRequest } from "../src/lib/worldgen/runtime-assets";
import { refinePilot } from "./worldgen-pilot-refine";
import { renewalBabies } from "./worldgen-renewal";
import { renewalBatch } from "./worldgen-renewal-batch";
import { castPreview } from "./worldgen-cast-preview";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = join(app, "data/teddy-world-pilot");
const source = join(app, "data/multiplyz.sqlite");
const destination = join(directory, "multiplyz.sqlite");
const report = join(app, "docs/playthroughs/teddy-world-pilot");
const QA_MODEL = "gemini-3.8-flash";
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const save = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });

function fingerprints(sqlite: Database.Database) {
  return sqlite.transaction(() => {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    return Object.fromEntries(
      tables.map(({ name }) => {
        const rows = sqlite
          .prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
          .raw()
          .all()
          .map((row) => JSON.stringify(row))
          .sort();
        return [name, { rows: rows.length, sha256: hash(rows.join("\n")) }];
      }),
    );
  })();
}

async function prepare() {
  if (existsSync(destination)) {
    if (!existsSync(join(report, "plan.json")))
      throw new Error("Copie déjà présente sans plan : conservée, aucun remplacement.");
    console.log(readFileSync(join(report, "plan.json"), "utf8"));
    return;
  }
  // mkdir without recursive is the exclusive claim: an interrupted preparation is never overwritten.
  mkdirSync(directory, { mode: 0o700 });
  const active = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await active.backup(destination);
  } finally {
    active.close();
  }
  chmodSync(destination, 0o600);
  const copy = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    if (copy.pragma("integrity_check", { simple: true }) !== "ok")
      throw new Error("Intégrité de la copie à examiner.");
    const db = drizzle(copy, { schema });
    const master = getApprovedMaster(db);
    if (!master || master.assetRef !== "storage/reference/teddy/teddy-master.png")
      throw new Error("Référence master inattendue : copie conservée, préparation arrêtée.");
    const masterBytes = readMasterBytesFromDisk(master.assetRef, { cwd: app });
    mkdirSync(dirname(join(directory, master.assetRef)), { recursive: true });
    writeFileSync(join(directory, master.assetRef), masterBytes, { flag: "wx" });
    const reserved = lastReservedWorld(db);
    const target = reserved + 1;
    if (target < socleSize(db))
      throw new Error("Le prochain monde appartient encore au socle : aucun pilote lancé.");
    const split = deriveCreatureSplit(target);
    const creatures = split.commons + split.rares + 1;
    const images = 3 + 3 * creatures;
    mkdirSync(report, { recursive: true });
    save(join(report, "source-baseline.json"), {
      source,
      snapshot: destination,
      integrity: "ok",
      tables: fingerprints(copy),
    });
    save(join(report, "plan.json"), {
      preparedAt: new Date().toISOString(),
      source,
      snapshot: destination,
      target,
      theme: futureWorldTheme(db, target).slug,
      creatures,
      images,
      maxVisionCalls: images + 1,
      designPlanningCalls: 1,
      stages: ["bébé", "adolescent", "adulte"],
      imageModel: "gemini-2.5-flash-image",
      qaModel: QA_MODEL,
      imageReservationEur: 0.1,
      qaReservationEur: 0.05,
      plannedReservationsEur: Math.round((images * 0.15 + 0.05) * 100) / 100,
      reservationCeilingEur: 5,
      automaticRetries: 0,
      parentApprovalRequired: true,
      masterSha256: hash(masterBytes),
      status: "prepared-not-generated",
    });
    console.log(readFileSync(join(report, "plan.json"), "utf8"));
  } finally {
    copy.close();
  }
}

async function preflight(apiKey: string, model: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `Modèle ${model} indisponible (HTTP ${response.status}). Aucun appel de génération envoyé.`,
    );
  const metadata = (await response.json()) as { supportedGenerationMethods?: string[] };
  if (!metadata.supportedGenerationMethods?.includes("generateContent"))
    throw new Error(`Modèle ${model} incompatible avec generateContent.`);
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function status() {
  const sqlite = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    console.log(describePilotStatus(drizzle(sqlite, { schema }), directory));
  } finally {
    sqlite.close();
  }
}

/** Exclusive local run. An explicit resume can recover a lock only when its PID no longer exists. */
function lockPilot(resume: boolean) {
  const path = join(directory, "active-run.json");
  if (existsSync(path)) {
    const previous = JSON.parse(readFileSync(path, "utf8"));
    if (!resume || !Number.isSafeInteger(previous.pid) || previous.pid <= 0)
      throw new Error("Un verrou de génération existe déjà ; consulter --status.");
    try {
      process.kill(previous.pid, 0);
      throw new Error("Une génération tourne encore ; consulter --status.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    unlinkSync(path);
  }
  const token = randomUUID();
  save(path, { pid: process.pid, token });
  const release = () => {
    if (existsSync(path) && JSON.parse(readFileSync(path, "utf8")).token === token)
      unlinkSync(path);
  };
  const interrupt = () => {
    console.error(
      "\nEssai interrompu. Images et budget conservés ; consulter --status avant toute reprise.",
    );
    process.exit(130);
  };
  process.once("exit", release);
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  return () => {
    release();
    process.off("exit", release);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  };
}

async function generate(resume = false) {
  if (!existsSync(destination)) throw new Error("Exécuter --prepare d’abord.");
  const plan = JSON.parse(readFileSync(join(report, "plan.json"), "utf8"));
  if (!resume && existsSync(join(directory, "started.json"))) return status();
  if (resume && !existsSync(join(directory, "started.json")))
    throw new Error("Aucun essai à reprendre ; utiliser --generate.");
  if (resume && existsSync(join(directory, "result.json"))) {
    status();
    throw new Error("Cet essai a déjà un bilan : l’examiner avant toute nouvelle génération.");
  }
  if (resume) {
    const started = JSON.parse(readFileSync(join(directory, "started.json"), "utf8"));
    if (started.at?.slice(0, 7) !== new Date().toISOString().slice(0, 7))
      throw new Error("Changement de mois : réexaminer le budget cumulé avant de reprendre.");
  }
  const cache = resume ? await loadPilotImageCache(directory) : undefined;
  // Whitelist one credential only: never load the original DATABASE_PATH or household settings.
  const originalEnvPath = join(app, "../multiplyz/.env");
  const original = existsSync(originalEnvPath)
    ? parseEnv(readFileSync(originalEnvPath, "utf8"))
    : {};
  const apiKey = process.env.GEMINI_API_KEY || original.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY absente.");
  // Fixed reviewed models: no URL or model supplied by a mutable manifest receives the credential.
  const imageModel = "gemini-2.5-flash-image",
    qaModel = QA_MODEL;
  const sqlite = new Database(destination, { fileMustExist: true });
  let release: (() => void) | undefined;
  try {
    const db = drizzle(sqlite, { schema });
    const target = lastReservedWorld(db) + 1;
    const previousJobs = db
      .select()
      .from(schema.jobs)
      .all()
      .filter((j) => j.type === "generate_world");
    const interrupted = previousJobs[0];
    const canResume =
      resume &&
      previousJobs.length === 1 &&
      interrupted.qaAttempts === 0 &&
      ["running", "pending"].includes(interrupted.status) &&
      JSON.parse(interrupted.payload).worldIndex === target;
    if (
      plan.target !== target ||
      target < socleSize(db) ||
      db
        .select()
        .from(schema.worlds)
        .all()
        .some((w) => w.index === target && (!resume || w.status !== "buffered")) ||
      (resume ? !canResume : previousJobs.length > 0)
    )
      throw new Error(
        "État du pilote différent du plan ou job existant : données conservées, aucun appel envoyé.",
      );
    release = lockPilot(resume);
    console.log("Vérification de l’accès aux modèles Gemini…");
    await preflight(apiKey, imageModel);
    await preflight(apiKey, qaModel);
    if (resume) {
      const folder = join(directory, "resumes");
      mkdirSync(folder, { recursive: true });
      save(join(folder, randomUUID() + ".json"), {
        at: new Date().toISOString(),
        target,
        previousJob: interrupted,
        reusableImages: cache!.size,
      });
      db.update(schema.jobs)
        .set({ status: "pending", updatedAt: new Date() })
        .where(eq(schema.jobs.id, interrupted.id))
        .run();
      console.log(
        `Reprise : ${cache!.size} image(s) réutilisable(s), réservations précédentes conservées.`,
      );
    } else
      save(join(directory, "started.json"), {
        at: new Date().toISOString(),
        target,
        pid: process.pid,
      });
    sqlite.pragma("foreign_keys=ON");
    writeHouseholdSettings(db, { parentWorldValidation: true });
    const config = loadWorldGenConfig({});
    const archive = join(directory, "storage/worldgen/raw");
    mkdirSync(archive, { recursive: true });
    let calls = Math.max(0, ...readPilotTrace(directory).map((e) => e.call));
    const trace = join(directory, "requests.jsonl");
    if (!existsSync(trace)) writeFileSync(trace, "", { flag: "wx", mode: 0o600 });
    const tracedFetch: typeof fetch = async (input, init) => {
      const call = ++calls;
      const body = JSON.parse(String(init?.body));
      const kind = body.generationConfig.responseModalities ? "image" : "vision";
      console.log(
        `[${call}] ${kind === "image" ? "Génération d’une image" : "Inspection d’une image"}…`,
      );
      const parts = body.contents[0].parts as { text?: string; inlineData?: { data: string } }[];
      appendFileSync(
        trace,
        JSON.stringify({
          call,
          at: new Date().toISOString(),
          type: body.generationConfig.responseModalities ? "image" : "vision",
          prompts: parts.flatMap((p) => (p.text ? [p.text] : [])),
          referenceSha256: parts.flatMap((p) =>
            p.inlineData ? [hash(Buffer.from(p.inlineData.data, "base64"))] : [],
          ),
        }) + "\n",
      );
      const heartbeat = setInterval(
        () => console.log(`[${call}] Gemini travaille encore…`),
        15_000,
      );
      try {
        const response = await fetch(input, init);
        const result = await response
          .clone()
          .json()
          .catch(() => null);
        const output = result?.candidates?.[0]?.content?.parts ?? [];
        for (const [index, part] of output.entries()) {
          if (part.inlineData?.data) {
            const extension =
              part.inlineData.mimeType === "image/png"
                ? "png"
                : part.inlineData.mimeType === "image/jpeg"
                  ? "jpg"
                  : "bin";
            writeFileSync(
              join(archive, `${call}-${index}.${extension}`),
              Buffer.from(part.inlineData.data, "base64"),
              { flag: "wx" },
            );
          }
        }
        appendFileSync(
          trace,
          JSON.stringify({
            call,
            at: new Date().toISOString(),
            status: response.status,
            verdict: body.generationConfig.responseMimeType
              ? output.flatMap((p: { text?: string }) => (p.text ? [p.text] : []))
              : undefined,
          }) + "\n",
        );
        console.log(`[${call}] Réponse reçue (HTTP ${response.status}).`);
        return response;
      } finally {
        clearInterval(heartbeat);
      }
    };
    const runtime = createWorldRuntime(db, {
      cwd: directory,
      publicArtRoot: join(app, "public/generated"),
      apiKey,
      imageModel,
      qaModel,
      config: {
        ...config,
        bufferAhead: 1,
        monthlyBudgetEur: 5,
        maxRetries: 0,
        qa: { ...config.qa, maxAttempts: 0 },
      },
      imageReservationEur: 0.1,
      qaReservationEur: 0.05,
      fetchImpl: tracedFetch,
      reuseImage: cache
        ? (input) => {
            const bytes = cache.read(input);
            if (bytes) console.log("Image existante réutilisée · aucun appel payant.");
            return bytes;
          }
        : undefined,
    });
    const result = await runtime.tick();
    save(join(directory, "result.json"), { ...result, calls, activeDatabaseWritten: false });
    const row = db
      .select()
      .from(schema.worlds)
      .all()
      .find((w) => w.index === target);
    if (row) {
      const world = readRuntimeCatalogue(
        target,
        row.assetRefs,
        join(directory, "storage/generated"),
      );
      const picture = (ref: string, label: string) =>
        `<figure><img src="storage/generated/${escapeHtml(ref)}" alt="${escapeHtml(label)}"><figcaption>${escapeHtml(label)}</figcaption></figure>`;
      const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TEDDy · Monde pilote</title><style>body{margin:2rem auto;padding:0 1rem;max-width:1100px;font:18px system-ui;color:#263e37;background:#f4f0e5}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1rem}figure{margin:0;padding:1rem;background:white;border-radius:16px}img{width:100%;height:250px;object-fit:contain}h2{margin-top:3rem}</style><h1>Monde ${world.worldIndex + 1} · Pilote</h1><p>Copie de contrôle. Résultat technique : ${escapeHtml(result.processed.outcome)}. Aucun contenu publié dans la partie familiale.</p><section>${Object.entries(
        world.assetRefs,
      )
        .map(([key, ref]) => picture(ref, key))
        .join(
          "",
        )}</section>${world.creatures.map((c) => `<h2>${escapeHtml(c.nameDefault)}</h2><p>${escapeHtml(c.story)}</p><section>${[c.artRef, c.stageArt?.[2], c.stageArt?.[3]].map((ref, index) => (ref ? picture(ref, ["Bébé", "Adolescent", "Adulte"][index]) : "")).join("")}</section>`).join("")}</html>`;
      writeFileSync(join(directory, "preview.html"), html, { flag: "wx" });
    }
    console.log(
      JSON.stringify({ result, calls, preview: join(directory, "preview.html") }, null, 2),
    );
  } finally {
    release?.();
    sqlite.close();
  }
}

/** Recheck existing pixels after a service failure. This path cannot request an image generation. */
async function inspectExisting() {
  const sqlite = new Database(destination, { fileMustExist: true });
  let release: (() => void) | undefined;
  try {
    const db = drizzle(sqlite, { schema });
    const plan = JSON.parse(readFileSync(join(report, "plan.json"), "utf8"));
    const started = JSON.parse(readFileSync(join(directory, "started.json"), "utf8"));
    if (started.at?.slice(0, 7) !== new Date().toISOString().slice(0, 7))
      throw new Error("Changement de mois : réexaminer le budget cumulé avant inspection.");
    const storage = join(directory, "storage/generated");
    const candidate = loadInspectablePilot(db, plan.target, storage);
    const originalPath = join(app, "../multiplyz/.env");
    const original = existsSync(originalPath) ? parseEnv(readFileSync(originalPath, "utf8")) : {};
    const apiKey = process.env.GEMINI_API_KEY || original.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY absente.");
    const master = getApprovedMaster(db);
    if (!master) throw new Error("Master Teddy approuvé requis.");
    const masterBytes = readMasterBytesFromDisk(master.assetRef, { cwd: directory });
    release = lockPilot(true);
    console.log(
      `Inspection seule · ${candidate.assets.length} images existantes · modèle ${QA_MODEL}.`,
    );
    await preflight(apiKey, QA_MODEL);
    const audit = join(directory, "inspections");
    mkdirSync(audit, { recursive: true });
    const runId = randomUUID();
    save(join(audit, `${runId}-started.json`), {
      at: new Date().toISOString(),
      model: QA_MODEL,
      previousJob: candidate.job,
      assetRefs: candidate.assets.map((a) => a.ref),
    });
    let call = Math.max(0, ...readPilotTrace(directory).map((e) => e.call));
    let inspected = 0;
    const trace = join(directory, "requests.jsonl");
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body));
      if (
        body.generationConfig.responseModalities ||
        body.generationConfig.responseMimeType !== "application/json"
      )
        throw new Error("Cette commande autorise uniquement l’inspection JSON.");
      reserveRequest(join(directory, "storage/worldgen/budget"), 0.05, 5, new Date());
      const id = ++call;
      console.log(`[${++inspected}/${candidate.assets.length}] Inspection · appel ${id}…`);
      const parts = body.contents[0].parts as { text?: string; inlineData?: { data: string } }[];
      appendFileSync(
        trace,
        JSON.stringify({
          call: id,
          type: "vision",
          model: QA_MODEL,
          at: new Date().toISOString(),
          prompts: parts.flatMap((p) => (p.text ? [p.text] : [])),
          referenceSha256: parts.flatMap((p) =>
            p.inlineData ? [hash(Buffer.from(p.inlineData.data, "base64"))] : [],
          ),
        }) + "\n",
      );
      const heartbeat = setInterval(
        () => console.log(`[${inspected}/${candidate.assets.length}] Gemini inspecte encore…`),
        15_000,
      );
      try {
        const response = await fetch(input, init);
        const output = await response
          .clone()
          .json()
          .catch(() => null);
        appendFileSync(
          trace,
          JSON.stringify({
            call: id,
            status: response.status,
            at: new Date().toISOString(),
            verdict:
              output?.candidates?.[0]?.content?.parts?.flatMap((p: { text?: string }) =>
                p.text ? [p.text] : [],
              ) ?? [],
            providerError:
              typeof output?.error?.message === "string"
                ? output.error.message.replaceAll(apiKey, "<REDACTED>").slice(0, 500)
                : undefined,
          }) + "\n",
        );
        console.log(
          `[${inspected}/${candidate.assets.length}] Réponse reçue (HTTP ${response.status}).`,
        );
        return response;
      } finally {
        clearInterval(heartbeat);
      }
    };
    const config = loadWorldGenConfig({});
    const inspector = createVisionInspector({
      apiKey,
      model: QA_MODEL,
      style: config.prompts.style,
      readAsset: createWorldAssetStore(storage).read,
      readMaster: () => masterBytes,
      fetchImpl,
    });
    const result = await reinspectPilotWorld(db, plan.target, storage, inspector, config.qa);
    const resultPath = join(audit, `${runId}-result.json`);
    const originalPreview = join(directory, "preview.html");
    const preview = join(directory, `preview-inspection-${runId}.html`);
    if (existsSync(originalPreview)) {
      const html = readFileSync(originalPreview, "utf8").replace(
        /Résultat technique : (?:failed|done|retry|idle)\./,
        `Résultat technique : ${result.outcome}.`,
      );
      writeFileSync(preview, html, { flag: "wx" });
    }
    save(resultPath, {
      ...result,
      model: QA_MODEL,
      calls: inspected,
      finishedAt: new Date().toISOString(),
      activeDatabaseWritten: false,
      preview: existsSync(preview) ? preview : originalPreview,
    });
    console.log(
      JSON.stringify(
        { ...result, bilan: resultPath, preview: existsSync(preview) ? preview : originalPreview },
        null,
        2,
      ),
    );
    if (result.outcome !== "done") process.exitCode = 1;
  } finally {
    release?.();
    sqlite.close();
  }
}

function checkPreservation() {
  const active = new Database(source, { readonly: true, fileMustExist: true });
  try {
    const before = JSON.parse(readFileSync(join(report, "source-baseline.json"), "utf8"));
    const after = fingerprints(active);
    const unchanged = JSON.stringify(after) === JSON.stringify(before.tables);
    const result = {
      checkedAt: new Date().toISOString(),
      unchanged,
      tables: after,
      integrity: active.pragma("integrity_check", { simple: true }),
      activeDatabaseWritten: false,
      seedExecuted: false,
    };
    save(join(report, `preservation-${Date.now()}.json`), result);
    console.log(
      JSON.stringify({ unchanged, integrity: result.integrity, tables: Object.keys(after).length }),
    );
    if (!unchanged)
      throw new Error(
        "Activité différente du point de départ : examiner sans aucune restauration.",
      );
  } finally {
    active.close();
  }
}

async function main() {
  const mode = process.argv[2] ?? "--prepare";
  if (process.argv.length > 3)
    throw new Error(
      "Usage : worldgen-pilot.ts [--prepare|--generate|--resume|--inspect|--refine-plan|--refine|--cast-plan|--cast-preview|--cast-growth-plan|--cast-growth|--cast-redesign-plan|--cast-redesign|--growth-proof-plan|--growth-proof|--growth-adolescent-plan|--growth-adolescent|--growth-adolescent-clarification-plan|--growth-adolescent-clarification|--cast-completion-plan|--cast-completion|--cast-completion-inspect-plan|--cast-completion-inspect|--arbelune-repair-plan|--arbelune-repair|--arbelune-adolescent-plan|--arbelune-adolescent|--arbelune-study-plan|--arbelune-study|--arbelune-study-anatomy-plan|--arbelune-study-anatomy|--arbelune-study-inspect-plan|--arbelune-study-inspect|--renewal-N-babies-plan|--renewal-N-babies|--renewal-N-baby-repair-plan|--renewal-N-baby-repair|--renewal-N-growth-plan|--renewal-N-growth|--renewal-N-growth-resume-plan|--renewal-N-growth-resume|--renewal-N-face-repair-plan|--renewal-N-face-repair|--renewal-N-face-repair-2-plan|--renewal-N-face-repair-2|--renewal-batch-plan|--renewal-batch|--renewal-batch-repair-plan|--renewal-batch-repair|--status|--check-preservation]",
    );
  if (mode === "--prepare") await prepare();
  else if (mode === "--generate") await generate();
  else if (mode === "--resume") await generate(true);
  else if (mode === "--status") status();
  else if (mode === "--inspect") await inspectExisting();
  else if (mode === "--refine" || mode === "--refine-plan")
    await refinePilot({
      app,
      qaModel: QA_MODEL,
      planOnly: mode === "--refine-plan",
      lock: () => lockPilot(true),
      preflight,
    });
  else if (mode === "--check-preservation") checkPreservation();
  else if (/^--renewal-batch(?:-repair)?(?:-plan)?$/.test(mode))
    await renewalBatch({
      app,
      planOnly: mode.endsWith("-plan"),
      repair: mode.includes("-repair"),
      lock: () => lockPilot(true),
      preflight,
    });
  else if (
    /^--renewal-[0-5]-(?:babies|baby-repair|face-repair(?:-2)?|growth(?:-resume)?)(?:-plan)?$/.test(
      mode,
    )
  )
    await renewalBabies({
      app,
      worldIndex: Number(mode.split("-")[3]),
      qaModel: QA_MODEL,
      planOnly: mode.endsWith("-plan"),
      repair: mode.includes("-baby-repair"),
      growth: mode.includes("-growth") || mode.includes("-face-repair"),
      faceRepair: mode.includes("-face-repair"),
      faceRepairPass: mode.includes("-face-repair-2") ? 2 : 1,
      resumeGrowth: mode.includes("-growth-resume"),
      lock: () => lockPilot(true),
      preflight,
    });
  else if (
    [
      "--cast-plan",
      "--cast-preview",
      "--cast-growth-plan",
      "--cast-growth",
      "--cast-redesign-plan",
      "--cast-redesign",
      "--growth-proof-plan",
      "--growth-proof",
      "--growth-adolescent-plan",
      "--growth-adolescent",
      "--growth-adolescent-clarification-plan",
      "--growth-adolescent-clarification",
      "--cast-completion-plan",
      "--cast-completion",
      "--cast-completion-inspect-plan",
      "--cast-completion-inspect",
      "--arbelune-repair-plan",
      "--arbelune-repair",
      "--arbelune-adolescent-plan",
      "--arbelune-adolescent",
      "--arbelune-study-plan",
      "--arbelune-study",
      "--arbelune-study-anatomy-plan",
      "--arbelune-study-anatomy",
      "--arbelune-study-inspect-plan",
      "--arbelune-study-inspect",
    ].includes(mode)
  )
    await castPreview({
      app,
      qaModel: QA_MODEL,
      planOnly: mode.endsWith("-plan"),
      growth:
        mode.startsWith("--cast-growth") ||
        mode.startsWith("--cast-redesign") ||
        mode.startsWith("--growth-proof") ||
        mode.startsWith("--growth-adolescent") ||
        mode.startsWith("--cast-completion") ||
        mode.startsWith("--arbelune-"),
      redesign: mode.startsWith("--cast-redesign"),
      proof: mode.startsWith("--growth-proof"),
      adolescent: mode.startsWith("--growth-adolescent"),
      clarify: mode.startsWith("--growth-adolescent-clarification"),
      complete: mode.startsWith("--cast-completion") || mode.startsWith("--arbelune-"),
      arbelune: mode.startsWith("--arbelune-"),
      arbeluneAdolescent: mode.startsWith("--arbelune-adolescent"),
      arbeluneStudy:
        mode.startsWith("--arbelune-study") && !mode.startsWith("--arbelune-study-inspect"),
      arbeluneStudyInspect: mode.startsWith("--arbelune-study-inspect"),
      arbeluneStudyAnatomy: mode.startsWith("--arbelune-study-anatomy"),
      recover: mode.startsWith("--cast-completion-inspect"),
      lock: () => lockPilot(true),
      preflight,
    });
  else throw new Error("Mode inconnu.");
}
main().catch((error: unknown) => {
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
  console.error(
    cause?.code
      ? `Accès API indisponible (${cause.code}). Aucun secret affiché ; conserver la copie.`
      : error instanceof Error
        ? error.message
        : "Essai interrompu.",
  );
  process.exitCode = 1;
});
