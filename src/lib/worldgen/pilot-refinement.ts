import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { jobs, worlds } from "@/lib/db/schema";
import type { WorldGenConfig } from "@/config/server-config";
import { ESTIMATED_EUR_PER_IMAGE, type GeneratedWorld } from "./generate-world";
import type { GenerateImageInput } from "./image-client";
import type { PilotTraceEntry } from "./pilot-status";
import { buildCreatureStagePrompt, cutoutNewCreature } from "./creature-growth";
import { loadFailedPilot } from "./pilot-inspection";
import { createWorldAssetStore } from "./runtime-assets";
import { saveRuntimeCatalogue } from "./runtime-catalogue";
import {
  assessAsset,
  collectInspectableAssets,
  type AssetInspection,
  type AsyncWorldInspector,
  type InspectableAsset,
} from "./qa";

type VisionRequest = {
  contents: { parts: { text?: string; inlineData?: { data: string } }[] }[];
};

/** Planning evidence only. NEVER supply this archive to the final validation inspector.
 * Historical logs lack finishReason: only a complete parsed diagnostic can inform the plan.
 * The fresh final pass requires the real response's STOP and all current signals.
 */
export function recordedDiagnostic(entries: PilotTraceEntry[], model: string, body: VisionRequest) {
  const parts = body.contents[0].parts;
  const prompts = parts.flatMap((p) => (p.text ? [p.text] : []));
  const hashes = parts.flatMap((p) =>
    p.inlineData
      ? [createHash("sha256").update(Buffer.from(p.inlineData.data, "base64")).digest("hex")]
      : [],
  );
  const request = entries.findLast(
    (e) =>
      e.type === "vision" &&
      e.model === model &&
      JSON.stringify(e.prompts) === JSON.stringify(prompts) &&
      JSON.stringify(e.referenceSha256) === JSON.stringify(hashes),
  );
  const response =
    request && entries.findLast((e) => e.call === request.call && e.status !== undefined);
  if (
    !response ||
    response.status !== 200 ||
    !response.verdict?.length ||
    response.blockReason ||
    (response.finishReason && response.finishReason !== "STOP")
  )
    return;
  return {
    call: request!.call,
    body: {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: response.verdict.map((text) => ({ text })),
          },
        },
      ],
    },
  };
}

export function loadRefinablePilot(
  db: Pick<AppDatabase, "select">,
  index: number,
  storage: string,
) {
  const candidate = loadFailedPilot(db, index, storage);
  if (candidate.world.designVersion)
    throw new Error(
      "Ce monde exige la nouvelle comparaison de milieu et de catalogue ; l’ancienne correction de pilote ne suffit pas.",
    );
  const rejected = candidate.job.lastError?.match(
    /^QA kid-safe échouée : asset "([^"]+)" rejeté \(règle style_coherence\)$/,
  );
  if (!rejected || !candidate.assets.some((a) => a.stage && a.ref === rejected[1]))
    throw new Error(
      "Correction ciblée réservée à un stade refusé pour identité, croissance ou style.",
    );
  return candidate;
}

export interface PilotAssetCheck {
  asset: InspectableAsset;
  inspection: AssetInspection;
  reason: string | null;
}

async function checkAll(
  world: GeneratedWorld,
  inspect: AsyncWorldInspector,
  config: WorldGenConfig,
) {
  const checks: PilotAssetCheck[] = [];
  // Finish the diagnostic even when a content verdict fails; API errors still stop immediately.
  for (const asset of collectInspectableAssets(world)) {
    const inspection = await inspect(asset);
    const verdict = assessAsset(inspection, config.qa);
    const details = [
      inspection.identityMatches === false ? "identité différente" : null,
      inspection.growthVisible === false ? "croissance insuffisante" : null,
    ].filter(Boolean);
    checks.push({
      asset,
      inspection,
      reason: verdict.ok
        ? null
        : `${verdict.failedRule}${details.length ? ` : ${details.join(", ")}` : ""}`,
    });
  }
  return checks;
}

export interface RefinementDeps {
  config: WorldGenConfig;
  diagnose: AsyncWorldInspector;
  /** Must perform fresh vision I/O, never use recordedDiagnostic. */
  inspectFresh: AsyncWorldInspector;
  generate: (input: GenerateImageInput) => Promise<Buffer>;
  remainingUnits: () => number;
  onDiagnostic: (checks: PilotAssetCheck[]) => void;
  onCandidate: (world: GeneratedWorld) => void;
  onValidation: (checks: PilotAssetCheck[]) => void;
}

/** One correction per failed older stage, then a fresh check of ALL saved candidate pixels.
 * Only the isolated pilot invokes this; no worker retries or parent/publication guards are changed.
 */
