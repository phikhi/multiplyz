import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { StageAConfig } from "@/config/server-config";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import * as imageClient from "./image-client";
import { EXPRESSION_COUNT, TEDDY_EXPRESSIONS } from "./expressions";
import { listReferenceAssets, MASTER_ASSET_ID } from "./reference-assets";
import {
  applyBackgroundStrategy,
  defaultCutout,
  defaultReadPhotos,
  defaultWriteAsset,
  hashPhotos,
  resolveDeps,
  runStageA,
  type PhotoFile,
  type StageADeps,
} from "./stage-a";

// AUCUNE photo réelle, AUCUN appel réseau (DoD) : le client image et le FS sont TOUJOURS
// mockés, la config est injectée.

const tmpRoot = mkdtempSync(join(tmpdir(), "multiplyz-stagea-"));
let counter = 0;
function freshDb() {
  counter += 1;
  const db = createDatabase(join(tmpRoot, `case-${counter}`, "app.sqlite"));
  runMigrations(db);
  return db;
}
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

/** Config Stage A de test (stratégie réglable par cas). */
function stageAConfig(overrides: Partial<StageAConfig> = {}): StageAConfig {
  return {
    photosDir: "docs/teddy",
    outputDir: "storage/reference/teddy",
    backgroundStrategy: "post-cutout",
    matteColor: "#ffffff",
    ...overrides,
  };
}

/** Un lot de photos factices (octets, jamais de vraie photo). */
const FAKE_PHOTOS: PhotoFile[] = [
  { name: "front.jpg", data: Buffer.from("photo-front"), mimeType: "image/jpeg" },
  { name: "side.jpg", data: Buffer.from("photo-side"), mimeType: "image/jpeg" },
];

/** Dépendances mockées : générateur, lecture photos, écriture, détourage. */
function mockDeps(overrides: Partial<StageADeps> = {}): {
  deps: Partial<StageADeps>;
  generate: ReturnType<typeof vi.fn>;
  readPhotos: ReturnType<typeof vi.fn>;
  writeAsset: ReturnType<typeof vi.fn>;
  cutout: ReturnType<typeof vi.fn>;
} {
  const generate = vi.fn(async () => Buffer.from("RAW_MATTE_IMAGE"));
  const readPhotos = vi.fn(async () => FAKE_PHOTOS);
  const writeAsset = vi.fn(async (dir: string, file: string) => `${dir}/${file}`);
  const cutout = vi.fn(async () => Buffer.from("CUTOUT_TRANSPARENT"));
  return {
    deps: {
      generate,
      readPhotos,
      writeAsset,
      cutout,
      config: stageAConfig(),
      ...overrides,
    },
    generate,
    readPhotos,
    writeAsset,
    cutout,
  };
}

