import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./index";
import { runMigrations } from "./migrate";
import { attempts, mastery, masteryKey, pinAttempts, profiles, sessions } from "./schema";

const tmpRoot = mkdtempSync(join(tmpdir(), "multiplyz-auth-schema-"));
let counter = 0;
/** Base fraîche migrée par cas (FK activées via createDatabase). */
function freshDb() {
  counter += 1;
  const db = createDatabase(join(tmpRoot, `case-${counter}`, "app.sqlite"));
  runMigrations(db);
  return db;
}

afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

describe("schéma profiles", () => {
  it("insère et relit un profil (hash parent/récupération nullable)", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();

    const row = db.select().from(profiles).get();
    expect(row).toMatchObject({
      name: "Lina",
      nameKey: "lina",
      pinHash: "h",
      avatar: "fox",
      parentPinHash: null,
      recoveryCodeHash: null,
    });
    expect(row?.id).toBeTypeOf("number");
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("contraint l'unicité du prénom (single-tenant)", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    expect(() =>
      db
        .insert(profiles)
        .values({ name: "Lina", nameKey: "lina", pinHash: "h2", avatar: "cat" })
        .run(),
    ).toThrow();
  });

  it("index UNIQUE sur name_key : deux clés identiques → doublon rejeté (ADR 0005, #37)", () => {
    const db = freshDb();
    // name distincts (index BINARY sur `name` n'attrape rien) mais name_key identique :
    // seul l'index UNIQUE `name_key` (posé par la migration à la main) doit lever.
    db.insert(profiles)
      .values({ name: "Élodie", nameKey: "élodie", pinHash: "h", avatar: "fox" })
      .run();
    expect(() =>
      db
        .insert(profiles)
        .values({ name: "élodie", nameKey: "élodie", pinHash: "h2", avatar: "cat" })
        .run(),
    ).toThrow();
  });
});

describe("schéma sessions (FK ON DELETE CASCADE)", () => {
  it("purge les sessions à la suppression du profil (RGPD — AUTH §6)", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    db.insert(sessions)
      .values({ token: "tok-1", profileId: 1, kind: "child", expiresAt: new Date(1_000_000) })
      .run();
    expect(db.select().from(sessions).all()).toHaveLength(1);

    db.delete(profiles).where(eq(profiles.id, 1)).run();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it("refuse une session orpheline (contrainte FK active)", () => {
    const db = freshDb();
    expect(() =>
      db
        .insert(sessions)
        .values({ token: "tok-x", profileId: 999, kind: "parent", expiresAt: new Date(1_000_000) })
        .run(),
    ).toThrow();
  });

  it("référence sessions.profile_id → profiles.id en cascade", () => {
    const [fk] = getTableConfig(sessions).foreignKeys;
    const ref = fk.reference();
    expect(ref.foreignTable).toBe(profiles);
    expect(ref.foreignColumns[0].name).toBe("id");
    expect(fk.onDelete).toBe("cascade");
  });
});

describe("schéma pin_attempts (rate-limit — AUTH §4)", () => {
  it("clé composite texte en PK + compteur par défaut 0 (niveau DB)", () => {
    const db = freshDb();
    // Insertion sans `failures` → exerce le défaut DB (0).
    db.insert(pinAttempts)
      .values({ id: "profile:1", lastFailureAt: new Date(1_000_000) })
      .run();

    const row = db.select().from(pinAttempts).get();
    expect(row).toMatchObject({ id: "profile:1", failures: 0 });
    expect(row?.lastFailureAt).toBeInstanceOf(Date);
  });
});

describe("masteryKey (clé composite (profil, fact) encodée en PK texte)", () => {
  it("assemble `<profileId>:<factId>`", () => {
    expect(masteryKey(5, "mult_6x8")).toBe("5:mult_6x8");
    expect(masteryKey(1, "comp10_7")).toBe("1:comp10_7");
  });

  it("reste sans ambiguïté même quand le fact_id contient `_`/`x`/`+`/`-`", () => {
    // Le fact_id (3.1) n'utilise jamais `:` → le 1er `:` sépare toujours le profil.
    expect(masteryKey(12, "sub_15-6")).toBe("12:sub_15-6");
    expect(masteryKey(3, "add_4+9")).toBe("3:add_4+9");
  });
});

describe("schéma mastery (Leitner + fluence — ENGINE §2)", () => {
  it("insère et relit une ligne (défauts DB : box 0, compteurs 0, dates nullables)", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    // Insertion minimale → exerce tous les défauts DB (strength/counts/avg = 0).
    db.insert(mastery)
      .values({ id: masteryKey(1, "mult_6x8"), profileId: 1, factId: "mult_6x8", skill: "mult" })
      .run();

    const row = db.select().from(mastery).get();
    expect(row).toMatchObject({
      id: "1:mult_6x8",
      profileId: 1,
      factId: "mult_6x8",
      skill: "mult",
      strength: 0,
      correctCount: 0,
      wrongCount: 0,
      avgResponseMs: 0,
      lastSeen: null,
      nextDue: null,
    });
  });

  it("persiste force/compteurs/fluence et les timestamps quand fournis", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    db.insert(mastery)
      .values({
        id: masteryKey(1, "comp10_7"),
        profileId: 1,
        factId: "comp10_7",
        skill: "comp10",
        strength: 4,
        correctCount: 9,
        wrongCount: 2,
        avgResponseMs: 2500,
        lastSeen: new Date(1_000_000),
        nextDue: new Date(2_000_000),
      })
      .run();

    const row = db.select().from(mastery).get();
    expect(row).toMatchObject({ strength: 4, correctCount: 9, wrongCount: 2, avgResponseMs: 2500 });
    expect(row?.lastSeen).toBeInstanceOf(Date);
    expect(row?.nextDue).toBeInstanceOf(Date);
  });

  it("contraint l'unicité (profil, fact) via la PK texte encodée", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    const row = {
      id: masteryKey(1, "add_4+9"),
      profileId: 1,
      factId: "add_4+9",
      skill: "add" as const,
    };
    db.insert(mastery).values(row).run();
    // Même (profil, fact) → même PK → doublon rejeté (une ligne par (profil, fact)).
    expect(() => db.insert(mastery).values(row).run()).toThrow();
  });

  it("purge la maîtrise à la suppression du profil (FK cascade — RGPD)", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    db.insert(mastery)
      .values({ id: masteryKey(1, "mult_6x8"), profileId: 1, factId: "mult_6x8", skill: "mult" })
      .run();
    expect(db.select().from(mastery).all()).toHaveLength(1);

    db.delete(profiles).where(eq(profiles.id, 1)).run();
    expect(db.select().from(mastery).all()).toHaveLength(0);
  });

  it("refuse une ligne orpheline (contrainte FK active)", () => {
    const db = freshDb();
    expect(() =>
      db
        .insert(mastery)
        .values({
          id: masteryKey(999, "mult_6x8"),
          profileId: 999,
          factId: "mult_6x8",
          skill: "mult",
        })
        .run(),
    ).toThrow();
  });

  it("référence mastery.profile_id → profiles.id en cascade", () => {
    const [fk] = getTableConfig(mastery).foreignKeys;
    const ref = fk.reference();
    expect(ref.foreignTable).toBe(profiles);
    expect(ref.foreignColumns[0].name).toBe("id");
    expect(fk.onDelete).toBe("cascade");
  });
});

