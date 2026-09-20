"use server";

import { revalidatePath } from "next/cache";
import { getEconomyConfig, getMapConfig } from "@/config/server-config";
import { getDb } from "@/lib/db";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import {
  acknowledgeShardReceipt,
  loadShardOffers,
  pendingShardReceipt,
  purchaseCompanion,
} from "@/lib/game/shard-shop";
import type {
  ShardPurchaseResult,
  ShardReceipt,
  ShardShopState,
} from "@/lib/game/shard-shop-types";
import { loadWallet } from "@/lib/game/wallet";

export async function shardShopStateAction(): Promise<ShardShopState | null> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) return null;
  return getDb().transaction((tx) => ({
    profileId,
    ...loadWallet(tx, profileId),
    offers: loadShardOffers(tx, profileId, getEconomyConfig(), getMapConfig()),
    receipt: pendingShardReceipt(tx, profileId),
  }));
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/** The supplied profile is a session guard. No client-controlled price or wallet patch. */
export async function buyCompanionAction(
  purchaseId: unknown,
  characterId: unknown,
  expectedProfileId: unknown,
): Promise<ShardPurchaseResult> {
  if (!validId(purchaseId) || !validId(characterId)) return { ok: false, error: "INVALID" };
  const profileId = await getCurrentChildProfileId();
  if (profileId === null || profileId !== expectedProfileId)
    return { ok: false, error: "UNAUTHENTICATED" };
  const result = purchaseCompanion(
    getDb(),
    profileId,
    getEconomyConfig(),
    getMapConfig(),
    purchaseId,
    characterId,
    new Date(),
  );
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function acknowledgeCompanionAction(
  purchaseId: unknown,
  expectedProfileId: unknown,
): Promise<ShardReceipt | null> {
  if (!validId(purchaseId)) return null;
  const profileId = await getCurrentChildProfileId();
  if (profileId === null || profileId !== expectedProfileId) return null;
  return acknowledgeShardReceipt(getDb(), profileId, purchaseId);
}
