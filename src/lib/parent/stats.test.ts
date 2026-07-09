import { describe, expect, it } from "vitest";
import {
  loadEngineConfig,
  loadReportingConfig,
  type ReportingConfig,
} from "@/config/server-config";
import { makeFact } from "@/lib/engine/facts";
import type { ScopeEntry } from "@/lib/engine/level";
import type { MasteryState } from "@/lib/engine/mastery";
import type { Skill } from "@/lib/engine/domain";
import {
  compareReview,
  computeAccuracyStats,
  computeMasteryMap,
  computeReviewList,
  computeSpeedStats,
  computeTrend,
  type AttemptRecord,
  type ReviewItem,
  type StatsConfig,
} from "./stats";

/**
 * Agrégats **read-only** de l'espace parent (story 7.2, PLAN §Espace parent :79-84, ADR 0012).
 * Chaque agrégat est une fonction **pure** testée sur fixtures `attempts`/`mastery`. Bornes, tris,
 * fenêtres et seuils sont **mutation-prouvés par test NOMMÉ** (#143/#173). La **fidélité au modèle**
 * (maîtrise `box ≥ 4`, justesse = correction pas vitesse, jamais-vus non maîtrisés) est vérifiée
 * explicitement, pas seulement la mécanique.
 */

const ENGINE = loadEngineConfig({});
const REPORTING = loadReportingConfig({});
const CONFIG: StatsConfig = { engine: ENGINE, reporting: REPORTING };

/** Config avec seuils de reporting surchargés (prouve que les ⚙️ AGISSENT). */
function withReporting(overrides: Partial<ReportingConfig>): StatsConfig {
  return { engine: ENGINE, reporting: { ...REPORTING, ...overrides } };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0); // epoch ms injecté, déterministe
/** Instant à `days` jours avant NOW (les décimales évitent les bords exacts de fenêtre). */
const daysAgo = (days: number): number => NOW - Math.round(days * DAY);

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    skill: "mult",
    correct: true,
    responseMs: 1000,
    isRetry: false,
    createdAt: NOW,
    ...overrides,
  };
}

function masteryState(overrides: Partial<MasteryState> = {}): MasteryState {
  return {
    box: 3,
    correctCount: 0,
    wrongCount: 0,
    avgResponseMs: 0,
    lastSeen: null,
    nextDue: null,
    ...overrides,
  };
}

function scopeEntry(skill: Skill, a: number, b: number, state: MasteryState | null): ScopeEntry {
  return { fact: makeFact(skill, a, b), state };
}

function reviewItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    factKey: "mult_6x8",
    skill: "mult",
    box: 1,
    wrongCount: 0,
    avgResponseMs: 1000,
    reason: "wrong",
    ...overrides,
  };
}

