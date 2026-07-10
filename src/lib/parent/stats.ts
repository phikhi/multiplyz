/**
 * Agrégats **statistiques de l'espace parent** — cœur read-only (PLAN §Espace parent :79-84,
 * PRODUCT §1.4, story 7.2, ADR 0012). Transforme la **matière première** du moteur (`attempts` +
 * `mastery`, PLAN :77/:113) en indicateurs qu'un parent lit : **justesse**, **rapidité/fluence**,
 * **carte de maîtrise**, **à revoir**. Chaque agrégat est une **fonction pure et déterministe** :
 * - aucune I/O, aucune UI, aucun accès DB — l'appelant serveur (`stats-source.ts`) charge les
 *   données (lecture seule) et passe des tableaux + config ;
 * - **horloge injectée** (`now`, epoch ms) — jamais de `Date.now()` interne (comme le moteur) ;
 * - toutes les fenêtres/seuils/sémantiques proviennent de la config ⚙️ (`EngineConfig` réutilisé +
 *   `ReportingConfig`, ADR 0012) — aucune constante magique en dur.
 *
 * **Fidélité au modèle ENGINE (le point de vigilance, ADR 0012)** — ce module *rapporte* le
 * moteur, il ne le *réinvente* pas :
 * - **Maîtrise = `box ≥ 4`** : la carte de maîtrise réutilise `isFactMastered` / `skillMasteryRatio`
 *   (ENGINE §2) tels quels — jamais un second barème.
 * - **Justesse = la correction, PAS la vitesse** (PRODUCT §5 :138, ENGINE §5) : la justesse compte
 *   les **1ʳᵉˢ réponses** (`isRetry = false`) — les re-essais sont « pratique **non comptée** »
 *   (ENGINE §9), exactement comme la maîtrise. Un re-essai n'entre ni dans la justesse ni dans la
 *   rapidité (parité avec `mastery.avgResponseMs`, calculé sur les seules 1ʳᵉˢ réponses).
 * - **« Lent » = seuil de fluence du moteur** (`EngineConfig.fluenceThresholdsMs[skill]`, ENGINE §2)
 *   — jamais un seuil de lenteur inventé.
 *
 * Ces agrégats sont **read-only** : ce module ne touche **jamais** la DB (le pont DB read-only vit
 * dans `stats-source.ts`). Il ne consomme que des structures de données pures.
 */

import type { EngineConfig, RegularityConfig, ReportingConfig } from "../../config/server-config";
import { SKILLS, type Skill } from "../engine/domain";
import type { ScopeEntry } from "../engine/level";
import type { RegularityStats } from "./regularity";
import {
  INITIAL_BOX,
  isFactMastered,
  skillMasteryRatio,
  type MasteryState,
} from "../engine/mastery";

/** Millisecondes par jour (la fenêtre de tendance ⚙️ est exprimée en jours). */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Une réponse journalisée, **miroir pur** des colonnes utiles de `attempts` (PLAN §data, ENGINE
 * §10). Alimente justesse + rapidité. `createdAt` est un **instant epoch ms** (la couche de lecture
 * convertit le `Date` de la colonne) — cohérent avec l'horloge injectée du moteur.
 */
export interface AttemptRecord {
  /** Compétence du fait répondu (indexe le seuil de fluence). */
  readonly skill: Skill;
  /** Réponse juste ? (« je ne sais pas » = `false`, ENGINE §9). */
  readonly correct: boolean;
  /** Temps de réponse (ms) — matière de la rapidité. */
  readonly responseMs: number;
  /** Re-essai (pratique **non comptée**, ENGINE §9) → exclu de justesse/rapidité. */
  readonly isRetry: boolean;
  /** Instant de la réponse (epoch ms) — base des fenêtres de tendance. */
  readonly createdAt: number;
}

/**
 * Config combinée des agrégats de l'espace parent : le moteur (`EngineConfig`, réutilisé pour
 * maîtrise/fluence) + le reporting justesse/rapidité/maîtrise/à-revoir (`ReportingConfig`, ADR 0012)
 * + la régularité (`RegularityConfig`, ADR 0014 : fuseau du jour, temps/jour, série, respect 15-20
 * min). Bundle passé aux fonctions pures pour rester une **source unique** sans multiplier les
 * paramètres.
 */
