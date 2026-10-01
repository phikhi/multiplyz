import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createWorldAssetStore } from "@/lib/worldgen/runtime-assets";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { characters, collection, collectionKey, evolutionReceipts } from "@/lib/db/schema";
import type { EconomyConfig } from "@/config/server-config";
import { loadCollectionEntry } from "./collection";
import { stageArtRefs } from "./creature-stage-art";
import { isRenderableAssetRef } from "./world-theme";
import {
  assertPositiveAmount,
  debitWalletInTx,
  InsufficientBalanceError,
  loadWallet,
} from "./wallet";
import type {
  EvolutionOffer,
  EvolutionReceipt,
  EvolutionResult,
  EvolutionState,
} from "./evolution-types";

type Reader = Pick<AppDatabase, "select" | "insert" | "update">;
export type ArtReady = (refs: readonly string[]) => boolean;

/** Local assets must be delivered and different; repathing the same bytes is not growth. */
export const stageAssetsReady: ArtReady = (refs) => {
  try {
    if (refs.some((ref) => !isRenderableAssetRef(ref))) return false;
    const runtime = createWorldAssetStore(join(process.cwd(), "storage/generated"));
    const images = refs.map((ref) =>
      /^world\/\d+\/runtime-/.test(ref)
        ? runtime.read(ref)
        : readFileSync(`public/generated/${ref}`),
    );
    return images.every(
      (image, i) => image.length > 0 && images.slice(0, i).every((other) => !image.equals(other)),
    );
  } catch {
    return false;
  }
};

const transitionKey = (profileId: number, characterId: string, fromStage: number) =>
  JSON.stringify([profileId, characterId, fromStage]);
const receiptFields = {
  offer: evolutionReceipts.offer,
  balance: evolutionReceipts.balance,
  acknowledged: evolutionReceipts.acknowledged,
};

export function pendingEvolutionReceipt(
  db: Reader,
  profileId: number,
  characterId: string,
): EvolutionReceipt | null {
  return (
    db
      .select(receiptFields)
      .from(evolutionReceipts)
      .where(
        and(
          eq(evolutionReceipts.profileId, profileId),
          eq(evolutionReceipts.characterId, characterId),
          eq(evolutionReceipts.acknowledged, false),
        ),
      )
      .get() ?? null
  );
}

export function loadEvolutionOffer(
  db: Reader,
  profileId: number,
  characterId: string,
  economy: EconomyConfig,
  artReady: ArtReady = stageAssetsReady,
): EvolutionOffer | null {
  const entry = loadCollectionEntry(db, profileId, characterId);
  if (!entry || ![1, 2].includes(entry.stage)) return null;
  const catalogue = db.select().from(characters).where(eq(characters.id, characterId)).get();
  if (!catalogue) return null;
  const refs = stageArtRefs(catalogue);
  const afterArtRef = refs[entry.stage];
  if (!afterArtRef || !artReady(refs.slice(0, entry.stage + 1))) return null;
  return {
    characterId,
    displayName: entry.displayName,
    fromStage: entry.stage,
    toStage: entry.stage + 1,
    beforeArtRef: entry.artRef,
    afterArtRef,
    price:
      entry.stage === 1 ? economy.spend.evolutionStage2Shards : economy.spend.evolutionStage3Shards,
  };
}

export function loadEvolutionState(
  db: Reader,
  profileId: number,
  characterId: string,
  economy: EconomyConfig,
  artReady: ArtReady = stageAssetsReady,
): EvolutionState | null {
  const entry = loadCollectionEntry(db, profileId, characterId);
  if (!entry) return null;
  return {
    profileId,
    entry,
    ...loadWallet(db, profileId),
    offer: loadEvolutionOffer(db, profileId, characterId, economy, artReady),
    receipt: pendingEvolutionReceipt(db, profileId, characterId),
  };
}

/** A transition is unique for this possession, including after acknowledgement and on another device. */
export function evolveCompanion(
  db: AppDatabase,
  profileId: number,
  characterId: string,
  fromStage: number,
  expectedPrice: number,
  expectedArtRef: string,
  economy: EconomyConfig,
  now: Date,
  artReady: ArtReady = stageAssetsReady,
): EvolutionResult {
  if (fromStage !== 1 && fromStage !== 2) return { ok: false, error: "INVALID" };
  try {
    return db.transaction(
      (tx): EvolutionResult => {
        const previous = tx
          .select(receiptFields)
          .from(evolutionReceipts)
          .where(eq(evolutionReceipts.id, transitionKey(profileId, characterId, fromStage)))
          .get();
        if (previous) return { ok: true, receipt: previous };
        if (pendingEvolutionReceipt(tx, profileId, characterId))
          return { ok: false, error: "CHANGED" };
        const offer = loadEvolutionOffer(tx, profileId, characterId, economy, artReady);
        if (!offer) return { ok: false, error: "UNAVAILABLE" };
        if (
          offer.fromStage !== fromStage ||
          offer.price !== expectedPrice ||
          offer.afterArtRef !== expectedArtRef
        )
          return { ok: false, error: "CHANGED" };
        assertPositiveAmount(offer.price);
        const debit = debitWalletInTx(
          tx,
          {
            profileId,
            currency: "shards",
            amount: offer.price,
            reason: "evolution",
            refId: transitionKey(profileId, characterId, fromStage),
          },
          now,
        );
        if (!debit.applied) return { ok: false, error: "CHANGED" };
        tx.update(collection)
          .set({ stage: offer.toStage })
          .where(eq(collection.id, collectionKey(profileId, characterId)))
          .run();
        const receipt: EvolutionReceipt = { offer, balance: debit.balance, acknowledged: false };
        tx.insert(evolutionReceipts)
          .values({
            id: transitionKey(profileId, characterId, fromStage),
            profileId,
            characterId,
            fromStage,
            ...receipt,
            createdAt: now,
          })
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

export function acknowledgeEvolution(
  db: AppDatabase,
  profileId: number,
  characterId: string,
  fromStage: number,
): EvolutionReceipt | null {
  return (
    db
      .update(evolutionReceipts)
      .set({ acknowledged: true })
      .where(eq(evolutionReceipts.id, transitionKey(profileId, characterId, fromStage)))
      .returning(receiptFields)
      .get() ?? null
  );
}
