"use server";

import { revalidatePath } from "next/cache";
import { getEconomyConfig, getMapConfig } from "@/config/server-config";
import { getDb } from "@/lib/db";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { loadEggPool } from "@/lib/game/egg-draw";
import { acknowledgeEgg, pendingEggReceipt, purchaseEgg } from "@/lib/game/egg-receipt";
import type { EggPurchaseResult, EggReceipt, EggShopState } from "@/lib/game/egg-receipt-types";
import { getUnlockedWorldCount } from "@/lib/game/unlock";
import { loadWallet } from "@/lib/game/wallet";

export async function boutiqueStateAction(): Promise<EggShopState | null> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) return null;
  const db = getDb();
  return db.transaction((tx) => ({
    profileId,
    eggPriceCoins: getEconomyConfig().spend.eggPriceCoins,
    ...loadWallet(tx, profileId),
    available:
      loadEggPool(
        tx,
        profileId,
        getUnlockedWorldCount(tx, profileId, getMapConfig().levelsPerWorld),
      ).length > 0,
    receipt: pendingEggReceipt(tx, profileId),
  }));
}

function validId(drawId: unknown): drawId is string {
  return typeof drawId === "string" && drawId.length > 0 && drawId.length <= 64;
}

/** expectedProfileId is only a session guard: never the authority for spending. */
export async function buyEggAction(
  drawId: unknown,
  expectedProfileId: unknown,
): Promise<EggPurchaseResult> {
  if (!validId(drawId)) return { ok: false, error: "INVALID" };
  const profileId = await getCurrentChildProfileId();
  if (profileId === null || profileId !== expectedProfileId)
    return { ok: false, error: "UNAUTHENTICATED" };
  const result = purchaseEgg(
    getDb(),
    profileId,
    getEconomyConfig(),
    getMapConfig(),
    drawId,
    new Date(),
    Math.random,
  );
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function acknowledgeEggAction(
  drawId: unknown,
  expectedProfileId: unknown,
): Promise<EggReceipt | null> {
  if (!validId(drawId)) return null;
  const profileId = await getCurrentChildProfileId();
  if (profileId === null || profileId !== expectedProfileId) return null;
  return acknowledgeEgg(getDb(), profileId, drawId);
}
