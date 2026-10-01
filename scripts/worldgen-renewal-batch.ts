import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import * as schema from "../src/lib/db/schema";
import { loadRenewalPlan, assertRenewalRows } from "../src/lib/worldgen/creature-renewal";
import { readCatalogueArt } from "../src/lib/worldgen/creature-design-runtime";
import { assertNewNames } from "../src/lib/worldgen/creature-design";
import { resolveWorld } from "../src/lib/worldgen/socle";
import { generateImage } from "../src/lib/worldgen/image-client";
import { loadWorldGenConfig } from "../src/config/server-config";
import { reserveRequest } from "../src/lib/worldgen/runtime-assets";
import { readPilotReservedUnits, readPilotTrace } from "../src/lib/worldgen/pilot-status";
import { pilotCeilingEur } from "../src/lib/worldgen/pilot-budget";
import { loadBatchRepair } from "../src/lib/worldgen/renewal-batch-repair";
import {
  batchHash,
  batchTasks,
  pendingBatchTasks,
  generateRenewalBatch,
  BatchTransportError,
  renderBatchGallery,
  type BatchWorld,
} from "../src/lib/worldgen/renewal-batch";

type Plan = {
  version: number;
  mode: string;
  inventoryPath: string;
  inventorySha256: string;
  validatedCastApprovalSha256: string;
  sources: { path: string; sha256: string }[];
  preservedArts: { ref: string; sha256: string }[];
  worlds: (Omit<BatchWorld, "creatures"> & {
    theme: string;
    creatures: (BatchWorld["creatures"][number] & {
      id: string;
      speciesKey: string;
      rarity: string;
      inEggPool: boolean;
    })[];
  })[];
  inspections: number;
  published: boolean;
  databaseWritten: boolean;
};
export async function renewalBatch(options: {
  app: string;
  planOnly: boolean;
  repair?: boolean;
  lock: () => () => void;
  preflight: (key: string, model: string) => Promise<void>;
}) {
  const { app, planOnly } = options,
    directory = join(app, "data/teddy-world-pilot"),
    path = join(directory, "renewal-batch-plan.json");
  const bytes = readFileSync(path),
    plan: Plan = JSON.parse(bytes.toString()),
    sha = batchHash(bytes);
  const source = new Database(join(app, "data/multiplyz.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  const db = drizzle(source, { schema });
  let release: (() => void) | undefined;
  try {
    const baseline = loadRenewalPlan(app, 0, db),
      ceiling = pilotCeilingEur(directory);
    const inventoryBytes = readFileSync(join(app, plan.inventoryPath));
    if (batchHash(inventoryBytes) !== plan.inventorySha256)
      throw new Error("Inventaire du lot modifié.");
    const inventory = JSON.parse(inventoryBytes.toString());
    if (
      plan.version !== 1 ||
      plan.mode !== "generate-all-then-human-review" ||
      plan.worlds.length !== 6 ||
      plan.inspections !== 0 ||
      plan.published !== false ||
      plan.databaseWritten !== false ||
      plan.validatedCastApprovalSha256 !== baseline.validated.approvalSha256
    )
      throw new Error("Plan de génération groupée invalide.");
    plan.worlds.forEach((w, i) => {
      const expected = inventory.worlds[i];
      if (
        w.worldIndex !== i ||
        w.theme !== expected.theme ||
        w.creatures.length !== expected.creatures.length
      )
        throw new Error("Correspondance des mondes modifiée.");
      w.creatures.forEach((c, slot) => {
        const row = expected.creatures[slot];
        if (
          c.id !== row.id ||
          c.speciesKey !== row.speciesKey ||
          c.rarity !== row.rarity ||
          c.inEggPool !== row.inEggPool ||
          c.name !== row.proposed.name ||
          c.ages.length !== 3 ||
          c.ages.some(
            (a, n) =>
              a.stage !== n + 1 ||
              (i === 0
                ? typeof a.ref !== "string" || a.prompt !== undefined
                : typeof a.prompt !== "string" ||
                  a.prompt.length < 100 ||
                  a.prompt.length > 7000 ||
                  a.ref !== undefined),
          )
        )
          throw new Error("Identité ou trois âges du lot invalides.");
      });
    });
    const family = db.select().from(schema.characters).all();
    assertNewNames(
      plan.worlds.flatMap((w) => w.creatures.map((c) => c.name)),
      family
        .map((c) => c.nameDefault)
        .concat(baseline.validated.draft.plan.creatures.map((c) => c.name)),
    );
    const preserved = plan.worlds[0].creatures.flatMap((c) => c.ages.map((a) => a.ref!));
    if (
      plan.preservedArts.length !== preserved.length ||
      plan.preservedArts.some((a, i) => a.ref !== preserved[i])
    )
      throw new Error("Arts du monde 0 incomplets.");
    let repairGuard = () => {};
    const guard = () => {
      if (
        batchHash(readFileSync(path)) !== sha ||
        pilotCeilingEur(directory) !== ceiling ||
        loadRenewalPlan(app, 0, db).recipeSha256 !== baseline.recipeSha256
      )
        throw new Error("Sources du lot modifiées.");
      const actual = db.select().from(schema.characters).all();
      for (const w of inventory.worlds) {
        assertRenewalRows(
          w.creatures,
          actual.filter((c) => c.worldIndex === w.worldIndex),
        );
        if (resolveWorld(db, w.worldIndex).theme !== w.label)
          throw new Error("Thème familial modifié.");
        for (const c of w.creatures)
          for (const art of c.preservedArts)
            if (
              batchHash(
                readCatalogueArt(
                  art.ref,
                  join(app, "storage/generated"),
                  join(app, "public/generated"),
                ),
              ) !== art.sha256
            )
              throw new Error("Art familial modifié.");
      }
      for (const item of plan.sources)
        if (batchHash(readFileSync(join(app, item.path))) !== item.sha256)
          throw new Error("Source conservée modifiée.");
      for (const item of plan.preservedArts)
        if (batchHash(readFileSync(join(directory, "storage/generated", item.ref))) !== item.sha256)
          throw new Error("Image conservée modifiée.");
      repairGuard();
    };
    guard();
    const pilot = baseline.validated.draft;
    let worlds: BatchWorld[] = [
      ...plan.worlds,
      {
        worldIndex: 6,
        label: "Pilote · Jardins suspendus (conservé)",
        creatures: pilot.plan.creatures.map((c, i) => ({
          name: c.name,
          ages: [
            { stage: 1, ref: pilot.artRefs[i] },
            { stage: 2, ref: pilot.stageArt[i][2]! },
            { stage: 3, ref: pilot.stageArt[i][3]! },
          ],
        })),
      },
    ];
    const batchName = options.repair ? "renewal-batch-repair" : "renewal-batch";
    let activePlanSha = sha;
    if (options.repair) {
      const repair = loadBatchRepair(directory, worlds);
      worlds = repair.worlds;
      repairGuard = repair.verify;
      activePlanSha = batchHash(sha + repair.sha256);
      if (planOnly && !existsSync(join(directory, batchName, "started.json")))
        renderBatchGallery(directory, worlds, new Map(), batchName);
    }
    const tasks = batchTasks(worlds),
      pending = pendingBatchTasks(directory, tasks, batchName);
    const remainingUnits = () => ceiling * 1_000_000 - readPilotReservedUnits(directory);
    console.log(
      JSON.stringify(
        {
          mode: batchName,
          newImages: pending.length,
          preservedImages: worlds
            .flatMap((w) => w.creatures.flatMap((c) => c.ages))
            .filter((a) => a.ref).length,
          worldsToGenerate: [...new Set(pending.map((t) => t.worldIndex))],
          inspections: 0,
          reservedEur: readPilotReservedUnits(directory) / 1_000_000,
          plannedAdditionalEur: (pending.length * 100_000) / 1_000_000,
          plannedCumulativeEur:
            (readPilotReservedUnits(directory) + pending.length * 100_000) / 1_000_000,
          ceilingEur: ceiling,
          published: false,
        },
        null,
        2,
      ),
    );
    if (remainingUnits() < pending.length * 100_000)
      throw new Error("Budget insuffisant pour tout le lot.");
    if (planOnly) return;
    release = options.lock();
    guard();
    const oldEnv = join(app, "../multiplyz/.env");
    const apiKey =
      process.env.GEMINI_API_KEY ||
      (existsSync(oldEnv) ? parseEnv(readFileSync(oldEnv, "utf8")).GEMINI_API_KEY : undefined);
    if (!apiKey) throw new Error("GEMINI_API_KEY absente.");
    const model = "gemini-2.5-flash-image";
    if (pending.length) await options.preflight(apiKey, model);
    const config = { ...loadWorldGenConfig({}), maxRetries: 0 };
    const runId = randomUUID();
    let call = Math.max(0, ...readPilotTrace(directory).map((e) => e.call));
    const result = await generateRenewalBatch({
      directory,
      worlds,
      planSha256: activePlanSha,
      batchName,
      guard,
      remainingUnits,
      generate: async (task, checkpoint) => {
        console.log(
          `[lot] Monde ${task.worldIndex} · ${task.name} · ${["", "bébé", "ado", "adulte"][task.stage]}…`,
        );
        const heartbeat = setInterval(() => console.log("[lot] Gemini travaille encore…"), 30000);
        try {
          return await generateImage(
            { prompt: task.prompt },
            {
              config,
              apiKey,
              model,
              fetchImpl: async (input, init) => {
                guard();
                if (remainingUnits() < 100_000)
                  throw new BatchTransportError("Plafond cumulé atteint.");
                reserveRequest(
                  join(directory, "storage/worldgen/budget"),
                  0.1,
                  ceiling,
                  new Date(),
                );
                const id = ++call;
                const record = (data: object) =>
                  appendFileSync(
                    join(directory, "requests.jsonl"),
                    JSON.stringify({
                      call: id,
                      runId,
                      phase: batchName,
                      task: task.key,
                      at: new Date().toISOString(),
                      ...data,
                    }) + "\n",
                  );
                record({ type: "image", model, prompts: [task.prompt], referenceSha256: [] });
                let response: Response;
                try {
                  response = await fetch(input, { ...init, signal: AbortSignal.timeout(120_000) });
                } catch {
                  throw new BatchTransportError(
                    "Connexion interrompue ; budget conservé, reprendre avec la même commande.",
                  );
                }
                const output = await response
                    .clone()
                    .json()
                    .catch(() => null),
                  candidate = output?.candidates?.[0];
                record({
                  status: response.status,
                  finishReason: candidate?.finishReason,
                  blockReason: output?.promptFeedback?.blockReason,
                });
                if (!response.ok)
                  throw new BatchTransportError(
                    `HTTP ${response.status} ; lot suspendu, aucun retry automatique.`,
                  );
                const part = candidate?.content?.parts?.find(
                  (p: { inlineData?: { data?: string } }) => p.inlineData?.data,
                );
                if (
                  candidate?.finishReason === "STOP" &&
                  !output?.promptFeedback?.blockReason &&
                  part
                ) {
                  const raw = Buffer.from(part.inlineData.data, "base64");
                  mkdirSync(join(directory, "storage/worldgen/raw"), { recursive: true });
                  writeFileSync(join(directory, "storage/worldgen/raw", `${id}-0.png`), raw, {
                    flag: "wx",
                  });
                  writeFileSync(join(checkpoint, "raw.png"), raw, { flag: "wx" });
                }
                return response;
              },
            },
          );
        } catch (error) {
          const reason = (
            error instanceof Error ? error.message : "Échec de génération."
          ).replaceAll(apiKey, "<REDACTED>");
          throw error instanceof BatchTransportError
            ? new BatchTransportError(reason)
            : new Error(reason);
        } finally {
          clearInterval(heartbeat);
        }
      },
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    release?.();
    source.close();
  }
}