// ============================================================================
// computeTrend — polarité, zone morte (seuil), données insuffisantes
// ============================================================================
describe("computeTrend", () => {
  it("current null → stable, delta null (fenêtre courante sans donnée)", () => {
    expect(computeTrend(null, 0.5, 0.05, false)).toEqual({
      current: null,
      previous: 0.5,
      delta: null,
      direction: "stable",
    });
  });

  it("previous null → stable, delta null (fenêtre précédente sans donnée)", () => {
    // current non-null, previous null → couvre le 2ᵉ opérande du `|| null`.
    expect(computeTrend(0.8, null, 0.05, false)).toEqual({
      current: 0.8,
      previous: null,
      delta: null,
      direction: "stable",
    });
  });

  it("justesse (haut = mieux) : hausse nette = amélioration", () => {
    const t = computeTrend(1.0, 0.5, 0.05, false);
    expect(t.direction).toBe("improving");
    expect(t.delta).toBeCloseTo(0.5);
  });

  it("justesse (haut = mieux) : baisse nette = régression", () => {
    expect(computeTrend(0.4, 0.9, 0.05, false).direction).toBe("regressing");
  });

  it("rapidité (bas = mieux) : accélérer = amélioration (polarité inversée)", () => {
    // current plus RAPIDE (1000 < 1500) → amélioration MALGRÉ delta négatif.
    // Si la polarité était inversée (haut = mieux), ce serait une régression.
    expect(computeTrend(1000, 1500, 300, true).direction).toBe("improving");
  });

  it("rapidité (bas = mieux) : ralentir = régression", () => {
    expect(computeTrend(2000, 1500, 300, true).direction).toBe("regressing");
  });

  it("écart STRICTEMENT égal au seuil (amélioration) = stable (borne stricte >)", () => {
    // Intégral (ms) → arithmétique exacte. improvement = -(1200-1500) = 300, non > 300 → stable.
    // Muter `>` en `>=` rougirait ce test.
    expect(computeTrend(1200, 1500, 300, true).direction).toBe("stable");
    // Un ms de plus franchit la zone morte → amélioration (le seuil AGIT).
    expect(computeTrend(1199, 1500, 300, true).direction).toBe("improving");
  });

  it("écart STRICTEMENT égal au seuil (régression) = stable (borne stricte <)", () => {
    // improvement = -(1800-1500) = -300, non < -300 → stable. Muter `<` en `<=` rougirait.
    expect(computeTrend(1800, 1500, 300, true).direction).toBe("stable");
    expect(computeTrend(1801, 1500, 300, true).direction).toBe("regressing");
  });

  it("le SEUIL contrôle la direction (même valeurs, seuil différent)", () => {
    // improvement = -(1300 − 1500) = 200. Seuil 300 → zone morte = stable ; seuil 100 → amélioration.
    expect(computeTrend(1300, 1500, 300, true).direction).toBe("stable");
    expect(computeTrend(1300, 1500, 100, true).direction).toBe("improving");
  });
});

// ============================================================================
// computeAccuracyStats — justesse = correction (pas vitesse), re-essais exclus
// ============================================================================
describe("computeAccuracyStats", () => {
  it("global = 1ʳᵉˢ réponses justes / total ; les re-essais sont EXCLUS (ENGINE §9)", () => {
    const attempts = [
      attempt({ correct: true }),
      attempt({ correct: true }),
      attempt({ correct: false }),
      // Re-essai JUSTE : s'il était compté, la justesse passerait de 2/3 à 3/4.
      attempt({ correct: true, isRetry: true }),
    ];
    expect(computeAccuracyStats(attempts, CONFIG, NOW).overall).toBeCloseTo(2 / 3);
  });

  it("par compétence (comp10/add/sub/mult), null si la compétence n'a aucune 1ʳᵉ réponse", () => {
    const attempts = [
      attempt({ skill: "mult", correct: true }),
      attempt({ skill: "mult", correct: false }),
      attempt({ skill: "add", correct: true }),
      attempt({ skill: "add", correct: true }),
    ];
    const { bySkill } = computeAccuracyStats(attempts, CONFIG, NOW);
    expect(bySkill.mult).toBeCloseTo(0.5);
    expect(bySkill.add).toBeCloseTo(1);
    expect(bySkill.comp10).toBeNull();
    expect(bySkill.sub).toBeNull();
  });

  it("aucune 1ʳᵉ réponse → overall/bySkill null, tendance stable", () => {
    const stats = computeAccuracyStats([], CONFIG, NOW);
    expect(stats.overall).toBeNull();
    expect(stats.bySkill.mult).toBeNull();
    expect(stats.trend).toEqual({
      current: null,
      previous: null,
      delta: null,
      direction: "stable",
    });
  });

  it("tendance : fenêtre courante vs précédente (semaine glissante) — amélioration", () => {
    const attempts = [
      // Fenêtre courante (0-7 j) : 2 justes → 1.0.
      attempt({ createdAt: daysAgo(1), correct: true }),
      attempt({ createdAt: daysAgo(2), correct: true }),
      // Fenêtre précédente (7-14 j) : 1 juste + 1 faux → 0.5.
      attempt({ createdAt: daysAgo(8), correct: true }),
      attempt({ createdAt: daysAgo(9), correct: false }),
      // Hors des deux fenêtres (> 14 j) : ignoré par la tendance, compté dans overall.
      attempt({ createdAt: daysAgo(30), correct: false }),
    ];
    const { trend } = computeAccuracyStats(attempts, CONFIG, NOW);
    expect(trend.current).toBeCloseTo(1);
    expect(trend.previous).toBeCloseTo(0.5);
    expect(trend.direction).toBe("improving");
  });

  it("la FENÊTRE de tendance (⚙️ semaine glissante) AGIT sur le résultat", () => {
    const attempts = [
      attempt({ createdAt: daysAgo(3), correct: true }),
      attempt({ createdAt: daysAgo(10), correct: false }),
    ];
    // Fenêtre 7 j : courant {3j juste}=1.0, précédent {10j faux}=0.0 → amélioration.
    expect(computeAccuracyStats(attempts, CONFIG, NOW).trend.direction).toBe("improving");
    // Fenêtre 12 j : courant {3j,10j}=0.5, précédent {}=null → indécidable = stable.
    const wide = withReporting({ trendWindowDays: 12 });
    expect(computeAccuracyStats(attempts, wide, NOW).trend.direction).toBe("stable");
  });
});

