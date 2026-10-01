import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { evolutionReceipts } from "@/lib/db/schema";
import type { RegularityConfig } from "@/config/server-config";
import { readHouseholdSettings, type HouseholdSettings } from "@/lib/parent/settings";
import {
  evaluateScreenTimeLock,
  loadTodayActiveMinutes,
  isScreenTimeHardLocked,
} from "@/lib/parent/screen-time-lock";
import { makeDayOrdinal } from "@/lib/parent/regularity";
import { needsDiagnostic, isRecalibrationRequested } from "@/lib/engine/service";
import { loadAdventure } from "./adventure";
import { pendingEggReceipt } from "./egg-receipt";
import { pendingShardReceipt } from "./shard-shop";

/** Same configured day and time estimate as the existing parental limit. Once per day. */
export function breakDecision(
  settings: HouseholdSettings,
  minutes: number,
  day: number,
  offeredDay?: number,
): { day: number; reason: "limit" | "suggested" } | null {
  if (isScreenTimeHardLocked(settings, minutes)) return { day, reason: "limit" };
  if (minutes >= settings.screenTimeNudgeMinutes && offeredDay !== day)
    return { day, reason: "suggested" };
  return null;
}
export function loadBreakDecision(
  db: AppDatabase,
  profileId: number,
  config: RegularityConfig,
  now: number,
  offeredDay?: number,
) {
  return breakDecision(
    readHouseholdSettings(db),
    loadTodayActiveMinutes(db, profileId, config, now),
    makeDayOrdinal(config.dayTimeZone)(now),
    offeredDay,
  );
}

/** Read-only destination, evaluated only after authentication, never from a remembered name. */
export function dailyReturnPath(
  db: AppDatabase,
  profileId: number,
  config: RegularityConfig,
  now: number,
): string {
  const active = loadAdventure(db, profileId);
  if (active && active.phase !== "closed") return active.paused ? "/repos" : "/jouer";
  if (pendingEggReceipt(db, profileId)) return "/boutique";
  if (pendingShardReceipt(db, profileId)) return "/boutique/eclats";
  const growth = db
    .select({ id: evolutionReceipts.characterId })
    .from(evolutionReceipts)
    .where(
      and(eq(evolutionReceipts.profileId, profileId), eq(evolutionReceipts.acknowledged, false)),
    )
    .get();
  if (growth) return `/collection/${encodeURIComponent(growth.id)}/grandir`;
  if (evaluateScreenTimeLock(db, profileId, readHouseholdSettings(db), config, now))
    return "/repos";
  return needsDiagnostic(db, profileId) || isRecalibrationRequested(db, profileId)
    ? "/jouer"
    : "/carte";
}

export function dailyRestState(
  db: AppDatabase,
  profileId: number,
  config: RegularityConfig,
  now: number,
) {
  const adventure = loadAdventure(db, profileId);
  const active = Boolean(adventure && adventure.phase !== "closed");
  const locked =
    !active && evaluateScreenTimeLock(db, profileId, readHouseholdSettings(db), config, now);
  const suggested =
    !active &&
    adventure?.restReason === "suggested" &&
    adventure.breakOfferedDay === makeDayOrdinal(config.dayTimeZone)(now);
  return { reason: locked ? "limit" : suggested ? "suggested" : "manual", active } as const;
}
