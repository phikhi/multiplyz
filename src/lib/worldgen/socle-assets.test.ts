import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { characters, socleWorlds, worlds } from "@/lib/db/schema";
import { type GenerateImageInput } from "./image-client";
import { WorldGenError } from "./generate-world";
import {
  MASTER_ASSET_ID,
  approveAsset,
  upsertCandidate,
  type ReferenceAssetInput,
} from "./reference-assets";
import {
  buildSocle,
  regenerateSocleContent,
  socleSeed,
  socleWorldId,
  SOCLE_WORLD_COUNT,
} from "./socle";
import {
  defaultSocleWriteAsset,
  generateSocleWorldAssets,
  readMasterBytesFromDisk,
} from "./socle-assets";

const tmpRoot = mkdtempSync(join(tmpdir(), "multiplyz-socle-assets-"));
let counter = 0;
/** Base fraîche **migrée** → le socle est déjà amorcé (placeholders) par `runMigrations`. */
function freshDb(): AppDatabase {
  counter += 1;
  const db = createDatabase(join(tmpRoot, `case-${counter}`, "app.sqlite"));
  runMigrations(db);
  // Catalogue VIDÉ (R4.2 #382) : `runMigrations` amorce désormais le catalogue socle de créatures
  // (`seedSocleCreatures`). Ces tests exercent le seed d'ASSETS de créatures sur un catalogue
  // CONTRÔLÉ (dont un cas « catalogue vide ») → on efface le seed de migration.
  db.delete(characters).run();
  return db;
}
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

const MASTER_REF = "storage/reference/teddy/teddy-master.png";

/** Seed un master Teddy **approuvé** (prérequis d'ancrage ADR 0009). */
function seedApprovedMaster(db: AppDatabase): void {
  const input: ReferenceAssetInput = {
    id: MASTER_ASSET_ID,
    kind: "master",
    expression: null,
    assetRef: MASTER_REF,
    backgroundStrategy: "post-cutout",
    transparent: true,
    sourcePhotosHash: "hash-master",
  };
  upsertCandidate(db, input);
  approveAsset(db, MASTER_ASSET_ID, "owner");
}

/** Générateur d'image mocké : octets factices + enregistre chaque appel (prompt + refImages). */
function recordingGenerate(): {
  fn: (input: GenerateImageInput) => Promise<Buffer>;
  calls: GenerateImageInput[];
} {
  const calls: GenerateImageInput[] = [];
  let n = 0;
  return {
    calls,
    fn: (input) => {
      calls.push(input);
      n += 1;
      return Promise.resolve(Buffer.from(`img-${n}`));
    },
  };
}

/** Lit + parse `socle_worlds.asset_refs` pour un slot (ou undefined si absent). */
function readSocleRefs(db: AppDatabase, slot: number): Record<string, string> | undefined {
  const row = db
    .select({ assetRefs: socleWorlds.assetRefs })
    .from(socleWorlds)
    .where(eq(socleWorlds.id, socleWorldId(slot)))
    .get();
  return row ? (JSON.parse(row.assetRefs) as Record<string, string>) : undefined;
}

describe("generateSocleWorldAssets — ancrage Teddy sur le master réel", () => {
  it("passe les octets RÉELS du master en refImages (via loadMasterBytes), pas le chemin", async () => {
    const db = freshDb();
    seedApprovedMaster(db);
    const gen = recordingGenerate();
    const sentinel = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const seen: string[] = [];

    await generateSocleWorldAssets(db, 0, {
      generate: gen.fn,
      loadMasterBytes: (ref) => {
        seen.push(ref);
        return sentinel;
      },
    });

    // 3 appels : fond, tuiles (sans refImages), Teddy (avec refImages = master).
    expect(gen.calls).toHaveLength(3);
    const teddyCall = gen.calls.find((c) => c.refImages !== undefined);
    expect(teddyCall?.refImages).toHaveLength(1);
    expect(teddyCall?.refImages?.[0].mimeType).toBe("image/png");
    // Les octets injectés (sentinel) atterrissent dans refImages → l'ancrage est CÂBLÉ sur les
    // vrais octets (rougit si on retombe sur le chemin encodé / si l'ancrage est retiré).
    expect(teddyCall?.refImages?.[0].data).toEqual(sentinel);
    expect(seen).toEqual([MASTER_REF]); // loadMasterBytes reçoit bien la réf du master.
    // Fond + tuiles ne portent AUCUNE référence image (texte seul).
    const noRefCalls = gen.calls.filter((c) => c.refImages === undefined);
    expect(noRefCalls).toHaveLength(2);
  });

  it("échec loud si aucun master approuvé (ADR 0009)", async () => {
    const db = freshDb(); // socle amorcé mais master absent.
    await expect(
      generateSocleWorldAssets(db, 0, { generate: recordingGenerate().fn }),
    ).rejects.toBeInstanceOf(WorldGenError);
  });
});