export interface StatsConfig {
  readonly engine: EngineConfig;
  readonly reporting: ReportingConfig;
  readonly regularity: RegularityConfig;
}

/** Sens d'une tendance, **interprété au regard du bien-fondé** de l'indicateur (ADR 0012). */
export type TrendDirection = "improving" | "stable" | "regressing";

/**
 * Tendance d'un indicateur entre la **fenêtre courante** et la **précédente** (semaine glissante
 * ⚙️). `current`/`previous` = valeur de l'indicateur dans chaque fenêtre (`null` si la fenêtre n'a
 * aucune donnée → tendance **indécidable** = `stable`). `delta` = `current − previous` (brut,
 * `null` si indécidable). `direction` applique la **zone morte** (seuil ⚙️) et la **polarité** de
 * l'indicateur (justesse : haut = mieux ; rapidité : bas = mieux).
 */
export interface Trend {
  readonly current: number | null;
  readonly previous: number | null;
  readonly delta: number | null;
  readonly direction: TrendDirection;
}

/**
 * **Justesse** (PLAN §Espace parent) : % de 1ʳᵉˢ réponses justes, global + par compétence, +
 * tendance hebdo. `null` = aucune 1ʳᵉ réponse comptée (rien à afficher, pas `0 %` trompeur).
 */
export interface AccuracyStats {
  /** Justesse globale `[0,1]`, ou `null` si aucune 1ʳᵉ réponse. */
  readonly overall: number | null;
  /** Justesse par compétence `[0,1]` (ou `null` si la compétence n'a aucune 1ʳᵉ réponse). */
  readonly bySkill: Record<Skill, number | null>;
  /** Tendance de la justesse (haut = amélioration). */
  readonly trend: Trend;
}

/**
 * **Rapidité / fluence** (PLAN §Espace parent) : temps de réponse moyen (ms) des 1ʳᵉˢ réponses,
 * global + par compétence, + tendance. `null` = aucune 1ʳᵉ réponse. Repère l'automatisation.
 */
export interface SpeedStats {
  /** Temps de réponse moyen global (ms, arrondi), ou `null` si aucune 1ʳᵉ réponse. */
  readonly overallMs: number | null;
  /** Temps moyen par compétence (ms), ou `null` si aucune 1ʳᵉ réponse pour la compétence. */
  readonly bySkillMs: Record<Skill, number | null>;
  /** Tendance de la rapidité (**baisser = s'améliorer**, automatisation). */
  readonly trend: Trend;
}

/** Niveau de maîtrise d'une compétence pour la carte parent (heatmap PLAN §Espace parent). */
export type MasteryLevel = "mastered" | "in-progress" | "weak";

/**
 * Maîtrise d'**une** compétence (carte de maîtrise). `ratio` = `skillMasteryRatio` sur **tous** les
 * faits Tier 1 de la compétence (jamais-vus comptés **non maîtrisés**, comme les gates ENGINE
 * §2/§7/§8) → `masteredCount / totalCount`. `level` = classement par les seuils ⚙️ (ADR 0012).
 */
export interface SkillMastery {
  readonly skill: Skill;
  /** Proportion de faits maîtrisés `[0,1]` (`box ≥ 4`, ENGINE §2). */
  readonly ratio: number;
  /** Classement maîtrisé / en cours / faible. */
  readonly level: MasteryLevel;
  /** Nombre de faits maîtrisés (`box ≥ 4`). */
  readonly masteredCount: number;
  /** Nombre total de faits Tier 1 de la compétence (jamais-vus inclus). */
  readonly totalCount: number;
}

/** Carte de maîtrise : une entrée par compétence (ENGINE §1). */
export type MasteryMap = Record<Skill, SkillMastery>;

/** Pourquoi un calcul est « à revoir » : raté, lent, ou les deux. */
export type ReviewReason = "wrong" | "slow" | "wrong-and-slow";

