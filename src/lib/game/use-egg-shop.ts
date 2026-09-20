"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  acknowledgeEggAction,
  boutiqueStateAction,
  buyEggAction,
} from "@/app/(app)/boutique/actions";
import type { EggReceipt, EggShopState } from "./egg-receipt-types";

type Destination = "companion" | "shop" | "map";
type Intent =
  | { kind: "buy"; drawId: string; revealed: boolean }
  | { kind: "close"; drawId: string; destination: Destination };

function readIntent(key: string): Intent | null {
  const stored = localStorage.getItem(key);
  let value: unknown;
  try {
    value = JSON.parse(stored ?? "null");
  } catch {
    localStorage.removeItem(key);
    return null;
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("drawId" in value) ||
    typeof value.drawId !== "string" ||
    value.drawId.length === 0 ||
    value.drawId.length > 64
  )
    return null;
  if ("kind" in value && value.kind === "buy")
    return {
      kind: "buy",
      drawId: value.drawId,
      revealed: "revealed" in value && value.revealed === true,
    };
  if (
    "kind" in value &&
    value.kind === "close" &&
    "destination" in value &&
    (value.destination === "companion" ||
      value.destination === "shop" ||
      value.destination === "map")
  )
    return { kind: "close", drawId: value.drawId, destination: value.destination };
  return null;
}

export function useEggShop() {
  const router = useRouter();
  const [shop, setShop] = useState<EggShopState | null>(null);
  const [receipt, setReceipt] = useState<EggReceipt | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const current = useRef<EggShopState | null>(null);
  const pending = useRef<Intent | null>(null);
  const mounted = useRef(false);
  const key = (profileId: number) => `teddy:egg:${profileId}`;

  const send = useCallback(
    async (state: EggShopState, intent: Intent) => {
      if (inFlight.current) return;
      inFlight.current = true;
      pending.current = intent;
      setBusy(true);
      setError(null);
      try {
        if (intent.kind === "buy") {
          const result = await buyEggAction(intent.drawId, state.profileId);
          if (!mounted.current) return;
          if (!result.ok) {
            // A definitive refusal is safe to clear; an unknown network outcome never is.
            if (result.error !== "UNAUTHENTICATED") {
              if (localStorage.getItem(key(state.profileId)) === JSON.stringify(intent))
                localStorage.removeItem(key(state.profileId));
              pending.current = null;
            }
            setError(result.error);
            const fresh = await boutiqueStateAction();
            if (mounted.current && fresh?.profileId === state.profileId) {
              current.current = fresh;
              setShop(fresh);
            }
            return;
          }
          setReceipt(result.receipt);
          setRevealed(intent.revealed);
          pending.current = null;
        } else {
          const result = await acknowledgeEggAction(intent.drawId, state.profileId);
          if (!mounted.current) return;
          if (!result) {
            setError("UNAUTHENTICATED");
            return;
          }
          if (localStorage.getItem(key(state.profileId)) === JSON.stringify(intent))
            localStorage.removeItem(key(state.profileId));
          pending.current = null;
          if (intent.destination === "shop") {
            const fresh = await boutiqueStateAction();
            if (!mounted.current) return;
            if (!fresh || fresh.profileId !== state.profileId) {
              setError("UNAUTHENTICATED");
              return;
            }
            current.current = fresh;
            setShop(fresh);
            setReceipt(fresh.receipt);
            setRevealed(false);
            router.refresh();
          } else {
            router.replace(
              intent.destination === "companion"
                ? `/collection/${encodeURIComponent(result.result.creature.characterId)}`
                : "/carte",
            );
          }
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
    let state: EggShopState | null = null;
    try {
      state = await boutiqueStateAction();
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
    if (restored && state && mounted.current) await send(state, restored);
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
    if (inFlight.current || !current.current) return;
    try {
      localStorage.setItem(key(current.current.profileId), JSON.stringify(intent));
    } catch {
      setError("STORAGE");
      return;
    }
    void send(current.current, intent);
  }

  function open() {
    if (!receipt || busy) return;
    // Reveal is presentation only; the server already owns and has paid for this creature.
    try {
      localStorage.setItem(
        key(current.current!.profileId),
        JSON.stringify({ kind: "buy", drawId: receipt.drawId, revealed: true }),
      );
    } catch {
      /* A server receipt still restores the unopened egg on another visit. */
    }
    setRevealed(true);
  }

  return {
    shop,
    receipt,
    revealed,
    busy,
    error,
    retry: load,
    open,
    buy: () => dispatch({ kind: "buy", drawId: crypto.randomUUID(), revealed: false }),
    close: (destination: Destination) => {
      if (receipt) dispatch({ kind: "close", drawId: receipt.drawId, destination });
    },
  };
}
