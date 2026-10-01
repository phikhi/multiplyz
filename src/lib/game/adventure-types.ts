import type { WorldTheme } from "./world-theme";
import type { GameState } from "./session";
import type { FinishLevelResult } from "./finish-level";
import type { DiagnosticResponse } from "@/lib/engine/diagnostic";

export type AdventurePhase =
  "arrival" | "question" | "help" | "reveal" | "feedback" | "finale" | "results" | "closed";

/** Server-owned checkpoint. The renderer receives progress, never decides mastery or rewards. */
export interface Adventure {
  /** Read-only server presentation; absent in historical checkpoints. */
  worldTheme?: WorldTheme;
  id: string;
  revision: number;
  worldIndex: number;
  levelIndex: number;
  phase: AdventurePhase;
  game: GameState;
  result: Extract<FinishLevelResult, { ok: true }> | null;
  /** Optional additions keep all previously saved adventures readable. */
  diagnostic?: { recalibration: boolean; responses: DiagnosticResponse[] };
  paused?: boolean;
  breakOfferedDay?: number;
  restReason?: "suggested" | "limit";
}

export interface AdventureCommand {
  sessionId: string;
  revision: number;
  kind: "begin" | "answer" | "reveal" | "retry" | "next" | "results" | "close" | "pause" | "resume";
  value?: number | null;
  responseMs?: number;
  /** Device navigation after acknowledging a receipt; never a reward input. */
  destination?: "companion";
}

export type AdventureResponse =
  | { ok: true; adventure: Adventure }
  | {
      ok: false;
      error: "UNAUTHENTICATED" | "LOCKED" | "INVALID" | "STALE" | "DIAGNOSTIC" | "EMPTY";
    };
