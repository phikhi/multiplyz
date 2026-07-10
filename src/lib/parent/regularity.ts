/**
 * Agrégats de **régularité** de l'espace parent — cœur read-only (PLAN §Espace parent :83,
 * WIREFRAMES §7, story 7.4, ADR 0014). Transforme le **journal des réponses** (`attempts`, PLAN
 * :77 — la colonne `created_at` est documentée « régularité / tendances ») en indicateurs de
 * présence qu'un parent lit : **jours joués**, **temps de jeu/jour**, **série de jours** (courante +
 * record), **respect des 15-20 min**.
 *
 * **Dérivé, pas persisté (ADR 0014, Option A)** : aucune notion de « minutes jouées » ou de « série »
 * n'est stockée — tout se **dérive** de `attempts.createdAt`. Le temps/jour est une **approximation
 * par amplitude bornée** (la spec autorise explicitement l'approximation) — ce module ne **mesure**
 * pas une durée réelle de session (ce serait une écriture runtime / table sessions = décision SYNC
 * verrouillée, hors scope). C'est du **reporting** : il **rapporte** la régularité observée, il
 * n'**enforce** rien (le nudge / verrou de temps d'écran vit en 7.3 config + 7.8 #229 enforcement).
 *
 * Chaque agrégat est une **fonction pure et déterministe** : aucune I/O, aucune UI, aucun accès DB —
 * l'appelant serveur (`stats-source.ts`) charge `attempts` (lecture seule) et passe les records +
 * la config + une **horloge injectée** (`now`, epoch ms — jamais de `Date.now()` interne, comme le
 * moteur). Toutes les fenêtres/seuils/fuseaux proviennent de `RegularityConfig` (⚙️, ADR 0014) —
 * aucune constante magique en dur.
 *
 * **Fidélité au modèle (le point de vigilance)** — la régularité mesure l'**ENGAGEMENT** (présence
 * quotidienne, temps passé), pas la correction : elle compte donc **TOUTES les réponses**, re-essais
 * **inclus** (contrairement à la justesse/rapidité de `stats.ts` qui ne comptent que les 1ʳᵉˢ
 * réponses, ENGINE §9). Un re-essai est du temps de jeu réel — l'enfant était présent.
 */

import type { RegularityConfig } from "../../config/server-config";
import type { AttemptRecord } from "./stats";

/** Millisecondes par jour (conversion des ordinaux de jour calendaire). */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Millisecondes par minute (les seuils ⚙️ sont exprimés en minutes). */
const MS_PER_MINUTE = 60 * 1000;

/** Classement du temps de jeu d'un jour vis-à-vis de la fenêtre saine ⚙️ (« respect des 15-20 min »). */
export type DayRespect = "under" | "within" | "over";

/**
 * Activité d'**un** jour calendaire joué (au moins une réponse ce jour-là).
 * `dayOrdinal` = index entier du jour calendaire dans le fuseau ⚙️ (DST-indépendant : deux jours
 * calendaires consécutifs diffèrent de 1) — clé stable pour l'affichage/tri, pas un epoch.
 */
export interface DayActivity {
  /** Ordinal du jour calendaire (jours consécutifs = +1), dans le fuseau ⚙️. */
  readonly dayOrdinal: number;
  /** Temps de jeu approximé (ms) : amplitude premier→dernier attempt du jour, bornée par le plafond ⚙️. */
  readonly activeMs: number;
  /** Même temps arrondi à la minute (affichage « 18 min »). */
  readonly activeMinutes: number;
  /** Respect de la fenêtre saine ⚙️ (`under` / `within` / `over`). */
  readonly respect: DayRespect;
}

/**
 * Agrégats de régularité d'un profil (PLAN §Espace parent :83).
 * `today` = l'activité du jour calendaire de `now` (ou `null` si l'enfant n'a pas encore joué
 * aujourd'hui). `days` = tous les jours joués, triés par ordinal **croissant** (matière brute pour
 * la sparkline / le calendrier du dashboard 7.7).
 */
export interface RegularityStats {
  /** Nombre de jours calendaires **distincts** avec au moins une réponse (tout l'historique). */
  readonly daysPlayed: number;
  /** Longueur de la série **courante** (jours consécutifs joués finissant à aujourd'hui/hier). */
  readonly currentStreakDays: number;
  /** Plus **longue** série de jours consécutifs joués de tout l'historique. */
  readonly recordStreakDays: number;
  /** Activité du jour de `now` (`null` si aucune réponse aujourd'hui). */
  readonly today: DayActivity | null;
  /** Tous les jours joués, triés par ordinal croissant. */
  readonly days: readonly DayActivity[];
}

/**
 * Transforme un instant (epoch ms) en **ordinal de jour calendaire** dans un fuseau IANA. On lit la
 * date **locale** (année/mois/jour) via `Intl` — ce qui gère correctement l'heure d'été (heure
 * murale) — puis on convertit ce triplet en entier via `Date.UTC(y, m, d) / MS_PER_DAY`. Le résultat
 * est **DST-indépendant** (c'est un simple index de date civile) : deux jours calendaires consécutifs
 * diffèrent toujours de 1, ce que la logique de série exploite.
 */
