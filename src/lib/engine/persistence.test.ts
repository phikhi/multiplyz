import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { attempts, mastery, masteryKey, profiles } from "@/lib/db/schema";
import { makeFact, type Fact } from "./facts";
import type { MasteryState } from "./mastery";
import {
  attemptExists,
  insertAttempt,
  loadMasteryState,
  loadScope,
  resolveFact,
  upsertMastery,
  type AttemptRow,
} from "./persistence";

/**
 * Tests d'intégration de la couche de persistance du moteur (3.7) sur **base réelle**
 * (SQLite en mémoire + migrations). Vérifient le mapping DB↔moteur (instants ms↔Date),
 * l'upsert, le journal `attempts`, la garde d'idempotence et la résolution de fait.
 */

let db: AppDatabase;
let profileId: number;
const NOW = Date.UTC(2026, 6, 3, 10, 0, 0); // epoch ms injecté, déterministe

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = seedProfile("Léa");
});

const COMP10_7: Fact = makeFact("comp10", 7, 0);
const MULT_6X8: Fact = makeFact("mult", 6, 8);

function stateFixture(overrides: Partial<MasteryState> = {}): MasteryState {
  return {
    box: 3,
    correctCount: 2,
    wrongCount: 1,
    avgResponseMs: 1500,
    lastSeen: NOW,
    nextDue: NOW + 4 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

describe("loadMasteryState", () => {
  it("renvoie null pour un fait jamais vu (aucune ligne)", () => {
    expect(loadMasteryState(db, profileId, COMP10_7.key)).toBeNull();
  });

  it("mappe une ligne persistée vers un MasteryState (Date → epoch ms)", () => {
    upsertMastery(db, profileId, COMP10_7, stateFixture());
    expect(loadMasteryState(db, profileId, COMP10_7.key)).toEqual(stateFixture());
  });

  it("mappe lastSeen/nextDue null quand la ligne les a à null", () => {
    upsertMastery(db, profileId, COMP10_7, stateFixture({ lastSeen: null, nextDue: null }));
    const loaded = loadMasteryState(db, profileId, COMP10_7.key);
    expect(loaded?.lastSeen).toBeNull();
    expect(loaded?.nextDue).toBeNull();
  });

  it("isole les profils (même fait, autre profil → null)", () => {
    const other = seedProfile("Tom");
    upsertMastery(db, profileId, COMP10_7, stateFixture());
    expect(loadMasteryState(db, other, COMP10_7.key)).toBeNull();
  });
});

describe("upsertMastery", () => {
  it("insère une ligne neuve avec skill + colonnes dérivées", () => {
    upsertMastery(db, profileId, MULT_6X8, stateFixture({ box: 1 }));
    const row = db
      .select()
      .from(mastery)
      .where(eq(mastery.id, masteryKey(profileId, MULT_6X8.key)))
      .get();
    expect(row).toMatchObject({
      profileId,
      factId: MULT_6X8.key,
      skill: "mult",
      strength: 1,
      correctCount: 2,
      wrongCount: 1,
      avgResponseMs: 1500,
    });
  });

  it("met à jour la ligne existante sur conflit de PK (pas de doublon)", () => {
    upsertMastery(db, profileId, COMP10_7, stateFixture({ box: 1 }));
    upsertMastery(db, profileId, COMP10_7, stateFixture({ box: 4, correctCount: 9 }));
    const rows = db.select().from(mastery).where(eq(mastery.profileId, profileId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].strength).toBe(4);
    expect(rows[0].correctCount).toBe(9);
  });
});

describe("loadScope", () => {
  it("renvoie tout le domaine, state null pour les faits neufs", () => {
    const scope = loadScope(db, profileId);
    // Le périmètre couvre l'univers complet (comp10+add+sub+mult) — tous neufs ici.
    expect(scope.length).toBeGreaterThan(300);
    expect(scope.every((entry) => entry.state === null)).toBe(true);
  });

  it("attache le state persisté au bon fait", () => {
    upsertMastery(db, profileId, COMP10_7, stateFixture({ box: 2 }));
    const scope = loadScope(db, profileId);
    const entry = scope.find((e) => e.fact.key === COMP10_7.key);
    expect(entry?.state).toEqual(stateFixture({ box: 2 }));
    // Un autre fait reste neuf.
    expect(scope.find((e) => e.fact.key === MULT_6X8.key)?.state).toBeNull();
  });

  it("ignore une ligne mastery orpheline (fact_id hors domaine courant)", () => {
    // Ligne au fact_id corrompu / hors-Tier1 : ne doit apparaître dans aucun ScopeEntry.
    db.insert(mastery)
      .values({
        id: masteryKey(profileId, "mult_99x99"),
        profileId,
        factId: "mult_99x99",
        skill: "mult",
        strength: 5,
      })
      .run();
    const scope = loadScope(db, profileId);
    expect(scope.some((e) => e.fact.key === "mult_99x99")).toBe(false);
    // Aucune ligne du domaine n'a hérité de ce state orphelin.
    expect(scope.every((e) => e.state === null)).toBe(true);
  });
});

describe("attemptExists (garde d'idempotence, SYNC §2)", () => {
  const row: AttemptRow = {
    factId: COMP10_7.key,
    skill: "comp10",
    correct: true,
    responseMs: 1200,
    isRetry: false,
    clientAttemptId: "cid-1",
  };

  it("false quand clientAttemptId est null (jamais de dédoublonnage sans id)", () => {
    insertAttempt(db, profileId, { ...row, clientAttemptId: null }, new Date(NOW));
    expect(attemptExists(db, profileId, null)).toBe(false);
  });

  it("false quand aucune ligne ne porte cet id", () => {
    expect(attemptExists(db, profileId, "cid-1")).toBe(false);
  });

  it("true après insertion d'une ligne portant cet id", () => {
    insertAttempt(db, profileId, row, new Date(NOW));
    expect(attemptExists(db, profileId, "cid-1")).toBe(true);
  });

  it("est scopé au profil (même id, autre profil → false)", () => {
    const other = seedProfile("Tom");
    insertAttempt(db, profileId, row, new Date(NOW));
    expect(attemptExists(db, other, "cid-1")).toBe(false);
  });
});

describe("insertAttempt", () => {
  it("journalise une ligne append-only avec created_at = now serveur", () => {
    insertAttempt(
      db,
      profileId,
      {
        factId: MULT_6X8.key,
        skill: "mult",
        correct: false,
        responseMs: 5000,
        isRetry: true,
        clientAttemptId: "cid-a",
      },
      new Date(NOW),
    );
    const rows = db.select().from(attempts).where(eq(attempts.profileId, profileId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      factId: MULT_6X8.key,
      skill: "mult",
      correct: false,
      responseMs: 5000,
      isRetry: true,
      clientAttemptId: "cid-a",
    });
    expect(rows[0].createdAt.getTime()).toBe(NOW);
  });

  it("accepte plusieurs lignes (append-only, pas d'unicité de PK sur fait)", () => {
    const base: AttemptRow = {
      factId: COMP10_7.key,
      skill: "comp10",
      correct: true,
      responseMs: 900,
      isRetry: false,
      clientAttemptId: null,
    };
    insertAttempt(db, profileId, base, new Date(NOW));
    insertAttempt(db, profileId, base, new Date(NOW + 1000));
    const rows = db.select().from(attempts).where(eq(attempts.profileId, profileId)).all();
    expect(rows).toHaveLength(2);
  });
});

describe("resolveFact", () => {
  it("résout une clé canonique valide", () => {
    expect(resolveFact("comp10_7")).toEqual(COMP10_7);
  });

  it("renvoie null pour une clé corrompue / hors domaine", () => {
    expect(resolveFact("mult_0x5")).toBeNull();
    expect(resolveFact("comp10_007")).toBeNull();
    expect(resolveFact("garbage")).toBeNull();
  });
});
