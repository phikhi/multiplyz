import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DB_BUSY_TIMEOUT_MS, DEFAULT_DATABASE_PATH, resolveDatabasePath } from "./config";
import { createDatabase, getDb } from "./index";
import { runMigrations } from "./migrate";
import { schemaMeta } from "./schema";

const tmpRoot = mkdtempSync(join(tmpdir(), "multiplyz-db-"));
let counter = 0;
/** Chemin de base unique par test (évite les collisions de fichier WAL). */
function freshDbPath() {
  counter += 1;
  return join(tmpRoot, `case-${counter}`, "app.sqlite");
}

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("resolveDatabasePath", () => {
  beforeEach(() => {
    delete process.env.DATABASE_PATH;
  });

  it("retourne le chemin de l'env quand il est défini", () => {
    expect(resolveDatabasePath({ DATABASE_PATH: "/custom/app.sqlite" })).toBe("/custom/app.sqlite");
  });

  it("retombe sur le défaut quand l'env est vide / espaces", () => {
    expect(resolveDatabasePath({ DATABASE_PATH: "   " })).toBe(DEFAULT_DATABASE_PATH);
  });

  it("retombe sur le défaut quand l'env est absent", () => {
    expect(resolveDatabasePath({})).toBe(DEFAULT_DATABASE_PATH);
  });
});

describe("createDatabase", () => {
  it("crée le dossier parent et active WAL + busy_timeout", () => {
    const path = freshDbPath();
    const db = createDatabase(path);

    expect(existsSync(path)).toBe(true);
    const journal = db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`);
    const timeout = db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`);
    expect(journal?.journal_mode).toBe("wal");
    expect(timeout?.timeout).toBe(DB_BUSY_TIMEOUT_MS);
  });

  it("ouvre une base en mémoire sans toucher au disque", () => {
    const db = createDatabase(":memory:");
    const row = db.get<{ ok: number }>(sql`SELECT 1 AS ok`);
    expect(row?.ok).toBe(1);
  });
});

describe("getDb", () => {
  it("renvoie le même singleton sur appels répétés", () => {
    process.env.DATABASE_PATH = join(tmpRoot, "singleton", "app.sqlite");
    try {
      expect(getDb()).toBe(getDb());
    } finally {
      delete process.env.DATABASE_PATH;
    }
  });
});

describe("runMigrations", () => {
  it("applique le schéma et reste idempotente (2e run sans erreur)", () => {
    const db = createDatabase(freshDbPath());

    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();

    // Round-trip réel sur la table meta créée par la migration.
    db.insert(schemaMeta).values({ key: "schema_version", value: "1" }).run();
    const rows = db.select().from(schemaMeta).all();
    expect(rows).toEqual([{ key: "schema_version", value: "1", updatedAt: expect.any(Date) }]);
  });
});
