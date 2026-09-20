import "server-only";
import sharp from "sharp";
import type { WorldGenConfig } from "@/config/server-config";
import { floodFillTransparency } from "@/lib/image/flood-fill-transparency";
import { nativeCreatureStyle } from "./creature-design";
import {
  ESTIMATED_EUR_PER_IMAGE,
  type GeneratedCreature,
  type GeneratedWorld,
  type GenerateWorldDeps,
} from "./generate-world";

/** White-background extraction preserves enclosed pale markings. Existing delivered art is never edited. */
export async function cutoutNewCreature(bytes: Buffer): Promise<Buffer> {
  const image = sharp(bytes, { limitInputPixels: 40_000_000 });
  const stats = await image.stats();
  // Keep a genuine alpha channel; do not flatten an already transparent image.
  if (stats.channels.length === 4 && stats.channels[3].min < 255) {
    const rgba = await image.ensureAlpha().raw().toBuffer();
    let clear = 0,
      opaque = 0;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] === 0) clear++;
      if (rgba[i] >= 240) opaque++;
    }
    if (clear / (rgba.length / 4) < 0.05 || opaque / (rgba.length / 4) < 0.03)
      throw new Error("Détourage non fiable : silhouette transparente absente ou presque vide.");
    return image.png().toBuffer();
  }
  const { data, info } = await image
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 3) {
    const lo = Math.min(data[i], data[i + 1], data[i + 2]),
      hi = Math.max(data[i], data[i + 1], data[i + 2]);
    const bg = lo >= 236 && hi - lo <= 16;
    mask[i] = mask[i + 1] = mask[i + 2] = bg ? 255 : 0;
  }
  let border = 0,
    whiteBorder = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (x !== 0 && y !== 0 && x !== info.width - 1 && y !== info.height - 1) continue;
      border++;
      if (mask[(y * info.width + x) * 3] === 255) whiteBorder++;
    }
  if (whiteBorder / border < 0.95)
    throw new Error("Détourage non fiable : le fond doit être blanc et dégagé aux bords.");
  const rgba = floodFillTransparency({
    data: mask,
    width: info.width,
    height: info.height,
    channels: 3,
    fuzz: 40,
  });
  let transparent = 0;
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    rgba[j] = data[i];
    rgba[j + 1] = data[i + 1];
    rgba[j + 2] = data[i + 2];
    if (rgba[j + 3] === 0) transparent++;
  }
  // An unrecognised matte or empty cutout must not silently erase the subject.
  const fraction = transparent / (info.width * info.height);
  if (fraction < 0.05 || fraction > 0.97)
    throw new Error("Détourage non fiable : inspecter le fond et la silhouette.");
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

export function buildCreatureStagePrompt(config: WorldGenConfig, stage: 2 | 3): string {
  const ageStyle = config.prompts.style
    .replace("cute chibi proportions", "clearly developed older-age anatomical proportions")
    .replace(
      "big shiny friendly eyes",
      "friendly eyes proportioned for this older age, with the same iris colour and gentle expression",
    );
  return `${ageStyle}.
Use case: identity-preserving collectible creature growth.
Image 1 is the EXACT BABY and the identity reference. Keep its species, colours, markings, face and defining motifs.
The reference fixes identity, NOT body proportions, age, pose or composition. REDRAW the older anatomy; do not trace the baby's silhouette or keep its oversized baby head.
${stage === 3 ? "Image 2 is its ADOLESCENT stage: the adult must be visibly more developed than both references." : "Create its ADOLESCENT stage, visibly older than this baby."}
Draw one full-body ${stage === 2 ? "ADOLESCENT" : "ADULT"} of this same companion in a new gentle three-quarter pose.
${stage === 2 ? "Lengthen the torso and develop its existing limbs, wings or fins. Lively young proportions around 2.5 heads tall where the species permits." : "Develop a clearly mature, taller or longer body with broad existing appendages and a confident, kind pose. Around three heads tall where the species permits."}
The silhouette and anatomy must genuinely change; never simply scale, mirror or recolour the previous stage.
Growth must be obvious even when both images are displayed at the same overall size: a smaller relative facial area, visibly developed existing body structures and more mature proportions. A changed tail curl, root colour, small surface detail or new camera angle is not growth.
Do not invent unrelated clothing, new species or extra eyes or limbs. Stay round, cute, gentle; no muscles, armour or combat.
Square composition, centred full body, 10% empty margin, one creature, plain uniform white background for edge-connected cutout.
No text, stage labels, watermark, shadows on the floor or detached particles. Negative: ${config.prompts.negative}`;
}

