import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { jobs, worlds } from "@/lib/db/schema";
import { deriveWorldPalette, serializePalette } from "@/lib/worldgen/palette";
import { buildWorldTheme } from "@/lib/game/world-theme";
import { GENERATE_WORLD_JOB, serializeJobPayload } from "@/lib/worldgen/worker";
import { countPendingWorlds, listPendingWorlds } from "./world-approval";

// `buildWorldTheme` reste RÉEL par défaut (`vi.fn(actual.buildWorldTheme)`) pour tous les tests —
// seul le test dédié à la re-levée d'une erreur INATTENDUE (non-`PaletteError`) l'override le
// temps d'un appel (`mockImplementationOnce`), sans affecter les autres tests de ce fichier.
vi.mock("@/lib/game/world-theme", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/game/world-theme")>();
  return { ...actual, buildWorldTheme: vi.fn(actual.buildWorldTheme) };
});
const buildWorldThemeMock = vi.mocked(buildWorldTheme);

/**
 * Tests de la **projection de lecture parent** des mondes en attente (story 7.9), sur base réelle
 * (SQLite fichier + migrations) — même patron que `worker.test.ts`.
 *
 * **CORRIGÉ (rétro Backend PR #247)** : `listPendingWorlds`/`countPendingWorlds` filtrent
 * désormais `status = buffered` **ET** QA-validé (job `generate_world` `done`) — un monde
 * `buffered` **pré-QA/mi-QA** (`generateWorld` écrit `buffered` AVANT l'évaluation QA de
 * `processNextJob`) ne doit **jamais** apparaître dans la file d'approbation parent. Tous les tests
 * « le monde apparaît dans la liste » seedent donc explicitement un job `done` (`seedDoneJob`) —
 * un `seedWorld` seul (sans job) est réservé aux tests qui prouvent l'EXCLUSION.
 */

const tmpRoot = mkdtempSync(join(tmpdir(), "multiplyz-world-approval-"));
let counter = 0;
function freshDb(): AppDatabase {
  counter += 1;
  const db = createDatabase(join(tmpRoot, `case-${counter}`, "app.sqlite"));
  runMigrations(db);
  return db;
}

const NOW = new Date("2026-07-10T10:00:00.000Z");

/** Palette VALIDE (hex + slug), sérialisée — thème réellement construisible par `buildWorldTheme`. */
function validPalette(slug: string, accent: string): string {
  return serializePalette(deriveWorldPalette(slug, accent));
}

interface SeedOptions {
  readonly status?: "buffered" | "active" | "rejected";
  readonly theme?: string;
  readonly palette?: string;
  readonly assetRefs?: string;
}

function seedWorld(db: AppDatabase, index: number, options: SeedOptions = {}): void {
  db.insert(worlds)
    .values({
      id: `world:${index}`,
      index,
      theme: options.theme ?? "Forêt enchantée",
      palette: options.palette ?? validPalette("foret", "#4CAF50"),
      assetRefs: options.assetRefs ?? JSON.stringify({}),
      prompt: "p",
      seed: `s-${index}`,
      status: options.status ?? "buffered",
      createdAt: NOW,
    })
    .run();
}