/**
 * Un calcul **à revoir** (PLAN §Espace parent « top des calculs ratés/lents → quoi réviser en
 * priorité »). Seuls des faits **déjà vus**, **non maîtrisés** et **problématiques** (ratés et/ou
 * lents) y figurent — la liste est triée par priorité de remédiation puis bornée (⚙️).
 */
export interface ReviewItem {
  /** Clé stable du fait (ex. `mult_6x8`). */
  readonly factKey: string;
  /** Compétence du fait. */
  readonly skill: Skill;
  /** Boîte Leitner courante (0..maxBox) — plus bas = plus faible. */
  readonly box: number;
  /** Nombre de 1ʳᵉˢ réponses fausses cumulées. */
  readonly wrongCount: number;
  /** Temps de réponse moyen (ms) — au-delà du seuil de fluence = « lent ». */
  readonly avgResponseMs: number;
  /** Nature du problème (raté / lent / les deux). */
  readonly reason: ReviewReason;
}

/** L'ensemble des agrégats de l'espace parent pour un profil. */
export interface ParentStats {
  readonly accuracy: AccuracyStats;
  readonly speed: SpeedStats;
  readonly masteryMap: MasteryMap;
  readonly reviewList: readonly ReviewItem[];
  readonly regularity: RegularityStats;
}

/** Justesse d'un lot de réponses : `justes / total`, ou `null` si le lot est vide. */
function accuracyOf(records: readonly AttemptRecord[]): number | null {
  if (records.length === 0) {
    return null;
  }
  const correct = records.filter((r) => r.correct).length;
  return correct / records.length;
}

/** Temps de réponse moyen (ms, arrondi entier) d'un lot, ou `null` si le lot est vide. */
function meanResponseMsOf(records: readonly AttemptRecord[]): number | null {
  if (records.length === 0) {
    return null;
  }
  const total = records.reduce((sum, r) => sum + r.responseMs, 0);
  return Math.round(total / records.length);
}

/**
 * `true` si `createdAt` tombe dans la fenêtre glissante d'ordre `stepsBack` : `stepsBack = 0` =
 * fenêtre **courante** `(now − windowMs, now]`, `stepsBack = 1` = fenêtre **précédente**
 * `(now − 2·windowMs, now − windowMs]`. Borne basse **exclusive**, borne haute **inclusive** →
 * partition sans chevauchement des deux fenêtres consécutives.
 */
function inWindow(createdAt: number, now: number, windowMs: number, stepsBack: number): boolean {
  const end = now - stepsBack * windowMs;
  const start = end - windowMs;
  return createdAt > start && createdAt <= end;
}

/**
 * Calcule une **tendance** entre deux valeurs de fenêtre (semaine glissante ⚙️). Fenêtre sans
 * donnée (`current`/`previous === null`) → tendance **indécidable** = `stable` (jamais une
 * amélioration/régression inventée). Sinon : `delta = current − previous` ; l'**amélioration**
 * dépend de la **polarité** (`lowerIsBetter` : rapidité → baisser = mieux ; justesse → monter =
 * mieux) ; la **zone morte** `[−threshold, threshold]` (seuil ⚙️) reste `stable` pour ne pas
 * sur-interpréter le bruit.
 */
export function computeTrend(
  current: number | null,
  previous: number | null,
  threshold: number,
  lowerIsBetter: boolean,
): Trend {
  if (current === null || previous === null) {
    return { current, previous, delta: null, direction: "stable" };
  }
  const delta = current - previous;
  const improvement = lowerIsBetter ? -delta : delta;
  let direction: TrendDirection = "stable";
  if (improvement > threshold) {
    direction = "improving";
  } else if (improvement < -threshold) {
    direction = "regressing";
  }
  return { current, previous, delta, direction };
}

/**
 * **Tendance hebdo** d'un indicateur agrégé sur une fenêtre glissante. Partitionne `records` en
 * fenêtre **courante** vs **précédente** (`trendWindowDays` ⚙️, UN SEUL call-site du paramètre —
 * partagé par justesse ET rapidité pour qu'un unique test de fenêtre prouve les deux câblages,
 * #206), applique `metric` à chaque fenêtre, puis `computeTrend` (seuil + polarité de l'indicateur).
 */
