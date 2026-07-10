import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { attempts, mastery, masteryKey, profiles } from "@/lib/db/schema";
import {
  loadEngineConfig,
  loadRegularityConfig,
  loadReportingConfig,
} from "@/config/server-config";
import { makeFact, type Fact } from "@/lib/engine/facts";
import type { MasteryState } from "@/lib/engine/mastery";
import type { StatsConfig } from "./stats";
import { loadParentStats } from "./stats-source";

/**
 * Pont **DB → agrégats parent** (stories 7.2 + 7.4) sur **base réelle** (SQLite en mémoire +
 * migrations). Vérifie la composition end-to-end (attempts + scope → agrégats, régularité incluse)
 * ET la garde **read-only observable** : aucune écriture DB (espions insert/update/delete + comptes
 * de lignes inchangés).
 */

const CONFIG: StatsConfig = {
  engine: loadEngineConfig({}),
  reporting: loadReportingConfig({}),
  regularity: loadRegularityConfig({}),
};

let db: AppDatabase;
let profileId: number;
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0); // epoch ms (seconde pleine → round-trip Date exact)
const DAY = 24 * 60 * 60 * 1000;

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

function seedAttempt(
  pid: number,
  fact: Fact,
  overrides: { correct?: boolean; responseMs?: number; isRetry?: boolean; createdAt?: number } = {},
): void {
  db.insert(attempts)
    .values({
      profileId: pid,
      factId: fact.key,
      skill: fact.skill,
      correct: overrides.correct ?? true,
      responseMs: overrides.responseMs ?? 1000,
      isRetry: overrides.isRetry ?? false,
      clientAttemptId: null,
      createdAt: new Date(overrides.createdAt ?? NOW),
    })
    .run();
}

function seedMastery(pid: number, fact: Fact, state: Partial<MasteryState>): void {
  db.insert(mastery)
    .values({
      id: masteryKey(pid, fact.key),
      profileId: pid,
      factId: fact.key,
      skill: fact.skill,
      strength: state.box ?? 0,
      correctCount: state.correctCount ?? 0,
      wrongCount: state.wrongCount ?? 0,
      avgResponseMs: state.avgResponseMs ?? 0,
      lastSeen: null,
      nextDue: null,
    })
    .run();
}

function rowCounts(): Record<string, number> {
  return {
    attempts: db.select().from(attempts).all().length,
    mastery: db.select().from(mastery).all().length,
    profiles: db.select().from(profiles).all().length,
  };
}

const MULT_6X8 = makeFact("mult", 6, 8);
const MULT_2X3 = makeFact("mult", 2, 3);

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = seedProfile("Léa");
});