// ============================================================================
// computeSpeedStats — temps moyen, polarité (baisser = mieux), re-essais exclus
// ============================================================================
describe("computeSpeedStats", () => {
  it("global = temps moyen des 1ʳᵉˢ réponses (re-essais exclus, arrondi)", () => {
    const attempts = [
      attempt({ responseMs: 1000 }),
      attempt({ responseMs: 2000 }),
      // Re-essai lent : s'il était compté, la moyenne grimperait.
      attempt({ responseMs: 9000, isRetry: true }),
    ];
    expect(computeSpeedStats(attempts, CONFIG, NOW).overallMs).toBe(1500);
  });

  it("par compétence, null si aucune 1ʳᵉ réponse pour la compétence", () => {
    const attempts = [
      attempt({ skill: "mult", responseMs: 1000 }),
      attempt({ skill: "mult", responseMs: 3000 }),
      attempt({ skill: "sub", responseMs: 2000 }),
    ];
    const { bySkillMs } = computeSpeedStats(attempts, CONFIG, NOW);
    expect(bySkillMs.mult).toBe(2000);
    expect(bySkillMs.sub).toBe(2000);
    expect(bySkillMs.comp10).toBeNull();
    expect(bySkillMs.add).toBeNull();
  });

  it("aucune 1ʳᵉ réponse → overallMs null, tendance stable", () => {
    const stats = computeSpeedStats([], CONFIG, NOW);
    expect(stats.overallMs).toBeNull();
    expect(stats.bySkillMs.mult).toBeNull();
    expect(stats.trend.direction).toBe("stable");
  });

  it("tendance : accélérer entre les fenêtres = amélioration (polarité rapidité)", () => {
    const attempts = [
      // Courant (0-7 j) : moyenne 1000 (rapide).
      attempt({ createdAt: daysAgo(1), responseMs: 1000 }),
      attempt({ createdAt: daysAgo(2), responseMs: 1000 }),
      // Précédent (7-14 j) : moyenne 2000 (lent).
      attempt({ createdAt: daysAgo(8), responseMs: 2000 }),
      attempt({ createdAt: daysAgo(9), responseMs: 2000 }),
    ];
    const { trend } = computeSpeedStats(attempts, CONFIG, NOW);
    expect(trend.current).toBe(1000);
    expect(trend.previous).toBe(2000);
    // Plus rapide = amélioration : prouve que la polarité `lowerIsBetter` est câblée.
    expect(trend.direction).toBe("improving");
  });

  it("le SEUIL de tendance rapidité (⚙️ trendSpeedDeltaMs) AGIT", () => {
    const attempts = [
      attempt({ createdAt: daysAgo(1), responseMs: 1300 }),
      attempt({ createdAt: daysAgo(8), responseMs: 1500 }),
    ];
    // Écart 200 ms. Seuil défaut 300 → zone morte = stable.
    expect(computeSpeedStats(attempts, CONFIG, NOW).trend.direction).toBe("stable");
    // Seuil 100 → l'écart franchit la zone morte = amélioration.
    const tight = withReporting({ trendSpeedDeltaMs: 100 });
    expect(computeSpeedStats(attempts, tight, NOW).trend.direction).toBe("improving");
  });
});