function windowTrend(
  records: readonly AttemptRecord[],
  now: number,
  reporting: ReportingConfig,
  metric: (window: readonly AttemptRecord[]) => number | null,
  threshold: number,
  lowerIsBetter: boolean,
): Trend {
  const windowMs = reporting.trendWindowDays * MS_PER_DAY;
  const current = metric(records.filter((r) => inWindow(r.createdAt, now, windowMs, 0)));
  const previous = metric(records.filter((r) => inWindow(r.createdAt, now, windowMs, 1)));
  return computeTrend(current, previous, threshold, lowerIsBetter);
}

/**
 * **Justesse** (global + par compétence + tendance hebdo). Ne compte que les **1ʳᵉˢ réponses**
 * (`isRetry = false`, ENGINE §9) — la justesse est la **correction**, pas la vitesse (PRODUCT §5).
 */
export function computeAccuracyStats(
  attempts: readonly AttemptRecord[],
  config: StatsConfig,
  now: number,
): AccuracyStats {
  const graded = attempts.filter((a) => !a.isRetry);
  const bySkill = {} as Record<Skill, number | null>;
  for (const skill of SKILLS) {
    bySkill[skill] = accuracyOf(graded.filter((a) => a.skill === skill));
  }
  return {
    overall: accuracyOf(graded),
    bySkill,
    // Justesse : haut = mieux → `lowerIsBetter = false`, zone morte `trendAccuracyDelta`.
    trend: windowTrend(
      graded,
      now,
      config.reporting,
      accuracyOf,
      config.reporting.trendAccuracyDelta,
      false,
    ),
  };
}

/**
 * **Rapidité / fluence** (temps moyen global + par compétence + tendance). Même population que la
 * justesse et que `mastery.avgResponseMs` : **1ʳᵉˢ réponses seules** (`isRetry = false`). La
 * tendance est à **polarité inversée** (baisser = s'améliorer, automatisation ENGINE §2).
 */
export function computeSpeedStats(
  attempts: readonly AttemptRecord[],
  config: StatsConfig,
  now: number,
): SpeedStats {
  const graded = attempts.filter((a) => !a.isRetry);
  const bySkillMs = {} as Record<Skill, number | null>;
  for (const skill of SKILLS) {
    bySkillMs[skill] = meanResponseMsOf(graded.filter((a) => a.skill === skill));
  }
  return {
    overallMs: meanResponseMsOf(graded),
    bySkillMs,
    // Rapidité : baisser = mieux → `lowerIsBetter = true`, zone morte `trendSpeedDeltaMs`.
    trend: windowTrend(
      graded,
      now,
      config.reporting,
      meanResponseMsOf,
      config.reporting.trendSpeedDeltaMs,
      true,
    ),
  };
}

/**
 * État « jamais vu » (NEW) posé au dénominateur de la maîtrise : boîte de départ (`INITIAL_BOX`,
 * ENGINE §2) → **jamais maîtrisé** (`box < 4`). Réutilise la constante du moteur — pas de second
 * barème. Compter les jamais-vus comme non maîtrisés reproduit **exactement** la définition de
 * maîtrise d'une compétence des gates ENGINE §2/§7/§8 (ratio sur tout l'univers Tier 1).
 */
const NEVER_SEEN_STATE: MasteryState = {
  box: INITIAL_BOX,
  correctCount: 0,
  wrongCount: 0,
  avgResponseMs: 0,
  lastSeen: null,
  nextDue: null,
};

/** Classe une compétence par son ratio de maîtrise (seuils ⚙️, ADR 0012). Maîtrisé testé d'abord. */
function classifyMastery(ratio: number, reporting: ReportingConfig): MasteryLevel {
  if (ratio >= reporting.masteredMinRatio) {
    return "mastered";
  }
  if (ratio >= reporting.inProgressMinRatio) {
    return "in-progress";
  }
  return "weak";
}

