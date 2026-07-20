import { describe, expect, it } from "vitest";
import { computeAccuracyDailySeries } from "./accuracy-daily";
import type { AttemptRecord } from "./stats";

/**
 * Série QUOTIDIENNE de justesse (issue #241, ADR 0018) — fonction **pure** testée sur fixtures
 * `attempts`. Fidélité au modèle vérifiée explicitement : **1ʳᵉˢ réponses seules** (ENGINE §9,
 * ADR 0012, même filtre que `computeAccuracyStats`) et **même découpage de jour calendaire** que
 * `regularity.ts` (fuseau ⚙️). Mutation-preuve : chaque garde est épinglée par un test qui ROUGIT
 * si la garde est retirée/mutée (CLAUDE.md #143), pas seulement exercée.
 */

const TZ = "Europe/Paris";
const DAY = 24 * 60 * 60 * 1000;
/** Instant déterministe : `Date.UTC(2026, 6, 20, 12)` = 14:00 Europe/Paris (été, DST-safe). */
const T0 = Date.UTC(2026, 6, 20, 12, 0, 0);
const daysAgo = (n: number): number => T0 - n * DAY;

function attempt(createdAt: number, overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    skill: "add",
    correct: true,
    responseMs: 1000,
    isRetry: false,
    createdAt,
    ...overrides,
  };
}

describe("computeAccuracyDailySeries — regroupement par jour + tri", () => {
  it("aucune réponse → série vide", () => {
    expect(computeAccuracyDailySeries([], TZ)).toEqual([]);
  });

  it("regroupe par jour calendaire DISTINCT (plusieurs réponses le même jour = 1 point)", () => {
    const series = computeAccuracyDailySeries(
      [
        attempt(Date.UTC(2026, 6, 20, 6, 0), { correct: true }),
        attempt(Date.UTC(2026, 6, 20, 16, 0), { correct: false }),
        attempt(daysAgo(1), { correct: true }),
      ],
      TZ,
    );
    expect(series).toHaveLength(2);
  });

  it("triée par ordinal CROISSANT (matière brute déterministe), peu importe l'ordre d'arrivée", () => {
    const series = computeAccuracyDailySeries(
      [attempt(daysAgo(2)), attempt(daysAgo(0)), attempt(daysAgo(1))],
      TZ,
    );
    const ordinals = series.map((p) => p.dayOrdinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(ordinals).toHaveLength(3);
  });
});

describe("computeAccuracyDailySeries — FIDÉLITÉ : 1ʳᵉˢ réponses seules (ADR 0012, ENGINE §9)", () => {
  it("MUTATION-PROUVÉ : un re-essai est EXCLU du ratio du jour — rougit si le filtre `isRetry` est retiré", () => {
    // 1 vraie réponse fausse + 1 re-essai JUSTE le même jour. Si le re-essai comptait, le jour
    // afficherait 50 % (1/2) au lieu de 0 % (0/1) — épingle précisément le filtre `!a.isRetry`.
    const series = computeAccuracyDailySeries(
      [
        attempt(T0, { correct: false, isRetry: false }),
        attempt(T0 + 60_000, { correct: true, isRetry: true }),
      ],
      TZ,
    );
    expect(series).toHaveLength(1);
    expect(series[0].accuracy).toBe(0);
  });

  it("un jour SANS AUCUNE 1ʳᵉ réponse (re-essais seuls) n'apparaît PAS dans la série", () => {
    // Re-essai seul un jour, 1ʳᵉ réponse un autre jour → SEUL le jour avec 1ʳᵉ réponse compte.
    const series = computeAccuracyDailySeries(
      [
        attempt(daysAgo(1), { isRetry: true, correct: false }),
        attempt(daysAgo(0), { isRetry: false, correct: true }),
      ],
      TZ,
    );
    expect(series).toHaveLength(1);
    expect(series[0].accuracy).toBe(1);
  });

  it("ratio EXACT : justes / total des 1ʳᵉˢ réponses du jour (re-essais mélangés ignorés)", () => {
    const series = computeAccuracyDailySeries(
      [
        attempt(T0, { correct: true }),
        attempt(T0 + 60_000, { correct: true }),
        attempt(T0 + 120_000, { correct: false }),
        attempt(T0 + 180_000, { correct: false }),
        // Re-essai juste au milieu — n'entre PAS dans le ratio (sinon 3/5 = 60 % au lieu de 2/4 = 50 %).
        attempt(T0 + 90_000, { correct: true, isRetry: true }),
      ],
      TZ,
    );
    expect(series).toHaveLength(1);
    expect(series[0].accuracy).toBeCloseTo(0.5);
  });
});

describe("computeAccuracyDailySeries — jour calendaire (même découpage que regularity.ts)", () => {
  it("bordure de fuseau : un instant proche de minuit UTC peut basculer de jour civil selon `timeZone`", () => {
    // 23:30 UTC 20/07 → 01:30 Europe/Paris 21/07 (jour civil SUIVANT). Un 2ᵉ point le 20/07 à
    // 21:00 UTC → 23:00 Paris (même jour civil que lui-même, distinct du 1er) → 2 jours en Paris.
    const parisSeries = computeAccuracyDailySeries(
      [attempt(Date.UTC(2026, 6, 20, 23, 30)), attempt(Date.UTC(2026, 6, 20, 21, 0))],
      "Europe/Paris",
    );
    expect(parisSeries).toHaveLength(2);

    // En UTC brut, les deux instants tombent le MÊME jour civil (20/07) → 1 seul point — rougit si
    // le fuseau ⚙️ n'est pas vraiment threadé jusqu'à `makeDayOrdinal`.
    const utcSeries = computeAccuracyDailySeries(
      [attempt(Date.UTC(2026, 6, 20, 23, 30)), attempt(Date.UTC(2026, 6, 20, 21, 0))],
      "UTC",
    );
    expect(utcSeries).toHaveLength(1);
  });
});