function makeDayOrdinal(timeZone: string): (epochMs: number) => number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (epochMs: number): number => {
    const parts: Record<string, string> = {};
    for (const part of formatter.formatToParts(new Date(epochMs))) {
      parts[part.type] = part.value;
    }
    return Math.floor(
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / MS_PER_DAY,
    );
  };
}

/**
 * Temps de jeu approximé d'un jour (ms) : **amplitude** `dernier − premier` des instants du jour,
 * **bornée** par le plafond ⚙️ (ADR 0014). Un jour à une seule réponse a une amplitude nulle → 0 ms
 * (une question isolée ≈ temps négligeable). `timestamps` est **toujours non vide** (un jour n'existe
 * dans la Map que parce qu'il a au moins une réponse).
 */
function dayActiveMs(timestamps: readonly number[], maxAmplitudeMs: number): number {
  let min = timestamps[0];
  let max = timestamps[0];
  for (const t of timestamps) {
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return Math.min(max - min, maxAmplitudeMs);
}

/**
 * Classe le temps de jeu d'un jour vis-à-vis de la fenêtre saine ⚙️. Comparaison en **ms entiers**
 * (pas de division flottante) : `< min` → `under` ; `> max` → `over` ; **bornes incluses** entre les
 * deux → `within` (le respect des 15-20 min inclut 15 ET 20).
 */
function classifyRespect(activeMs: number, config: RegularityConfig): DayRespect {
  const minMs = config.respectWindowMinMinutes * MS_PER_MINUTE;
  const maxMs = config.respectWindowMaxMinutes * MS_PER_MINUTE;
  if (activeMs < minMs) {
    return "under";
  }
  if (activeMs > maxMs) {
    return "over";
  }
  return "within";
}

/**
 * Série **courante** : longueur du run de jours **consécutifs** joués se terminant au dernier jour
 * joué — mais **vivante** seulement si ce dernier jour est encore dans la fenêtre de rupture par
 * rapport à aujourd'hui (`todayOrdinal − dernier < streakBreakGapDays`) ; aujourd'hui pas encore
 * fini ne casse donc pas la série d'hier. Sinon la série est rompue → `0`. Deux jours sont
 * « consécutifs » si leur écart est `< gap` (défaut 2 : écart 1 continue, écart ≥ 2 rompt).
 * `ordinals` est trié **croissant** et sans doublon (un ordinal par jour joué).
 */
function currentStreak(ordinals: readonly number[], todayOrdinal: number, gap: number): number {
  if (ordinals.length === 0) {
    return 0;
  }
  const last = ordinals[ordinals.length - 1];
  // Série morte si le dernier jour joué est trop loin d'aujourd'hui (borne stricte `>=`).
  if (todayOrdinal - last >= gap) {
    return 0;
  }
  let streak = 1;
  for (let i = ordinals.length - 1; i > 0; i--) {
    if (ordinals[i] - ordinals[i - 1] < gap) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Série **record** : plus long run de jours **consécutifs** joués de tout l'historique (même règle
 * de consécutivité `< gap` que la série courante). `ordinals` trié croissant, sans doublon.
 */
function recordStreak(ordinals: readonly number[], gap: number): number {
  if (ordinals.length === 0) {
    return 0;
  }
  let best = 1;
  let run = 1;
  for (let i = 1; i < ordinals.length; i++) {
    if (ordinals[i] - ordinals[i - 1] < gap) {
      run++;
    } else {
      run = 1;
    }
    if (run > best) {
      best = run;
    }
  }
  return best;
}

/**
 * **Agrégats de régularité** (jours joués, temps/jour, série courante + record, respect 15-20 min).
 * Compte **TOUTES** les réponses (re-essais inclus : engagement, pas correction — cf. en-tête). Le
 * jour calendaire est défini dans le fuseau ⚙️ (`dayTimeZone`), l'horloge `now` est injectée.
 */
export function computeRegularityStats(
  attempts: readonly AttemptRecord[],
  config: RegularityConfig,
  now: number,
): RegularityStats {
  const toDayOrdinal = makeDayOrdinal(config.dayTimeZone);

  // Regroupe les instants des réponses par jour calendaire.
  const byDay = new Map<number, number[]>();
  for (const a of attempts) {
    const ordinal = toDayOrdinal(a.createdAt);
    const list = byDay.get(ordinal);
    if (list) {
      list.push(a.createdAt);
    } else {
      byDay.set(ordinal, [a.createdAt]);
    }
  }

  const maxAmplitudeMs = config.maxDayAmplitudeMinutes * MS_PER_MINUTE;
  // Jours joués, triés par ordinal croissant (matière brute déterministe).
  const days: DayActivity[] = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ordinal, timestamps]) => {
      const activeMs = dayActiveMs(timestamps, maxAmplitudeMs);
      return {
        dayOrdinal: ordinal,
        activeMs,
        activeMinutes: Math.round(activeMs / MS_PER_MINUTE),
        respect: classifyRespect(activeMs, config),
      };
    });

  const ordinals = days.map((d) => d.dayOrdinal);
  const todayOrdinal = toDayOrdinal(now);
  return {
    daysPlayed: days.length,
    currentStreakDays: currentStreak(ordinals, todayOrdinal, config.streakBreakGapDays),
    recordStreakDays: recordStreak(ordinals, config.streakBreakGapDays),
    today: days.find((d) => d.dayOrdinal === todayOrdinal) ?? null,
    days,
  };
}
