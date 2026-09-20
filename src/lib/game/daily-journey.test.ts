import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import {
  adventureSessions,
  attempts,
  ledger,
  mastery,
  profiles,
  progress,
  wallet,
  characters,
  householdSettings,
  HOUSEHOLD_SETTINGS_ID,
} from "@/lib/db/schema";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { requestRecalibration } from "@/lib/engine/service";
import { readHouseholdSettings } from "@/lib/parent/settings";
import { startAdventure, commandAdventure, loadAdventure } from "./adventure";
import { breakDecision, dailyReturnPath, dailyRestState, loadBreakDecision } from "./daily-return";
import type { Adventure, AdventureCommand } from "./adventure-types";
import { resolveAnswer } from "./answer";

import { purchaseEgg, acknowledgeEgg } from "./egg-receipt";
import { purchaseCompanion, loadShardOffers, acknowledgeShardReceipt } from "./shard-shop";
import { evolveCompanion, acknowledgeEvolution } from "./evolution";
import { makeDayOrdinal } from "@/lib/parent/regularity";

const { engine, map, economy, regularity } = CONFIG_DEFAULTS;
const now = Date.UTC(2026, 8, 10, 12);
let db: AppDatabase, id: number, a: Adventure;
const payload = (kind: AdventureCommand["kind"], fields: Partial<AdventureCommand> = {}) => ({
  sessionId: a.id,
  revision: a.revision,
  kind,
  ...fields,
});
function send(kind: AdventureCommand["kind"], fields: Partial<AdventureCommand> = {}) {
  const result = commandAdventure(db, id, payload(kind, fields), engine, map, economy, now);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  a = result.adventure;
  return a;
}
function solve() {
  send("answer", { value: resolveAnswer(a.game.current.question.factKey), responseMs: 2100 });
  send("next");
}
function finish() {
  if (a.phase === "arrival") send("begin");
  while (a.phase === "question") solve();
}
beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  id = db
    .insert(profiles)
    .values({ name: "Nova", nameKey: "nova", avatar: "cat", pinHash: "test" })
    .returning()
    .get().id;
  a = startAdventure(db, id, engine, map, now)!;
});
afterEach(() => db.$client.close());

