import { and, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { stageArtRefs } from "@/lib/game/creature-stage-art";

export interface ReviewedStageArt {
  readonly characterId: string;
  readonly species: string;
  readonly baseArtRef: string;
  readonly baseSha256: string;
  readonly stages: Readonly<Record<"2" | "3", { readonly ref: string; readonly sha256: string }>>;
}

/** Only adds reviewed stages to an unchanged baby catalogue. Never writes possessions or base art. */
export function publishCreatureStages(
  db: AppDatabase,
  reviewed: readonly ReviewedStageArt[],
): string[] {
  return db.transaction(
    (tx) => {
      const published: string[] = [];
      for (const art of reviewed) {
        const artRefStages = JSON.stringify({ 2: art.stages[2].ref, 3: art.stages[3].ref });
        if (stageArtRefs({ artRef: art.baseArtRef, artRefStages, maxStage: 3 }).length !== 3)
          throw new Error(`Invalid reviewed stage refs: ${art.characterId}`);
        const updated = tx
          .update(characters)
          .set({ maxStage: 3, artRefStages })
          .where(
            and(
              eq(characters.id, art.characterId),
              eq(characters.speciesKey, art.species),
              eq(characters.artRef, art.baseArtRef),
              eq(characters.maxStage, 1),
              isNull(characters.artRefStages),
            ),
          )
          .returning({ id: characters.id })
          .get();
        if (updated) published.push(updated.id);
      }
      return published;
    },
    { behavior: "immediate" },
  );
}
