"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getEconomyConfig } from "@/config/server-config";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { acknowledgeEvolution, evolveCompanion, loadEvolutionState } from "@/lib/game/evolution";
import type { EvolutionReceipt, EvolutionResult, EvolutionState } from "@/lib/game/evolution-types";

const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

export async function evolutionStateAction(characterId: unknown): Promise<EvolutionState | null> {
  if (!validId(characterId)) return null;
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) return null;
  return getDb().transaction((tx) =>
    loadEvolutionState(tx, profileId, characterId, getEconomyConfig()),
  );
}

/** Client scalars are consent guards only; possession, price and stage come from the server. */
export async function evolveCompanionAction(
  characterId: unknown,
  fromStage: unknown,
  expectedPrice: unknown,
  expectedArtRef: unknown,
  expectedProfileId: unknown,
): Promise<EvolutionResult> {
  if (
    !validId(characterId) ||
    !validId(expectedArtRef) ||
    (fromStage !== 1 && fromStage !== 2) ||
    typeof expectedPrice !== "number" ||
    !Number.isSafeInteger(expectedPrice) ||
    expectedPrice <= 0
  )
    return { ok: false, error: "INVALID" };
  const profileId = await getCurrentChildProfileId();
  if (profileId === null || profileId !== expectedProfileId)
    return { ok: false, error: "UNAUTHENTICATED" };
  const result = evolveCompanion(
    getDb(),
    profileId,
    characterId,
    fromStage,
    expectedPrice,
    expectedArtRef,
    getEconomyConfig(),
    new Date(),
  );
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function acknowledgeEvolutionAction(
  characterId: unknown,
  fromStage: unknown,
  expectedProfileId: unknown,
): Promise<EvolutionReceipt | null> {
  if (!validId(characterId) || (fromStage !== 1 && fromStage !== 2)) return null;
  const profileId = await getCurrentChildProfileId();
  if (profileId === null || profileId !== expectedProfileId) return null;
  return acknowledgeEvolution(getDb(), profileId, characterId, fromStage);
}