/** Insère un job `generate_world` `done` pour un index (⇔ génération + QA réussies, `worldPassedQa`). */
function seedDoneJob(db: AppDatabase, worldIndex: number): void {
  db.insert(jobs)
    .values({
      type: GENERATE_WORLD_JOB,
      payload: serializeJobPayload(worldIndex),
      status: "done",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

/** Seed un monde `buffered` **QA-validé** (le cas le plus courant : prêt à apparaître dans la file). */
function seedQaPassedWorld(db: AppDatabase, index: number, options: SeedOptions = {}): void {
  seedWorld(db, index, options);
  seedDoneJob(db, index);
}

describe("listPendingWorlds — file d'approbation parent (story 7.9)", () => {
  it("liste vide quand aucun monde n'est buffered", () => {
    const db = freshDb();
    expect(listPendingWorlds(db)).toEqual([]);
  });

  it("liste UNIQUEMENT les mondes buffered ET QA-validés, triés par world_index croissant", () => {
    const db = freshDb();
    seedQaPassedWorld(db, 5, { status: "buffered" });
    seedQaPassedWorld(db, 2, { status: "buffered" });
    seedQaPassedWorld(db, 3, { status: "active" }); // hors file (déjà approuvé)
    seedQaPassedWorld(db, 4, { status: "rejected" }); // hors file (déjà rejeté)
    const pending = listPendingWorlds(db);
    expect(pending.map((w) => w.index)).toEqual([2, 5]);
  });

  it("MUTATION-PROUVÉ (rétro Backend PR #247) : un monde buffered PAS ENCORE QA-validé (aucun job done) N'APPARAÎT PAS dans la file", () => {
    const db = freshDb();
    // `generateWorld` (6.3) écrit `status='buffered'` À LA GÉNÉRATION, AVANT que la QA ne soit
    // évaluée (cf. JSDoc `processNextJob`, worker.ts) — aucun job `done` pour cet index.
    seedWorld(db, 14); // buffered, AUCUN job done
    // Retirer le filtre QA (`worldPassedQa`) de `qaPassedBufferedRows` exposerait ce monde mi-QA au
    // parent → test rouge (la liste ne serait plus vide).
    expect(listPendingWorlds(db)).toEqual([]);
  });

  it("MUTATION-PROUVÉ : un monde approuvé (active) disparaît de la file au refresh suivant", () => {
    const db = freshDb();
    seedQaPassedWorld(db, 10, { status: "buffered" });
    expect(listPendingWorlds(db).map((w) => w.id)).toEqual(["world:10"]);
    db.update(worlds).set({ status: "active" }).where(eq(worlds.index, 10)).run();
    // Retirer le filtre `status = buffered` laisserait ce monde dans la file indéfiniment.
    expect(listPendingWorlds(db)).toEqual([]);
  });

  it("expose le thème per-monde construit (accent + label), même contrat que la carte (world-theme.ts)", () => {
    const db = freshDb();
    seedQaPassedWorld(db, 7, {
      theme: "Océan scintillant",
      palette: validPalette("ocean", "#2196F3"),
    });
    const [w] = listPendingWorlds(db);
    expect(w.theme.label).toBe("Océan scintillant");
    expect(w.theme.accent).toBe("#2196F3");
    expect(w.theme.slug).toBe("ocean");
  });

  it("assetRefs placeholder (gate owner non franchi) ⇒ background/tiles/teddy null — repli accent+nom, jamais un throw", () => {
    const db = freshDb();
    seedQaPassedWorld(db, 8, {
      assetRefs: JSON.stringify({
        background: "placeholder://socle/8/background",
        tiles: "placeholder://socle/8/tiles",
        teddy: "placeholder://socle/8/teddy",
      }),
    });
    const [w] = listPendingWorlds(db);
    expect(w.theme.background).toBeNull();
    expect(w.theme.tiles).toBeNull();
    expect(w.theme.teddy).toBeNull();
  });

  it("assetRefs RENDABLES (gate owner franchi) ⇒ URLs publiques non-null (aperçu image réel)", () => {
    const db = freshDb();
    seedQaPassedWorld(db, 9, {
      assetRefs: JSON.stringify({
        background: "world/9/background.png",
        tiles: "world/9/tiles.png",
        teddy: "world/9/teddy.png",
      }),
    });
    const [w] = listPendingWorlds(db);
    expect(w.theme.background).toBe("/generated/world/9/background.png");
  });

  it("MUTATION-PROUVÉ : un monde à palette CORROMPUE est EXCLU de la file sans planter les autres (défense en profondeur)", () => {
    const db = freshDb();
    seedQaPassedWorld(db, 11, { status: "buffered" }); // sain
    seedQaPassedWorld(db, 12, { status: "buffered", palette: "{}" }); // corrompu (slug/accent absents)
    // Retirer le try/catch autour de `buildWorldTheme` ferait planter TOUTE la liste (y compris le
    // monde 11, sain) au lieu d'exclure seulement le monde 12 corrompu.
    const pending = listPendingWorlds(db);
    expect(pending.map((w) => w.index)).toEqual([11]);
  });

  it("MUTATION-PROUVÉ : une erreur INATTENDUE (non-PaletteError) est RE-LEVÉE, jamais silencieusement avalée", () => {
    const db = freshDb();
    seedQaPassedWorld(db, 13, { status: "buffered" });
    buildWorldThemeMock.mockImplementationOnce(() => {
      throw new TypeError("bug inattendu (pas une palette corrompue)");
    });
    // Retirer `if (!(error instanceof PaletteError)) throw error;` avalerait AUSSI cette erreur
    // (monde silencieusement exclu au lieu de faire remonter un vrai bug).
    expect(() => listPendingWorlds(db)).toThrow(TypeError);
  });
});

describe("countPendingWorlds — repère de compte du tableau de bord (story 7.9)", () => {
  it("0 quand aucun monde en attente", () => {
    const db = freshDb();
    expect(countPendingWorlds(db)).toBe(0);
  });

  it("compte UNIQUEMENT les mondes buffered ET QA-validés (même filtre que listPendingWorlds)", () => {
    const db = freshDb();
    seedQaPassedWorld(db, 20, { status: "buffered" });
    seedQaPassedWorld(db, 21, { status: "buffered" });
    seedQaPassedWorld(db, 22, { status: "active" });
    expect(countPendingWorlds(db)).toBe(2);
  });

  it("MUTATION-PROUVÉ (rétro Backend PR #247) : un monde buffered PAS ENCORE QA-validé N'EST PAS compté", () => {
    const db = freshDb();
    seedWorld(db, 24); // buffered, AUCUN job done
    // Retirer le filtre QA laisserait ce monde mi-QA gonfler le compte affiché au parent.
    expect(countPendingWorlds(db)).toBe(0);
  });

  it("MUTATION-PROUVÉ : décroît après approbation (source de vérité serveur, pas un compte figé)", () => {
    const db = freshDb();
    seedQaPassedWorld(db, 23, { status: "buffered" });
    expect(countPendingWorlds(db)).toBe(1);
    db.update(worlds).set({ status: "active" }).where(eq(worlds.index, 23)).run();
    expect(countPendingWorlds(db)).toBe(0);
  });
});
