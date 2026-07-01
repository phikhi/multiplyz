import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/lib/db";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { attemptKey, getAttemptState, recordFailure, resetAttempts } from "./pin-attempts";

let db: AppDatabase;

const T0 = new Date("2026-07-01T12:00:00.000Z");
const T1 = new Date("2026-07-01T12:00:05.000Z");

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
});

describe("attemptKey", () => {
  it("encode la cible en clé composite <scope>:<clé>", () => {
    expect(attemptKey("profile", "5")).toBe("profile:5");
    expect(attemptKey("ip", "1.2.3.4")).toBe("ip:1.2.3.4");
  });
});

describe("getAttemptState", () => {
  it("null quand aucun échec enregistré", () => {
    expect(getAttemptState(db, "profile:5")).toBeNull();
  });
});

describe("recordFailure", () => {
  it("crée la ligne au 1er échec (failures=1)", () => {
    recordFailure(db, "profile:5", T0);
    expect(getAttemptState(db, "profile:5")).toEqual({ failures: 1, lastFailureAt: T0 });
  });

  it("incrémente et met à jour l'instant aux échecs suivants (upsert atomique)", () => {
    recordFailure(db, "profile:5", T0);
    recordFailure(db, "profile:5", T1);
    expect(getAttemptState(db, "profile:5")).toEqual({ failures: 2, lastFailureAt: T1 });
  });

  it("compteurs indépendants par cible", () => {
    recordFailure(db, "profile:5", T0);
    recordFailure(db, "ip:1.2.3.4", T0);
    recordFailure(db, "ip:1.2.3.4", T1);
    expect(getAttemptState(db, "profile:5")?.failures).toBe(1);
    expect(getAttemptState(db, "ip:1.2.3.4")?.failures).toBe(2);
  });
});

describe("resetAttempts", () => {
  it("supprime le compteur (succès)", () => {
    recordFailure(db, "profile:5", T0);
    resetAttempts(db, "profile:5");
    expect(getAttemptState(db, "profile:5")).toBeNull();
  });

  it("no-op sur une cible absente", () => {
    expect(() => resetAttempts(db, "profile:404")).not.toThrow();
  });
});