// ============================================================================
// computeMasteryMap — maîtrise box≥4, jamais-vus NON maîtrisés, seuils ⚙️
// ============================================================================
describe("computeMasteryMap", () => {
  it("FIDÉLITÉ : jamais-vus comptés NON maîtrisés (dénominateur = univers complet)", () => {
    // 2 maîtrisés (box 5, box 4) + 1 faible (box 1) + 1 jamais vu (null) → 2/4 = 0.5.
    // Si le jamais-vu était exclu, ce serait 2/3 ≈ 0.667 (over-claim de maîtrise).
    const scope = [
      scopeEntry("mult", 6, 8, masteryState({ box: 5 })),
      scopeEntry("mult", 7, 8, masteryState({ box: 4 })),
      scopeEntry("mult", 2, 3, masteryState({ box: 1 })),
      scopeEntry("mult", 3, 4, null),
    ];
    const mult = computeMasteryMap(scope, CONFIG).mult;
    expect(mult.masteredCount).toBe(2);
    expect(mult.totalCount).toBe(4);
    expect(mult.ratio).toBeCloseTo(0.5);
  });

  it("FIDÉLITÉ : maîtrisé = box ≥ 4 exactement (box 3 non maîtrisé)", () => {
    const scope = [
      scopeEntry("mult", 6, 8, masteryState({ box: 4 })),
      scopeEntry("mult", 7, 8, masteryState({ box: 3 })),
    ];
    // Muter le seuil `box ≥ 4` (ex. ≥ 3) ferait passer masteredCount de 1 à 2.
    expect(computeMasteryMap(scope, CONFIG).mult.masteredCount).toBe(1);
  });

  it("classe maîtrisé / en cours / faible par seuils (⚙️ 0.85 / 0.4)", () => {
    // Clés distinctes par compétence. mult 9/10=0.9 → maîtrisé ; add 5/10=0.5 → en cours ;
    // sub 1/10=0.1 → faible ; comp10 absent (0/0) → faible.
    const scope: ScopeEntry[] = [];
    for (let k = 1; k <= 10; k++)
      scope.push(scopeEntry("mult", 1, k, masteryState({ box: k <= 9 ? 5 : 0 })));
    for (let k = 1; k <= 10; k++)
      scope.push(scopeEntry("add", 1, k, masteryState({ box: k <= 5 ? 5 : 0 })));
    for (let k = 1; k <= 10; k++)
      scope.push(scopeEntry("sub", 10, k, masteryState({ box: k <= 1 ? 5 : 0 })));
    const map = computeMasteryMap(scope, CONFIG);
    expect(map.mult.level).toBe("mastered");
    expect(map.add.level).toBe("in-progress");
    expect(map.sub.level).toBe("weak");
    expect(map.comp10.level).toBe("weak");
  });

  it("les SEUILS de classement (⚙️) AGISSENT sur le niveau", () => {
    // Ratio mult = 0.5 (1 maîtrisé / 2).
    const scope = [
      scopeEntry("mult", 6, 8, masteryState({ box: 5 })),
      scopeEntry("mult", 7, 8, masteryState({ box: 0 })),
    ];
    // Défaut (0.85 / 0.4) : 0.5 → en cours.
    expect(computeMasteryMap(scope, CONFIG).mult.level).toBe("in-progress");
    // Abaisser masteredMinRatio à 0.4 : 0.5 → maîtrisé.
    expect(computeMasteryMap(scope, withReporting({ masteredMinRatio: 0.4 })).mult.level).toBe(
      "mastered",
    );
    // Relever inProgressMinRatio à 0.6 : 0.5 → faible.
    expect(computeMasteryMap(scope, withReporting({ inProgressMinRatio: 0.6 })).mult.level).toBe(
      "weak",
    );
  });
});