describe("loadParentStats", () => {
  it("compose les 5 agrégats depuis attempts + mastery (bout-en-bout)", () => {
    // 2 réponses comptées (1 juste 1000 ms + 1 fausse 3000 ms) + 1 re-essai (exclu de justesse).
    seedAttempt(profileId, MULT_6X8, { correct: true, responseMs: 1000 });
    seedAttempt(profileId, MULT_2X3, { correct: false, responseMs: 3000 });
    seedAttempt(profileId, MULT_2X3, { correct: true, responseMs: 9000, isRetry: true });
    // Maîtrise : un fait maîtrisé (box 5) + un fait faible et raté (box 1, 2 erreurs).
    seedMastery(profileId, MULT_6X8, { box: 5 });
    seedMastery(profileId, MULT_2X3, { box: 1, wrongCount: 2, avgResponseMs: 1000 });

    const stats = loadParentStats(db, profileId, CONFIG, NOW);

    expect(stats.accuracy.overall).toBeCloseTo(0.5); // 1 juste / 2 comptées (re-essai exclu)
    expect(stats.speed.overallMs).toBe(2000); // (1000 + 3000) / 2
    expect(stats.masteryMap.mult.masteredCount).toBe(1); // seul mult_6x8 est box ≥ 4
    expect(stats.reviewList.map((i) => i.factKey)).toContain("mult_2x3"); // faible + raté
    // Régularité : les 3 réponses (re-essai INCLUS — engagement) tombent le même jour → 1 jour joué,
    // série courante vivante (aujourd'hui). Prouve le câblage attempts → computeRegularityStats.
    expect(stats.regularity.daysPlayed).toBe(1);
    expect(stats.regularity.currentStreakDays).toBe(1);
    expect(stats.regularity.today).not.toBeNull();
  });

  it("régularité : jours joués + série dérivés du journal (records threadés + engagement re-essai)", () => {
    // 3 jours consécutifs joués (aujourd'hui, hier, avant-hier), en heure de Paris. Un re-essai
    // seul le 3ᵉ jour → il compte quand même comme jour joué (engagement, ≠ justesse/rapidité).
    // Épingle le threading `attempts → computeRegularityStats` (muter records→[] rougit ce test).
    // NB (#224) : ces assertions sont INVARIANTES à `dayTimeZone`/`streakBreakGapDays`/`now` (jours
    // bien espacés en milieu de journée) → le threading de `config.regularity` et de `now` au bridge
    // est épinglé par les deux tests « bridge : … » ci-dessous, PAS par celui-ci.
    seedAttempt(profileId, MULT_6X8, { createdAt: NOW });
    seedAttempt(profileId, MULT_2X3, { createdAt: NOW - 1 * DAY });
    seedAttempt(profileId, MULT_2X3, { createdAt: NOW - 2 * DAY, isRetry: true });

    const { regularity } = loadParentStats(db, profileId, CONFIG, NOW);
    expect(regularity.daysPlayed).toBe(3);
    expect(regularity.currentStreakDays).toBe(3);
    expect(regularity.recordStreakDays).toBe(3);
    expect(regularity.days.map((d) => d.dayOrdinal)).toHaveLength(3);
  });

  it("bridge : le FUSEAU threadé via config.regularity AGIT (Paris vs UTC → daysPlayed diffère)", () => {
    // A = 23:30 UTC 20/07 → 01:30 Europe/Paris 21/07 (jour civil suivant) ; B = 21:00 UTC 20/07 →
    // 23:00 Paris 20/07 (même jour). Deux jours civils DISTINCTS en Paris, un SEUL en UTC.
    seedAttempt(profileId, MULT_6X8, { createdAt: Date.UTC(2026, 6, 20, 23, 30) });
    seedAttempt(profileId, MULT_2X3, { createdAt: Date.UTC(2026, 6, 20, 21, 0) });

    // Défaut (Europe/Paris) threadé via loadParentStats → 2 jours.
    expect(loadParentStats(db, profileId, CONFIG, NOW).regularity.daysPlayed).toBe(2);
    // `dayTimeZone:"UTC"` threadé via loadParentStats (le VRAI chemin bridge, pas
    // `computeRegularityStats` direct) → même jour civil → 1 jour. Rougit si le bridge fige
    // `config.regularity` (le défaut Paris resterait 2) — épingle le threading du ⚙️ au call-site.
    const utcConfig: StatsConfig = {
      ...CONFIG,
      regularity: { ...CONFIG.regularity, dayTimeZone: "UTC" },
    };
    expect(loadParentStats(db, profileId, utcConfig, NOW).regularity.daysPlayed).toBe(1);
  });

  it("bridge : `now` threadé AGIT sur la série courante (dernier jour trop vieux → 0)", () => {
    // Une seule réponse il y a 2 jours (= l'écart de rupture) → série MORTE relativement à NOW.
    seedAttempt(profileId, MULT_6X8, { createdAt: NOW - 2 * DAY });

    // Série courante = 0 : `todayOrdinal − dernier >= streakBreakGapDays` (2 >= 2). Rougit si le
    // bridge fige `now` (ex. 0 = 1970 → dernier jour dans un futur lointain → série redevient
    // vivante = 1) — épingle le threading de `now` au call-site loadParentStats.
    expect(loadParentStats(db, profileId, CONFIG, NOW).regularity.currentStreakDays).toBe(0);
  });

  it("isole le profil demandé (n'agrège pas les réponses d'un autre profil)", () => {
    const other = seedProfile("Tom");
    seedAttempt(profileId, MULT_6X8, { correct: true });
    seedAttempt(other, MULT_2X3, { correct: false });
    seedAttempt(other, MULT_2X3, { correct: false });

    // Léa n'a qu'une réponse juste → 100 % ; les 2 fausses de Tom ne comptent pas.
    expect(loadParentStats(db, profileId, CONFIG, NOW).accuracy.overall).toBeCloseTo(1);
  });

  it("convertit created_at (Date) en epoch ms → fenêtres de tendance correctes", () => {
    // Courant (0-7 j) : juste ; précédent (7-14 j) : faux → justesse en amélioration.
    seedAttempt(profileId, MULT_6X8, { correct: true, createdAt: NOW - 1 * DAY });
    seedAttempt(profileId, MULT_2X3, { correct: false, createdAt: NOW - 8 * DAY });

    const { trend } = loadParentStats(db, profileId, CONFIG, NOW).accuracy;
    expect(trend.current).toBeCloseTo(1);
    expect(trend.previous).toBeCloseTo(0);
    expect(trend.direction).toBe("improving");
  });

  it("LECTURE SEULE : aucune écriture DB (garde read-only observable)", () => {
    seedAttempt(profileId, MULT_6X8, { correct: true });
    seedMastery(profileId, MULT_2X3, { box: 1, wrongCount: 1 });

    const insertSpy = vi.spyOn(db, "insert");
    const updateSpy = vi.spyOn(db, "update");
    const deleteSpy = vi.spyOn(db, "delete");
    const before = rowCounts();

    loadParentStats(db, profileId, CONFIG, NOW);

    // Aucune mutation tentée (rougit si une écriture est introduite dans la couche stats).
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    // Comptes de lignes inchangés (2ᵉ observable de non-écriture).
    expect(rowCounts()).toEqual(before);
  });
});
