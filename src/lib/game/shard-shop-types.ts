import type { WalletBalance } from "./wallet";

export interface ShardOffer {
  readonly characterId: string;
  readonly displayName: string;
  readonly worldIndex: number;
  readonly rarity: "common" | "rare";
  readonly artRef: string;
  readonly story: string;
  readonly price: number;
}

export type ShardDestination = "companion" | "shop" | "map";

export interface ShardReceipt {
  readonly purchaseId: string;
  readonly offer: ShardOffer;
  readonly balance: WalletBalance;
  readonly acknowledged: boolean;
}

export interface ShardShopState extends WalletBalance {
  readonly profileId: number;
  readonly offers: readonly ShardOffer[];
  readonly receipt: ShardReceipt | null;
}

export type ShardPurchaseResult =
  | { readonly ok: true; readonly receipt: ShardReceipt }
  | {
      readonly ok: false;
      readonly error: "BROKE" | "UNAVAILABLE" | "OWNED" | "REPLAY" | "INVALID" | "UNAUTHENTICATED";
    };
