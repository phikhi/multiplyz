"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  acknowledgeCompanionAction,
  buyCompanionAction,
  shardShopStateAction,
} from "@/app/(app)/boutique/eclats/actions";
import type { ShardDestination, ShardReceipt, ShardShopState } from "./shard-shop-types";

type Intent =
  | { kind: "buy"; purchaseId: string; characterId: string }
  | { kind: "close"; purchaseId: string; destination: ShardDestination };
const key = (profileId: number) => `teddy:shards:${profileId}`;

function readIntent(storageKey: string): Intent | null {
  const stored = localStorage.getItem(storageKey);
  let value: unknown;
  try {
    value = JSON.parse(stored ?? "null");
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("purchaseId" in value) ||
    typeof value.purchaseId !== "string" ||
    !value.purchaseId.length ||
    value.purchaseId.length > 128
  )
    return null;
  if (
    "kind" in value &&
    value.kind === "buy" &&
    "characterId" in value &&
    typeof value.characterId === "string" &&
    value.characterId.length > 0 &&
    value.characterId.length <= 128
  )
    return { kind: "buy", purchaseId: value.purchaseId, characterId: value.characterId };
  if (
    "kind" in value &&
    value.kind === "close" &&
    "destination" in value &&
    (value.destination === "companion" ||
      value.destination === "shop" ||
      value.destination === "map")
  )
    return { kind: "close", purchaseId: value.purchaseId, destination: value.destination };
  return null;
}

export function useShardShop() {
  const router = useRouter();
  const [shop, setShop] = useState<ShardShopState | null>(null);
  const [receipt, setReceipt] = useState<ShardReceipt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<ShardShopState | null>(null);
  const pending = useRef<Intent | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  const send = useCallback(
    async (state: ShardShopState, intent: Intent) => {
      if (inFlight.current) return;
      inFlight.current = true;
      pending.current = intent;
      setBusy(true);
      setError(null);
      const clearIntent = () => {
        if (localStorage.getItem(key(state.profileId)) === JSON.stringify(intent))
          localStorage.removeItem(key(state.profileId));
        pending.current = null;
      };
      try {
        if (intent.kind === "buy") {
          const result = await buyCompanionAction(
            intent.purchaseId,
            intent.characterId,
            state.profileId,
          );
          if (!mounted.current) return;
          if (!result.ok) {
            if (result.error !== "UNAUTHENTICATED") clearIntent();
            setError(result.error);
            const fresh = await shardShopStateAction();
            if (mounted.current && fresh?.profileId === state.profileId) {
              current.current = fresh;
              setShop(fresh);
              setReceipt(fresh.receipt);
            }
            return;
          }
          setReceipt(result.receipt);
          pending.current = null;
        } else {
          const result = await acknowledgeCompanionAction(intent.purchaseId, state.profileId);
          if (!mounted.current) return;
          if (!result) {
            setError("UNAUTHENTICATED");
            return;
          }
          // Keep the destination until acknowledgement is known, including across browser closure.
          clearIntent();
          router.replace(
            intent.destination === "companion"
              ? `/collection/${encodeURIComponent(result.offer.characterId)}`
              : intent.destination === "shop"
                ? "/boutique"
                : "/carte",
          );
        }
      } catch {
        if (mounted.current) setError("NETWORK");
      } finally {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [router],
  );

  const load = useCallback(async () => {
    if (inFlight.current) return;
    if (pending.current && current.current) {
      await send(current.current, pending.current);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let restored: Intent | null = null;
    let state: ShardShopState | null = null;
    try {
      state = await shardShopStateAction();
      if (!mounted.current) return;
      if (!state) {
        setError("UNAUTHENTICATED");
        return;
      }
      current.current = state;
      setShop(state);
      setReceipt(state.receipt);
      try {
        restored = readIntent(key(state.profileId));
      } catch {
        setError("STORAGE");
      }
    } catch {
      if (mounted.current) setError("NETWORK");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
    if (state && restored && mounted.current) await send(state, restored);
  }, [send]);

  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => {
      if (mounted.current) void load();
    });
    const online = () => {
      void load();
    };
    window.addEventListener("online", online);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", online);
    };
  }, [load]);

  function dispatch(intent: Intent) {
    if (inFlight.current || !current.current || pending.current) return;
    try {
      localStorage.setItem(key(current.current.profileId), JSON.stringify(intent));
    } catch {
      setError("STORAGE");
      return;
    }
    void send(current.current, intent);
  }

  return {
    shop,
    receipt,
    busy,
    error,
    retry: load,
    buy: (characterId: string) =>
      dispatch({ kind: "buy", purchaseId: crypto.randomUUID(), characterId }),
    close: (destination: ShardDestination) => {
      if (receipt) dispatch({ kind: "close", purchaseId: receipt.purchaseId, destination });
    },
  };
}