describe("hashPhotos (empreinte déterministe du lot — garde WORLDGEN §8)", () => {
  it("même lot ⇒ même empreinte (ordre des fichiers indifférent)", () => {
    const a = hashPhotos(FAKE_PHOTOS);
    const b = hashPhotos([...FAKE_PHOTOS].reverse());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("un lot différent ⇒ une empreinte différente", () => {
    const other = [{ name: "front.jpg", data: Buffer.from("AUTRE"), mimeType: "image/jpeg" }];
    expect(hashPhotos(FAKE_PHOTOS)).not.toBe(hashPhotos(other));
  });
});

describe("applyBackgroundStrategy (⚙️ CONSOMMÉ — ADR 0008 contrainte 3)", () => {
  const RAW = Buffer.from("RAW_MATTE");

  // GARDE À EFFET OBSERVABLE + MUTATION : la stratégie CHANGE la sortie observable.
  // `post-cutout` → détoure (cutout appelé) → transparent=true, octets = sortie du cutout.
  it("post-cutout détoure : cutout appelé, transparent=true, octets = sortie détourée", async () => {
    const cutout = vi.fn(async () => Buffer.from("CUTOUT"));
    const out = await applyBackgroundStrategy(RAW, stageAConfig(), cutout);
    expect(cutout).toHaveBeenCalledWith(RAW, "#ffffff");
    expect(out.transparent).toBe(true);
    expect(out.bytes.toString()).toBe("CUTOUT");
  });

  // Mutation : basculer la stratégie (`post-cutout` ↔ `full-card`) inverse CES assertions.
  it("full-card garde le fond plein : cutout JAMAIS appelé, transparent=false, octets inchangés", async () => {
    const cutout = vi.fn(async () => Buffer.from("CUTOUT"));
    const out = await applyBackgroundStrategy(
      RAW,
      stageAConfig({ backgroundStrategy: "full-card" }),
      cutout,
    );
    expect(cutout).not.toHaveBeenCalled();
    expect(out.transparent).toBe(false);
    expect(out.bytes).toBe(RAW);
  });
});

describe("runStageA (outil one-shot — master + model sheet, WORLDGEN §8)", () => {
  it("génère le master + les 5 expressions et les persiste en candidats", async () => {
    const db = freshDb();
    const { deps, generate } = mockDeps();
    const produced = await runStageA(db, deps);

    // 1 master + 5 expressions = 6 assets.
    expect(produced).toHaveLength(1 + EXPRESSION_COUNT);
    expect(generate).toHaveBeenCalledTimes(1 + EXPRESSION_COUNT);

    const stored = listReferenceAssets(db);
    expect(stored).toHaveLength(6);
    // Tous en candidat (le figeage = sign-off owner, jamais auto).
    expect(stored.every((a) => a.status === "candidate")).toBe(true);
    expect(stored.every((a) => a.approvedBy === null)).toBe(true);

    // Le master + chaque slug d'expression sont présents.
    const ids = stored.map((a) => a.id).sort();
    const expected = [
      MASTER_ASSET_ID,
      ...TEDDY_EXPRESSIONS.map((e) => `teddy:expression:${e.slug}`),
    ].sort();
    expect(ids).toEqual(expected);
  });

  it("construit les prompts depuis la charte ART §5 (style + blank ear tag no text)", async () => {
    const db = freshDb();
    const { deps, generate } = mockDeps();
    await runStageA(db, deps);

    // Le prompt du master doit porter le STYLE DE BASE verrouillé + la contrainte étiquette.
    const firstPrompt = generate.mock.calls[0][0].prompt as string;
    expect(firstPrompt).toContain("flat 2D kawaii vector illustration"); // STYLE ART §5 (enrichi ADR 0009)
    expect(firstPrompt).toContain("blank ear tag with no text"); // ADR 0008 contrainte 2
    expect(firstPrompt).toContain("Negative:"); // NEGATIVE injecté
    // Le placeholder {base_style} est bien résolu (jamais laissé littéral).
    expect(firstPrompt).not.toContain("{base_style}");
    expect(firstPrompt).not.toContain("{world_accessory}");
  });

  it("passe les photos en img2img (Stage A = SEUL stage qui les passe, WORLDGEN §8)", async () => {
    const db = freshDb();
    const { deps, generate } = mockDeps();
    await runStageA(db, deps);
    // Chaque appel de génération porte les 2 photos de référence.
    for (const call of generate.mock.calls) {
      expect(call[0].refImages).toHaveLength(FAKE_PHOTOS.length);
    }
  });

  // GARDE WORLDGEN §8 « photos jamais re-consommées après A » : les photos sont lues UNE
  // SEULE FOIS (au démarrage), et toutes persistances partagent la MÊME empreinte du lot.
  // Mutation : relire les photos par asset (readPhotos dans la boucle) → readPhotos appelé 6× → rouge.
  it("lit les photos EXACTEMENT une fois et fige une empreinte unique du lot", async () => {
    const db = freshDb();
    const { deps, readPhotos } = mockDeps();
    await runStageA(db, deps);
    expect(readPhotos).toHaveBeenCalledTimes(1);

    const stored = listReferenceAssets(db);
    // Toutes les lignes partagent la MÊME empreinte de photos (un seul lot lu au Stage A).
    const rows = db.all<{ h: string }>(
      sql`SELECT DISTINCT source_photos_hash AS h FROM teddy_reference_assets`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].h).toBe(hashPhotos(FAKE_PHOTOS));
    expect(stored).toHaveLength(6);
  });

  // GARDE : dossier de photos vide → erreur explicite (rien à ancrer). Mutation : retirer le
  // garde `photos.length === 0` → générerait sur un lot vide → ce test ne lèverait plus → rouge.
  it("lève si le dossier de photos est vide (aucune photo à ancrer)", async () => {
    const db = freshDb();
    const { deps } = mockDeps({ readPhotos: vi.fn(async () => []) });
    await expect(runStageA(db, deps)).rejects.toThrow(/aucune photo/i);
    // Aucune écriture d'asset.
    expect(listReferenceAssets(db)).toHaveLength(0);
  });

  // ⚙️ CONSOMMÉ mutation-prouvé au niveau outil : la stratégie de fond change la sortie
  // PERSISTÉE (transparent + extension de fichier). Mutation : figer la stratégie → un des
  // deux cas rougit (transparent/extension incorrects).
  it("post-cutout ⇒ assets transparents (.png) ; full-card ⇒ assets pleins (.jpg)", async () => {
    // post-cutout
    const dbA = freshDb();
    const a = mockDeps({ config: stageAConfig({ backgroundStrategy: "post-cutout" }) });
    await runStageA(dbA, a.deps);
    expect(a.cutout).toHaveBeenCalledTimes(6);
    const storedA = listReferenceAssets(dbA);
    expect(storedA.every((x) => x.transparent === true)).toBe(true);
    expect(storedA.every((x) => x.assetRef.endsWith(".png"))).toBe(true);
    expect(storedA.every((x) => x.backgroundStrategy === "post-cutout")).toBe(true);

    // full-card
    const dbB = freshDb();
    const b = mockDeps({ config: stageAConfig({ backgroundStrategy: "full-card" }) });
    await runStageA(dbB, b.deps);
    expect(b.cutout).not.toHaveBeenCalled();
    const storedB = listReferenceAssets(dbB);
    expect(storedB.every((x) => x.transparent === false)).toBe(true);
    expect(storedB.every((x) => x.assetRef.endsWith(".jpg"))).toBe(true);
    expect(storedB.every((x) => x.backgroundStrategy === "full-card")).toBe(true);
  });

  it("écrit les octets détourés en post-cutout (sortie du cutout, pas le matte brut)", async () => {
    const db = freshDb();
    const { deps, writeAsset } = mockDeps();
    await runStageA(db, deps);
    // Chaque écriture reçoit la sortie détourée (CUTOUT_TRANSPARENT), pas RAW_MATTE_IMAGE.
    for (const call of writeAsset.mock.calls) {
      expect((call[2] as Buffer).toString()).toBe("CUTOUT_TRANSPARENT");
    }
  });
});

describe("dépendances par défaut (prod) — testées sans réseau ni photo réelle", () => {
  it("resolveDeps câble les défauts prod (generate → client image 6.1, FS, cutout)", () => {
    const deps = resolveDeps();
    expect(deps.generate).toBeTypeOf("function");
    expect(deps.readPhotos).toBe(defaultReadPhotos);
    expect(deps.writeAsset).toBe(defaultWriteAsset);
    expect(deps.cutout).toBe(defaultCutout);
    // config par défaut = bloc stageA de la config centrale (source unique).
    expect(deps.config.backgroundStrategy).toBeTypeOf("string");
  });

  it("le generate par défaut délègue au client image 6.1 (generateImage)", async () => {
    const spy = vi
      .spyOn(imageClient, "generateImage")
      .mockResolvedValue(Buffer.from("FROM_CLIENT"));
    const { generate } = resolveDeps();
    const out = await generate({ prompt: "p" });
    expect(spy).toHaveBeenCalledWith({ prompt: "p" });
    expect(out.toString()).toBe("FROM_CLIENT");
  });

  it("defaultCutout (post-cutout non configuré) rejette avec un message d'action", async () => {
    await expect(defaultCutout()).rejects.toThrow(/détourage configuré/i);
  });

  it("defaultReadPhotos lit les images d'un dossier (ignore README/.DS_Store), octets factices", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stagea-photos-"));
    writeFileSync(join(dir, "b-side.jpg"), Buffer.from("SIDE"));
    writeFileSync(join(dir, "a-front.png"), Buffer.from("FRONT"));
    writeFileSync(join(dir, "README.md"), "not an image");
    writeFileSync(join(dir, ".DS_Store"), "junk");
    const photos = await defaultReadPhotos(dir);
    // Triées par nom, non-images exclues.
    expect(photos.map((p) => p.name)).toEqual(["a-front.png", "b-side.jpg"]);
    expect(photos[0].mimeType).toBe("image/png");
    expect(photos[1].mimeType).toBe("image/jpeg");
    expect(photos[0].data.toString()).toBe("FRONT");
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaultWriteAsset crée le dossier de sortie et écrit les octets, renvoie le chemin", async () => {
    const root = mkdtempSync(join(tmpdir(), "stagea-out-"));
    const outDir = join(root, "nested", "teddy");
    const ref = await defaultWriteAsset(outDir, "teddy-master.png", Buffer.from("BYTES"));
    expect(ref).toBe(join(outDir, "teddy-master.png"));
    expect(readFileSync(ref).toString()).toBe("BYTES");
    rmSync(root, { recursive: true, force: true });
  });

  // Bout-en-bout des DÉFAUTS FS (sans réseau) : générateur mocké, mais readPhotos/writeAsset
  // par défaut sur des dossiers temp + stratégie `full-card` (aucun cutout requis). Prouve que
  // le SEUL point de lecture des photos par défaut fonctionne sans re-lire après A.
  it("runStageA avec readPhotos/writeAsset par défaut (full-card) sur dossiers temp", async () => {
    const root = mkdtempSync(join(tmpdir(), "stagea-e2e-"));
    const photosDir = join(root, "photos");
    const outputDir = join(root, "out");
    mkdirSync(photosDir, { recursive: true });
    writeFileSync(join(photosDir, "teddy.jpg"), Buffer.from("REAL_LOOKING_FAKE"));

    const db = freshDb();
    const generate = vi.fn(async () => Buffer.from("GEN"));
    await runStageA(db, {
      generate,
      config: stageAConfig({ photosDir, outputDir, backgroundStrategy: "full-card" }),
    });

    const stored = listReferenceAssets(db);
    expect(stored).toHaveLength(1 + EXPRESSION_COUNT);
    // Les fichiers ont bien été écrits par le writeAsset par défaut.
    expect(readFileSync(join(outputDir, "teddy-master.jpg")).toString()).toBe("GEN");
    rmSync(root, { recursive: true, force: true });
  });
});
