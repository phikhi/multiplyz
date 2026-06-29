import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS } from "../../config/server-config";
import { getDatabaseConfig, resolveDatabasePath } from "./config";
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

// Les ⚙️ DB sont lus depuis process.env → on nettoie après chaque test pour
// éviter toute fuite vers les autres specs (mémoïsation de getConfig, etc.).
afterEach(() => {
  delete process.env.DATABASE_PATH;
  delete process.env.SQLITE_BUSY_TIMEOUT_MS;
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("resolveDatabasePath (consomme la config centrale)", () => {
  it("retourne le chemin de l'env quand il est défini", () => {
    expect(resolveDatabasePath({ DATABASE_PATH: "/custom/app.sqlite" })).toBe("/custom/app.sqlite");
  });

  it("retombe sur le défaut central quand l'env est vide / espaces", () => {
    expect(resolveDatabasePath({ DATABASE_PATH: "   " })).toBe(CONFIG_DEFAULTS.database.path);
  });

  it("retombe sur le défaut central quand l'env est absent", () => {
    expect(resolveDatabasePath({})).toBe(CONFIG_DEFAULTS.database.path);
  });

  it("lit process.env par défaut (sans argument)", () => {
    delete process.env.DATABASE_PATH;
    expect(resolveDatabasePath()).toBe(CONFIG_DEFAULTS.database.path);
  });
});

describe("getDatabaseConfig (dérive les ⚙️ DB du module central)", () => {
  it("honore SQLITE_BUSY_TIMEOUT_MS et expose journalMode WAL", () => {
    const cfg = getDatabaseConfig({ SQLITE_BUSY_TIMEOUT_MS: "8000" });
    expect(cfg.busyTimeoutMs).toBe(8000);
    expect(cfg.journalMode).toBe("WAL");
  });

  it("retombe sur le busy_timeout par défaut central", () => {
    expect(getDatabaseConfig({}).busyTimeoutMs).toBe(CONFIG_DEFAULTS.database.busyTimeoutMs);
  });
});

describe("createDatabase", () => {
  it("crée le dossier parent et active WAL + busy_timeout (défaut central)", () => {
    const path = freshDbPath();
    const db = createDatabase(path);

    expect(existsSync(path)).toBe(true);
    const journal = db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`);
    const timeout = db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`);
    expect(journal?.journal_mode).toBe("wal");
    expect(timeout?.timeout).toBe(CONFIG_DEFAULTS.database.busyTimeoutMs);
  });

  it("applique RÉELLEMENT SQLITE_BUSY_TIMEOUT_MS à la connexion (PRAGMA)", () => {
    // Bug latent corrigé par l'ADR 0002 : la valeur env doit atteindre la DB.
    process.env.SQLITE_BUSY_TIMEOUT_MS = "8000";
    const db = createDatabase(freshDbPath());

    const timeout = db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`);
    expect(timeout?.timeout).toBe(8000);
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
  it("applique le schéma et reste idempotente sur une connexion ré-ouverte", () => {
    const path = freshDbPath();

    // 1er "run" : nouvelle connexion → applique la migration.
    runMigrations(createDatabase(path));
    // 2e "run" : connexion ré-ouverte sur le même fichier (fidèle à 2 process
    // `db:migrate` successifs) → no-op, pas d'erreur.
    const db = createDatabase(path);
    expect(() => runMigrations(db)).not.toThrow();

    // Round-trip réel sur la table meta créée par la migration.
    db.insert(schemaMeta).values({ key: "schema_version", value: "1" }).run();
    const rows = db.select().from(schemaMeta).all();
    expect(rows).toEqual([{ key: "schema_version", value: "1", updatedAt: expect.any(Date) }]);
  });
});
