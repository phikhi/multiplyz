import { describe, expect, it } from "vitest";
import { loadRegularityConfig, type RegularityConfig } from "@/config/server-config";
import { computeRegularityStats } from "./regularity";
import type { AttemptRecord } from "./stats";

/**
 * Agrégats de **régularité** read-only de l'espace parent (story 7.4, PLAN §Espace parent :83,
 * ADR 0014). Fonction **pure** testée sur fixtures `attempts`. Fuseau, plafond d'amplitude, écart de
 * rupture de série et fenêtre saine sont des ⚙️ **mutation-prouvés par test NOMMÉ** (#143/#173), avec
 * les **bornes inclusives/strictes testées à la valeur-frontière exacte** (rétro 7.2 #224). La
 * **fidélité au modèle** (engagement = TOUTES les réponses re-essais inclus, jour calendaire local)
 * est vérifiée explicitement.
 */

const CONFIG = loadRegularityConfig({}); // Europe/Paris, amplitude 240, gap 2, respect 15-20.

/** Config régularité avec des ⚙️ surchargés (prouve qu'ils AGISSENT sur l'agrégat). */
function withConfig(overrides: Partial<RegularityConfig>): RegularityConfig {
  return { ...CONFIG, ...overrides };
}

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
/** epoch ms injecté, déterministe. `Date.UTC(2026, 6, 20, 12)` = **14:00 Europe/Paris** (heure d'été). */
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);
/** Instant `n` jours avant NOW (même heure murale ~14:00 Paris : pas de bord de minuit, juillet = pas de DST). */
const daysAgo = (n: number): number => NOW - n * DAY;

function attempt(createdAt: number, overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    skill: "mult",
    correct: true,
    responseMs: 1000,
    isRetry: false,
    createdAt,
    ...overrides,
  };
}

