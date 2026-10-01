"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { adventureCommandAction, resumeAdventureAction } from "@/app/(app)/jouer/adventure-actions";
import type { Adventure, AdventureCommand, AdventureResponse } from "./adventure-types";

/** A single pending intention, never an offline game or a client mastery mirror. */
export function useAdventure(profileId: number) {
  const { replace, refresh: refreshRoute } = useRouter();
  const [adventure, setAdventure] = useState<Adventure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const pending = useRef<AdventureCommand | null>(null);
  const inFlight = useRef(false);
  const retryable = useRef(false);
  const current = useRef<Adventure | null>(null);
  const key = `teddy:pending:${profileId}`;

  const accept = useCallback(
    (result: AdventureResponse) => {
      if (!result.ok) {
        setError(result.error);
        if (result.error === "DIAGNOSTIC") refreshRoute();
        return false;
      }
      current.current = result.adventure;
      setAdventure(result.adventure);
      setError(null);
      if (result.adventure.phase === "closed") {
        const companion = result.adventure.result?.legendary;
        replace(
          pending.current?.destination === "companion" && companion
            ? `/collection/${encodeURIComponent(companion.characterId)}`
            : result.adventure.restReason
              ? "/repos"
              : "/carte",
        );
      }
      return true;
    },
    [replace, refreshRoute],
  );

  const send = useCallback(async () => {
    const command = pending.current;
    if (!command || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    try {
      const result = await adventureCommandAction(command, profileId);
      retryable.current = false;
      if (accept(result)) {
        pending.current = null;
        try {
          if (localStorage.getItem(key) === JSON.stringify(command)) localStorage.removeItem(key);
        } catch {
          setStorageWarning(true);
        }
      }
    } catch {
      retryable.current = true;
      setError("NETWORK");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }, [accept, key, profileId]);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    if (pending.current) {
      await send();
      return;
    }
    inFlight.current = true;
    setSending(true);
    try {
      accept(await resumeAdventureAction(profileId));
    } catch {
      retryable.current = true;
      setError("NETWORK");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }, [accept, send, profileId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const stored = localStorage.getItem(key);
        if (stored) pending.current = JSON.parse(stored);
      } catch {
        setStorageWarning(true);
      }
      void load();
    });
    const online = () => {
      if (pending.current) void send();
      else void load();
    };
    const retry = setInterval(() => {
      if (pending.current && retryable.current && navigator.onLine) void send();
    }, 5000);
    window.addEventListener("online", online);
    return () => {
      cancelled = true;
      clearInterval(retry);
      window.removeEventListener("online", online);
    };
  }, [key, load, send]);

  const dispatch = useCallback(
    (
      kind: AdventureCommand["kind"],
      fields: Pick<AdventureCommand, "value" | "responseMs" | "destination"> = {},
    ) => {
      const state = current.current;
      if (!state || pending.current || inFlight.current) return;
      const command: AdventureCommand = {
        sessionId: state.id,
        revision: state.revision,
        kind,
        ...fields,
      };
      pending.current = command;
      try {
        localStorage.setItem(key, JSON.stringify(command));
      } catch {
        setStorageWarning(true);
      }
      void send();
    },
    [key, send],
  );

  const refresh = useCallback(() => {
    pending.current = null;
    try {
      localStorage.removeItem(key);
    } catch {
      setStorageWarning(true);
    }
    void load();
  }, [key, load]);

  return { adventure, error, sending, storageWarning, dispatch, retry: load, refresh };
}
