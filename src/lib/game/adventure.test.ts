import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { adventureSessions, attempts, ledger, mastery, profiles, progress } from "@/lib/db/schema";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { startAdventure, commandAdventure, loadAdventure } from "./adventure";
import type { Adventure, AdventureCommand } from "./adventure-types";
import { resolveAnswer } from "./answer";
import { loadWallet } from "./wallet";
import { recordStars } from "./progress";
import { generateAllFacts } from "@/lib/engine/facts";
import { seedDiagnostic } from "@/lib/engine/service";

const { engine, map, economy } = CONFIG_DEFAULTS;
const now = Date.UTC(2026, 8, 10, 12);
let db: AppDatabase;
let profileId: number;
let a: Adventure;
function command(kind: AdventureCommand["kind"], fields: Partial<AdventureCommand> = {}) {
  return { sessionId: a.id, revision: a.revision, kind, ...fields };
}
function send(input: unknown) {
  return commandAdventure(db, profileId, input, engine, map, economy, now);
}
function act(kind: AdventureCommand["kind"], fields: Partial<AdventureCommand> = {}) {
  const r = send(command(kind, fields));
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error);
  a = r.adventure;
}
function solve(correct = true) {
  act("answer", {
    value: correct ? resolveAnswer(a.game.current.question.factKey) : null,
    responseMs: 2100,
  });
  if (!correct) {
    act("reveal");
    act("retry");
    act("answer", { value: 9999, responseMs: 1500 });
  }
}
beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = db
    .insert(profiles)
    .values({ name: "Test", nameKey: "test", pinHash: "hash", avatar: "cat" })
    .returning()
    .get().id;
  seedDiagnostic(
    db,
    profileId,
    generateAllFacts().map((fact) => ({
      factKey: fact.key,
      skill: fact.skill,
      correct: true,
      responseMs: 1200,
    })),
    engine,
    now - 30 * 86400000,
  );
  a = startAdventure(db, profileId, engine, map, now)!;
});
afterEach(() => db.$client.close());