describe("schéma attempts (journal append-only — ENGINE §10)", () => {
  it("insère et relit une réponse (bool round-trip + défauts is_retry/created_at)", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    // Sans `isRetry`/`createdAt` → exerce leurs défauts DB (false / unixepoch()).
    db.insert(attempts)
      .values({ profileId: 1, factId: "mult_6x8", skill: "mult", correct: true, responseMs: 1800 })
      .run();

    const row = db.select().from(attempts).get();
    expect(row).toMatchObject({
      profileId: 1,
      factId: "mult_6x8",
      skill: "mult",
      correct: true,
      responseMs: 1800,
      isRetry: false,
    });
    expect(row?.id).toBeTypeOf("number");
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("persiste correct=false et is_retry=true (bool drizzle → 0/1)", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    db.insert(attempts)
      .values({
        profileId: 1,
        factId: "sub_15-6",
        skill: "sub",
        correct: false,
        responseMs: 5200,
        isRetry: true,
      })
      .run();

    const row = db.select().from(attempts).get();
    expect(row).toMatchObject({ correct: false, isRetry: true });
  });

  it("est append-only : deux réponses sur le même fait coexistent", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    const base = { profileId: 1, factId: "mult_6x8", skill: "mult" as const };
    db.insert(attempts)
      .values({ ...base, correct: false, responseMs: 6000 })
      .run();
    db.insert(attempts)
      .values({ ...base, correct: true, responseMs: 1700 })
      .run();
    expect(db.select().from(attempts).all()).toHaveLength(2);
  });

  it("purge les tentatives à la suppression du profil (FK cascade — RGPD)", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    db.insert(attempts)
      .values({ profileId: 1, factId: "mult_6x8", skill: "mult", correct: true, responseMs: 1800 })
      .run();
    expect(db.select().from(attempts).all()).toHaveLength(1);

    db.delete(profiles).where(eq(profiles.id, 1)).run();
    expect(db.select().from(attempts).all()).toHaveLength(0);
  });

  it("refuse une tentative orpheline (contrainte FK active)", () => {
    const db = freshDb();
    expect(() =>
      db
        .insert(attempts)
        .values({ profileId: 999, factId: "mult_6x8", skill: "mult", correct: true, responseMs: 1 })
        .run(),
    ).toThrow();
  });

  it("référence attempts.profile_id → profiles.id en cascade", () => {
    const [fk] = getTableConfig(attempts).foreignKeys;
    const ref = fk.reference();
    expect(ref.foreignTable).toBe(profiles);
    expect(ref.foreignColumns[0].name).toBe("id");
    expect(fk.onDelete).toBe("cascade");
  });
});
