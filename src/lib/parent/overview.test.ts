import { describe, expect, it } from "vitest";
import { reachableTimeOptions } from "./settings";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { makeFact } from "@/lib/engine/facts";
import type { ScopeEntry } from "@/lib/engine/level";
import type { AttemptRecord } from "./stats";
import { computeParentOverview, parentPeriod } from "./overview";
const config = CONFIG_DEFAULTS;
const now = Date.UTC(2026, 8, 11, 12),
  day = 86400000;
const record = (patch: Partial<AttemptRecord> = {}): AttemptRecord => ({
  skill: "add",
  correct: true,
  responseMs: 2000,
  isRetry: false,
  createdAt: now,
  ...patch,
});
const report = (records: AttemptRecord[], scope: ScopeEntry[] = []) =>
  computeParentOverview(records, scope, config, now, "recent");
describe("TEDDy parent periods and denominators", () => {
  it("separates no data, zero success and a small sample", () => {
    expect(report([])).toMatchObject({
      total: 0,
      accuracy: { overall: null },
      comparison: "missing",
    });
    expect(report([record({ correct: false })])).toMatchObject({
      total: 1,
      correct: 0,
      accuracy: { overall: 0 },
      bySkill: { sub: { total: 0 } },
      comparison: "missing",
    });
    expect(report([record(), record({ createdAt: now - 8 * day })]).comparison).toBe("small");
  });
  it("uses exact rolling boundaries, excludes retries and future dates, and keeps per-skill counts", () => {
    const value = report([
      record({ createdAt: now - 7 * day }),
      record({ createdAt: now - 7 * day + 1, correct: false, responseMs: 4000 }),
      record({ skill: "mult" }),
      record({ isRetry: true }),
      record({ createdAt: now + 1 }),
    ]);
    expect(value).toMatchObject({
      total: 2,
      correct: 1,
      previousTotal: 1,
      accuracy: { overall: 0.5 },
      speed: { overallMs: 3000 },
      bySkill: { add: { total: 1, correct: 0 }, mult: { total: 1, correct: 1 }, sub: { total: 0 } },
    });
    expect(value.daily.reduce((n, d) => n + d.total, 0)).toBe(2);
    expect(value.daily.some((d) => d.accuracy === null)).toBe(true);
    expect(value.daily.some((d) => d.accuracy === 0)).toBe(true);
  });
  it("keeps missing comparison distinct from stable; uses configured window", () => {
    const records = Array.from({ length: 20 }, () => record());
    expect(report(records).comparison).toBe("missing");
    const value = report([...records, ...records.map((r) => ({ ...r, createdAt: now - 8 * day }))]);
    expect(value.comparison).toBe("available");
    expect(value.trend.direction).toBe("stable");
    const custom = { ...config, reporting: { ...config.reporting, trendWindowDays: 3 } };
    expect(
      computeParentOverview([record({ createdAt: now - 4 * day })], [], custom, now, "recent")
        .total,
    ).toBe(0);
    expect(computeParentOverview([], [], custom, now, "month").days).toBe(12);
  });
  it("history does not invent a comparison and unknown periods fall back", () => {
    const value = computeParentOverview(
      [record({ createdAt: now - 90 * day }), record()],
      [],
      config,
      now,
      "all",
    );
    expect(value).toMatchObject({ total: 2, start: null, comparison: "history" });
    expect(value.daily).toHaveLength(2);
    expect(parentPeriod("bad")).toBe("recent");
  });
  it("reuses engine weak/due/slow predicates on observed facts without counting unseen facts", () => {
    const state = {
      box: 0,
      correctCount: 0,
      wrongCount: 1,
      avgResponseMs: config.engine.fluenceThresholdsMs.add + 1,
      lastSeen: now,
      nextDue: now,
    };
    const scope = [
      { fact: makeFact("add", 2, 3), state },
      { fact: makeFact("sub", 3, 1), state: null },
    ];
    const before = JSON.stringify(scope);
    expect(report([], scope)).toMatchObject({
      seen: 1,
      weak: 1,
      due: 1,
      slow: 1,
      bySkill: { sub: { seen: 0 } },
    });
    expect(JSON.stringify(scope)).toBe(before);
  });
});

it("offers reachable limits without hiding or altering an existing unreachable setting", () => {
  expect(reachableTimeOptions([30, 45, 60, 90, 120], 45, 75)).toEqual([30, 45, 60]);
  expect(reachableTimeOptions([30, 45, 60, 90, 120], 90, 75)).toEqual([30, 45, 60, 90]);
});
