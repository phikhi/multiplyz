import type { EggDrawResult } from "./egg-draw";

export interface EggReceipt {
  readonly drawId: string;
  readonly result: Extract<EggDrawResult, { ok: true }>;
  readonly acknowledged: boolean;
}

export type EggPurchaseResult =
  | { readonly ok: true; readonly receipt: EggReceipt }
  | {
      readonly ok: false;
      readonly error: "BROKE" | "REPLAY" | "NO_POOL" | "INVALID" | "UNAUTHENTICATED";
    };

export interface EggShopState {
  readonly profileId: number;
  readonly eggPriceCoins: number;
  readonly coins: number;
  readonly shards: number;
  readonly available: boolean;
  readonly receipt: EggReceipt | null;
}