describe("durable adventure on real SQLite", () => {
  it("keeps the engine's short levels and handles a fully mastered scope with nothing due", () => {
    db.run(sql`DELETE FROM adventure_sessions`);
    db.delete(mastery).run();
    // Une maîtrise existante distingue ce niveau court d'un premier diagnostic.
    const known = generateAllFacts()[0];
    seedDiagnostic(
      db,
      profileId,
      [{ factKey: known.key, skill: known.skill, correct: true, responseMs: 1200 }],
      engine,
      now,
    );
    expect(startAdventure(db, profileId, engine, map, now)?.game.questions.length).toBe(
      engine.newMaxPerLevel,
    );
    db.run(sql`DELETE FROM adventure_sessions`);
    db.delete(mastery).run();
    seedDiagnostic(
      db,
      profileId,
      generateAllFacts().map((fact) => ({
        factKey: fact.key,
        skill: fact.skill,
        correct: true,
        responseMs: 1200,
      })),
      engine,
      now,
    );
    db.update(mastery)
      .set({ strength: engine.maxBox, nextDue: new Date(now + 86400000) })
      .run();
    expect(startAdventure(db, profileId, engine, map, now)).toBeNull();
    expect(loadAdventure(db, profileId)).toBeNull();
  });

  it("resumes the exact engine questions and accepts a repeated start only once", () => {
    expect(startAdventure(db, profileId, engine, map, now + 1000)).toEqual(a);
    expect(a.game.questions).toHaveLength(10);
    act("begin");
    solve();
    act("next");
    expect(loadAdventure(db, profileId)).toEqual(a);
    expect(a.game.currentIndex).toBe(1);
  });
  it("keeps the first attempt across help, reload, retry and duplicate delivery", () => {
    act("begin");
    const input = command("answer", { value: null, responseMs: 3100 });
    act("answer", { value: null, responseMs: 3100 });
    expect(send(input)).toEqual({ ok: true, adventure: a });
    expect(a.phase).toBe("help");
    const rows = db.select().from(mastery).all();
    act("reveal");
    act("retry");
    a = startAdventure(db, profileId, engine, map, now + 900000)!;
    act("answer", { value: resolveAnswer(a.game.current.question.factKey), responseMs: 1000 });
    expect(a.game.firstCorrectCount).toBe(0);
    expect(db.select().from(attempts).all()).toHaveLength(1);
    expect(db.select().from(mastery).all()).toEqual(rows);
  });
  it("finishes with every answer accompanied, unlocks and credits once even after lost final reply", () => {
    act("begin");
    for (let i = 0; i < 9; i++) {
      solve(false);
      act("next");
    }
    solve(false);
    const final = command("next");
    act("next");
    expect(a.phase).toBe("finale");
    expect(a.result?.stars).toBe(0);
    expect(a.result?.reward.total).toBe(economy.levelBaseCoins);
    expect(send(final)).toEqual({ ok: true, adventure: a });
    expect(startAdventure(db, profileId, engine, map, now)).toEqual(a);
    act("results");
    expect(loadAdventure(db, profileId)?.result).toEqual(a.result);
    act("close");
    a = startAdventure(db, profileId, engine, map, now)!;
    expect(a.levelIndex).toBe(1);
    expect(send(final)).toEqual({ ok: false, error: "STALE" });
    expect(db.select().from(progress).all()).toHaveLength(1);
    expect(db.select().from(ledger).all()).toHaveLength(1);
    expect(loadWallet(db, profileId).coins).toBe(economy.levelBaseCoins);
  });
  it("calculates the score on the server, ignoring client-supplied stars/correct", () => {
    act("begin");
    expect(
      send({ ...command("answer", { value: null, responseMs: 1200 }), correct: true, stars: 3 }).ok,
    ).toBe(true);
    a = loadAdventure(db, profileId)!;
    expect(a.game.firstCorrectCount).toBe(0);
    expect(db.select().from(attempts).get()?.correct).toBe(false);
  });
  it("serializes competing tabs: the first submitted answer wins", () => {
    act("begin");
    const rival = command("answer", { value: 9999, responseMs: 2000 });
    solve();
    expect(send(rival)).toEqual({ ok: true, adventure: a });
    expect(a.game.firstCorrectCount).toBe(1);
    expect(db.select().from(attempts).all()).toHaveLength(1);
  });
  it("rolls back attempt and mastery if checkpoint persistence fails", () => {
    act("begin");
    const before = a;
    const priorMastery = db.select().from(mastery).all();
    db.run(
      sql`CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON adventure_sessions BEGIN SELECT RAISE(ABORT, 'disk failure'); END`,
    );
    expect(() => solve()).toThrow("disk failure");
    expect(db.select().from(attempts).all()).toHaveLength(0);
    expect(db.select().from(mastery).all()).toEqual(priorMastery);
    expect(loadAdventure(db, profileId)).toEqual(before);
  });
  it("rolls back final gains and progress if the receipt cannot be saved", () => {
    act("begin");
    for (let i = 0; i < 9; i++) {
      solve();
      act("next");
    }
    solve();
    db.run(
      sql`CREATE TRIGGER fail_receipt BEFORE UPDATE ON adventure_sessions BEGIN SELECT RAISE(ABORT, 'disk failure'); END`,
    );
    expect(() => act("next")).toThrow("disk failure");
    expect(loadWallet(db, profileId).coins).toBe(0);
    expect(db.select().from(progress).all()).toHaveLength(0);
    expect(db.select().from(ledger).all()).toHaveLength(0);
    expect(loadAdventure(db, profileId)?.phase).toBe("feedback");
  });
  it("keeps configured boss length and guaranteed legendary reward", () => {
    db.run(sql`DELETE FROM adventure_sessions`);
    for (let i = 0; i < map.levelsPerWorld; i++)
      recordStars(db, { profileId, worldIndex: 0, levelIndex: i }, 0, new Date(now));
    a = startAdventure(db, profileId, engine, { ...map, bossQuestionCount: 15 }, now)!;
    expect(a.game.questions).toHaveLength(15);
    act("begin");
    for (let i = 0; i < 15; i++) {
      solve();
      act("next");
    }
    expect(a.result?.stars).toBe(3);
    expect(a.result?.legendaryAdded).toBe(true);
    expect(a.result?.unlockedNextWorld).toBe(true);
  });
  it("refuses an incompatible saved question without committing a checkpoint or attempt", () => {
    act("begin");
    const question = a.game.current.question;
    const incompatible: Adventure = {
      ...a,
      game: {
        ...a.game,
        current: {
          ...a.game.current,
          question: { ...question, skill: question.skill === "mult" ? "add" : "mult" },
        },
      },
    };
    db.update(adventureSessions).set({ state: incompatible }).run();
    expect(() => solve()).toThrow("Invalid server-generated adventure attempt");
    expect(loadAdventure(db, profileId)).toEqual(incompatible);
    expect(db.select().from(attempts).all()).toHaveLength(0);
  });
  it("does not acknowledge a finish when the saved target is no longer playable", () => {
    act("begin");
    for (let i = 0; i < 9; i++) {
      solve();
      act("next");
    }
    solve();
    const incompatible = { ...a, levelIndex: 5 };
    db.update(adventureSessions).set({ state: incompatible }).run();
    expect(() => act("next")).toThrow("Adventure finish refused: LEVEL_LOCKED");
    expect(loadAdventure(db, profileId)).toEqual(incompatible);
    expect(db.select().from(progress).all()).toHaveLength(0);
    expect(db.select().from(ledger).all()).toHaveLength(0);
  });
  it("rejects wrong profiles, malformed commands and impossible transitions", () => {
    const other = db
      .insert(profiles)
      .values({ name: "Other", pinHash: "hash", avatar: "cat" })
      .returning()
      .get().id;
    expect(commandAdventure(db, other, command("begin"), engine, map, economy, now)).toEqual({
      ok: false,
      error: "STALE",
    });
    for (const invalid of [
      null,
      {},
      command("answer", { value: -1, responseMs: 0 }),
      command("answer", { value: null, responseMs: NaN }),
    ])
      expect(send(invalid)).toEqual({ ok: false, error: "INVALID" });
    for (const kind of ["next", "results", "close", "retry", "reveal"] as const)
      expect(send(command(kind))).toEqual({ ok: false, error: "INVALID" });
    expect(send(command("answer", { value: 1, responseMs: 1000 }))).toEqual({
      ok: false,
      error: "INVALID",
    });
    expect(send(command("begin", { revision: 99 }))).toEqual({ ok: false, error: "STALE" });
    act("begin");
    expect(send(command("begin"))).toEqual({ ok: false, error: "INVALID" });
    db.delete(profiles).where(eq(profiles.id, profileId)).run();
    expect(loadAdventure(db, profileId)).toBeNull();
  });
});
