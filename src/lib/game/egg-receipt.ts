import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { eggReceipts } from "@/lib/db/schema";
import type { EconomyConfig, MapConfig } from "@/config/server-config";
import { buyEggAndDraw, type RandomSource } from "./egg-draw";
import type { EggReceipt, EggPurchaseResult } from "./egg-receipt-types";

type Reader = Pick<AppDatabase, "select">;
const receiptKey = (profileId: number, drawId: string) => `${profileId}:${drawId}`;

export function pendingEggReceipt(db: Reader, profileId: number): EggReceipt | null {
  return (
    db
      .select({
        drawId: eggReceipts.drawId,
        result: eggReceipts.result,
        acknowledged: eggReceipts.acknowledged,
      })
      .from(eggReceipts)
      .where(and(eq(eggReceipts.profileId, profileId), eq(eggReceipts.acknowledged, false)))
      .get() ?? null
  );
}

/** One unfinished encounter per profile. Nested transaction reuses every existing economy rule. */
export function purchaseEgg(
  db: AppDatabase,
  profileId: number,
  economy: EconomyConfig,
  map: MapConfig,
  drawId: string,
  now: Date,
  rand: RandomSource,
): EggPurchaseResult {
  return db.transaction((tx) => {
    const previous = tx
      .select()
      .from(eggReceipts)
      .where(eq(eggReceipts.id, receiptKey(profileId, drawId)))
      .get();
    if (previous) return { ok: true, receipt: previous };
    const pending = pendingEggReceipt(tx, profileId);
    if (pending) {
      // Bind this second tab's intention too, even if its HTTP response is lost.
      tx.insert(eggReceipts)
        .values({ id: receiptKey(profileId, drawId), profileId, ...pending, createdAt: now })
        .run();
      return { ok: true, receipt: pending };
    }
    const result = buyEggAndDraw(tx, profileId, economy, map, drawId, now, rand);
    if (!result.ok) return result;
    const receipt = { drawId, result, acknowledged: false };
    tx.insert(eggReceipts)
      .values({ id: receiptKey(profileId, drawId), profileId, ...receipt, createdAt: now })
      .run();
    return { ok: true, receipt };
  });
}

/** Replay-safe acknowledgement. The receipt remains available by its original draw id. */
export function acknowledgeEgg(
  db: AppDatabase,
  profileId: number,
  drawId: string,
): EggReceipt | null {
  return (
    db
      .update(eggReceipts)
      .set({ acknowledged: true })
      .where(and(eq(eggReceipts.profileId, profileId), eq(eggReceipts.drawId, drawId)))
      .returning({
        drawId: eggReceipts.drawId,
        result: eggReceipts.result,
        acknowledged: eggReceipts.acknowledged,
      })
      .get() ?? null
  );
}
