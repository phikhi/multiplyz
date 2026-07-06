import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./index";
import { runMigrations } from "./migrate";
import {
  attempts,
  characters,
  collection,
  collectionKey,
  jobs,
  ledger,
  mastery,
  masteryKey,
  pinAttempts,
  profiles,
  progress,
  progressKey,
  sessions,
  wallet,
  worlds,
} from "./schema";

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
    // seul l'index UNIQUE `name_key` (déclaré via `.unique()`) doit lever.
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

  it("GARDE anti-drift : les index de `profiles` en base == exactement {name, name_key} (ADR 0005)", () => {
    // Garde le contrat drizzle cohérent (schema.ts ↔ snapshot ↔ SQL réel). L'index
    // `name_key` est déclaré via `.unique()` de colonne → drizzle-kit le sérialise
    // dans le snapshot ET le SQL (`db:generate` = no-op). Ce test lit l'état RÉEL
    // en base (`sqlite_master`) après migration : il échoue si une migration perd
    // l'un des index OU si un index inattendu apparaît (divergence future). Effet
    // observable : retirer `.unique()` de `name_key` OU casser le SQL 0005 → rouge.
    const db = freshDb();
    const rows = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'profiles' AND name NOT LIKE 'sqlite_autoindex_%'`,
    );
    const indexes = rows.map((r) => r.name).sort();
    expect(indexes).toEqual(["profiles_name_key_unique", "profiles_name_unique"]);
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

  // Idempotence DB-niveau (#82) : l'index UNIQUE composite `(profile_id,
  // client_attempt_id)` doit **rejeter au niveau MOTEUR** un rejeu portant le même id
  // client — indépendamment de la garde applicative `attemptExists`. On insère la 2ᵉ
  // ligne EN BRUT (sans passer par `submitAttempt` qui court-circuiterait via
  // `attemptExists`) → seule la contrainte DB peut lever. Effet observable : retirer le
  // `uniqueIndex(...)` d'`attempts` (ou casser le SQL 0008) → l'insert passe → rouge.
  // GARDE anti-drift (#82, même patron que la garde `profiles`) : après `runMigrations`,
  // l'index UNIQUE `attempts_profile_client_attempt_unique` doit EXISTER en base (état
  // réel `sqlite_master`, pas seulement le nom du token). Effet observable : retirer le
  // `uniqueIndex(...)` d'`attempts` OU casser le SQL 0008 → l'index disparaît → rouge.
  it("GARDE : l'index UNIQUE (profile_id, client_attempt_id) existe en base après migration (#82)", () => {
    const db = freshDb();
    const rows = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'attempts' AND name NOT LIKE 'sqlite_autoindex_%'`,
    );
    expect(rows.map((r) => r.name)).toContain("attempts_profile_client_attempt_unique");
  });

  it("rejette au niveau DB un doublon (profile_id, client_attempt_id) — idempotence moteur (#82)", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    const row = {
      profileId: 1,
      factId: "mult_6x8",
      skill: "mult" as const,
      correct: true,
      responseMs: 1800,
      clientAttemptId: "attempt-abc",
    };
    db.insert(attempts).values(row).run();
    // Même (profil, id client) → l'index UNIQUE composite doit lever (le moteur DB, pas
    // seulement la garde applicative, sérialise le dédoublonnage).
    expect(() => db.insert(attempts).values(row).run()).toThrow();
  });

  // NULL-distinctness SQLite : plusieurs lignes SANS id client (diagnostic, rejeux nus)
  // coexistent — jamais dédoublonnées, car SQLite traite chaque `NULL` comme distinct dans
  // un index UNIQUE composite ordinaire. C'est cette propriété (et non un prédicat partiel
  // `WHERE ... IS NOT NULL`, redondant + non-testable ici, cf. rétro #124) qui laisse les
  // rejeux nus libres. Ce test verrouille l'invariant append-only-sans-clé. Deux tentatives
  // sans id client → 2 lignes.
  it("laisse coexister plusieurs tentatives sans client_attempt_id (NULL-distinctness, #82)", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    const base = {
      profileId: 1,
      factId: "mult_6x8",
      skill: "mult" as const,
      correct: true,
      responseMs: 1800,
    };
    // clientAttemptId omis → NULL. Deux réponses distinctes sans id doivent coexister.
    db.insert(attempts).values(base).run();
    db.insert(attempts).values(base).run();
    expect(db.select().from(attempts).all()).toHaveLength(2);
  });

  // Le même id client sur DEUX profils différents n'est PAS un doublon (la clé est
  // COMPOSITE (profil, id) — un id client est scopé au profil). Effet observable : un
  // index sur `client_attempt_id` seul (colonne unique, non composite) ferait lever ici.
  it("autorise le même client_attempt_id sur deux profils distincts (clé composite, #82)", () => {
    const db = freshDb();
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    db.insert(profiles)
      .values({ id: 2, name: "Théo", nameKey: "théo", pinHash: "h", avatar: "cat" })
      .run();
    const base = {
      factId: "mult_6x8",
      skill: "mult" as const,
      correct: true,
      responseMs: 1800,
      clientAttemptId: "attempt-shared",
    };
    db.insert(attempts)
      .values({ ...base, profileId: 1 })
      .run();
    // Même id client, profil différent → clé composite distincte → accepté.
    expect(() =>
      db
        .insert(attempts)
        .values({ ...base, profileId: 2 })
        .run(),
    ).not.toThrow();
    expect(db.select().from(attempts).all()).toHaveLength(2);
  });
});

// ============================================================================
// Boucle jouer → récompense (epic #5) — progress / wallet / ledger
// ============================================================================

describe("progressKey (PK composite encodée en texte)", () => {
  it("encode (profil, monde, niveau) en une clé stable séparée par `:`", () => {
    expect(progressKey(1, 0, 2)).toBe("1:0:2");
    expect(progressKey(42, 7, 3)).toBe("42:7:3");
  });

  it("distingue des tuples voisins (pas de collision d'encodage)", () => {
    // (1,2,3) ≠ (12,3,«») ≠ (1,23,«») : les entiers séparés par `:` restent injectifs.
    const keys = new Set([progressKey(1, 2, 3), progressKey(12, 3, 3), progressKey(1, 23, 3)]);
    expect(keys.size).toBe(3);
  });
});

describe("schéma progress (progression par niveau — MAP §4)", () => {
  function seed(db: ReturnType<typeof freshDb>) {
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
  }

  it("insère et relit une progression (défauts stars=0 / updated_at)", () => {
    const db = freshDb();
    seed(db);
    // Sans `stars`/`updatedAt` → exerce leurs défauts DB (0 / unixepoch()).
    db.insert(progress)
      .values({ id: progressKey(1, 0, 0), profileId: 1, worldIndex: 0, levelIndex: 0 })
      .run();

    const row = db.select().from(progress).get();
    expect(row).toMatchObject({ profileId: 1, worldIndex: 0, levelIndex: 0, stars: 0 });
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("contraint l'unicité (profil, monde, niveau) via la PK texte encodée", () => {
    const db = freshDb();
    seed(db);
    const row = {
      id: progressKey(1, 2, 3),
      profileId: 1,
      worldIndex: 2,
      levelIndex: 3,
      stars: 2 as const,
    };
    db.insert(progress).values(row).run();
    // Même (profil, monde, niveau) → même PK → doublon rejeté.
    expect(() => db.insert(progress).values(row).run()).toThrow();
  });

  it("purge la progression à la suppression du profil (FK cascade — RGPD)", () => {
    const db = freshDb();
    seed(db);
    db.insert(progress)
      .values({ id: progressKey(1, 0, 0), profileId: 1, worldIndex: 0, levelIndex: 0 })
      .run();
    expect(db.select().from(progress).all()).toHaveLength(1);

    db.delete(profiles).where(eq(profiles.id, 1)).run();
    expect(db.select().from(progress).all()).toHaveLength(0);
  });

  it("refuse une progression orpheline (contrainte FK active)", () => {
    const db = freshDb();
    expect(() =>
      db
        .insert(progress)
        .values({ id: progressKey(999, 0, 0), profileId: 999, worldIndex: 0, levelIndex: 0 })
        .run(),
    ).toThrow();
  });

  it("référence progress.profile_id → profiles.id en cascade", () => {
    const [fk] = getTableConfig(progress).foreignKeys;
    const ref = fk.reference();
    expect(ref.foreignTable).toBe(profiles);
    expect(ref.foreignColumns[0].name).toBe("id");
    expect(fk.onDelete).toBe("cascade");
  });
});

describe("schéma wallet (portefeuille — ECONOMY §3.1)", () => {
  function seed(db: ReturnType<typeof freshDb>) {
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
  }

  it("insère et relit un portefeuille (défauts coins=0 / shards=0 / updated_at)", () => {
    const db = freshDb();
    seed(db);
    db.insert(wallet).values({ profileId: 1 }).run();

    const row = db.select().from(wallet).get();
    expect(row).toMatchObject({ profileId: 1, coins: 0, shards: 0 });
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("une seule ligne par profil (PK = profile_id)", () => {
    const db = freshDb();
    seed(db);
    db.insert(wallet).values({ profileId: 1, coins: 10 }).run();
    // 2ᵉ insert même profil → PK en conflit → rejeté.
    expect(() => db.insert(wallet).values({ profileId: 1, coins: 20 }).run()).toThrow();
  });

  it("purge le portefeuille à la suppression du profil (FK cascade — RGPD)", () => {
    const db = freshDb();
    seed(db);
    db.insert(wallet).values({ profileId: 1, coins: 30 }).run();
    expect(db.select().from(wallet).all()).toHaveLength(1);

    db.delete(profiles).where(eq(profiles.id, 1)).run();
    expect(db.select().from(wallet).all()).toHaveLength(0);
  });

  it("référence wallet.profile_id → profiles.id en cascade", () => {
    const [fk] = getTableConfig(wallet).foreignKeys;
    const ref = fk.reference();
    expect(ref.foreignTable).toBe(profiles);
    expect(ref.foreignColumns[0].name).toBe("id");
    expect(fk.onDelete).toBe("cascade");
  });
});

describe("schéma ledger (journal append-only — ECONOMY §3.7)", () => {
  function seed(db: ReturnType<typeof freshDb>) {
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
  }

  it("insère et relit un mouvement (ref_id nullable + défaut created_at)", () => {
    const db = freshDb();
    seed(db);
    // Sans `refId`/`createdAt` → exerce le nullable de ref_id + le défaut created_at.
    db.insert(ledger)
      .values({ profileId: 1, direction: "earn", currency: "coins", amount: 10, reason: "level" })
      .run();

    const row = db.select().from(ledger).get();
    expect(row).toMatchObject({
      profileId: 1,
      direction: "earn",
      currency: "coins",
      amount: 10,
      reason: "level",
      refId: null,
    });
    expect(row?.id).toBeTypeOf("number");
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("est append-only : deux mouvements identiques coexistent (PK auto)", () => {
    const db = freshDb();
    seed(db);
    const mv = {
      profileId: 1,
      direction: "earn" as const,
      currency: "coins" as const,
      amount: 10,
      reason: "level",
    };
    db.insert(ledger).values(mv).run();
    db.insert(ledger).values(mv).run();
    expect(db.select().from(ledger).all()).toHaveLength(2);
  });

  it("laisse ref_id physiquement NULLABLE (garde de nullabilité, PRAGMA)", () => {
    const db = freshDb();
    const col = db
      .all<{ name: string; notnull: number }>(sql`PRAGMA table_info(ledger)`)
      .find((c) => c.name === "ref_id");
    expect(col?.notnull).toBe(0);
  });

  it("purge le journal à la suppression du profil (FK cascade — RGPD)", () => {
    const db = freshDb();
    seed(db);
    db.insert(ledger)
      .values({ profileId: 1, direction: "earn", currency: "coins", amount: 10, reason: "level" })
      .run();
    expect(db.select().from(ledger).all()).toHaveLength(1);

    db.delete(profiles).where(eq(profiles.id, 1)).run();
    expect(db.select().from(ledger).all()).toHaveLength(0);
  });

  it("refuse un mouvement orphelin (contrainte FK active)", () => {
    const db = freshDb();
    expect(() =>
      db
        .insert(ledger)
        .values({
          profileId: 999,
          direction: "earn",
          currency: "coins",
          amount: 1,
          reason: "level",
        })
        .run(),
    ).toThrow();
  });

  it("référence ledger.profile_id → profiles.id en cascade", () => {
    const [fk] = getTableConfig(ledger).foreignKeys;
    const ref = fk.reference();
    expect(ref.foreignTable).toBe(profiles);
    expect(ref.foreignColumns[0].name).toBe("id");
    expect(fk.onDelete).toBe("cascade");
  });

  // Idempotence DB-niveau du crédit (#82) : l'index UNIQUE composite `(profile_id,
  // reason, ref_id)` doit **rejeter au niveau MOTEUR** un rejeu de crédit portant la
  // même clé de rejeu — indépendamment de la garde applicative `creditExists`. On insère
  // la 2ᵉ ligne EN BRUT (sans passer par `creditWalletInTx`) → seule la contrainte DB
  // peut lever. Effet observable : retirer le `uniqueIndex(...)` du `ledger` → rouge.
  // GARDE anti-drift (#82) : après `runMigrations`, l'index UNIQUE
  // `ledger_profile_reason_ref_unique` doit EXISTER en base (`sqlite_master`). Effet
  // observable : retirer le `uniqueIndex(...)` du `ledger` OU casser le SQL 0008 → rouge.
  it("GARDE : l'index UNIQUE (profile_id, reason, ref_id) existe en base après migration (#82)", () => {
    const db = freshDb();
    const rows = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ledger' AND name NOT LIKE 'sqlite_autoindex_%'`,
    );
    expect(rows.map((r) => r.name)).toContain("ledger_profile_reason_ref_unique");
  });

  it("rejette au niveau DB un doublon (profile_id, reason, ref_id) — idempotence crédit (#82)", () => {
    const db = freshDb();
    seed(db);
    const mv = {
      profileId: 1,
      direction: "earn" as const,
      currency: "coins" as const,
      amount: 10,
      reason: "level",
      refId: "level:0:2",
    };
    db.insert(ledger).values(mv).run();
    // Même (profil, raison, clé de rejeu) → l'index UNIQUE composite doit lever.
    expect(() => db.insert(ledger).values(mv).run()).toThrow();
  });

  // NULL-distinctness SQLite : le journal reste append-only pour les mouvements SANS clé de
  // rejeu (`ref_id` NULL) — jamais contraints, car SQLite traite chaque `NULL` comme distinct
  // dans un index UNIQUE composite ordinaire. C'est cette propriété (et non un prédicat partiel
  // `WHERE ref_id IS NOT NULL`, redondant + non-testable ici, cf. rétro #124) qui laisse ces
  // mouvements libres. Ce test verrouille l'invariant append-only-sans-clé (deux mouvements
  // NULL identiques coexistent).
  it("laisse coexister deux mouvements sans ref_id (append-only, NULL-distinctness #82)", () => {
    const db = freshDb();
    seed(db);
    const mv = {
      profileId: 1,
      direction: "earn" as const,
      currency: "coins" as const,
      amount: 10,
      reason: "level",
      // refId omis → NULL : mouvement non-idempotent, jamais dédoublonné.
    };
    db.insert(ledger).values(mv).run();
    db.insert(ledger).values(mv).run();
    expect(db.select().from(ledger).all()).toHaveLength(2);
  });

  // La clé de rejeu est scopée par (profil, raison) : la MÊME `ref_id` sous une RAISON
  // différente n'est pas un doublon (clé composite à 3 colonnes). Effet observable : un
  // index sur `(profile_id, ref_id)` seul (sans `reason`) ferait lever ici.
  it("autorise la même ref_id sous une raison différente (clé à 3 colonnes, #82)", () => {
    const db = freshDb();
    seed(db);
    const base = {
      profileId: 1,
      direction: "earn" as const,
      currency: "coins" as const,
      amount: 10,
      refId: "level:0:2",
    };
    db.insert(ledger)
      .values({ ...base, reason: "level" })
      .run();
    // Même ref_id, raison différente → clé composite distincte → accepté.
    expect(() =>
      db
        .insert(ledger)
        .values({ ...base, reason: "star_bonus" })
        .run(),
    ).not.toThrow();
    expect(db.select().from(ledger).all()).toHaveLength(2);
  });
});

// ============================================================================
// Collection (story 5.6) — catalogue characters + possession collection
// (ECONOMY §3.2/§3.3, MAP §6, PRODUCT §2.3)
// ============================================================================

describe("collectionKey (PK composite (profil, créature) encodée en texte)", () => {
  it("encode (profil, créature) en une clé stable séparée par `:`", () => {
    expect(collectionKey(1, "legendary:0")).toBe("1:legendary:0");
    expect(collectionKey(42, "common_fox")).toBe("42:common_fox");
  });

  it("distingue des profils voisins pour une même créature (pas de collision)", () => {
    const keys = new Set([collectionKey(1, "legendary:0"), collectionKey(2, "legendary:0")]);
    expect(keys.size).toBe(2);
  });
});

describe("schéma characters (catalogue — ECONOMY §3.2)", () => {
  function seedCharacter(db: ReturnType<typeof freshDb>, overrides: Record<string, unknown> = {}) {
    db.insert(characters)
      .values({
        id: "legendary:0",
        worldIndex: 0,
        speciesKey: "legendary_world_0",
        nameDefault: "Braisille",
        rarity: "legendary",
        inEggPool: false,
        artRef: "placeholder://legendary/0",
        ...overrides,
      })
      .run();
  }

  it("insère et relit une créature (défauts max_stage=1 / in_egg_pool + nullable art/story)", () => {
    const db = freshDb();
    // Sans `maxStage` → défaut 1 ; `artRefStages`/`story` omis → nullable.
    seedCharacter(db);
    const row = db.select().from(characters).get();
    expect(row).toMatchObject({
      id: "legendary:0",
      worldIndex: 0,
      speciesKey: "legendary_world_0",
      nameDefault: "Braisille",
      rarity: "legendary",
      maxStage: 1,
      inEggPool: false,
      artRef: "placeholder://legendary/0",
      artRefStages: null,
      story: null,
    });
  });

  it("in_egg_pool round-trip (bool drizzle → 0/1) : commune true, légendaire false", () => {
    const db = freshDb();
    seedCharacter(db); // légendaire → false
    db.insert(characters)
      .values({
        id: "common:0",
        worldIndex: 0,
        speciesKey: "common_world_0",
        nameDefault: "Goupil",
        rarity: "common",
        // inEggPool omis → défaut true (communes dans le pool).
        artRef: "placeholder://common/0",
      })
      .run();
    const legendary = db.select().from(characters).where(eq(characters.id, "legendary:0")).get();
    const common = db.select().from(characters).where(eq(characters.id, "common:0")).get();
    expect(legendary?.inEggPool).toBe(false);
    expect(common?.inEggPool).toBe(true);
  });

  it("contraint l'unicité de l'id (PK texte) — même id rejeté", () => {
    const db = freshDb();
    seedCharacter(db);
    expect(() => seedCharacter(db)).toThrow();
  });

  it("laisse art_ref_stages et story physiquement NULLABLES (garde de nullabilité, PRAGMA)", () => {
    const db = freshDb();
    const info = db.all<{ name: string; notnull: number }>(sql`PRAGMA table_info(characters)`);
    expect(info.find((c) => c.name === "art_ref_stages")?.notnull).toBe(0);
    expect(info.find((c) => c.name === "story")?.notnull).toBe(0);
    // Contraste : name_default reste NOT NULL (colonne obligatoire du catalogue).
    expect(info.find((c) => c.name === "name_default")?.notnull).toBe(1);
  });
});

describe("schéma collection (possession — ECONOMY §3.3)", () => {
  function seed(db: ReturnType<typeof freshDb>) {
    db.insert(profiles)
      .values({ id: 1, name: "Lina", nameKey: "lina", pinHash: "h", avatar: "fox" })
      .run();
    db.insert(characters)
      .values({
        id: "legendary:0",
        worldIndex: 0,
        speciesKey: "legendary_world_0",
        nameDefault: "Braisille",
        rarity: "legendary",
        inEggPool: false,
        artRef: "placeholder://legendary/0",
      })
      .run();
  }

  it("insère et relit une possession (défauts count=1 / stage=1 / nickname nullable / unlocked_at)", () => {
    const db = freshDb();
    seed(db);
    // Sans `count`/`stage`/`nickname`/`unlockedAt` → exerce les défauts + le nullable nickname.
    db.insert(collection)
      .values({ id: collectionKey(1, "legendary:0"), profileId: 1, characterId: "legendary:0" })
      .run();
    const row = db.select().from(collection).get();
    expect(row).toMatchObject({
      profileId: 1,
      characterId: "legendary:0",
      count: 1,
      stage: 1,
      nickname: null,
    });
    expect(row?.unlockedAt).toBeInstanceOf(Date);
  });

  it("persiste un renommage enfant (nickname)", () => {
    const db = freshDb();
    seed(db);
    db.insert(collection)
      .values({
        id: collectionKey(1, "legendary:0"),
        profileId: 1,
        characterId: "legendary:0",
        nickname: "Flamme",
      })
      .run();
    expect(db.select().from(collection).get()?.nickname).toBe("Flamme");
  });

  it("contraint l'unicité (profil, créature) via la PK texte encodée", () => {
    const db = freshDb();
    seed(db);
    const row = {
      id: collectionKey(1, "legendary:0"),
      profileId: 1,
      characterId: "legendary:0",
    };
    db.insert(collection).values(row).run();
    // Même (profil, créature) → même PK → doublon rejeté.
    expect(() => db.insert(collection).values(row).run()).toThrow();
  });

  it("purge la collection à la suppression du profil (FK cascade — RGPD)", () => {
    const db = freshDb();
    seed(db);
    db.insert(collection)
      .values({ id: collectionKey(1, "legendary:0"), profileId: 1, characterId: "legendary:0" })
      .run();
    expect(db.select().from(collection).all()).toHaveLength(1);

    db.delete(profiles).where(eq(profiles.id, 1)).run();
    expect(db.select().from(collection).all()).toHaveLength(0);
  });

  it("purge la possession à la suppression de la créature (FK cascade au catalogue)", () => {
    const db = freshDb();
    seed(db);
    db.insert(collection)
      .values({ id: collectionKey(1, "legendary:0"), profileId: 1, characterId: "legendary:0" })
      .run();
    db.delete(characters).where(eq(characters.id, "legendary:0")).run();
    expect(db.select().from(collection).all()).toHaveLength(0);
  });

  it("refuse une possession orpheline de profil (contrainte FK active)", () => {
    const db = freshDb();
    seed(db);
    expect(() =>
      db
        .insert(collection)
        .values({
          id: collectionKey(999, "legendary:0"),
          profileId: 999,
          characterId: "legendary:0",
        })
        .run(),
    ).toThrow();
  });

  it("refuse une possession orpheline de créature (FK au catalogue active)", () => {
    const db = freshDb();
    seed(db);
    expect(() =>
      db
        .insert(collection)
        .values({ id: collectionKey(1, "ghost:0"), profileId: 1, characterId: "ghost:0" })
        .run(),
    ).toThrow();
  });

  it("référence collection.profile_id → profiles.id en cascade", () => {
    const fk = getTableConfig(collection).foreignKeys.find(
      (f) => f.reference().foreignTable === profiles,
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0].name).toBe("id");
    expect(fk?.onDelete).toBe("cascade");
  });

  it("référence collection.character_id → characters.id en cascade", () => {
    const fk = getTableConfig(collection).foreignKeys.find(
      (f) => f.reference().foreignTable === characters,
    );
    expect(fk).toBeDefined();
    expect(fk?.reference().foreignColumns[0].name).toBe("id");
    expect(fk?.onDelete).toBe("cascade");
  });
});

// ============================================================================
// Pipeline mondes IA (story 6.1) — worlds (mondes générés) + jobs (file)
// (WORLDGEN §3/§5, PLAN §Modèle de données, ADR 0008)
// ============================================================================

describe("schéma worlds (mondes générés — WORLDGEN §5)", () => {
  function seedWorld(db: ReturnType<typeof freshDb>, overrides: Record<string, unknown> = {}) {
    db.insert(worlds)
      .values({
        id: "world:0",
        index: 0,
        theme: "forêt enchantée",
        palette: '{"accent":"#3aa76d"}',
        assetRefs: '{"background":"world/0/bg.png","tiles":"world/0/tiles.png"}',
        prompt: "flat 2D kawaii vector illustration, forest world background …",
        seed: "seed-forest-0",
        ...overrides,
      })
      .run();
  }

  it("insère et relit un monde (défaut status=buffered + approved_by nullable + created_at)", () => {
    const db = freshDb();
    // Sans `status`/`approvedBy`/`createdAt` → exerce le défaut DB + le nullable approved_by.
    seedWorld(db);
    const row = db.select().from(worlds).get();
    expect(row).toMatchObject({
      id: "world:0",
      index: 0,
      theme: "forêt enchantée",
      palette: '{"accent":"#3aa76d"}',
      assetRefs: '{"background":"world/0/bg.png","tiles":"world/0/tiles.png"}',
      prompt: "flat 2D kawaii vector illustration, forest world background …",
      seed: "seed-forest-0",
      status: "buffered",
      approvedBy: null,
    });
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("persiste un monde actif validé par un parent (status=active + approved_by)", () => {
    const db = freshDb();
    seedWorld(db, { status: "active", approvedBy: "parent" });
    const row = db.select().from(worlds).get();
    expect(row).toMatchObject({ status: "active", approvedBy: "parent" });
  });

  it("contraint l'unicité de l'index (un seul monde par index) via .unique()", () => {
    const db = freshDb();
    seedWorld(db);
    // Même `index`, id différent → l'index UNIQUE `worlds_index_unique` doit lever.
    expect(() => seedWorld(db, { id: "world:0-bis" })).toThrow();
  });

  it("autorise des mondes à des index distincts", () => {
    const db = freshDb();
    seedWorld(db);
    expect(() => seedWorld(db, { id: "world:1", index: 1 })).not.toThrow();
    expect(db.select().from(worlds).all()).toHaveLength(2);
  });

  it("contraint l'unicité de l'id (PK texte) — même id rejeté", () => {
    const db = freshDb();
    seedWorld(db);
    expect(() => seedWorld(db, { index: 99 })).toThrow();
  });

  // GARDE anti-drift (#91/#105, doctrine snapshot↔SQL) : `approved_by` est
  // volontairement NULLABLE en base (schema.ts sans `.notNull()`, snapshot notNull:false,
  // SQL `approved_by text`). Le contraste `theme` NOT NULL prouve que la garde n'est pas
  // vacuous (elle distingue une colonne réellement nullable d'une colonne obligatoire).
  // Effet observable : « corriger » approved_by en `.notNull()` + rebuild → notnull=1 → rouge.
  it("laisse approved_by physiquement NULLABLE, theme NOT NULL (garde PRAGMA)", () => {
    const db = freshDb();
    const info = db.all<{ name: string; notnull: number }>(sql`PRAGMA table_info(worlds)`);
    expect(info.find((c) => c.name === "approved_by")?.notnull).toBe(0);
    expect(info.find((c) => c.name === "theme")?.notnull).toBe(1);
  });

  // GARDE anti-drift (#82, même patron que les gardes `profiles`/`attempts`) : après
  // `runMigrations`, l'index UNIQUE `worlds_index_unique` doit EXISTER en base (état réel
  // `sqlite_master`, pas seulement le nom du token dans schema.ts). Effet observable :
  // retirer `.unique()` de `worlds.index` OU casser le SQL 0009 → l'index disparaît → rouge.
  it("GARDE : l'index UNIQUE worlds_index_unique existe en base après migration", () => {
    const db = freshDb();
    const rows = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'worlds' AND name NOT LIKE 'sqlite_autoindex_%'`,
    );
    expect(rows.map((r) => r.name)).toContain("worlds_index_unique");
  });
});

describe("schéma jobs (file de génération — WORLDGEN §3)", () => {
  function seedJob(db: ReturnType<typeof freshDb>, overrides: Record<string, unknown> = {}) {
    db.insert(jobs)
      .values({
        type: "generate_world",
        payload: '{"world_index":0}',
        ...overrides,
      })
      .run();
  }

  it("insère et relit un job (défauts status=pending / attempts=0 / last_error null / timestamps)", () => {
    const db = freshDb();
    // Sans `status`/`attempts`/`lastError`/timestamps → exerce les défauts + nullable last_error.
    seedJob(db);
    const row = db.select().from(jobs).get();
    expect(row).toMatchObject({
      type: "generate_world",
      payload: '{"world_index":0}',
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    expect(row?.id).toBeTypeOf("number");
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("persiste un job échoué (status=failed + attempts + last_error)", () => {
    const db = freshDb();
    seedJob(db, { status: "failed", attempts: 3, lastError: "model 503 after retries" });
    const row = db.select().from(jobs).get();
    expect(row).toMatchObject({
      status: "failed",
      attempts: 3,
      lastError: "model 503 after retries",
    });
  });

  it("est une file : plusieurs jobs coexistent (PK autoincrement)", () => {
    const db = freshDb();
    seedJob(db);
    seedJob(db, { payload: '{"world_index":1}' });
    expect(db.select().from(jobs).all()).toHaveLength(2);
  });

  // GARDE anti-drift (#91/#105) : `last_error` est volontairement NULLABLE (schema.ts sans
  // `.notNull()`, snapshot notNull:false). Le contraste `type` NOT NULL empêche un test vacuous.
  it("laisse last_error physiquement NULLABLE, type NOT NULL (garde PRAGMA)", () => {
    const db = freshDb();
    const info = db.all<{ name: string; notnull: number }>(sql`PRAGMA table_info(jobs)`);
    expect(info.find((c) => c.name === "last_error")?.notnull).toBe(0);
    expect(info.find((c) => c.name === "type")?.notnull).toBe(1);
  });
});
