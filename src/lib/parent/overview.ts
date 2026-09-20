import { SKILLS, type Skill } from "../engine/domain";
import { isWeak, isDue, type ScopeEntry } from "../engine/level";
import {
  isSlow,
  computeAccuracyStats,
  computeSpeedStats,
  type AttemptRecord,
  type StatsConfig,
} from "./stats";
import { computeAccuracyDailySeries } from "./accuracy-daily";
import { makeDayOrdinal } from "./regularity";

/** Presentation caution, not a statistical confidence threshold or a pedagogical gate. */
export const PARENT_SMALL_SAMPLE = 20;
export type ParentPeriod = "recent" | "month" | "all";
export function parentPeriod(value: unknown): ParentPeriod {
  return value === "month" || value === "all" ? value : "recent";
}
export function computeParentOverview(
  records: readonly AttemptRecord[],
  scope: readonly ScopeEntry[],
  config: StatsConfig,
  now: number,
  period: ParentPeriod,
) {
  const days =
    period === "all" ? null : config.reporting.trendWindowDays * (period === "month" ? 4 : 1);
  const start = days === null ? null : now - days * 86400000;
  const current = records.filter(
    (r) => !r.isRetry && r.createdAt <= now && (start === null || r.createdAt > start),
  );
  const previous =
    days === null
      ? []
      : records.filter(
          (r) => !r.isRetry && r.createdAt > now - days * 2 * 86400000 && r.createdAt <= start!,
        );
  const reporting = {
    ...config,
    reporting: { ...config.reporting, trendWindowDays: days ?? config.reporting.trendWindowDays },
  };
  const bySkill = Object.fromEntries(
    SKILLS.map((skill) => [
      skill,
      {
        total: current.filter((r) => r.skill === skill).length,
        correct: current.filter((r) => r.skill === skill && r.correct).length,
        seen: scope.filter((e) => e.fact.skill === skill && e.state !== null).length,
      },
    ]),
  ) as Record<Skill, { total: number; correct: number; seen: number }>;
  const toDay = makeDayOrdinal(config.regularity.dayTimeZone);
  const series = computeAccuracyDailySeries(current, config.regularity.dayTimeZone);
  const lastDay = toDay(now);
  // At most 29 calendar dates for the standard 28-day rolling window. History is a table of played dates.
  const ordinals =
    start === null
      ? series.map((d) => d.dayOrdinal)
      : Array.from({ length: lastDay - toDay(start) + 1 }, (_, i) => toDay(start) + i);
  const observed = scope.filter((e) => e.state !== null);
  return {
    period,
    days,
    start,
    now,
    timeZone: config.regularity.dayTimeZone,
    total: current.length,
    correct: current.filter((r) => r.correct).length,
    previousTotal: previous.length,
    historyTotal: records.filter((r) => !r.isRetry && r.createdAt <= now).length,
    accuracy: computeAccuracyStats(current, reporting, now),
    speed: computeSpeedStats(current, reporting, now),
    trend: computeAccuracyStats(records, reporting, now).trend,
    comparison:
      days === null
        ? "history"
        : current.length === 0 || previous.length === 0
          ? "missing"
          : Math.min(current.length, previous.length) < PARENT_SMALL_SAMPLE
            ? "small"
            : "available",
    bySkill,
    seen: observed.length,
    weak: observed.filter((e) => isWeak(e.state!, config.engine)).length,
    due: observed.filter((e) => isDue(e.state!, config.engine, now)).length,
    slow: observed.filter((e) => isSlow(e.state!, e.fact.skill, config.engine)).length,
    daily: ordinals.map((dayOrdinal) => ({
      dayOrdinal,
      accuracy: series.find((d) => d.dayOrdinal === dayOrdinal)?.accuracy ?? null,
      total: current.filter((r) => toDay(r.createdAt) === dayOrdinal).length,
    })),
    maxAmplitudeMinutes: config.regularity.maxDayAmplitudeMinutes,
  };
}
export type ParentOverview = ReturnType<typeof computeParentOverview>;
