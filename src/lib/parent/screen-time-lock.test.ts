import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { attempts, profiles } from "@/lib/db/schema";
import { loadRegularityConfig, type RegularityConfig } from "@/config/server-config";
import { makeFact } from "@/lib/engine/facts";
import type { HouseholdSettings } from "./settings";
import {
  evaluateScreenTimeLock,
  isScreenTimeHardLocked,
  loadTodayActiveMinutes,
} from "./screen-time-lock";

/**
 * **Enforcement — verrou dur du temps d'écran** (story 7.8 #229, DETAILS §25-32). La garde pure
 * (`isScreenTimeHardLocked`) est mutation-prouvée à la **borne exacte** (seuil atteint bloque, juste
 * sous passe, `>=` pas `>`). Le pont DB (`loadTodayActiveMinutes`) tourne sur **base réelle**
 * (SQLite en mémoire + migrations, mêmes conventions que `stats-source.test.ts`) et réutilise
 * `computeRegularityStats` (7.4) — jamais une seconde définition du temps de jeu.
 */

const CONFIG: RegularityConfig = loadRegularityConfig({}); // Paris, amplitude 240, gap 2, 15-20.
const MIN = 60 * 1000;
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0); // 14:00 Europe/Paris (été) — pas de bord de minuit.

function settings(overrides: Partial<HouseholdSettings> = {}): HouseholdSettings {
  return {
    theme: "system",
    parentWorldValidation: false,
    screenTimeNudgeMinutes: 20,
    screenTimeHardLockEnabled: false,
    screenTimeHardLockMinutes: 30,
    soundEnabled: true,
    musicEnabled: true,
    volume: 70,
    ...overrides,
  };
}

// ============================================================================
// isScreenTimeHardLocked — garde pure, bornée (mutation-proof à la valeur exacte)
// ============================================================================
describe("isScreenTimeHardLocked", () => {
  it("désactivé → jamais bloquant, même très au-dessus du seuil (opt-in strict)", () => {
    expect(
      isScreenTimeHardLocked(
        settings({ screenTimeHardLockEnabled: false, screenTimeHardLockMinutes: 10 }),
        999,
      ),
    ).toBe(false);
  });

  it("activé + minutes JUSTE SOUS le seuil → passe (29 < 30)", () => {
    expect(
      isScreenTimeHardLocked(
        settings({ screenTimeHardLockEnabled: true, screenTimeHardLockMinutes: 30 }),
        29,
      ),
    ).toBe(false);
  });

  it("activé + minutes = seuil EXACT → bloque (borne INCLUSIVE `>=`, pas `>`)", () => {
    // Rouge si la borne devenait stricte (`>` au lieu de `>=`) : 30 >= 30 doit bloquer.
    expect(
      isScreenTimeHardLocked(
        settings({ screenTimeHardLockEnabled: true, screenTimeHardLockMinutes: 30 }),
        30,
      ),
    ).toBe(true);
  });

  it("activé + minutes AU-DESSUS du seuil → bloque", () => {
    expect(
      isScreenTimeHardLocked(
        settings({ screenTimeHardLockEnabled: true, screenTimeHardLockMinutes: 30 }),
        45,
      ),
    ).toBe(true);
  });

  it("activé + 0 minute jouée aujourd'hui → jamais bloquant (enfant pas encore entré)", () => {
    expect(
      isScreenTimeHardLocked(
        settings({ screenTimeHardLockEnabled: true, screenTimeHardLockMinutes: 10 }),
        0,
      ),
    ).toBe(false);
  });
});

// ============================================================================
// loadTodayActiveMinutes — pont DB (base réelle), réutilise computeRegularityStats (7.4)
// ============================================================================
let db: AppDatabase;
let profileId: number;

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

const FACT = makeFact("mult", 6, 8);

function seedAttempt(pid: number, createdAt: number): void {
  db.insert(attempts)
    .values({
      profileId: pid,
      factId: FACT.key,
      skill: FACT.skill,
      correct: true,
      responseMs: 1000,
      isRetry: false,
      clientAttemptId: null,
      createdAt: new Date(createdAt),
    })
    .run();
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = seedProfile("Léa");
});

describe("loadTodayActiveMinutes", () => {
  it("aucune réponse aujourd'hui → 0 (jamais bloquant sur une journée pas encore jouée)", () => {
    expect(loadTodayActiveMinutes(db, profileId, CONFIG, NOW)).toBe(0);
  });

  it("réponses seulement HIER → 0 aujourd'hui (n'agrège pas les jours passés)", () => {
    seedAttempt(profileId, NOW - 24 * 60 * 60 * 1000);
    expect(loadTodayActiveMinutes(db, profileId, CONFIG, NOW)).toBe(0);
  });

  it("2 réponses aujourd'hui espacées de 30 min → 30 minutes (amplitude, réutilise 7.4)", () => {
    seedAttempt(profileId, NOW - 30 * MIN);
    seedAttempt(profileId, NOW);
    expect(loadTodayActiveMinutes(db, profileId, CONFIG, NOW)).toBe(30);
  });

  it("isole le profil demandé (n'agrège pas le temps joué d'un autre profil)", () => {
    const other = seedProfile("Tom");
    seedAttempt(other, NOW - 60 * MIN);
    seedAttempt(other, NOW);
    // Léa n'a rien joué → 0, malgré l'heure jouée par Tom.
    expect(loadTodayActiveMinutes(db, profileId, CONFIG, NOW)).toBe(0);
  });

  it("bridge : `maxDayAmplitudeMinutes` ⚙️ threadé AGIT (plafonne l'amplitude, ADR 0014)", () => {
    seedAttempt(profileId, NOW - 120 * MIN);
    seedAttempt(profileId, NOW);
    const cappedConfig: RegularityConfig = { ...CONFIG, maxDayAmplitudeMinutes: 60 };
    // Rouge si le plafond ⚙️ n'était pas threadé (resterait 120).
    expect(loadTodayActiveMinutes(db, profileId, cappedConfig, NOW)).toBe(60);
  });
});

// ============================================================================
// evaluateScreenTimeLock — pont complet (settings + DB + garde), consommé par startLevelAction
// ============================================================================
describe("evaluateScreenTimeLock", () => {
  it("désactivé → false SANS lire la DB (court-circuit avant toute requête, chemin chaud)", () => {
    const selectSpy = vi.spyOn(db, "select");
    const result = evaluateScreenTimeLock(
      db,
      profileId,
      settings({ screenTimeHardLockEnabled: false }),
      CONFIG,
      NOW,
    );
    expect(result).toBe(false);
    // Rouge si le court-circuit était retiré (le pont interrogerait la DB même désactivé).
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("activé + seuil EXACT atteint (borne DB→garde bout-en-bout) → true", () => {
    seedAttempt(profileId, NOW - 30 * MIN);
    seedAttempt(profileId, NOW);
    const result = evaluateScreenTimeLock(
      db,
      profileId,
      settings({ screenTimeHardLockEnabled: true, screenTimeHardLockMinutes: 30 }),
      CONFIG,
      NOW,
    );
    expect(result).toBe(true);
  });

  it("activé + JUSTE SOUS le seuil (bout-en-bout) → false (la partie peut continuer)", () => {
    seedAttempt(profileId, NOW - 29 * MIN);
    seedAttempt(profileId, NOW);
    const result = evaluateScreenTimeLock(
      db,
      profileId,
      settings({ screenTimeHardLockEnabled: true, screenTimeHardLockMinutes: 30 }),
      CONFIG,
      NOW,
    );
    expect(result).toBe(false);
  });
});
