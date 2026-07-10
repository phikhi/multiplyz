import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { profiles, progress } from "@/lib/db/schema";
import { loadEngineConfig, loadMapConfig, loadRegularityConfig } from "@/config/server-config";
import { recordStars } from "../game/progress";
import { loadProgressionSummary } from "./progression";

/**
 * Résumé de progression (story 7.7, PLAN §Espace parent) sur **base réelle** (SQLite en mémoire +
 * migrations — le socle de secours est amorcé par `runMigrations`, 6.6). Vérifie la composition
 * (monde/niveaux/créatures/niveaux du jour) ET la garde **read-only** (aucune écriture).
 */

const MAP_CONFIG = loadMapConfig({});
const ENGINE_CONFIG = loadEngineConfig({});
const REGULARITY_CONFIG = loadRegularityConfig({});

let db: AppDatabase;
let profileId: number;
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = seedProfile("Léa");
});

describe("loadProgressionSummary", () => {
  it("profil jamais joué : monde 1, aucun niveau terminé, aucune créature, aucun niveau aujourd'hui", () => {
    const summary = loadProgressionSummary(
      db,
      profileId,
      MAP_CONFIG,
      ENGINE_CONFIG,
      REGULARITY_CONFIG,
      NOW,
    );
    expect(summary.worldNumber).toBe(1); // worldIndex 0 → affichage 1-based
    expect(summary.levelsCompleted).toBe(0);
    expect(summary.totalLevels).toBe(MAP_CONFIG.levelsPerWorld + 1); // + boss
    expect(summary.creaturesCount).toBe(0);
    expect(summary.levelsToday).toBe(0);
  });

  it("niveaux terminés AUJOURD'HUI comptés ; un niveau terminé un autre jour ne compte PAS", () => {
    recordStars(db, { profileId, worldIndex: 0, levelIndex: 0 }, 3, new Date(NOW));
    recordStars(db, { profileId, worldIndex: 0, levelIndex: 1 }, 2, new Date(NOW - 5 * DAY));

    const summary = loadProgressionSummary(
      db,
      profileId,
      MAP_CONFIG,
      ENGINE_CONFIG,
      REGULARITY_CONFIG,
      NOW,
    );
    expect(summary.levelsCompleted).toBe(2); // les 2 sont terminés, quel que soit le jour
    expect(summary.levelsToday).toBe(1); // seul le niveau 0 a été mis à jour AUJOURD'HUI
  });

  it("isole le profil demandé (n'agrège pas la progression d'un autre profil)", () => {
    const other = seedProfile("Tom");
    recordStars(db, { profileId: other, worldIndex: 0, levelIndex: 0 }, 3, new Date(NOW));

    const summary = loadProgressionSummary(
      db,
      profileId,
      MAP_CONFIG,
      ENGINE_CONFIG,
      REGULARITY_CONFIG,
      NOW,
    );
    expect(summary.levelsCompleted).toBe(0);
    expect(summary.levelsToday).toBe(0);
  });

  it("LECTURE SEULE : aucune écriture DB (garde read-only observable)", () => {
    recordStars(db, { profileId, worldIndex: 0, levelIndex: 0 }, 3, new Date(NOW));
    const before = db.select().from(progress).all().length;

    const insertSpy = vi.spyOn(db, "insert");
    const updateSpy = vi.spyOn(db, "update");
    const deleteSpy = vi.spyOn(db, "delete");

    loadProgressionSummary(db, profileId, MAP_CONFIG, ENGINE_CONFIG, REGULARITY_CONFIG, NOW);

    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(db.select().from(progress).all().length).toBe(before);
  });
});