type GrowthDeps = Pick<GenerateWorldDeps, "generate" | "writeAsset" | "config"> & {
  readAsset: (ref: string) => Buffer;
  onStage?: (stage: 2 | 3, ref: string, prompt: string) => void;
  correction?: (stage: 2 | 3) => string;
};

/** Canonical references stay unchanged; each completed stage can be journalled before the next call. */
export async function generateCreatureStages(
  creature: GeneratedCreature,
  worldIndex: number,
  slot: number,
  deps: GrowthDeps,
): Promise<GeneratedCreature> {
  const baby = deps.readAsset(creature.artRef);
  let adolescent: Buffer | undefined;
  const stageArt = {} as Record<"2" | "3", string>;
  const stagePrompts = {} as Record<"2" | "3", string>;
  for (const stage of [2, 3] as const) {
    const config = creature.design
      ? {
          ...deps.config,
          prompts: {
            ...deps.config.prompts,
            style: nativeCreatureStyle(deps.config.prompts.style),
          },
        }
      : deps.config;
    const prompt =
      buildCreatureStagePrompt(config, stage) +
      (creature.design
        ? `\nCanonical species: ${creature.design.anatomy}. Preserve: ${creature.design.signature}.
Environmental adaptation: ${creature.design.adaptation}. Role: ${creature.design.role}.
Required ${stage === 2 ? "ADOLESCENT" : "ADULT"} anatomy: ${deps.correction?.(stage) || (stage === 2 ? creature.design.adolescent : creature.design.adult)}.
Keep its native habitat adaptations and its own colours. Never change the type or count of appendages to simulate growth.`
        : "");
    const references = [{ data: baby, mimeType: "image/png" }];
    if (adolescent) references.push({ data: adolescent, mimeType: "image/png" });
    const png = await deps.generate({ prompt, refImages: references });
    const cutout = await cutoutNewCreature(png);
    if (cutout.equals(baby) || (adolescent && cutout.equals(adolescent)))
      throw new Error("Un stade généré recopie un art précédent.");
    const name = creature.rarity === "legendary" ? "legendary" : `creature-${slot}`;
    stageArt[stage] = await deps.writeAsset(
      worldIndex,
      `${name}-${stage === 2 ? "ado" : "adulte"}.png`,
      cutout,
    );
    stagePrompts[stage] = prompt;
    deps.onStage?.(stage, stageArt[stage], prompt);
    if (stage === 2) adolescent = cutout;
  }
  return { ...creature, stageArt, stagePrompts };
}

/** Enrich only this new candidate; reuse the canonical baby and never the Teddy master as a creature reference. */
export async function generateCreatureGrowth(
  world: GeneratedWorld,
  deps: GrowthDeps,
): Promise<GeneratedWorld> {
  const creatures: GeneratedCreature[] = [];
  for (const [slot, creature] of world.creatures.entries())
    creatures.push(await generateCreatureStages(creature, world.worldIndex, slot, deps));
  const calls = world.cost.paidImageCalls + creatures.length * 2;
  return {
    ...world,
    creatures,
    cost: { ...world.cost, paidImageCalls: calls, estimatedEur: calls * ESTIMATED_EUR_PER_IMAGE },
  };
}
