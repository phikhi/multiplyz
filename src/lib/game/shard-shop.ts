import { and, asc, eq, lt, or } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { characters, collection, collectionKey, shardReceipts } from "@/lib/db/schema";
import type { EconomyConfig, MapConfig } from "@/config/server-config";
import { getUnlockedWorldCount } from "./unlock";
import { assertPositiveAmount, debitWalletInTx, InsufficientBalanceError } from "./wallet";
import type { ShardOffer, ShardPurchaseResult, ShardReceipt } from "./shard-shop-types";

type Reader = Pick<AppDatabase, "select">;
const receiptKey = (profileId: number, purchaseId: string) => `${profileId}:${purchaseId}`;

/** Actual catalogue of accessible worlds, including generated worlds; no seeded substitutes. */
export function loadShardOffers(
  db: Reader,
  profileId: number,
  economy: EconomyConfig,
  map: MapConfig,
): ShardOffer[] {
  const unlocked = getUnlockedWorldCount(db, profileId, map.levelsPerWorld);
  const owned = new Set(
    db
      .select({ id: collection.characterId })
      .from(collection)
      .where(eq(collection.profileId, profileId))
      .all()
      .map((row) => row.id),
  );
  return db
    .select()
    .from(characters)
    .where(
      and(
        lt(characters.worldIndex, unlocked),
        or(eq(characters.rarity, "common"), eq(characters.rarity, "rare")),
      ),
    )
    .orderBy(asc(characters.worldIndex), asc(characters.id))
    .all()
    .filter((character) => !owned.has(character.id))
    .map((character) => ({
      characterId: character.id,
      displayName: character.nameDefault,
      worldIndex: character.worldIndex,
      rarity: character.rarity as "common" | "rare",
      artRef: character.artRef,
      story: character.story ?? "",
      price:
        character.rarity === "common"
          ? economy.spend.shopPriceCommonShards
          : economy.spend.shopPriceRareShards,
    }));
}

const receiptFields = {
  purchaseId: shardReceipts.purchaseId,
  offer: shardReceipts.offer,
  balance: shardReceipts.balance,
  acknowledged: shardReceipts.acknowledged,
};

export function pendingShardReceipt(db: Reader, profileId: number): ShardReceipt | null {
  return (
    db
      .select(receiptFields)
      .from(shardReceipts)
      .where(and(eq(shardReceipts.profileId, profileId), eq(shardReceipts.acknowledged, false)))
      .get() ?? null
  );
}

/** Spend, journal, possession and encounter commit together. Only the server chooses the price. */
export function purchaseCompanion(
  db: AppDatabase,
  profileId: number,
  economy: EconomyConfig,
  map: MapConfig,
  purchaseId: string,
  characterId: string,
  now: Date,
): ShardPurchaseResult {
  try {
    return db.transaction(
      (tx): ShardPurchaseResult => {
        const previous = tx
          .select(receiptFields)
          .from(shardReceipts)
          .where(eq(shardReceipts.id, receiptKey(profileId, purchaseId)))
          .get();
        if (previous) return { ok: true, receipt: previous };
        const pending = pendingShardReceipt(tx, profileId);
        if (pending) {
          // Bind concurrent intentions to the unfinished encounter, even after its acknowledgement.
          tx.insert(shardReceipts)
            .values({
              id: receiptKey(profileId, purchaseId),
              profileId,
              ...pending,
              createdAt: now,
            })
            .run();
          return { ok: true, receipt: pending };
        }
        const owned = tx
          .select({ id: collection.id })
          .from(collection)
          .where(eq(collection.id, collectionKey(profileId, characterId)))
          .get();
        if (owned) return { ok: false, error: "OWNED" };
        const offer = loadShardOffers(tx, profileId, economy, map).find(
          (item) => item.characterId === characterId,
        );
        if (!offer) return { ok: false, error: "UNAVAILABLE" };
        assertPositiveAmount(offer.price);
        const debit = debitWalletInTx(
          tx,
          {
            profileId,
            currency: "shards",
            amount: offer.price,
            reason: "shop",
            refId: `shop:${purchaseId}`,
          },
          now,
        );
        if (!debit.applied) return { ok: false, error: "REPLAY" };
        tx.insert(collection)
          .values({
            id: collectionKey(profileId, characterId),
            profileId,
            characterId,
            count: 1,
            stage: 1,
            unlockedAt: now,
          })
          .run();
        const receipt: ShardReceipt = {
          purchaseId,
          offer,
          balance: debit.balance,
          acknowledged: false,
        };
        tx.insert(shardReceipts)
          .values({ id: receiptKey(profileId, purchaseId), profileId, ...receipt, createdAt: now })
          .run();
        return { ok: true, receipt };
      },
      { behavior: "immediate" },
    );
  } catch (error) {
    if (error instanceof InsufficientBalanceError) return { ok: false, error: "BROKE" };
    throw error;
  }
}

export function acknowledgeShardReceipt(
  db: AppDatabase,
  profileId: number,
  purchaseId: string,
): ShardReceipt | null {
  return (
    db
      .update(shardReceipts)
      .set({ acknowledged: true })
      .where(and(eq(shardReceipts.profileId, profileId), eq(shardReceipts.purchaseId, purchaseId)))
      .returning(receiptFields)
      .get() ?? null
  );
}
