/**
 * Modèle de maîtrise — cœur du moteur pédagogique (ENGINE.md §2 & §9).
 *
 * Applique **une réponse** (`attempt`) à l'état de maîtrise d'un fait et produit le
 * **nouvel état** (boîte Leitner, `next_due`, moyenne de fluence, compteurs,
 * `last_seen`). Fonction **pure** et **déterministe** :
 * - aucune I/O, aucune UI, aucun accès DB ;
 * - **horloge injectée** (`now` en paramètre) — jamais de `Date.now()` interne
 *   (LEARNINGS : tout comportement temporel se teste avec une horloge injectée) ;
 * - toutes les valeurs ⚙️ (délais Leitner, seuils de fluence, promotion/rétrograde,
 *   anti-mash) proviennent de la **config moteur** (3.2, `EngineConfig`) — aucune
 *   constante en dur ici.
 *
 * **Transitions** (ENGINE §2, sur la **1ʳᵉ réponse** d'un fait dans un niveau) :
 * - **juste + rapide** → `box = min(maxBox, box + promoteBoxes)` (promotion) ;
 * - **juste mais lent** → `box` inchangé, `next_due` court (encore à automatiser) ;
 * - **faux / « je ne sais pas »** → `box = max(0, box − demoteBoxes)` (rétrograde).
 *
 * **Anti-mash** (ENGINE §9) : une réponse **très rapide** (`response_ms < antiMashMs`)
 * ne peut **jamais** promouvoir (martèlement / devinette). Un tel « rapide » n'est pas
 * traité comme fluence → au mieux « juste mais lent » (pas de promotion), et un
 * rapide+faux reste faux (rétrograde). Cf. NB anti-mash sur `isFluent`.
 *
 * **Re-essai** (`is_retry = true`, ENGINE §9) : pratique **non comptée** → la maîtrise
 * est laissée **strictement inchangée** (aucune boîte, aucun compteur, aucun `next_due`
 * ni `last_seen` touché) ; un fait jamais vu reste jamais vu (`null`).
 */

import type { EngineConfig } from "../../config/server-config";
import type { Skill } from "./domain";

/**
 * État de maîtrise d'un **(profil, fact)** — miroir pur des colonnes de la table
 * `mastery` (3.2, `src/lib/db/schema.ts`) pertinentes pour la transition. La couche
 * de persistance (3.3+ côté serveur) mappe cette forme sur la ligne Drizzle ; le
 * moteur reste agnostique du stockage.
 *
 * `lastSeen` / `nextDue` sont des **instants epoch (ms)** — la persistance les
 * convertit en `Date`/timestamp au besoin. `null` = fait jamais rencontré / échéance
 * non encore fixée (cohérent avec les colonnes nullables du schéma).
 */
export interface MasteryState {
  /** Boîte Leitner 0..maxBox (force, ENGINE §2). */
  readonly box: number;
  /** Nombre cumulé de 1ʳᵉˢ réponses justes sur ce fait. */
  readonly correctCount: number;
  /** Nombre cumulé de 1ʳᵉˢ réponses fausses / « je ne sais pas » sur ce fait. */
  readonly wrongCount: number;
  /** Temps de réponse moyen (ms) — moyenne glissante de fluence (ENGINE §2). */
  readonly avgResponseMs: number;
  /** Instant (epoch ms) de la dernière rencontre du fait, ou `null` si jamais vu. */
  readonly lastSeen: number | null;
  /** Instant (epoch ms) de la prochaine échéance, ou `null` si non fixée. */
  readonly nextDue: number | null;
}

/**
 * Une **réponse** à évaluer (1ʳᵉ réponse d'un fait dans un niveau, ENGINE §2/§9).
 * Miroir pur des colonnes utiles de `attempts` (3.2).
 */
export interface Attempt {
  /** Compétence du fait répondu — indexe le seuil de fluence (ENGINE §2). */
  readonly skill: Skill;
  /** Réponse juste ? (« je ne sais pas » = `false`, ENGINE §9). */
  readonly correct: boolean;
  /** Temps de réponse (ms), de l'affichage à la 1ʳᵉ réponse (ENGINE §9). */
  readonly responseMs: number;
  /**
   * Re-essai (pratique après erreur) ? `true` → non compté pour la maîtrise
   * (ENGINE §9). Optionnel : absent ⇒ `false` (1ʳᵉ réponse comptée).
   */
  readonly isRetry?: boolean;
}