/**
 * **Carte de maîtrise** : par compétence, ratio de faits maîtrisés (`skillMasteryRatio`, ENGINE §2)
 * sur **tout** l'univers Tier 1 de la compétence (jamais-vus comptés non maîtrisés) + classement.
 * Réutilise les helpers du moteur — la maîtrise n'est jamais redéfinie ici (CLAUDE.md).
 */
export function computeMasteryMap(scope: readonly ScopeEntry[], config: StatsConfig): MasteryMap {
  const map = {} as Record<Skill, SkillMastery>;
  for (const skill of SKILLS) {
    const states = scope
      .filter((entry) => entry.fact.skill === skill)
      .map((entry) => entry.state ?? NEVER_SEEN_STATE);
    const ratio = skillMasteryRatio(states, config.engine);
    const masteredCount = states.filter((state) => isFactMastered(state, config.engine)).length;
    map[skill] = {
      skill,
      ratio,
      level: classifyMastery(ratio, config.reporting),
      masteredCount,
      totalCount: states.length,
    };
  }
  return map;
}

/** `true` si le temps moyen du fait dépasse le seuil de fluence de sa compétence (ENGINE §2). */
function isSlow(state: MasteryState, skill: Skill, engine: EngineConfig): boolean {
  return state.avgResponseMs > engine.fluenceThresholdsMs[skill];
}

/** Nature du problème d'un fait à revoir (au moins une des deux conditions est vraie ici). */
function reviewReason(wrong: boolean, slow: boolean): ReviewReason {
  if (wrong && slow) {
    return "wrong-and-slow";
  }
  return wrong ? "wrong" : "slow";
}

/**
 * Comparateur de priorité de remédiation de la liste « à revoir » (le plus prioritaire d'abord) :
 * 1. **boîte croissante** (le plus faible en tête) ;
 * 2. à boîte égale, **erreurs décroissantes** (le plus souvent raté) ;
 * 3. à erreurs égales, **lenteur décroissante** (`avgResponseMs`) ;
 * 4. départage **déterministe** par clé de fait (ordre total : les clés d'un `scope` sont uniques).
 */
export function compareReview(a: ReviewItem, b: ReviewItem): number {
  if (a.box !== b.box) {
    return a.box - b.box;
  }
  if (a.wrongCount !== b.wrongCount) {
    return b.wrongCount - a.wrongCount;
  }
  if (a.avgResponseMs !== b.avgResponseMs) {
    return b.avgResponseMs - a.avgResponseMs;
  }
  return a.factKey < b.factKey ? -1 : 1;
}

/**
 * **À revoir** : top des calculs **ratés/lents** à réviser en priorité (PLAN §Espace parent).
 * Candidats = faits **déjà vus** (`state !== null`), **non maîtrisés** (`box < 4`, ENGINE §2) et
 * **problématiques** — au moins **raté** (`wrongCount > 0`) ou **lent** (au-delà du seuil de
 * fluence, ENGINE §2). Triés par `compareReview`, puis **bornés** à `reviewListSize` (⚙️).
 */
export function computeReviewList(scope: readonly ScopeEntry[], config: StatsConfig): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const entry of scope) {
    const state = entry.state;
    if (state === null) {
      continue; // jamais vu → rien à revoir (cohérent avec la dette #64 : les neufs ne comptent pas)
    }
    if (isFactMastered(state, config.engine)) {
      continue; // maîtrisé (box ≥ 4) → n'a pas besoin d'être revu
    }
    const wrong = state.wrongCount > 0;
    const slow = isSlow(state, entry.fact.skill, config.engine);
    if (!wrong && !slow) {
      continue; // en cours mais ni raté ni lent → pas une priorité de révision
    }
    items.push({
      factKey: entry.fact.key,
      skill: entry.fact.skill,
      box: state.box,
      wrongCount: state.wrongCount,
      avgResponseMs: state.avgResponseMs,
      reason: reviewReason(wrong, slow),
    });
  }
  items.sort(compareReview);
  return items.slice(0, config.reporting.reviewListSize);
}
