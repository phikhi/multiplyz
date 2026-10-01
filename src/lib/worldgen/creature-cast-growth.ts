import "server-only";
import type { WorldGenConfig } from "@/config/server-config";
import type { CastDraft } from "./creature-cast-preview";
import { deriveSocleCreatures } from "./creature-catalog";
import { generateCreatureStages } from "./creature-growth";
import type { GenerateImageInput } from "./image-client";
import { createWorldAssetStore } from "./runtime-assets";
import { assessAsset, type AssetInspection, type InspectableAsset } from "./qa";

export interface CastGrowthDraft extends CastDraft {
  stageArt: Partial<Record<"2" | "3", string>>[];
}

/** Twelve older stages anchored on approved babies; fresh QA for all eighteen arts, no database. */
export async function previewCastGrowth(
  cast: CastDraft,
  storage: string,
  deps: {
    config: WorldGenConfig;
    remainingUnits: () => number;
    generate: (input: GenerateImageInput) => Promise<Buffer>;
    inspect: (asset: InspectableAsset, draft: CastGrowthDraft) => Promise<AssetInspection>;
    onDraft: (draft: CastGrowthDraft) => void;
    onCheck: (check: unknown) => void;
    stageInstructions?: (slot: number, stage: 2 | 3) => string;
    excludedArts?: readonly string[];
  },
) {
  const { plan } = cast;
  if (deps.remainingUnits() < plan.creatures.length * 350_000)
    throw new Error(
      "Budget insuffisant pour les évolutions et la QA complète ; aucun appel envoyé.",
    );
  if (
    cast.artRefs.length !== plan.creatures.length ||
    new Set(cast.artRefs).size !== cast.artRefs.length
  )
    throw new Error("Références des bébés incomplètes ou répétées.");
  const store = createWorldAssetStore(storage);
  const draft: CastGrowthDraft = { ...cast, stageArt: plan.creatures.map(() => ({})) };
  const existing = [...cast.artRefs, ...(deps.excludedArts ?? [])].map((ref) => store.read(ref));
  const descriptors = deriveSocleCreatures(plan.worldIndex);
  deps.onDraft(draft);
  for (const [slot, design] of plan.creatures.entries()) {
    await generateCreatureStages(
      {
        ...descriptors[slot],
        nameDefault: design.name,
        story: design.story,
        artRef: cast.artRefs[slot],
        design,
      },
      plan.worldIndex,
      slot,
      {
        config: deps.config,
        generate: deps.generate,
        readAsset: store.read,
        correction: deps.stageInstructions
          ? (stage) => deps.stageInstructions!(slot, stage)
          : undefined,
        async writeAsset(index, name, bytes) {
          if (existing.some((old) => old.equals(bytes)))
            throw new Error("Un nouveau stade recopie les pixels d’un compagnon existant.");
          const ref = await store.write(index, name, bytes);
          existing.push(store.read(ref));
          return ref;
        },
        onStage(stage, ref) {
          draft.stageArt[slot][stage] = ref;
          deps.onDraft(draft);
        },
      },
    );
  }
  const checks = [];
  for (const [slot, babyRef] of cast.artRefs.entries()) {
    for (const stage of [1, 2, 3] as const) {
      const ref = stage === 1 ? babyRef : draft.stageArt[slot][stage]!;
      const asset: InspectableAsset = {
        kind: "creature",
        ref,
        ...(stage === 1 ? {} : { stage, babyRef }),
        ...(stage === 3 ? { previousRef: draft.stageArt[slot][2]! } : {}),
      };
      const inspection = await deps.inspect(asset, draft);
      const required = [
        inspection.habitatMatches,
        inspection.visuallyDistinct,
        ...(stage === 1 ? [] : [inspection.identityMatches, inspection.growthVisible]),
      ];
      if (required.some((signal) => typeof signal !== "boolean"))
        throw new Error("Signaux de comparaison/croissance absents.");
      const verdict = assessAsset(inspection, deps.config.qa);
      const check = { name: plan.creatures[slot].name, slot, stage, ref, inspection, verdict };
      checks.push(check);
      deps.onCheck(check);
    }
  }
  return {
    outcome: checks.every((c) => c.verdict.ok) ? "passed-for-visual-review" : "rejected",
    checks,
    images: plan.creatures.length * 3,
    generatedImages: plan.creatures.length * 2,
    reusedBabies: cast.artRefs.length,
    published: false,
    growthGenerated: true,
  };
}
