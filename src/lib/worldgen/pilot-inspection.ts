import "server-only";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { jobs, worlds } from "@/lib/db/schema";
import { readHouseholdSettings } from "@/lib/parent/settings";
import type { QaConfig } from "@/config/server-config";
import { assertFutureWorld } from "./future-worlds";
import { readRuntimeCatalogue } from "./runtime-catalogue";
import { createWorldAssetStore } from "./runtime-assets";
import { parseWorldIndex } from "./worker";
import { assessWorldAssetsAsync, collectInspectableAssets, type AsyncWorldInspector } from "./qa";

/** An unavailable service is not a negative content verdict. Never retry a content rejection here. */
export function inspectionUnavailable(error: string | null): boolean {
  return /^QA kid-safe échouée : Inspection vision indisponible \(HTTP (404|429|500|502|503|504)\)/.test(
    error ?? "",
  );
}

export function loadInspectablePilot(
  db: Pick<AppDatabase, "select">,
  index: number,
  storage: string,
) {
  const candidate = loadFailedPilot(db, index, storage);
  if (candidate.world.designVersion)
    throw new Error(
      "Ce monde exige la nouvelle comparaison de milieu et de catalogue ; l’ancienne reprise de pilote ne suffit pas.",
    );
  if (!inspectionUnavailable(candidate.job.lastError))
    throw new Error(
      "Inspection seule réservée à un échec technique ; aucun refus de contenu ni monde validé ne peut être contourné.",
    );
  return candidate;
}

/** Shared read-only invariants; each recovery mode must also check its eligible failure. */
export function loadFailedPilot(db: Pick<AppDatabase, "select">, index: number, storage: string) {
  assertFutureWorld(db, index);
  if (!readHouseholdSettings(db).parentWorldValidation)
    throw new Error("Le pilote doit rester soumis à l’approbation parent.");
  const row = db.select().from(worlds).where(eq(worlds.index, index)).get();
  const candidates = db
    .select()
    .from(jobs)
    .all()
    .filter((j) => j.type === "generate_world" && parseWorldIndex(j.payload) === index);
  const job = candidates[0];
  if (row?.status !== "buffered" || candidates.length !== 1 || job.status !== "failed")
    throw new Error(
      "Un seul candidat échoué et non publié est requis ; aucun monde validé ne peut être contourné.",
    );
  const world = readRuntimeCatalogue(index, row.assetRefs, storage);
  if (world.creatures.some((c) => !c.stageArt?.[2] || !c.stageArt?.[3]))
    throw new Error("Les trois stades doivent être présents avant inspection.");
  const assets = collectInspectableAssets(world);
  // All files must exist before any API spend. The inspector validates the actual pixels.
  const store = createWorldAssetStore(storage);
  for (const asset of assets)
    if (!store.read(asset.ref).length) throw new Error("Image de pilote vide.");
  return { world, job, assets, assetRefs: row.assetRefs };
}

/** No generator dependency and no activation: only inspect the exact saved candidate. */
export async function reinspectPilotWorld(
  db: AppDatabase,
  index: number,
  storage: string,
  inspect: AsyncWorldInspector,
  config: QaConfig,
) {
  const before = loadInspectablePilot(db, index, storage);
  let reason: string | null = null;
  try {
    const verdict = await assessWorldAssetsAsync(before.world, inspect, config);
    if (!verdict.ok)
      reason = `asset "${verdict.failedAssetRef}" rejeté (règle ${verdict.failedRule})`;
  } catch (error) {
    reason = error instanceof Error ? error.message : "Inspection interrompue.";
  }
  db.transaction((tx) => {
    const current = loadInspectablePilot(tx, index, storage);
    if (
      current.assetRefs !== before.assetRefs ||
      current.job.lastError !== before.job.lastError ||
      current.job.qaAttempts !== before.job.qaAttempts
    )
      throw new Error("Le candidat a changé pendant l’inspection ; aucune validation enregistrée.");
    tx.update(jobs)
      .set(
        reason === null
          ? { status: "done", updatedAt: new Date() }
          : {
              status: "failed",
              qaAttempts: before.job.qaAttempts + 1,
              lastError: `QA kid-safe échouée : ${reason}`,
              updatedAt: new Date(),
            },
      )
      .where(eq(jobs.id, before.job.id))
      .run();
  });
  return {
    outcome: reason === null ? "done" : "failed",
    jobId: before.job.id,
    worldIndex: index,
    images: before.assets.length,
    reason,
    published: false,
  };
}
