/** Direct Node entry point. Default --check is read-only; never migrates, seeds or resets a DB. */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, openSync, writeFileSync, closeSync, unlinkSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import * as schema from "../src/lib/db/schema";
import { getConfig, getWorldGenConfig } from "../src/config/server-config";
import { getApprovedMaster } from "../src/lib/worldgen/reference-assets";
import { readMasterBytesFromDisk } from "../src/lib/worldgen/socle-assets";
import { lastReservedWorld, socleSize } from "../src/lib/worldgen/future-worlds";
import { createWorldRuntime } from "../src/lib/worldgen/runtime";

async function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--once", "--daemon"].includes(mode) || process.argv.length > 3)
    throw new Error("Usage : worldgen-worker.ts [--check|--once|--daemon]");
  const path = resolve(process.env.DATABASE_PATH ?? "data/multiplyz.sqlite");
  const sqlite = new Database(path, { readonly: mode === "--check", fileMustExist: true });
  const db = drizzle(sqlite, { schema });
  let lock: string | undefined;
  try {
    const config = getWorldGenConfig();
    const model = getConfig().imageModel;
    const master = getApprovedMaster(db);
    const missing: string[] = [];
    if (!model.apiKey) missing.push("GEMINI_API_KEY");
    if (!process.env.WORLDGEN_QA_MODEL) missing.push("WORLDGEN_QA_MODEL");
    for (const key of ["WORLDGEN_IMAGE_RESERVATION_EUR", "WORLDGEN_QA_RESERVATION_EUR"]) {
      if (!(Number(process.env[key]) > 0) || !Number.isFinite(Number(process.env[key])))
        missing.push(key);
    }
    try {
      if (!master) throw new Error("master");
      readMasterBytesFromDisk(master.assetRef);
    } catch {
      missing.push("master Teddy approuvé présent sur disque");
    }
    const current = lastReservedWorld(db);
    const socle = socleSize(db);
    const targets = Array.from({ length: config.bufferAhead }, (_, i) => current + i + 1).filter(
      (i) => i >= socle,
    );
    const lockPath = join(dirname(path), "worldgen-worker.lock");
    if (existsSync(lockPath))
      missing.push(
        "verrou worker déjà présent (vérifier le processus avant de retirer un verrou orphelin)",
      );
    if (mode === "--check") {
      console.log(
        JSON.stringify(
          {
            mode: "lecture seule",
            socle,
            dernierMondeReserve: current,
            cibles: targets,
            plafondMensuelEur: config.monthlyBudgetEur,
            prerequisManquants: missing,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (missing.length) throw new Error("Prérequis manquants : " + missing.join(", "));
    mkdirSync(dirname(lockPath), { recursive: true });
    const fd = openSync(lockPath, "wx");
    lock = lockPath;
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    } finally {
      closeSync(fd);
    }
    sqlite.pragma("foreign_keys=ON");
    sqlite.pragma("busy_timeout=5000");
    const worker = createWorldRuntime(db, {
      cwd: process.cwd(),
      apiKey: model.apiKey,
      imageModel: model.model,
      qaModel: process.env.WORLDGEN_QA_MODEL!,
      config,
      imageReservationEur: Number(process.env.WORLDGEN_IMAGE_RESERVATION_EUR),
      qaReservationEur: Number(process.env.WORLDGEN_QA_RESERVATION_EUR),
    });
    let stopping = false,
      wake: (() => void) | undefined;
    const stop = () => {
      stopping = true;
      wake?.();
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    try {
      let first = true;
      do {
        const result = await worker.tick(first);
        first = false;
        console.log(JSON.stringify(result));
        if (mode === "--once" || stopping) break;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 30_000);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = undefined;
      } while (!stopping);
    } finally {
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
    }
  } finally {
    if (lock) unlinkSync(lock);
    sqlite.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Échec du worker.");
  process.exitCode = 1;
});