export async function refinePilotWorld(
  db: AppDatabase,
  index: number,
  storage: string,
  deps: RefinementDeps,
) {
  const before = loadRefinablePilot(db, index, storage);
  const assertUnchanged = (database: Pick<AppDatabase, "select"> = db) => {
    const current = loadRefinablePilot(database, index, storage);
    if (
      current.assetRefs !== before.assetRefs ||
      current.job.id !== before.job.id ||
      current.job.qaAttempts !== before.job.qaAttempts ||
      current.job.lastError !== before.job.lastError
    )
      throw new Error("Le pilote a changé pendant la correction ; aucune validation enregistrée.");
  };
  const diagnostic = await checkAll(before.world, deps.diagnose, deps.config);
  deps.onDiagnostic(diagnostic);
  const failures = diagnostic.filter((c) => c.reason);
  if (
    !failures.length ||
    failures.some((c) => !c.asset.stage || !c.reason!.startsWith("style_coherence"))
  )
    throw new Error(
      "Diagnostic à examiner : cette passe corrige uniquement les stades refusés pour style/identité/croissance.",
    );
  const requiredUnits = failures.length * 100_000 + before.assets.length * 50_000;
  if (deps.remainingUnits() < requiredUnits)
    throw new Error(
      `Budget insuffisant pour ${failures.length} correction(s) et la validation complète ; aucune image régénérée.`,
    );
  assertUnchanged();
  const store = createWorldAssetStore(storage);
  const creatures = before.world.creatures.map((c) => ({
    ...c,
    stageArt: { ...c.stageArt! },
    stagePrompts: { ...c.stagePrompts! },
  }));
  for (const [slot, creature] of creatures.entries()) {
    for (const stage of [2, 3] as const) {
      const rejected = failures.find((c) => c.asset.ref === creature.stageArt![stage]);
      if (!rejected) continue;
      assertUnchanged();
      const prompt = `${buildCreatureStagePrompt(deps.config, stage)}
Correction of a rejected growth illustration: ${rejected.reason}.
Make the BODY itself visibly older: substantially lengthen the existing torso relative to the head, reduce the head-to-body ratio, and develop the existing neck, legs, tail or wings only where present in the canonical baby.
Opening wings, changing a pose, adding decoration or enlarging the whole image does not show growth. Keep every defining motif and the exact number and type of appendages: feathered wings stay feathered, membranes stay membranes. Never add tentacles, limbs or a new crown to suggest age.
Identity is anchored to image 1, including when the adolescent reference has drifted. Keep the same soft illustration style and friendly expression.`;
      const references = [store.read(creature.artRef)];
      if (stage === 3) references.push(store.read(creature.stageArt![2]));
      const pixels = await cutoutNewCreature(
        await deps.generate({
          prompt,
          refImages: references.map((data) => ({ data, mimeType: "image/png" })),
        }),
      );
      if (
        references.some((ref) => pixels.equals(ref)) ||
        pixels.equals(store.read(creature.stageArt![stage]))
      )
        throw new Error("La correction recopie un art existant ; aucun nouvel essai automatique.");
      const name = creature.rarity === "legendary" ? "legendary" : `creature-${slot}`;
      creature.stageArt = {
        ...creature.stageArt!,
        [stage]: await store.write(index, `${name}-${stage === 2 ? "ado" : "adulte"}.png`, pixels),
      };
      creature.stagePrompts = { ...creature.stagePrompts!, [stage]: prompt };
    }
  }
  // A new background filename gives the revised manifest an immutable, independent identity.
  // The image pixels are copied locally, with no extra generation call.
  const paidImageCalls = before.world.cost.paidImageCalls + failures.length;
  const candidate: GeneratedWorld = {
    ...before.world,
    creatures,
    assetRefs: {
      ...before.world.assetRefs,
      background: await store.write(
        index,
        "background.png",
        store.read(before.world.assetRefs.background),
      ),
    },
    cost: {
      ...before.world.cost,
      paidImageCalls,
      estimatedEur: paidImageCalls * ESTIMATED_EUR_PER_IMAGE,
    },
  };
  saveRuntimeCatalogue(storage, candidate);
  deps.onCandidate(candidate);
  const validation = await checkAll(
    candidate,
    async (asset) => {
      assertUnchanged();
      return deps.inspectFresh(asset);
    },
    deps.config,
  );
  deps.onValidation(validation);
  const rejected = validation.filter((c) => c.reason);
  db.transaction((tx) => {
    assertUnchanged(tx);
    // A rejected revision remains archived; the old candidate and its failure remain untouched.
    if (rejected.length) return;
    tx.update(worlds)
      .set({ assetRefs: JSON.stringify(candidate.assetRefs) })
      .where(eq(worlds.index, index))
      .run();
    tx.update(jobs)
      .set({
        status: "done",
        qaAttempts: before.job.qaAttempts + 1,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, before.job.id))
      .run();
  });
  return {
    outcome: rejected.length ? "failed" : "done",
    worldIndex: index,
    jobId: before.job.id,
    correctedImages: failures.length,
    inspectedImages: validation.length,
    rejections: rejected,
    published: false,
    parentApprovalRequired: true,
  };
}
