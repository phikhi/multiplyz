"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import {
  getEngineConfig,
  getMapConfig,
  getEconomyConfig,
  getRegularityConfig,
} from "@/config/server-config";
import { readHouseholdSettings } from "@/lib/parent/settings";
import { evaluateScreenTimeLock } from "@/lib/parent/screen-time-lock";
import { loadBreakDecision } from "@/lib/game/daily-return";
import { commandAdventure, loadAdventure, startAdventure } from "@/lib/game/adventure";
import { presentAdventureWorld } from "@/lib/game/adventure-world";
import type { AdventureResponse } from "@/lib/game/adventure-types";

export async function resumeAdventureAction(
  expectedProfileId?: unknown,
): Promise<AdventureResponse> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null || (expectedProfileId !== undefined && expectedProfileId !== profileId))
    return { ok: false, error: "UNAUTHENTICATED" };
  const db = getDb();
  const current = loadAdventure(db, profileId);
  if (current && current.phase !== "closed")
    return { ok: true, adventure: presentAdventureWorld(db, current) };
  if (
    evaluateScreenTimeLock(
      db,
      profileId,
      readHouseholdSettings(db),
      getRegularityConfig(),
      Date.now(),
    )
  )
    return { ok: false, error: "LOCKED" };
  const adventure = startAdventure(db, profileId, getEngineConfig(), getMapConfig(), Date.now());
  return adventure
    ? { ok: true, adventure: presentAdventureWorld(db, adventure) }
    : { ok: false, error: "EMPTY" };
}

export async function adventureCommandAction(
  input: unknown,
  expectedProfileId?: unknown,
): Promise<AdventureResponse> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null || (expectedProfileId !== undefined && expectedProfileId !== profileId))
    return { ok: false, error: "UNAUTHENTICATED" };
  const result = commandAdventure(
    getDb(),
    profileId,
    input,
    getEngineConfig(),
    getMapConfig(),
    getEconomyConfig(),
    Date.now(),
    (day) => loadBreakDecision(getDb(), profileId, getRegularityConfig(), Date.now(), day),
  );
  if (result.ok && result.adventure.result) revalidatePath("/carte", "layout");
  return result.ok
    ? { ...result, adventure: presentAdventureWorld(getDb(), result.adventure) }
    : result;
}