// ============================================================================
// Jours joués + fidélité engagement (re-essais INCLUS, contrairement à justesse/rapidité)
// ============================================================================
describe("computeRegularityStats — jours joués", () => {
  it("aucune réponse → 0 jour, séries 0, aujourd'hui null, liste vide", () => {
    const r = computeRegularityStats([], CONFIG, NOW);
    expect(r.daysPlayed).toBe(0);
    expect(r.currentStreakDays).toBe(0);
    expect(r.recordStreakDays).toBe(0);
    expect(r.today).toBeNull();
    expect(r.days).toEqual([]);
  });

  it("compte les jours calendaires DISTINCTS (plusieurs réponses le même jour = 1 jour)", () => {
    const attempts = [
      attempt(Date.UTC(2026, 6, 20, 6, 0)),
      attempt(Date.UTC(2026, 6, 20, 16, 0)),
      attempt(daysAgo(1)),
    ];
    expect(computeRegularityStats(attempts, CONFIG, NOW).daysPlayed).toBe(2);
  });

  it("FIDÉLITÉ : un re-essai SEUL compte comme jour joué (engagement, pas justesse — ENGINE §9)", () => {
    // Si la régularité filtrait les re-essais comme la justesse (stats.ts), ce jour ne compterait pas.
    const r = computeRegularityStats(
      [attempt(NOW, { isRetry: true, correct: false })],
      CONFIG,
      NOW,
    );
    expect(r.daysPlayed).toBe(1);
    expect(r.today).not.toBeNull();
  });

  it("les jours sont triés par ordinal CROISSANT (matière brute déterministe)", () => {
    const attempts = [attempt(daysAgo(2)), attempt(daysAgo(0)), attempt(daysAgo(1))];
    const ordinals = computeRegularityStats(attempts, CONFIG, NOW).days.map((d) => d.dayOrdinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(ordinals).toHaveLength(3);
  });
});

// ============================================================================
// Temps de jeu / jour — amplitude bornée (ADR 0014) + plafond ⚙️
// ============================================================================
describe("computeRegularityStats — temps/jour (amplitude bornée)", () => {
  it("temps = amplitude premier→dernier réponse du jour (ordre d'arrivée quelconque)", () => {
    // Réponses NON triées à l'arrivée : 10:00, 08:00, 18:00 Paris → amplitude 08:00→18:00 = 10 h.
    const attempts = [
      attempt(Date.UTC(2026, 6, 20, 8, 0)), // 10:00 Paris
      attempt(Date.UTC(2026, 6, 20, 6, 0)), // 08:00 Paris (premier)
      attempt(Date.UTC(2026, 6, 20, 16, 0)), // 18:00 Paris (dernier)
    ];
    // Amplitude brute 600 min > plafond 240 → bornée à 240 (voir test dédié). Ici on borne haut à 5 h
    // pour lire l'amplitude BRUTE : min(600, 300) = 300 min.
    const day = computeRegularityStats(
      attempts,
      withConfig({ maxDayAmplitudeMinutes: 300 }),
      NOW,
    ).today;
    expect(day?.activeMinutes).toBe(300);
  });

  it("une réponse ISOLÉE du jour → 0 min (amplitude nulle)", () => {
    expect(computeRegularityStats([attempt(NOW)], CONFIG, NOW).today?.activeMs).toBe(0);
    expect(computeRegularityStats([attempt(NOW)], CONFIG, NOW).today?.activeMinutes).toBe(0);
  });

  it("le PLAFOND d'amplitude (⚙️ maxDayAmplitudeMinutes) BORNE le temps/jour et AGIT", () => {
    // Amplitude brute 10 h = 600 min.
    const attempts = [attempt(Date.UTC(2026, 6, 20, 6, 0)), attempt(Date.UTC(2026, 6, 20, 16, 0))];
    // Défaut 240 → borné à 240 (rougit si le plafond est figé/ignoré → 600).
    expect(computeRegularityStats(attempts, CONFIG, NOW).today?.activeMinutes).toBe(240);
    // Plafond 60 → borné à 60 (le ⚙️ AGIT).
    expect(
      computeRegularityStats(attempts, withConfig({ maxDayAmplitudeMinutes: 60 }), NOW).today
        ?.activeMinutes,
    ).toBe(60);
  });
});

// ============================================================================
// Respect de la fenêtre saine 15-20 min — bornes INCLUSIVES à la valeur exacte (#224)
// ============================================================================
describe("computeRegularityStats — respect de la fenêtre 15-20 min", () => {
  /** Un jour à amplitude EXACTE de `minutes` (deux réponses espacées de `minutes`, même jour Paris). */
  const dayOf = (minutes: number, config = CONFIG) => {
    const first = Date.UTC(2026, 6, 20, 8, 0, 0);
    return computeRegularityStats([attempt(first), attempt(first + minutes * MIN)], config, NOW)
      .today;
  };

  it("temps < min → « under »", () => {
    expect(dayOf(14)?.respect).toBe("under");
  });

  it("temps > max → « over »", () => {
    expect(dayOf(21)?.respect).toBe("over");
  });

  it("BORNE basse INCLUSIVE : temps EXACTEMENT = min (15) → « within » (`<`, pas `<=`)", () => {
    // 15 min pile : `activeMs < minMs` est FAUX → within. Muter `<` en `<=` classerait « under ».
    expect(dayOf(15)?.respect).toBe("within");
  });

  it("BORNE haute INCLUSIVE : temps EXACTEMENT = max (20) → « within » (`>`, pas `>=`)", () => {
    // 20 min pile : `activeMs > maxMs` est FAUX → within. Muter `>` en `>=` classerait « over ».
    expect(dayOf(20)?.respect).toBe("within");
  });

  it("les BORNES de la fenêtre (⚙️ respectWindow{Min,Max}Minutes) AGISSENT sur le classement", () => {
    // 10 min : défaut [15,20] → under ; abaisser min à 5 → within (borne basse AGIT).
    expect(dayOf(10)?.respect).toBe("under");
    expect(dayOf(10, withConfig({ respectWindowMinMinutes: 5 }))?.respect).toBe("within");
    // 25 min : défaut → over ; relever max à 30 → within (borne haute AGIT).
    expect(dayOf(25)?.respect).toBe("over");
    expect(dayOf(25, withConfig({ respectWindowMaxMinutes: 30 }))?.respect).toBe("within");
  });
});

// ============================================================================
// Série courante — vivante aujourd'hui/hier, rompue au-delà de l'écart ⚙️
// ============================================================================
describe("computeRegularityStats — série courante", () => {
  it("jours consécutifs joués finissant aujourd'hui → longueur du run", () => {
    const attempts = [attempt(daysAgo(0)), attempt(daysAgo(1)), attempt(daysAgo(2))];
    expect(computeRegularityStats(attempts, CONFIG, NOW).currentStreakDays).toBe(3);
  });

  it("joué HIER mais pas aujourd'hui → série encore VIVANTE (aujourd'hui pas fini)", () => {
    // Dernier jour = hier (écart 1 < gap 2) → série vivante.
    const attempts = [attempt(daysAgo(1)), attempt(daysAgo(2))];
    expect(computeRegularityStats(attempts, CONFIG, NOW).currentStreakDays).toBe(2);
  });

  it("BORNE de vie : dernier jour à l'écart EXACT de rupture (2 j) → série MORTE = 0 (`>=`)", () => {
    // Dernier jour = avant-hier (écart 2 = gap) : `todayOrdinal − last >= gap` VRAI → 0.
    // Muter `>=` en `>` (2 > 2 faux) rendrait la série vivante (1) → ce test rougit.
    expect(computeRegularityStats([attempt(daysAgo(2))], CONFIG, NOW).currentStreakDays).toBe(0);
  });

  it("BORNE de vie : dernier jour juste sous l'écart (hier, 1 j) → série vivante = 1", () => {
    expect(computeRegularityStats([attempt(daysAgo(1))], CONFIG, NOW).currentStreakDays).toBe(1);
  });

  it("un TROU dans l'historique arrête le run courant (jours non consécutifs)", () => {
    // Aujourd'hui + hier consécutifs, puis un trou (rien il y a 2 j), puis il y a 3 j.
    const attempts = [attempt(daysAgo(0)), attempt(daysAgo(1)), attempt(daysAgo(3))];
    // Run courant = aujourd'hui + hier = 2 (le jour à −3 est une série antérieure séparée).
    expect(computeRegularityStats(attempts, CONFIG, NOW).currentStreakDays).toBe(2);
  });

  it("l'ÉCART de rupture (⚙️ streakBreakGapDays) AGIT sur la série courante", () => {
    // Aujourd'hui + il y a 2 jours (un jour manquant entre les deux).
    const attempts = [attempt(daysAgo(0)), attempt(daysAgo(2))];
    // Défaut gap 2 : écart 2 rompt → série courante = aujourd'hui seul = 1.
    expect(computeRegularityStats(attempts, CONFIG, NOW).currentStreakDays).toBe(1);
    // gap 3 : écart 2 < 3 → les deux jours forment une série continue = 2 (le ⚙️ AGIT).
    expect(
      computeRegularityStats(attempts, withConfig({ streakBreakGapDays: 3 }), NOW)
        .currentStreakDays,
    ).toBe(2);
  });
});

// ============================================================================
// Série record — plus long run consécutif + écart ⚙️ à la valeur-frontière
// ============================================================================
describe("computeRegularityStats — série record", () => {
  it("record = plus long run consécutif de l'historique (pas le dernier)", () => {
    // Runs : {−6,−5,−4,−3} = 4 ; {−1,0} = 2 → record 4, alors que la série COURANTE = 2.
    const attempts = [
      attempt(daysAgo(6)),
      attempt(daysAgo(5)),
      attempt(daysAgo(4)),
      attempt(daysAgo(3)),
      attempt(daysAgo(1)),
      attempt(daysAgo(0)),
    ];
    const r = computeRegularityStats(attempts, CONFIG, NOW);
    expect(r.recordStreakDays).toBe(4);
    expect(r.currentStreakDays).toBe(2);
  });

  it("BORNE : deux jours à l'écart EXACT de rupture (2 j) → runs de 1 → record 1 (`<`)", () => {
    // Ordinaux à −0 et −2 : écart 2 = gap → NON consécutifs. Muter `<` en `<=` fusionnerait en 2.
    expect(
      computeRegularityStats([attempt(daysAgo(0)), attempt(daysAgo(2))], CONFIG, NOW)
        .recordStreakDays,
    ).toBe(1);
  });

  it("BORNE : deux jours à l'écart juste sous la rupture (1 j) → run de 2", () => {
    expect(
      computeRegularityStats([attempt(daysAgo(0)), attempt(daysAgo(1))], CONFIG, NOW)
        .recordStreakDays,
    ).toBe(2);
  });

  it("l'ÉCART de rupture (⚙️ streakBreakGapDays) AGIT sur le record", () => {
    // Jours à −0, −2, −4 (écarts de 2). Défaut gap 2 : aucun consécutif → record 1.
    const attempts = [attempt(daysAgo(0)), attempt(daysAgo(2)), attempt(daysAgo(4))];
    expect(computeRegularityStats(attempts, CONFIG, NOW).recordStreakDays).toBe(1);
    // gap 3 : écarts de 2 < 3 → tout consécutif → record 3 (le ⚙️ AGIT).
    expect(
      computeRegularityStats(attempts, withConfig({ streakBreakGapDays: 3 }), NOW).recordStreakDays,
    ).toBe(3);
  });
});

// ============================================================================
// « Aujourd'hui » + fuseau ⚙️ (jour calendaire local, pas UTC)
// ============================================================================
describe("computeRegularityStats — aujourd'hui + fuseau", () => {
  it("today = null si la dernière réponse date d'hier (pas de jeu aujourd'hui)", () => {
    expect(computeRegularityStats([attempt(daysAgo(1))], CONFIG, NOW).today).toBeNull();
  });

  it("today = l'activité du jour de `now` quand l'enfant a joué aujourd'hui", () => {
    const today = computeRegularityStats([attempt(NOW)], CONFIG, NOW).today;
    expect(today).not.toBeNull();
    expect(today?.dayOrdinal).toBe(
      computeRegularityStats([attempt(NOW)], CONFIG, NOW).days[0]?.dayOrdinal,
    );
  });

  it("le FUSEAU (⚙️ dayTimeZone) DÉFINIT le jour calendaire et AGIT sur le compte de jours", () => {
    // A = 23:30 UTC 20/07 → 01:30 Paris 21/07 (jour suivant) ; B = 21:00 UTC 20/07 → 23:00 Paris 20/07.
    const attempts = [
      attempt(Date.UTC(2026, 6, 20, 23, 30)),
      attempt(Date.UTC(2026, 6, 20, 21, 0)),
    ];
    // Europe/Paris : A et B tombent des jours DIFFÉRENTS (20 vs 21) → 2 jours.
    expect(computeRegularityStats(attempts, CONFIG, NOW).daysPlayed).toBe(2);
    // UTC : A et B tombent le MÊME jour (20) → 1 jour. Rougit si le fuseau est figé/ignoré.
    expect(
      computeRegularityStats(attempts, withConfig({ dayTimeZone: "UTC" }), NOW).daysPlayed,
    ).toBe(1);
  });
});
