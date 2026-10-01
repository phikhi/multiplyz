import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { adventureSessions } from "@/lib/db/schema";
import type { EconomyConfig, EngineConfig, MapConfig } from "@/config/server-config";
import {
  startLevel,
  submitAttempt,
  needsDiagnostic,
  isRecalibrationRequested,
  seedDiagnostic,
  seedRecalibration,
} from "@/lib/engine/service";
import { selectDiagnostic } from "@/lib/engine/diagnostic";
import { diagnosticToQuestions } from "./diagnostic-questions";
import { LEVEL_SIZE } from "@/lib/engine/level";
import { computeStars, computeAccuracy } from "@/lib/engine/stars";
import { initGameState, applyAnswer, beginRetry, advance, buildSubmission } from "./session";
import { resolveAnswer } from "./answer";
import { resolveCurrentLevelTarget } from "./unlock";
import { finishLevel } from "./finish-level";
import type { Adventure, AdventureCommand, AdventureResponse } from "./adventure-types";

export function loadAdventure(db: AppDatabase, profileId: number): Adventure | null {
  return (
    db.select().from(adventureSessions).where(eq(adventureSessions.profileId, profileId)).get()
      ?.state ?? null
  );
}

function save(db: AppDatabase, profileId: number, state: Adventure, now: number) {
  db.insert(adventureSessions)
    .values({ profileId, state, updatedAt: new Date(now) })
    .onConflictDoUpdate({
      target: adventureSessions.profileId,
      set: { state, updatedAt: new Date(now) },
    })
    .run();
}

/** Check-and-create is serialized, including simultaneous tabs / StrictMode mounts. */
export function startAdventure(
  db: AppDatabase,
  profileId: number,
  engine: EngineConfig,
  map: MapConfig,
  now: number,
): Adventure | null {
  return db.transaction(() => {
    const current = loadAdventure(db, profileId);
    if (current && current.phase !== "closed") return current;
    const target = resolveCurrentLevelTarget(db, profileId, map.levelsPerWorld);
    const size = target.levelIndex === map.levelsPerWorld ? map.bossQuestionCount : LEVEL_SIZE;
    const recalibration = isRecalibrationRequested(db, profileId);
    const diagnostic = recalibration || needsDiagnostic(db, profileId);
    const level = diagnostic
      ? { questions: diagnosticToQuestions(selectDiagnostic(engine), Math.random) }
      : startLevel(db, profileId, engine, now, Math.random, { size });
    if (level.questions.length === 0) return null;
    const id = randomUUID();
    const state: Adventure = {
      id,
      revision: 0,
      ...target,
      phase: "arrival",
      game: initGameState(level.questions, 0, () => `${id}:0`),
      result: null,
      ...(diagnostic ? { diagnostic: { recalibration, responses: [] } } : {}),
      ...(current?.breakOfferedDay !== undefined
        ? { breakOfferedDay: current.breakOfferedDay }
        : {}),
    };
    save(db, profileId, state, now);
    return state;
  });
}

function isCommand(input: unknown): input is AdventureCommand {
  if (!input || typeof input !== "object") return false;
  const c = input as Record<string, unknown>;
  return (
    typeof c.sessionId === "string" &&
    c.sessionId.length <= 100 &&
    Number.isSafeInteger(c.revision) &&
    Number(c.revision) >= 0 &&
    typeof c.kind === "string" &&
    ["begin", "answer", "reveal", "retry", "next", "results", "close", "pause", "resume"].includes(
      c.kind,
    ) &&
    (c.kind !== "answer" ||
      ((c.value === null ||
        (Number.isSafeInteger(c.value) && Number(c.value) >= 0 && Number(c.value) <= 9999)) &&
        Number.isSafeInteger(c.responseMs) &&
        Number(c.responseMs) >= 0 &&
        Number(c.responseMs) <= 86_400_000))
  );
}

/**
 * Revision is the idempotency key. A lost reply returns the persisted checkpoint;
 * a stale run can NEVER finish the newly unlocked level. First attempt + mastery +
 * checkpoint, and final progress + wallet + receipt, commit atomically on one connection.
 */