describe("generateSocleWorldAssets — assets produits + persistance", () => {
  it("génère EXACTEMENT background/tiles/teddy (aucune créature)", async () => {
    const db = freshDb();
    seedApprovedMaster(db);
    const written: Array<[number, string]> = [];

    await generateSocleWorldAssets(db, 1, {
      generate: recordingGenerate().fn,
      writeAsset: (slot, name) => {
        written.push([slot, name]);
        return Promise.resolve(`socle/${slot}/${name}`);
      },
    });

    expect(written).toEqual([
      [1, "background.png"],
      [1, "tiles.png"],
      [1, "teddy.png"],
    ]);
  });

  it("met à jour asset_refs du BON slot, SANS toucher worlds/characters", async () => {
    const db = freshDb();
    seedApprovedMaster(db);

    await generateSocleWorldAssets(db, 2, { generate: recordingGenerate().fn });

    // Slot ciblé : refs réelles (namespace socle/…), plus de placeholder.
    expect(readSocleRefs(db, 2)).toEqual({
      background: "socle/2/background.png",
      tiles: "socle/2/tiles.png",
      teddy: "socle/2/teddy.png",
    });
    // Slots voisins INCHANGÉS (toujours placeholder) — la mise à jour ne fuit pas.
    expect(readSocleRefs(db, 1)?.background).toBe("placeholder://socle/1/background");
    expect(readSocleRefs(db, 3)?.background).toBe("placeholder://socle/3/background");
    // Le socle ne pollue JAMAIS la table position `worlds` ni `characters`.
    expect(db.select().from(worlds).all()).toHaveLength(0);
    expect(db.select().from(characters).all()).toHaveLength(0);
  });

  it("dérive le même thème que buildSocle pour le slot (reproductibilité §7)", async () => {
    const db = freshDb();
    seedApprovedMaster(db);
    const gen = recordingGenerate();
    const slot = 4;

    await generateSocleWorldAssets(db, slot, { generate: gen.fn });

    // Le label de thème de buildSocle[slot] doit apparaître dans le prompt de fond (les deux
    // dérivent de regenerateSocleContent(socleSeed(slot))) — rougit si la dérivation diverge.
    const expectedLabel = buildSocle()[slot].theme;
    expect(expectedLabel).toBe(regenerateSocleContent(socleSeed(slot)).theme.label);
    expect(gen.calls[0].prompt).toContain(expectedLabel);
  });

  it("idempotent : re-run REMPLACE les refs (UPDATE), aucune ligne ajoutée", async () => {
    const db = freshDb();
    seedApprovedMaster(db);
    const before = db.select().from(socleWorlds).all().length;
    expect(before).toBe(SOCLE_WORLD_COUNT);

    await generateSocleWorldAssets(db, 0, { generate: recordingGenerate().fn });
    await generateSocleWorldAssets(db, 0, { generate: recordingGenerate().fn });

    expect(db.select().from(socleWorlds).all()).toHaveLength(SOCLE_WORLD_COUNT); // pas de doublon.
    expect(readSocleRefs(db, 0)).toEqual({
      background: "socle/0/background.png",
      tiles: "socle/0/tiles.png",
      teddy: "socle/0/teddy.png",
    });
  });

  it("échec loud si le slot du socle n'est pas amorcé (0 ligne touchée)", async () => {
    const db = freshDb();
    seedApprovedMaster(db);
    // slot 99 n'existe pas dans le socle amorcé → l'UPDATE ne touche aucune ligne.
    await expect(
      generateSocleWorldAssets(db, 99, { generate: recordingGenerate().fn }),
    ).rejects.toBeInstanceOf(WorldGenError);
  });
});

describe("defaultSocleWriteAsset — namespace distinct", () => {
  it("renvoie socle/<slot>/<name> (jamais world/…)", async () => {
    await expect(defaultSocleWriteAsset(3, "teddy.png")).resolves.toBe("socle/3/teddy.png");
  });
});

describe("readMasterBytesFromDisk — lecture disque contrainte (sécurité)", () => {
  it("lit les octets d'un fichier sous storage/reference/", () => {
    const cwd = mkdtempSync(join(tmpRoot, "disk-ok-"));
    mkdirSync(join(cwd, "storage", "reference", "teddy"), { recursive: true });
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    writeFileSync(join(cwd, "storage", "reference", "teddy", "m.png"), bytes);
    expect(readMasterBytesFromDisk("storage/reference/teddy/m.png", { cwd })).toEqual(bytes);
  });

  it("refuse un chemin qui s'échappe de storage/reference/ (anti-traversal)", () => {
    const cwd = mkdtempSync(join(tmpRoot, "disk-esc-"));
    expect(() => readMasterBytesFromDisk("../../etc/passwd", { cwd })).toThrow(WorldGenError);
    expect(() => readMasterBytesFromDisk("storage/other/secret.png", { cwd })).toThrow(
      WorldGenError,
    );
    // Frère à préfixe partiel : SEUL le `+ sep` de la garde le rejette (sans lui, `startsWith(root)`
    // laisserait passer `storage/reference-evil/`). Mutation-preuve du `+ sep` (rétro sécurité #185).
    expect(() => readMasterBytesFromDisk("storage/reference-evil/secret.png", { cwd })).toThrow(
      WorldGenError,
    );
  });

  it("sans opts, résout depuis process.cwd() (défaut) — traversal rejeté avant toute I/O", () => {
    // Aucun `cwd` fourni → branche `?? process.cwd()` ; l'échappement rougit avant `readFileSync`.
    expect(() => readMasterBytesFromDisk("../../../../etc/passwd")).toThrow(WorldGenError);
  });
});