/** Boîte de départ d'un fait jamais vu (0 = à apprendre, ENGINE §2). */
export const INITIAL_BOX = 0;

/** Nombre de millisecondes dans un jour (délais Leitner exprimés en jours ⚙️). */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Délai de réapparition (ms) d'une boîte, dérivé des délais Leitner ⚙️ (jours,
 * ENGINE §2/§11). La boîte est **clampée** dans les bornes de la table de délais :
 * la config est un **contrat brut non validé de façon croisée** (LEARNINGS #58) — la
 * logique consommatrice ne suppose jamais `leitnerDelaysDays` cohérent avec `maxBox`
 * ni la boîte dans les bornes, elle borne défensivement (jamais d'accès hors tableau).
 */
function boxDelayMs(box: number, config: EngineConfig): number {
  const delays = config.leitnerDelaysDays;
  // Clamp dans [0, dernier index] : une boîte cible peut dépasser la table si `maxBox`
  // > longueur des délais (config incohérente) ; on retombe alors sur le dernier délai
  // défini plutôt que `undefined`. `Math.max(box, 0)` protège d'une boîte négative.
  const index = Math.min(Math.max(box, 0), delays.length - 1);
  return delays[index] * MS_PER_DAY;
}

/**
 * `true` si la réponse est **juste ET fluente** (« rapide », ENGINE §2) → seule
 * condition de **promotion**. « Rapide » = `response_ms ≤ fluenceThresholdsMs[skill]`.
 *
 * **NB anti-mash (ENGINE §9)** : une réponse **très rapide** (`< antiMashMs`) n'est
 * **jamais** comptée comme fluente, même si `correct` — martèlement / devinette ne
 * doivent pas promouvoir. Un tel cas retombe donc sur « juste mais lent » (pas de
 * promotion). Le seuil anti-mash borne le bas, le seuil de fluence borne le haut :
 * la fenêtre promotionnelle est `antiMashMs ≤ response_ms ≤ seuil_fluence`.
 */
function isFluent(attempt: Attempt, config: EngineConfig): boolean {
  const fluenceThreshold = config.fluenceThresholdsMs[attempt.skill];
  return (
    attempt.correct &&
    attempt.responseMs >= config.antiMashMs &&
    attempt.responseMs <= fluenceThreshold
  );
}

/**
 * Boîte cible après la réponse (ENGINE §2), bornée dans `[0, maxBox]`.
 *
 * - **juste + fluente** → promotion `box + promoteBoxes` (plafonnée à `maxBox`) ;
 * - **juste mais lent** (ou juste très rapide anti-mash) → `box` inchangé ;
 * - **faux** → rétrograde `box − demoteBoxes` (plancher 0).
 *
 * Clampe défensivement (`min`/`max`) : la config étant un contrat brut (LEARNINGS #58),
 * `promoteBoxes`/`demoteBoxes`/`maxBox` peuvent être incohérents — la boîte reste
 * toujours dans `[0, maxBox]`.
 */
function nextBox(box: number, attempt: Attempt, config: EngineConfig): number {
  if (!attempt.correct) {
    // Faux / « je ne sais pas » → rétrograde fort (plancher 0). Un rapide+faux passe
    // aussi par ici : anti-mash ne change pas l'issue d'un faux, il empêche seulement
    // un rapide+juste de promouvoir (cf. isFluent).
    return Math.max(0, box - config.demoteBoxes);
  }
  if (isFluent(attempt, config)) {
    // Juste + rapide (et pas anti-mash) → promotion, plafonnée à maxBox.
    return Math.min(config.maxBox, box + config.promoteBoxes);
  }
  // Juste mais lent (ou juste mais très rapide = anti-mash) → boîte inchangée,
  // clampée dans [0, maxBox] au cas où l'état d'entrée serait hors bornes.
  return Math.min(config.maxBox, Math.max(0, box));
}

/**
 * Moyenne **glissante** du temps de réponse par fait (fluence, ENGINE §2).
 *
 * Moyenne **cumulée exacte** sur les 1ʳᵉˢ réponses **comptées** : le nouvel
 * `avg_response_ms` est la moyenne arithmétique des `response_ms` de toutes les
 * réponses comptées jusqu'ici (dont celle-ci). `priorCount` = nb de réponses déjà
 * intégrées (= `correctCount + wrongCount` **avant** cette réponse). Arrondi à l'entier
 * (la colonne est un `integer`). Pour la 1ʳᵉ réponse (`priorCount = 0`) → renvoie
 * `response_ms` tel quel.
 */
function rollingAverage(priorAvg: number, priorCount: number, responseMs: number): number {
  const totalCount = priorCount + 1;
  return Math.round((priorAvg * priorCount + responseMs) / totalCount);
}

/**
 * État initial d'un fait **jamais vu** (`masteryRow = null`) : boîte de départ,
 * compteurs à zéro, moyenne à zéro, instants non fixés. Sert de base à `applyAttempt`
 * quand aucune ligne n'existe encore (ENGINE §2/§3 : « nouveau » = pas de ligne).
 */
function initialState(): MasteryState {
  return {
    box: INITIAL_BOX,
    correctCount: 0,
    wrongCount: 0,
    avgResponseMs: 0,
    lastSeen: null,
    nextDue: null,
  };
}

/**
 * **Applique une réponse** à l'état de maîtrise d'un fait → **nouvel état** (ENGINE
 * §2/§9). Cœur pédagogique : Leitner + fluence + anti-mash, horloge injectée.
 *
 * @param current état actuel du fait, ou `null` s'il n'a **jamais été vu** (initialisé).
 * @param attempt la réponse à intégrer (1ʳᵉ réponse d'un fait dans un niveau).
 * @param config config moteur ⚙️ (3.2) — délais/seuils/promotion, jamais en dur.
 * @param now instant courant **injecté** (epoch ms) — base de `last_seen`/`next_due`.
 * @returns le nouvel état de maîtrise. Sur un **re-essai** (`is_retry = true`), l'état
 *   est renvoyé **inchangé** (pratique non comptée) — `null` reste `null`.
 */
export function applyAttempt(
  current: MasteryState | null,
  attempt: Attempt,
  config: EngineConfig,
  now: number,
): MasteryState | null {
  // Re-essai = pratique non comptée (ENGINE §9) → maîtrise strictement inchangée.
  // On ne touche NI la boîte, NI les compteurs, NI last_seen/next_due : un re-essai
  // ne doit laisser aucune trace dans le modèle de maîtrise. Un fait jamais vu reste
  // jamais vu (`null`) — un re-essai ne crée pas de ligne.
  if (attempt.isRetry === true) {
    return current;
  }

  const state = current ?? initialState();
  const priorCount = state.correctCount + state.wrongCount;
  const box = nextBox(state.box, attempt, config);

  return {
    box,
    correctCount: state.correctCount + (attempt.correct ? 1 : 0),
    wrongCount: state.wrongCount + (attempt.correct ? 0 : 1),
    avgResponseMs: rollingAverage(state.avgResponseMs, priorCount, attempt.responseMs),
    lastSeen: now,
    // next_due = now + délai(box cible). Une réponse juste-mais-lente reste dans sa
    // boîte : son délai est donc « court » relativement à une promotion (la boîte n'a
    // pas monté) — pas de délai spécial ad hoc, la table Leitner porte déjà la révision
    // espacée (ENGINE §2 : « next_due court » = le délai de la boîte courante non promue).
    nextDue: now + boxDelayMs(box, config),
  };
}

/**
 * Un fait est **maîtrisé** quand sa boîte atteint le plancher de maîtrise (ENGINE §2 :
 * `box ≥ 4`). Le plancher `4` est dérivé de la config (`tierUnlockMinBox`, la boîte
 * « su » qui déclenche l'élargissement de Tier, ENGINE §8/§11) → pas de constante en dur.
 */
export function isFactMastered(state: MasteryState, config: EngineConfig): boolean {
  return state.box >= config.tierUnlockMinBox;
}

/**
 * **Maîtrise d'une compétence** = proportion de ses facts **maîtrisés** (`box ≥ 4`,
 * ENGINE §2), dans `[0, 1]`. Sur un ensemble **vide** → `0` (aucune maîtrise), pas de
 * division par zéro. `states` = les états de maîtrise des facts d'**une** compétence
 * (le filtrage par compétence est à la charge de l'appelant).
 */
export function skillMasteryRatio(states: readonly MasteryState[], config: EngineConfig): number {
  if (states.length === 0) {
    return 0;
  }
  const mastered = states.filter((state) => isFactMastered(state, config)).length;
  return mastered / states.length;
}