export function commandAdventure(
  db: AppDatabase,
  profileId: number,
  input: unknown,
  engine: EngineConfig,
  map: MapConfig,
  economy: EconomyConfig,
  now: number,
  breakPolicy?: (
    offeredDay: number | undefined,
  ) => { day: number; reason: "suggested" | "limit" } | null,
): AdventureResponse {
  if (!isCommand(input)) return { ok: false, error: "INVALID" };
  return db.transaction((): AdventureResponse => {
    const current = loadAdventure(db, profileId);
    if (!current || current.id !== input.sessionId) return { ok: false, error: "STALE" };
    if (input.revision < current.revision) return { ok: true, adventure: current };
    if (input.revision !== current.revision) return { ok: false, error: "STALE" };
    if (current.paused && input.kind !== "resume" && input.kind !== "pause")
      return { ok: false, error: "INVALID" };
    const next: Adventure = { ...current, revision: current.revision + 1 };
    switch (input.kind) {
      case "pause":
      case "resume":
        if (current.phase === "closed") return { ok: false, error: "INVALID" };
        next.paused = input.kind === "pause";
        break;
      case "begin":
        if (current.phase !== "arrival") return { ok: false, error: "INVALID" };
        next.phase = "question";
        break;
      case "answer": {
        if (current.phase !== "question") return { ok: false, error: "INVALID" };
        const correct = input.value === resolveAnswer(current.game.current.question.factKey);
        const submission = buildSubmission(
          { ...current.game, askedAt: 0 },
          { correct },
          input.responseMs!,
        );
        if (current.diagnostic) {
          next.diagnostic = { ...current.diagnostic, responses: [...current.diagnostic.responses] };
          if (!submission.isRetry)
            next.diagnostic.responses.push({
              factKey: submission.factKey,
              skill: submission.skill,
              correct: submission.correct,
              responseMs: submission.responseMs,
            });
        } else {
          const applied = submitAttempt(db, profileId, submission, engine, now);
          if (!applied.ok) throw new Error("Invalid server-generated adventure attempt");
        }
        next.game = applyAnswer(current.game, { correct });
        next.phase = next.game.current.phase === "retry" ? "help" : "feedback";
        break;
      }
      case "reveal":
        if (current.phase !== "help") return { ok: false, error: "INVALID" };
        next.phase = "reveal";
        break;
      case "retry":
        if (current.phase !== "reveal") return { ok: false, error: "INVALID" };
        next.game = beginRetry(current.game, 0);
        next.phase = "question";
        break;
      case "next": {
        if (current.phase !== "feedback") return { ok: false, error: "INVALID" };
        next.game = advance(
          current.game,
          0,
          () => `${current.id}:${current.game.currentIndex + 1}`,
        );
        next.phase = "question";
        if (next.game.finished) {
          if (current.diagnostic) {
            const seed = current.diagnostic.recalibration ? seedRecalibration : seedDiagnostic;
            seed(db, profileId, current.diagnostic.responses, engine, now);
            next.phase = "finale";
            break;
          }
          const stars = computeStars(
            computeAccuracy(next.game.firstCorrectCount, next.game.questions.length),
            engine.starThresholds,
          );
          const result = finishLevel(
            db,
            profileId,
            { worldIndex: current.worldIndex, levelIndex: current.levelIndex, stars },
            map,
            economy,
            new Date(now),
          );
          if (!result.ok) throw new Error(`Adventure finish refused: ${result.error}`);
          next.result = result;
          next.phase = "finale";
        }
        break;
      }
      case "results":
        if (current.phase !== "finale" || current.diagnostic)
          return { ok: false, error: "INVALID" };
        next.phase = "results";
        break;
      case "close":
        if (current.phase !== "results" && !(current.diagnostic && current.phase === "finale"))
          return { ok: false, error: "INVALID" };
        next.phase = "closed";
        if (!current.diagnostic && breakPolicy) {
          const decision = breakPolicy(current.breakOfferedDay);
          if (decision) {
            next.breakOfferedDay = decision.day;
            next.restReason = decision.reason;
          }
        }
        break;
    }
    save(db, profileId, next, now);
    return { ok: true, adventure: next };
  });
}
