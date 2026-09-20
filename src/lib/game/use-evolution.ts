"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  acknowledgeEvolutionAction,
  evolveCompanionAction,
  evolutionStateAction,
} from "@/app/(app)/collection/evolution-actions";
import type { EvolutionState } from "./evolution-types";

type Intent =
  | { kind: "grow"; fromStage: number; price: number; artRef: string }
  | { kind: "close"; fromStage: number };
const key = (state: EvolutionState) =>
  `teddy:evolution:${state.profileId}:${state.entry.characterId}`;
function readIntent(storageKey: string): Intent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("fromStage" in parsed) ||
    (parsed.fromStage !== 1 && parsed.fromStage !== 2) ||
    !("kind" in parsed)
  )
    return null;
  if (parsed.kind === "close") return { kind: "close", fromStage: parsed.fromStage };
  if (
    parsed.kind === "grow" &&
    "price" in parsed &&
    typeof parsed.price === "number" &&
    Number.isSafeInteger(parsed.price) &&
    parsed.price > 0 &&
    "artRef" in parsed &&
    typeof parsed.artRef === "string" &&
    parsed.artRef.length > 0 &&
    parsed.artRef.length <= 128
  )
    return {
      kind: "grow",
      fromStage: parsed.fromStage,
      price: parsed.price,
      artRef: parsed.artRef,
    };
  return null;
}

export function useEvolution(initial: EvolutionState) {
  const { replace } = useRouter();
  const [state, setState] = useState(initial);
  const [receipt, setReceipt] = useState(initial.receipt);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(initial);
  const pending = useRef<Intent | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  const send = useCallback(
    async (intent: Intent) => {
      if (inFlight.current) return;
      inFlight.current = true;
      pending.current = intent;
      const source = current.current;
      setBusy(true);
      setError(null);
      const clear = () => {
        if (localStorage.getItem(key(source)) === JSON.stringify(intent))
          localStorage.removeItem(key(source));
        pending.current = null;
      };
      try {
        if (intent.kind === "grow") {
          const result = await evolveCompanionAction(
            source.entry.characterId,
            intent.fromStage,
            intent.price,
            intent.artRef,
            source.profileId,
          );
          if (!mounted.current) return;
          if (result.ok) {
            setReceipt(result.receipt);
            pending.current = null;
          } else {
            if (result.error !== "UNAUTHENTICATED") clear();
            setError(result.error);
            const fresh = await evolutionStateAction(source.entry.characterId);
            if (mounted.current && fresh?.profileId === source.profileId) {
              current.current = fresh;
              setState(fresh);
              setReceipt(fresh.receipt);
            }
          }
        } else {
          const result = await acknowledgeEvolutionAction(
            source.entry.characterId,
            intent.fromStage,
            source.profileId,
          );
          if (!mounted.current) return;
          if (!result) {
            setError("UNAUTHENTICATED");
            return;
          }
          clear();
          replace(`/collection/${encodeURIComponent(source.entry.characterId)}`);
        }
      } catch {
        if (mounted.current) setError("NETWORK");
      } finally {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [replace],
  );

  const load = useCallback(async () => {
    if (inFlight.current) return;
    if (pending.current) {
      await send(pending.current);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let intent: Intent | null = null;
    try {
      const fresh = await evolutionStateAction(current.current.entry.characterId);
      if (!mounted.current) return;
      if (!fresh || fresh.profileId !== current.current.profileId) {
        setError("UNAUTHENTICATED");
        return;
      }
      current.current = fresh;
      setState(fresh);
      setReceipt(fresh.receipt);
      try {
        intent = readIntent(key(fresh));
      } catch {
        setError("STORAGE");
      }
    } catch {
      if (mounted.current) setError("NETWORK");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
    if (intent && mounted.current) await send(intent);
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
    if (inFlight.current || pending.current || error === "UNAUTHENTICATED") return;
    try {
      localStorage.setItem(key(current.current), JSON.stringify(intent));
    } catch {
      setError("STORAGE");
      return;
    }
    void send(intent);
  }
  return {
    state,
    receipt,
    busy,
    error,
    retry: load,
    grow: () => {
      const offer = state.offer;
      if (offer)
        dispatch({
          kind: "grow",
          fromStage: offer.fromStage,
          price: offer.price,
          artRef: offer.afterArtRef,
        });
    },
    close: () => {
      if (receipt) dispatch({ kind: "close", fromStage: receipt.offer.fromStage });
    },
  };
}
