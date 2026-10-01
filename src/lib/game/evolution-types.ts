import type { CollectionEntry } from "./collection";
import type { WalletBalance } from "./wallet";

export interface EvolutionOffer {
  readonly characterId: string;
  readonly displayName: string;
  readonly fromStage: number;
  readonly toStage: number;
  readonly beforeArtRef: string;
  readonly afterArtRef: string;
  readonly price: number;
}
export interface EvolutionReceipt {
  readonly offer: EvolutionOffer;
  readonly balance: WalletBalance;
  readonly acknowledged: boolean;
}
export interface EvolutionState extends WalletBalance {
  readonly profileId: number;
  readonly entry: CollectionEntry;
  readonly offer: EvolutionOffer | null;
  readonly receipt: EvolutionReceipt | null;
}
export type EvolutionResult =
  | { readonly ok: true; readonly receipt: EvolutionReceipt }
  | {
      readonly ok: false;
      readonly error: "INVALID" | "UNAUTHENTICATED" | "UNAVAILABLE" | "CHANGED" | "BROKE";
    };