// ============================================================================
// compareReview — chaque clé de tri mutation-prouvée par test NOMMÉ
// ============================================================================
describe("compareReview", () => {
  it("trie par boîte CROISSANTE (le plus faible en tête)", () => {
    expect(compareReview(reviewItem({ box: 1 }), reviewItem({ box: 3 }))).toBeLessThan(0);
    expect(compareReview(reviewItem({ box: 3 }), reviewItem({ box: 1 }))).toBeGreaterThan(0);
  });

  it("à boîte égale, plus d'ERREURS d'abord (décroissant)", () => {
    const a = reviewItem({ box: 2, wrongCount: 5 });
    const b = reviewItem({ box: 2, wrongCount: 1 });
    expect(compareReview(a, b)).toBeLessThan(0);
    expect(compareReview(b, a)).toBeGreaterThan(0);
  });

  it("à boîte et erreurs égales, plus LENT d'abord (décroissant)", () => {
    const a = reviewItem({ box: 2, wrongCount: 1, avgResponseMs: 5000 });
    const b = reviewItem({ box: 2, wrongCount: 1, avgResponseMs: 1000 });
    expect(compareReview(a, b)).toBeLessThan(0);
    expect(compareReview(b, a)).toBeGreaterThan(0);
  });

  it("départage DÉTERMINISTE par clé de fait (ordre total)", () => {
    const base = { box: 2, wrongCount: 1, avgResponseMs: 1000 };
    const a = reviewItem({ ...base, factKey: "mult_2x3" });
    const b = reviewItem({ ...base, factKey: "mult_6x8" });
    expect(compareReview(a, b)).toBeLessThan(0);
    expect(compareReview(b, a)).toBeGreaterThan(0);
  });
});

