import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { worlds } from "@/lib/db/schema";
import { deriveWorldPalette, serializePalette } from "@/lib/worldgen/palette";
import { buildWorldTheme } from "@/lib/game/world-theme";
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

describe("listPendingWorlds — file d'approbation parent (story 7.9)", () => {
  it("liste vide quand aucun monde n'est buffered", () => {
    const db = freshDb();
    expect(listPendingWorlds(db)).toEqual([]);
  });

  it("liste UNIQUEMENT les mondes buffered, triés par world_index croissant", () => {
    const db = freshDb();
    seedWorld(db, 5, { status: "buffered" });
    seedWorld(db, 2, { status: "buffered" });
    seedWorld(db, 3, { status: "active" }); // hors file (déjà approuvé)
    seedWorld(db, 4, { status: "rejected" }); // hors file (déjà rejeté)
    const pending = listPendingWorlds(db);
    expect(pending.map((w) => w.index)).toEqual([2, 5]);
  });

  it("MUTATION-PROUVÉ : un monde approuvé (active) disparaît de la file au refresh suivant", () => {
    const db = freshDb();
    seedWorld(db, 10, { status: "buffered" });
    expect(listPendingWorlds(db).map((w) => w.id)).toEqual(["world:10"]);
    db.update(worlds).set({ status: "active" }).where(eq(worlds.index, 10)).run();
    // Retirer le filtre `status = buffered` laisserait ce monde dans la file indéfiniment.
    expect(listPendingWorlds(db)).toEqual([]);
  });

  it("expose le thème per-monde construit (accent + label), même contrat que la carte (world-theme.ts)", () => {
    const db = freshDb();
    seedWorld(db, 7, {
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
    seedWorld(db, 8, {
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
    seedWorld(db, 9, {
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
    seedWorld(db, 11, { status: "buffered" }); // sain
    seedWorld(db, 12, { status: "buffered", palette: "{}" }); // corrompu (slug/accent absents)
    // Retirer le try/catch autour de `buildWorldTheme` ferait planter TOUTE la liste (y compris le
    // monde 11, sain) au lieu d'exclure seulement le monde 12 corrompu.
    const pending = listPendingWorlds(db);
    expect(pending.map((w) => w.index)).toEqual([11]);
  });

  it("MUTATION-PROUVÉ : une erreur INATTENDUE (non-PaletteError) est RE-LEVÉE, jamais silencieusement avalée", () => {
    const db = freshDb();
    seedWorld(db, 13, { status: "buffered" });
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

  it("compte UNIQUEMENT les mondes buffered (même filtre que listPendingWorlds)", () => {
    const db = freshDb();
    seedWorld(db, 20, { status: "buffered" });
    seedWorld(db, 21, { status: "buffered" });
    seedWorld(db, 22, { status: "active" });
    expect(countPendingWorlds(db)).toBe(2);
  });

  it("MUTATION-PROUVÉ : décroît après approbation (source de vérité serveur, pas un compte figé)", () => {
    const db = freshDb();
    seedWorld(db, 23, { status: "buffered" });
    expect(countPendingWorlds(db)).toBe(1);
    db.update(worlds).set({ status: "active" }).where(eq(worlds.index, 23)).run();
    expect(countPendingWorlds(db)).toBe(0);
  });
});
