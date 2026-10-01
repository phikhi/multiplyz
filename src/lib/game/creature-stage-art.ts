import { isRenderableAssetRef } from "./world-theme";

export interface StageCatalogue {
  readonly artRef: string;
  readonly artRefStages: string | null;
  readonly maxStage: number;
}

/** Catalogue contract: {"2": "socle/creature/…-ado.png", "3": "…-adulte.png"}. */
export function stageArtRefs(catalogue: StageCatalogue): readonly string[] {
  const refs = [catalogue.artRef];
  let parsed: unknown;
  try {
    parsed = JSON.parse(catalogue.artRefStages ?? "null");
  } catch {
    return refs;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return refs;
  for (const stage of [2, 3]) {
    if (stage > catalogue.maxStage) break;
    const ref = (parsed as Record<string, unknown>)[String(stage)];
    if (typeof ref !== "string" || !isRenderableAssetRef(ref) || refs.includes(ref)) break;
    refs.push(ref);
  }
  return refs;
}

/** Missing stage art remains visibly unavailable, never re-labelled baby art. */
export function creatureStageArt(catalogue: StageCatalogue, stage: number): string {
  return stageArtRefs(catalogue)[stage - 1] ?? "placeholder://stage-unavailable";
}