describe("first journey and durable daily return", () => {
  it("starts the real configured diagnostic without creating a reward or mastery", () => {
    expect(a.diagnostic).toEqual({ recalibration: false, responses: [] });
    expect(a.game.questions).toHaveLength(engine.diagnosticSize);
    expect(startAdventure(db, id, engine, map, now)).toEqual(a);
    expect(db.select().from(mastery).all()).toEqual([]);
    expect(dailyReturnPath(db, id, regularity, now)).toBe("/jouer");
  });
  it("honours a different diagnostic size from configuration", () => {
    db.delete(adventureSessions).run();
    expect(
      startAdventure(db, id, { ...engine, diagnosticSize: 12 }, map, now)?.game.questions,
    ).toHaveLength(12);
  });
  it("keeps the first answer through assistance, replay, and reopening", () => {
    send("begin");
    const input = payload("answer", { value: null, responseMs: 2500 });
    const result = commandAdventure(db, id, input, engine, map, economy, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    a = result.adventure;
    expect(commandAdventure(db, id, input, engine, map, economy, now)).toEqual(result);
    expect(loadAdventure(db, id)).toEqual(a);
    send("reveal");
    send("retry");
    send("answer", { value: resolveAnswer(a.game.current.question.factKey), responseMs: 1000 });
    expect(a.diagnostic?.responses).toHaveLength(1);
    expect(a.diagnostic?.responses[0].correct).toBe(false);
    send("next");
    finish();
    expect(
      db
        .select()
        .from(mastery)
        .all()
        .find((row) => row.factId === a.diagnostic?.responses[0].factKey)?.strength,
    ).toBe(0);
    expect(db.select().from(attempts).all()).toEqual([]);
    expect(db.select().from(ledger).all()).toEqual([]);
    expect(db.select().from(progress).all()).toEqual([]);
  });
  it("commits mastery once and resumes the completed welcome before starting level one", () => {
    finish();
    expect(a.phase).toBe("finale");
    expect(a.result).toBeNull();
    expect(db.select().from(mastery).all()).toHaveLength(engine.diagnosticSize);
    const before = db.select().from(mastery).all();
    expect(startAdventure(db, id, engine, map, now)).toEqual(a);
    send("close");
    expect(dailyReturnPath(db, id, regularity, now)).toBe("/carte");
    const normal = startAdventure(db, id, engine, map, now)!;
    expect(normal.diagnostic).toBeUndefined();
    expect(normal.levelIndex).toBe(0);
    expect(normal.worldIndex).toBe(0);
    expect(db.select().from(mastery).all()).toEqual(before);
  });
  it("rolls back mastery if the final checkpoint cannot be saved", () => {
    send("begin");
    while (a.game.currentIndex < a.game.questions.length - 1) solve();
    send("answer", { value: resolveAnswer(a.game.current.question.factKey), responseMs: 2100 });
    const before = a;
    db.run(
      sql.raw(
        "CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON adventure_sessions BEGIN SELECT RAISE(ABORT,'checkpoint failure'); END;",
      ),
    );
    expect(() => send("next")).toThrow("checkpoint failure");
    expect(db.select().from(mastery).all()).toEqual([]);
    expect(loadAdventure(db, id)).toEqual(before);
    db.run(sql.raw("DROP TRIGGER fail_checkpoint"));
    send("next");
    expect(a.phase).toBe("finale");
    expect(db.select().from(mastery).all()).toHaveLength(engine.diagnosticSize);
  });
  it("persists a manual pause and does not accept an answer while paused", () => {
    send("begin");
    const game = a.game;
    const pause = payload("pause");
    const result = commandAdventure(db, id, pause, engine, map, economy, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    a = result.adventure;
    expect(a.paused).toBe(true);
    expect(a.game).toEqual(game);
    expect(commandAdventure(db, id, pause, engine, map, economy, now)).toEqual(result);
    expect(dailyReturnPath(db, id, regularity, now)).toBe("/repos");
    expect(dailyRestState(db, id, regularity, now)).toEqual({ reason: "manual", active: true });
    expect(
      commandAdventure(
        db,
        id,
        payload("answer", { value: 1, responseMs: 1000 }),
        engine,
        map,
        economy,
        now,
      ),
    ).toEqual({ ok: false, error: "INVALID" });
    expect(startAdventure(db, id, engine, map, now)).toEqual(a);
    send("resume");
    expect(a.paused).toBe(false);
    expect(a.game).toEqual(game);
    expect(dailyReturnPath(db, id, regularity, now)).toBe("/jouer");
  });
  it("never resumes or mutates the checkpoint of another profile", () => {
    const other = db
      .insert(profiles)
      .values({ name: "Lune", nameKey: "lune", avatar: "fox", pinHash: "test" })
      .returning()
      .get().id;
    expect(commandAdventure(db, other, payload("pause"), engine, map, economy, now)).toEqual({
      ok: false,
      error: "STALE",
    });
    expect(loadAdventure(db, id)).toEqual(a);
    expect(loadAdventure(db, other)).toBeNull();
  });
  it("finishes the current run before an armed recalibration, then preserves earned mastery", () => {
    finish();
    send("close");
    a = startAdventure(db, id, engine, map, now)!;
    expect(a.diagnostic).toBeUndefined();
    requestRecalibration(db, id);
    expect(startAdventure(db, id, engine, map, now)).toEqual(a);
    send("begin");
    while (a.phase === "question") solve();
    send("results");
    send("close");
    const before = db.select().from(mastery).all();
    const rewards = db.select().from(ledger).all();
    a = startAdventure(db, id, engine, map, now)!;
    expect(a.diagnostic?.recalibration).toBe(true);
    finish();
    for (const row of before)
      expect(
        db.select().from(mastery).where(eq(mastery.id, row.id)).get()!.strength,
      ).toBeGreaterThanOrEqual(row.strength);
    expect(db.select().from(ledger).all()).toEqual(rewards);
    expect(
      db.select().from(profiles).where(eq(profiles.id, id)).get()?.recalibrationRequested,
    ).toBe(false);
  });
  it("offers a rest at the results boundary and carries its day into the next run", () => {
    finish();
    send("close");
    a = startAdventure(db, id, engine, map, now)!;
    send("begin");
    while (a.phase === "question") solve();
    send("results");
    const before = db.select().from(ledger).all();
    const close = payload("close");
    const r = commandAdventure(db, id, close, engine, map, economy, now, () => ({
      day: 999,
      reason: "suggested",
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    a = r.adventure;
    expect(a.restReason).toBe("suggested");
    expect(
      commandAdventure(db, id, close, engine, map, economy, now, () => {
        throw new Error("recomputed");
      }),
    ).toEqual(r);
    expect(startAdventure(db, id, engine, map, now)?.breakOfferedDay).toBe(999);
    expect(db.select().from(ledger).all()).toEqual(before);
  });
  it("keeps optional additions compatible with an older saved checkpoint", () => {
    finish();
    send("close");
    a = startAdventure(db, id, engine, map, now)!;
    expect(a.paused).toBeUndefined();
    expect(a.breakOfferedDay).toBeUndefined();
    send("begin");
    solve();
    expect(a.phase).toBe("question");
  });
});

describe("configured breaks", () => {
  it("uses inclusive thresholds, once per local day, with the parent limit taking precedence", () => {
    const settings = {
      ...readHouseholdSettings(db),
      screenTimeNudgeMinutes: 15,
      screenTimeHardLockEnabled: false,
      screenTimeHardLockMinutes: 20,
    };
    expect(breakDecision(settings, 14, 10)).toBeNull();
    expect(breakDecision(settings, 15, 10)).toEqual({ day: 10, reason: "suggested" });
    expect(breakDecision(settings, 20, 10, 10)).toBeNull();
    expect(breakDecision(settings, 15, 11, 10)?.reason).toBe("suggested");
    expect(breakDecision({ ...settings, screenTimeNudgeMinutes: 30 }, 20, 10)).toBeNull();
    expect(
      breakDecision({ ...settings, screenTimeHardLockEnabled: true }, 20, 10, 10)?.reason,
    ).toBe("limit");
  });
});

it("returns to pending encounters without spending again or crossing profiles", () => {
  finish();
  send("close");
  db.insert(wallet).values({ profileId: id, coins: 100, shards: 400 }).run();
  expect(purchaseEgg(db, id, economy, map, "daily-egg", new Date(now), () => 0).ok).toBe(true);
  const before = db.select().from(ledger).all();
  expect(dailyReturnPath(db, id, regularity, now)).toBe("/boutique");
  expect(db.select().from(ledger).all()).toEqual(before);
  acknowledgeEgg(db, id, "daily-egg");
  expect(dailyReturnPath(db, id, regularity, now)).toBe("/carte");
  const offer = loadShardOffers(db, id, economy, map)[0];
  expect(
    purchaseCompanion(db, id, economy, map, "daily-shards", offer.characterId, new Date(now)).ok,
  ).toBe(true);
  expect(dailyReturnPath(db, id, regularity, now)).toBe("/boutique/eclats");
  acknowledgeShardReceipt(db, id, "daily-shards");
  db.update(characters)
    .set({
      maxStage: 3,
      artRefStages: JSON.stringify({
        2: "socle/creature/daily-ado.png",
        3: "socle/creature/daily-adulte.png",
      }),
    })
    .where(eq(characters.id, offer.characterId))
    .run();
  expect(
    evolveCompanion(
      db,
      id,
      offer.characterId,
      1,
      40,
      "socle/creature/daily-ado.png",
      economy,
      new Date(now),
      () => true,
    ).ok,
  ).toBe(true);
  expect(dailyReturnPath(db, id, regularity, now)).toBe(
    `/collection/${encodeURIComponent(offer.characterId)}/grandir`,
  );
  const other = db
    .insert(profiles)
    .values({ name: "Lune", nameKey: "lune", avatar: "fox", pinHash: "test" })
    .returning()
    .get().id;
  expect(dailyReturnPath(db, other, regularity, now)).toBe("/jouer");
  acknowledgeEvolution(db, id, offer.characterId, 1);
  expect(dailyReturnPath(db, id, regularity, now)).toBe("/carte");
});
it("uses persisted day time, allows the active run, and releases the limit next local day", () => {
  finish();
  send("close");
  const late = Date.UTC(2026, 8, 10, 21, 59); // 23:59 Paris
  db.insert(householdSettings)
    .values({
      id: HOUSEHOLD_SETTINGS_ID,
      screenTimeNudgeMinutes: 15,
      screenTimeHardLockEnabled: true,
      screenTimeHardLockMinutes: 20,
    })
    .run();
  for (const at of [late - 20 * 60000, late])
    db.insert(attempts)
      .values({
        profileId: id,
        factId: "comp10_3",
        skill: "comp10",
        correct: true,
        responseMs: 1000,
        isRetry: false,
        createdAt: new Date(at),
      })
      .run();
  const day = makeDayOrdinal(regularity.dayTimeZone)(late);
  expect(loadBreakDecision(db, id, regularity, late)).toEqual({ day, reason: "limit" });
  expect(dailyReturnPath(db, id, regularity, late)).toBe("/repos");
  expect(dailyRestState(db, id, regularity, late)).toEqual({ reason: "limit", active: false });
  const tomorrow = late + 2 * 60000;
  expect(dailyReturnPath(db, id, regularity, tomorrow)).toBe("/carte");
  expect(dailyRestState(db, id, regularity, tomorrow).reason).toBe("manual");
  a = startAdventure(db, id, engine, map, late)!;
  expect(dailyReturnPath(db, id, regularity, late)).toBe("/jouer");
  send("pause");
  expect(dailyRestState(db, id, regularity, late)).toEqual({ reason: "manual", active: true });
});
it("shows a non-blocking suggestion only on the day recorded at the result", () => {
  finish();
  send("close");
  a = startAdventure(db, id, engine, map, now)!;
  finish();
  send("results");
  const day = makeDayOrdinal(regularity.dayTimeZone)(now);
  const result = commandAdventure(db, id, payload("close"), engine, map, economy, now, () => ({
    day,
    reason: "suggested",
  }));
  expect(result.ok).toBe(true);
  expect(dailyRestState(db, id, regularity, now)).toEqual({ reason: "suggested", active: false });
  expect(dailyRestState(db, id, regularity, now + 86400000)).toEqual({
    reason: "manual",
    active: false,
  });
  expect(dailyReturnPath(db, id, regularity, now)).toBe("/carte");
});
