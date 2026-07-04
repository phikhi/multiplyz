import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { nameKey } from "../auth/validation";
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
    // Le migrateur drizzle rejoue toute migration dont le `created_at` est > au
    // dernier appliqué : pour re-jouer 0005 il faut dé-journaliser 0005 ET toutes
    // les migrations postérieures, et retirer leurs artefacts (tables game-loop 0006 :
    // ledger/wallet/progress ; collection 0007 : collection/characters — `collection`
    // référence `characters` par FK, donc drop dans cet ordre).
    seed.run(sql`DROP TABLE collection`);
    seed.run(sql`DROP TABLE characters`);
    seed.run(sql`DROP TABLE ledger`);
    seed.run(sql`DROP TABLE wallet`);
    seed.run(sql`DROP TABLE progress`);
    seed.run(sql`DROP INDEX profiles_name_key_unique`);
    seed.run(sql`ALTER TABLE profiles DROP COLUMN name_key`);
    // Dé-journalise 0005 (6ᵉ migration, index 5) + tout ce qui suit → l'état « base
    // dev antérieure à #37 » où seules 0000..0004 sont enregistrées. On cible 0005 par
    // son **ordinal** (OFFSET 5 dans l'ordre chronologique) plutôt qu'un timestamp en
    // dur : robuste à l'ajout de migrations ultérieures (0006, …).
    seed.run(
      sql`DELETE FROM __drizzle_migrations WHERE created_at >= (
        SELECT created_at FROM __drizzle_migrations ORDER BY created_at LIMIT 1 OFFSET 5
      )`,
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

  // GARDE anti-drift (#105 / doctrine snapshot↔SQL LEARNINGS #411-419) : la colonne
  // `name_key` est volontairement NULLABLE en base (schema.ts sans `.notNull()`,
  // snapshot notNull:false, SQL `ADD name_key text`). Rouge si un futur agent
  // « corrige » schema.ts en `.notNull()` + régénère une migration de rebuild
  // (la colonne redeviendrait notnull=1). Le non-null reste un invariant applicatif.
  it("laisse name_key physiquement NULLABLE après migration (cohérence, #105)", () => {
    const path = freshDbPath();
    runMigrations(createDatabase(path));
    const db = createDatabase(path);
    const col = db
      .all<{ name: string; notnull: number }>(sql`PRAGMA table_info(profiles)`)
      .find((c) => c.name === "name_key");
    expect(col?.notnull).toBe(0);
  });
});

describe("backfillNameKeys", () => {
  it("remplit name_key sur toutes les lignes NULL (NFC + sanitize + locale), laisse les autres, idempotent", () => {
    const db = createDatabase(":memory:");
    db.run(sql`CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT)`);
    // id 1 : É précomposé. id 2 : « é » DÉCOMPOSÉ (e + U+0301) + espaces à compacter
    // → exerce NFC + sanitizeName + locale (un `.toLowerCase()` naïf produirait
    // "  léa  " ≠ "léa"). id 3 : clé déjà posée → intouchée.
    const decomposed = "  Léa  ";
    db.run(sql`INSERT INTO profiles (id, name, name_key) VALUES
      (1, 'Élodie', NULL), (2, ${decomposed}, NULL), (3, 'Théo', 'clé-fixe')`);

    backfillNameKeys(db);
    // Attendu DÉRIVÉ de nameKey() (pas de valeur en dur) → verrouille tout le
    // contrat de normalisation, pas seulement un lower() sur capitale accentuée.
    expect(db.all(sql`SELECT id, name_key FROM profiles ORDER BY id`)).toEqual([
      { id: 1, name_key: nameKey("Élodie") },
      { id: 2, name_key: nameKey(decomposed) },
      { id: 3, name_key: "clé-fixe" },
    ]);
    // Sanity : la clé est bien la forme NFC compactée minuscule, pas l'entrée brute.
    expect(nameKey(decomposed)).toBe("léa");

    // 2e passage : plus aucune ligne NULL → boucle 0 itération, aucune écriture.
    backfillNameKeys(db);
    expect(db.get(sql`SELECT name_key FROM profiles WHERE id = 1`)).toEqual({
      name_key: nameKey("Élodie"),
    });
  });

  // Collision : base pré-#37 (UNIQUE binaire sur `name`) où deux prénoms convergent
  // vers la même clé. Détectée AVANT écriture → erreur explicite, aucune ligne
  // écrite (atomique), rejeu déterministe. Rouge si on retire la détection (l'index
  // lèverait en plein UPDATE, laissant une base à demi-migrée).
  it("lève une erreur explicite sans rien écrire quand deux prénoms partagent une clé (#105)", () => {
    const db = createDatabase(":memory:");
    db.run(
      sql`CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT UNIQUE)`,
    );
    db.run(
      sql`INSERT INTO profiles (id, name, name_key) VALUES (1, 'Élodie', NULL), (2, 'élodie', NULL)`,
    );

    expect(() => backfillNameKeys(db)).toThrow(/même[\s\S]*clé d'unicité/);
    // Atomique : les deux lignes restent NULL (pas de demi-migration).
    expect(db.all(sql`SELECT id FROM profiles WHERE name_key IS NULL ORDER BY id`)).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    // Rejeu : relève à l'identique, ne « répare » pas silencieusement.
    expect(() => backfillNameKeys(db)).toThrow(/même[\s\S]*clé d'unicité/);
  });

  // Collision avec une clé DÉJÀ posée (non-NULL), pas seulement intra-batch : exerce
  // le pré-chargement `claimedBy` depuis les lignes non-NULL. Rouge si ce SELECT est
  // neutralisé (la garde ne verrait que les collisions du même batch).
  it("détecte une collision avec une clé name_key déjà posée en base (#105)", () => {
    const db = createDatabase(":memory:");
    db.run(
      sql`CREATE TABLE profiles (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT UNIQUE)`,
    );
    // id 1 : clé déjà posée « élodie » ; id 2 : NULL « Élodie » → nameKey = « élodie ».
    db.run(
      sql`INSERT INTO profiles (id, name, name_key) VALUES (1, 'élodie', 'élodie'), (2, 'Élodie', NULL)`,
    );

    expect(() => backfillNameKeys(db)).toThrow(/même[\s\S]*clé d'unicité/);
    // La ligne NULL n'est pas écrite ; la clé existante est intouchée.
    expect(db.all(sql`SELECT id, name_key FROM profiles ORDER BY id`)).toEqual([
      { id: 1, name_key: "élodie" },
      { id: 2, name_key: null },
    ]);
  });
});