// ============================================================================
// computeReviewList — filtres (vu/non maîtrisé/problématique), raison, borne ⚙️
// ============================================================================
describe("computeReviewList", () => {
  it("n'inclut QUE les faits ratés ou lents (un fait en cours sain est exclu)", () => {
    const scope = [
      // Raté (mult, seuil fluence 4000 → pas lent) → inclus, raison "wrong".
      scopeEntry("mult", 6, 8, masteryState({ box: 1, wrongCount: 3, avgResponseMs: 1000 })),
      // En cours mais ni raté ni lent (rapide, 0 erreur) → EXCLU.
      scopeEntry("add", 3, 8, masteryState({ box: 2, wrongCount: 0, avgResponseMs: 500 })),
    ];
    const list = computeReviewList(scope, CONFIG);
    expect(list.map((i) => i.factKey)).toEqual(["mult_6x8"]);
  });

  it("exclut les faits MAÎTRISÉS (box ≥ 4) même ratés/lents", () => {
    const scope = [
      scopeEntry("mult", 6, 8, masteryState({ box: 5, wrongCount: 9, avgResponseMs: 9000 })),
      scopeEntry("mult", 2, 3, masteryState({ box: 1, wrongCount: 1, avgResponseMs: 1000 })),
    ];
    expect(computeReviewList(scope, CONFIG).map((i) => i.factKey)).toEqual(["mult_2x3"]);
  });

  it("exclut les faits JAMAIS VUS (state null)", () => {
    const scope = [
      scopeEntry("sub", 12, 5, null),
      scopeEntry("mult", 2, 3, masteryState({ box: 1, wrongCount: 1, avgResponseMs: 1000 })),
    ];
    expect(computeReviewList(scope, CONFIG).map((i) => i.factKey)).toEqual(["mult_2x3"]);
  });

  it("raison : raté (wrong) / lent (slow) / les deux (wrong-and-slow)", () => {
    const scope = [
      // Raté seul (mult rapide < 4000).
      scopeEntry("mult", 6, 8, masteryState({ box: 3, wrongCount: 2, avgResponseMs: 1000 })),
      // Lent seul (mult > 4000, 0 erreur).
      scopeEntry("mult", 7, 8, masteryState({ box: 3, wrongCount: 0, avgResponseMs: 5000 })),
      // Les deux (comp10 seuil 3000, lent + raté).
      scopeEntry("comp10", 4, 0, masteryState({ box: 3, wrongCount: 2, avgResponseMs: 5000 })),
    ];
    const byKey = Object.fromEntries(
      computeReviewList(scope, CONFIG).map((i) => [i.factKey, i.reason]),
    );
    expect(byKey["mult_6x8"]).toBe("wrong");
    expect(byKey["mult_7x8"]).toBe("slow");
    expect(byKey["comp10_4"]).toBe("wrong-and-slow");
  });

  it("« lent » utilise le seuil de fluence du MOTEUR par compétence (ENGINE §2)", () => {
    // avgResponseMs 3500 : LENT pour comp10 (seuil 3000) mais RAPIDE pour mult (seuil 4000).
    const scope = [
      scopeEntry("comp10", 4, 0, masteryState({ box: 2, wrongCount: 0, avgResponseMs: 3500 })),
      scopeEntry("mult", 6, 8, masteryState({ box: 2, wrongCount: 0, avgResponseMs: 3500 })),
    ];
    // Seul le comp10 dépasse SON seuil → seul lui est « à revoir ».
    expect(computeReviewList(scope, CONFIG).map((i) => i.factKey)).toEqual(["comp10_4"]);
  });

  it("trie par priorité (boîte ↑, erreurs ↓, lenteur ↓) — cf. compareReview", () => {
    const scope = [
      scopeEntry("mult", 2, 3, masteryState({ box: 2, wrongCount: 1, avgResponseMs: 1000 })),
      scopeEntry("comp10", 4, 0, masteryState({ box: 0, wrongCount: 1, avgResponseMs: 1000 })),
      scopeEntry("mult", 6, 8, masteryState({ box: 1, wrongCount: 1, avgResponseMs: 1000 })),
    ];
    // Attendu par boîte croissante : comp10_4 (0) < mult_6x8 (1) < mult_2x3 (2).
    expect(computeReviewList(scope, CONFIG).map((i) => i.factKey)).toEqual([
      "comp10_4",
      "mult_6x8",
      "mult_2x3",
    ]);
  });

  it("BORNE la liste à reviewListSize (⚙️) en gardant les plus prioritaires", () => {
    // 6 faits faibles ratés, boîtes 0..5 → priorité = boîte croissante.
    const scope = [
      scopeEntry("mult", 1, 2, masteryState({ box: 0, wrongCount: 1 })),
      scopeEntry("mult", 1, 3, masteryState({ box: 1, wrongCount: 1 })),
      scopeEntry("mult", 1, 4, masteryState({ box: 2, wrongCount: 1 })),
      scopeEntry("mult", 1, 5, masteryState({ box: 3, wrongCount: 1 })),
      scopeEntry("comp10", 4, 0, masteryState({ box: 3, wrongCount: 1 })),
      // Le moins prioritaire (boîte la plus haute non maîtrisée) = doit être coupé à N=5.
      scopeEntry("mult", 1, 6, masteryState({ box: 3, wrongCount: 1, avgResponseMs: 0 })),
    ];
    const list = computeReviewList(scope, CONFIG);
    expect(list).toHaveLength(REPORTING.reviewListSize); // 5
    // ⚙️ AGIT : abaisser la borne à 2 tronque à 2.
    expect(computeReviewList(scope, withReporting({ reviewListSize: 2 }))).toHaveLength(2);
  });
});
