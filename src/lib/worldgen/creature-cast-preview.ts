import "server-only";
import type { WorldGenConfig } from "@/config/server-config";
import { buildCreaturePrompt } from "./generate-world";
import {
  designedCreaturePrompt,
  nativeCreatureStyle,
  type WorldCreatureDesign,
} from "./creature-design";
import { cutoutNewCreature } from "./creature-growth";
import { createWorldAssetStore } from "./runtime-assets";
import type { GenerateImageInput } from "./image-client";
import { assessAsset, type AssetInspection, type InspectableAsset } from "./qa";

export interface CastDraft {
  plan: WorldCreatureDesign;
  artRefs: string[];
}

type CastDependencies = Parameters<typeof previewCreatureCast>[2];
export type BabyCheck = {
  name: string;
  ref: string;
  inspection: AssetInspection;
  verdict: ReturnType<typeof assessAsset>;
};

async function inspectBaby(
  draft: CastDraft,
  slot: number,
  deps: CastDependencies,
): Promise<BabyCheck> {
  const ref = draft.artRefs[slot];
  const inspection = await deps.inspect({ ref, kind: "creature" }, draft);
  if (
    typeof inspection.habitatMatches !== "boolean" ||
    typeof inspection.visuallyDistinct !== "boolean"
  )
    throw new Error("Verdict de milieu et de ressemblance absent.");
  const verdict = assessAsset(inspection, deps.config.qa);
  const check = { name: draft.plan.creatures[slot].name, ref, inspection, verdict };
  deps.onCheck?.(check);
  return check;
}

async function generateBaby(plan: WorldCreatureDesign, slot: number, deps: CastDependencies) {
  const creature = plan.creatures[slot];
  const config = babyConfig(deps.config);
  const prompt =
    buildCreaturePrompt(
      config,
      { concept: creature.anatomy, features: creature.signature },
      "individual natural colours, adapted to its material",
    ) + `\n${designedCreaturePrompt(creature, plan.habitat)}`;
  return cutoutNewCreature(await deps.generate({ prompt }));
}

function babyConfig(config: WorldGenConfig): WorldGenConfig {
  return {
    ...config,
    prompts: {
      ...config.prompts,
      style: nativeCreatureStyle(config.prompts.style),
      creature:
        config.prompts.creature
          .replace(
            "a cute round collectible creature",
            "a gentle collectible creature with a distinctive anatomical silhouette",
          )
          .replace(/transparent background/gi, "plain uniform white background") +
        ". BABY proportions, one full-body companion, 10% empty margin. No floor shadow, no detached particles, no checkerboard.",
    },
  };
}

/** Replace one rejected baby only; inspect it first, then all unchanged peers against the final cast. */
export async function repairCreatureCast(
  source: CastDraft,
  plan: WorldCreatureDesign,
  slot: number,
  storage: string,
  deps: CastDependencies,
) {
  if (
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot >= source.artRefs.length ||
    source.artRefs.length !== plan.creatures.length ||
    source.plan.worldIndex !== plan.worldIndex ||
    source.plan.creatures.some(
      (c, i) =>
        c.name !== plan.creatures[i].name ||
        (i !== slot && JSON.stringify(c) !== JSON.stringify(plan.creatures[i])),
    )
  )
    throw new Error("Correction limitée à une identité et au groupe conservé.");
  if (deps.remainingUnits() < 100_000 + plan.creatures.length * 50_000)
    throw new Error("Budget insuffisant pour une correction et toute sa validation.");
  const store = createWorldAssetStore(storage);
  const bytes = await generateBaby(plan, slot, deps);
  if (source.artRefs.some((ref) => bytes.equals(store.read(ref))))
    throw new Error("La correction reprend les mêmes pixels qu’un bébé existant.");
  const refs = [...source.artRefs];
  refs[slot] = await store.write(
    plan.worldIndex,
    `${slot === refs.length - 1 ? "legendary" : `creature-${slot}`}.png`,
    bytes,
  );
  const draft = { plan, artRefs: refs };
  deps.onImage?.(draft);
  deps.onDraft(draft);
  const checks = [await inspectBaby(draft, slot, deps)];
  if (checks[0].verdict.ok)
    for (let i = 0; i < refs.length; i++)
      if (i !== slot) checks.push(await inspectBaby(draft, i, deps));
  checks.sort((a, b) => refs.indexOf(a.ref) - refs.indexOf(b.ref));
  const fullValidation = checks.length === refs.length && checks.every((c) => c.verdict.ok);
  return {
    outcome: fullValidation ? "passed-for-visual-review" : "rejected",
    checks,
    images: refs.length,
    inspectedImages: checks.length,
    fullValidation,
    generatedImages: 1,
    reusedImages: refs.length - 1,
    published: false,
    growthGenerated: false,
  };
}

/** Baby identities only, never a complete world or a playable catalogue. No DB dependency. */
export async function previewCreatureCast(
  plan: WorldCreatureDesign,
  storage: string,
  deps: {
    config: WorldGenConfig;
    remainingUnits: () => number;
    generate: (input: GenerateImageInput) => Promise<Buffer>;
    inspect: (asset: InspectableAsset, draft: CastDraft) => Promise<AssetInspection>;
    onDraft: (draft: CastDraft) => void;
    onImage?: (draft: CastDraft) => void;
    onCheck?: (check: BabyCheck) => void;
  },
) {
  if (deps.remainingUnits() < plan.creatures.length * 150_000)
    throw new Error("Budget insuffisant pour les bébés et leur inspection ; aucun appel envoyé.");
  const store = createWorldAssetStore(storage);
  const artRefs: string[] = [];
  for (let slot = 0; slot < plan.creatures.length; slot++) {
    const bytes = await generateBaby(plan, slot, deps);
    if (artRefs.some((ref) => bytes.equals(store.read(ref))))
      throw new Error("Deux nouveaux bébés recopient les mêmes pixels ; aperçu arrêté.");
    const name = slot === plan.creatures.length - 1 ? "legendary" : `creature-${slot}`;
    artRefs.push(await store.write(plan.worldIndex, `${name}.png`, bytes));
    deps.onImage?.({ plan, artRefs: [...artRefs] });
  }
  const draft = { plan, artRefs };
  deps.onDraft(draft);
  const checks = [];
  for (let slot = 0; slot < artRefs.length; slot++)
    checks.push(await inspectBaby(draft, slot, deps));
  return {
    outcome: checks.every((c) => c.verdict.ok) ? "passed-for-visual-review" : "rejected",
    checks,
    images: artRefs.length,
    published: false,
    growthGenerated: false,
  };
}
