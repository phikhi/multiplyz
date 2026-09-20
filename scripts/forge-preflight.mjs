/** Read-only release check. Never creates, migrates or seeds a database. */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, join, sep, isAbsolute } from "node:path";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => {
  throw new Error(message);
};
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
function check() {
  const runtime = process.argv[2] === "--runtime";
  if (process.argv.length > (runtime ? 3 : 2)) fail("Usage : forge-preflight.mjs [--runtime]");
  if (Number(process.versions.node.split(".")[0]) !== 22) fail("Node 22 requis.");
  const source = process.env.DATABASE_PATH;
  if (!source || source === ":memory:")
    fail("DATABASE_PATH doit désigner la base familiale existante.");
  if (runtime) {
    if (!isAbsolute(source)) fail("DATABASE_PATH absolu requis pour le daemon.");
    if (process.env.NODE_ENV !== "production") fail("NODE_ENV=production requis.");
    if (!process.env.GEMINI_API_KEY?.trim())
      fail("GEMINI_API_KEY requise par la garde de démarrage existante.");
    if (process.env.TEDDY_CHECK_BUILD) fail("Le daemon utilise le build de production .next.");
    if (!readFileSync(".next/BUILD_ID", "utf8").trim()) fail("Build .next absent.");
  }
  const sqlite = new Database(resolve(source), { readonly: true, fileMustExist: true });
  try {
    sqlite.pragma("query_only=ON");
    sqlite.exec("BEGIN");
    if (sqlite.pragma("integrity_check", { simple: true }) !== "ok")
      fail("Intégrité SQLite incorrecte.");
    if (sqlite.pragma("foreign_key_check").length) fail("Références SQLite invalides.");
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    const expected = journal.entries.map(({ tag }) => hash(readFileSync(`drizzle/${tag}.sql`)));
    const applied = sqlite
      .prepare("SELECT hash FROM __drizzle_migrations ORDER BY created_at, id")
      .all()
      .map((r) => r.hash);
    // La famille conserve une empreinte historique de 0005. Vérifier séparément
    // son schéma réel, son journal intact et les sources de cette release.
    const contract = JSON.parse(readFileSync("deploy/forge/database-contract.json", "utf8"));
    const schema = sqlite
      .prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name")
      .raw()
      .all();
    if (
      hash(JSON.stringify(schema)) !== contract.schemaSha256 ||
      JSON.stringify(applied) !== JSON.stringify(contract.appliedMigrationHashes) ||
      JSON.stringify(expected) !== JSON.stringify(contract.sourceMigrationHashes)
    ) {
      fail(
        "Schéma ou journal différent du contrat familial ; aucune migration automatique autorisée.",
      );
    }
    const tables = {};
    for (const { name } of sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()) {
      const rows = sqlite
        .prepare(`SELECT * FROM ${quote(name)}`)
        .raw()
        .all()
        .map((row) => JSON.stringify(row))
        .sort();
      tables[name] = { rows: rows.length, sha256: hash(rows.join("\n")) };
    }
    for (const name of [
      "profiles",
      "collection",
      "wallet",
      "adventure_sessions",
      "evolution_receipts",
      "household_settings",
    ]) {
      if (!tables[name]) fail(`Table requise absente : ${name}`);
    }
    if (!tables.profiles.rows) fail("Foyer absent ; ne pas démarrer un onboarding neuf.");
    const assets = {};
    const missing = [];
    let placeholders = 0;
    const add = (ref, privateReference = false) => {
      if (typeof ref !== "string") fail("Référence d’asset invalide.");
      if (ref.startsWith("placeholder://")) {
        placeholders++;
        return;
      }
      const root = privateReference
        ? "storage/reference"
        : /^world\/(0|[1-9]\d*)\/runtime-/.test(ref)
          ? "storage/generated"
          : "public/generated";
      const relative = privateReference ? ref.replace(/^storage\/reference\//, "") : ref;
      if (
        !relative ||
        relative.split("/").some((p) => !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9]+)?$/.test(p))
      )
        fail("Chemin d’asset invalide.");
      const canonicalRoot = realpathSync(root);
      let file;
      try {
        file = realpathSync(resolve(canonicalRoot, relative));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        missing.push(join(root, relative));
        return;
      }
      if (!file.startsWith(canonicalRoot + sep) || !statSync(file).isFile())
        fail("Asset hors du stockage attendu.");
      const bytes = readFileSync(file);
      if (!bytes.length) fail("Asset vide.");
      assets[join(root, relative)] = { bytes: bytes.length, sha256: hash(bytes) };
    };
    const creatures = sqlite
      .prepare("SELECT art_ref, art_ref_stages, max_stage FROM characters")
      .all();
    for (const creature of creatures) {
      add(creature.art_ref);
      const stages = JSON.parse(creature.art_ref_stages ?? "{}");
      for (let stage = 2; stage <= creature.max_stage; stage++) add(stages[stage]);
    }
    for (const table of ["worlds", "socle_worlds"]) {
      for (const row of sqlite.prepare(`SELECT asset_refs FROM ${quote(table)}`).all()) {
        for (const ref of Object.values(JSON.parse(row.asset_refs))) add(ref);
      }
    }
    const references = sqlite
      .prepare("SELECT asset_ref FROM teddy_reference_assets WHERE status='approved'")
      .all();
    if (!references.length) fail("Référence Teddy approuvée absente.");
    for (const row of references) add(row.asset_ref, true);
    for (const row of sqlite.prepare("SELECT art_ref FROM cosmetics").all()) add(row.art_ref);
    if (missing.length) fail(`${missing.length} assets absents : ${missing.join(", ")}`);
    sqlite.exec("ROLLBACK");
    return {
      readOnly: true,
      integrity: "ok",
      migrations: applied.length,
      creatures: creatures.length,
      placeholders,
      tables,
      assets,
    };
  } finally {
    sqlite.close();
  }
}
try {
  console.log(JSON.stringify(check(), null, 2));
} catch (error) {
  console.error(`Précontrôle refusé : ${error.message}`);
  process.exitCode = 1;
}
