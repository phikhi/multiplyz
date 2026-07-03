import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS } from "../../config/server-config";
import { getDatabaseConfig, resolveDatabasePath } from "./config";
import { createDatabase, getDb } from "./index";
import { backfillNameKeys, runMigrations } from "./migrate";
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

  // Régression #105 : la migration 0005 (ajout `name_key`) doit s'appliquer sur
  // une table `profiles` DÉJÀ peuplée sans planter (`Cannot add a NOT NULL column
  // with default value NULL`), et backfiller la clé accent-correcte.
  it("applique 0005 sur une table profiles peuplée sans crash + backfille name_key (#105)", () => {
    const path = freshDbPath();
    // Base « fraîche » complète, puis on la ramène à l'état PRÉ-0005 : colonne +
    // index `name_key` retirés, 0005 dé-journalisée, et un profil accentué inséré
    // — reproduction fidèle d'une base dev antérieure à la story #37.
    runMigrations(createDatabase(path));
    const seed = createDatabase(path);
    seed.run(sql`DROP INDEX profiles_name_key_unique`);
    seed.run(sql`ALTER TABLE profiles DROP COLUMN name_key`);
    seed.run(
      sql`DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)`,
    );
    seed.run(sql`INSERT INTO profiles (name, pin_hash, avatar) VALUES ('Élodie', 'h', 'a')`);

    // Rejeu des migrations sur cette base peuplée : ne doit PAS lever.
    const db = createDatabase(path);
    expect(() => runMigrations(db)).not.toThrow();

    const row = db.get<{ name_key: string }>(
      sql`SELECT name_key FROM profiles WHERE name = 'Élodie'`,
    );
    expect(row?.name_key).toBe("élodie");
  });
});

describe("backfillNameKeys", () => {
  it("remplit name_key (accent-correct) sur les lignes NULL, laisse les autres, idempotent", () => {
    const db = createDatabase(":memory:");
    db.run(sql`CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT)`);
    // id 1 : à backfiller (NULL, accentué) ; id 2 : clé déjà posée → intouchée.
    db.run(
      sql`INSERT INTO profiles (id, name, name_key) VALUES (1, 'Élodie', NULL), (2, 'Léa', 'DÉJÀ')`,
    );

    backfillNameKeys(db);
    expect(db.all(sql`SELECT id, name_key FROM profiles ORDER BY id`)).toEqual([
      { id: 1, name_key: "élodie" },
      { id: 2, name_key: "DÉJÀ" },
    ]);

    // 2e passage : plus aucune ligne NULL → boucle 0 itération, aucune écriture.
    backfillNameKeys(db);
    expect(db.get(sql`SELECT name_key FROM profiles WHERE id = 1`)).toEqual({ name_key: "élodie" });
  });
});
