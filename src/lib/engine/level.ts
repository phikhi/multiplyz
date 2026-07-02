/**
 * Composition d'un niveau (~10 questions) — cœur de la sélection (ENGINE.md §4 & §7).
 *
 * `buildLevel` transforme l'**état de maîtrise du périmètre** (tous les faits du
 * domaine + leur `MasteryState` ou `null` s'ils sont neufs) en une **liste ordonnée
 * de ~10 faits** à poser. Fonction **pure** et **déterministe** :
 * - aucune I/O, aucune UI, aucun accès DB — l'appelant serveur (3.7) fournit le
 *   scope depuis `generateAllFacts()` + les lignes `mastery`, et persiste le résultat ;
 * - **horloge injectée** (`now`, epoch ms) — jamais de `Date.now()` interne (LEARNINGS :
 *   tout comportement temporel se teste avec une horloge injectée) ;
 * - **rotation douce déterministe** : un `rotation` entier injecté (compteur de niveau
 *   côté serveur) pilote le choix de la compétence de départ en cas d'égalité de
 *   faiblesse → aucune dépendance à `Math.random`, aucune branche probabiliste sous
 *   gate coverage 100 % (LEARNINGS aléa/#34/#61) ;
 * - toutes les valeurs ⚙️ (cap de nouveaux, seuil de consolidation, bascule
 *   interleaving, boîtes plancher) proviennent de la **config moteur** (3.2,
 *   `EngineConfig`) — aucune constante magique en dur.
 *
 * **Pools** (ENGINE §4, restreints au périmètre actif §7) :
 * - **DUE** : `next_due ≤ now` et `box < maxBox`, triés par **faiblesse** (box
 *   croissant) puis **retard** (`next_due` le plus ancien d'abord) ;
 * - **NEW** : faits **jamais vus** (`state === null`) des compétences actives ;
 * - **MAINT** : faits `box = maxBox` (entretien) dont l'échéance est arrivée
 *   (`next_due ≤ now`).
 *
 * **Mix cible** ~**70 % DUE** + ~**30 % NEW/MAINT**, sous **cap de nouveaux**
 * (`newMaxPerLevel`), forcé à **0 nouveau** quand trop de faits sont fragiles
 * (`weak ≥ consolidationThreshold`, consolidation pure, ENGINE §7).
 *
 * **Périmètre du cap de nouveaux** : cette fonction n'applique QUE le cap
 * **par niveau** (`newMaxPerLevel`). Le second cap d'ENGINE §7 — `newMaxPerDay`
 * (nouveaux max **par jour**) — est **cross-niveaux** : il exige de compter les
 * nouveaux déjà introduits dans les niveaux précédents de la journée, un état
 * inter-niveaux que cette fonction **pure sans mémoire** ne possède pas. Il est
 * donc **délégué à l'appelant serveur** (story 3.7), qui tient ce compteur
 * journalier et peut réduire le cap effectif passé/appliqué en amont si besoin.
 */

import type { EngineConfig } from "../../config/server-config";
import { SKILLS, type Skill } from "./domain";
import type { Fact } from "./facts";
import type { MasteryState } from "./mastery";

/**
 * Une entrée du **périmètre** : un fait et son état de maîtrise (`null` = jamais vu).
 * Miroir pur de la jointure `facts × mastery` que l'appelant serveur (3.7) fournit ;
 * le moteur reste agnostique du stockage.
 */
export interface ScopeEntry {
  /** Le fait concerné (issu de `generateAllFacts()`). */
  readonly fact: Fact;
  /** État de maîtrise, ou `null` si le fait n'a **jamais** été rencontré (NEW). */
  readonly state: MasteryState | null;
}

/**
 * Une question composée du niveau : le fait à poser + un drapeau `isReask`. Un
 * **re-ask intra-niveau** (ENGINE §4/§9 : un fait raté revient une fois) porte
 * `isReask = true` → l'appelant ne **recompte pas** la maîtrise sur cette occurrence
 * (pratique de renforcement court terme). Les items nominaux portent `isReask = false`.
 */
export interface LevelItem {
  /** Le fait à poser. */
  readonly fact: Fact;
  /** `true` si c'est la ré-apparition d'un fait raté (non comptée pour la maîtrise). */
  readonly isReask: boolean;
}

/** Nombre cible de questions par niveau (ENGINE §4 : « ~10 questions »). */
export const LEVEL_SIZE = 10;

/**
 * Part cible du pool DUE dans un niveau plein (ENGINE §4 : « ~70 % DUE »). Sur
 * `LEVEL_SIZE = 10` → 7 items DUE prioritaires (consolidation), le reste NEW/MAINT.
 * ⚙️ : ratio de composition, pas encore dans `EngineConfig` (posé local, commenté)
 * — à migrer si une story ultérieure veut le calibrer indépendamment.
 */
export const DUE_TARGET_RATIO = 0.7;

/**
 * Nombre d'items DUE visés dans un niveau plein (dérivé de `DUE_TARGET_RATIO`).
 * `Math.round(10 × 0.7) = 7` (ENGINE §4 pseudo-code : `prendre(due, 7)`).
 */
const DUE_TARGET = Math.round(LEVEL_SIZE * DUE_TARGET_RATIO);

/**
 * `true` si le fait est **DUE** : déjà rencontré, boîte sous le plafond (`< maxBox`,
 * donc pas en entretien), et **échéance atteinte** (`next_due ≤ now`). Un `next_due`
 * `null` (échéance jamais fixée sur une ligne existante — cas défensif) est traité
 * comme **dû** (à revoir). (ENGINE §4.)
 */
function isDue(state: MasteryState, config: EngineConfig, now: number): boolean {
  return state.box < config.maxBox && (state.nextDue === null || state.nextDue <= now);
}

/**
 * `true` si le fait est en **MAINT** (entretien, ENGINE §4) : boîte au plafond
 * (`box ≥ maxBox`, maîtrisé de longue date) et échéance d'entretien arrivée
 * (`next_due ≤ now`). `≥` (et non `===`) borne défensivement une boîte au-dessus du
 * max (config incohérente, LEARNINGS #58).
 */
function isMaint(state: MasteryState, config: EngineConfig, now: number): boolean {
  return state.box >= config.maxBox && (state.nextDue === null || state.nextDue <= now);
}

/**
 * `true` si le fait est **fragile** au sens consolidation (ENGINE §7 : `box ≤
 * consolidationMaxBox`). Le décompte des fragiles du périmètre actif pilote le cap de
 * nouveaux (`weak ≥ consolidationThreshold` → 0 nouveau).
 */
function isWeak(state: MasteryState, config: EngineConfig): boolean {
  return state.box <= config.consolidationMaxBox;
}

/**
 * Comparateur DUE (ENGINE §4) : **faiblesse d'abord** (box croissant), puis **retard**
 * (`next_due` le plus ancien d'abord). Un `next_due` `null` est considéré comme le
 * plus en retard possible (échéance non fixée → à revoir en priorité). Ordre **total
 * et stable** (tie-break final sur la clé du fait) → tri déterministe, testable.
 */
function compareDue(a: ScopeEntry, b: ScopeEntry): number {
  const boxA = a.state!.box;
  const boxB = b.state!.box;
  if (boxA !== boxB) {
    return boxA - boxB; // plus faible (box petite) d'abord
  }
  const dueA = a.state!.nextDue ?? Number.NEGATIVE_INFINITY;
  const dueB = b.state!.nextDue ?? Number.NEGATIVE_INFINITY;
  if (dueA !== dueB) {
    return dueA - dueB; // plus ancien (next_due petit) d'abord
  }
  // Tie-break déterministe : clé canonique. Deux items nominaux distincts ont
  // toujours des clés distinctes (anti-doublon en amont) → `< ? -1 : 1` est total,
  // pas de 3ᵉ cas d'égalité (branche morte évitée sous gate 100 %).
  return byKey(a, b);
}

/**
 * Comparateur lexicographique **total** sur la clé canonique — tie-break stable et
 * déterministe. Deux `ScopeEntry` distincts d'un même niveau portent des clés
 * distinctes (anti-doublon), donc `< ? -1 : 1` suffit (aucune branche d'égalité morte).
 */
function byKey(a: ScopeEntry, b: ScopeEntry): number {
  return a.fact.key < b.fact.key ? -1 : 1;
}

/**
 * Difficulté **proxy** d'un fait pour l'ordonnancement final (ENGINE §4 : « facile →
 * un peu plus dur → finir sur un presque-su »). On approxime la difficulté ressentie
 * par la **force inverse** : un fait à boîte haute (bien su) est « facile », un fait à
 * boîte basse / neuf est « plus dur ». Un fait **NEW** (`state === null`) est le plus
 * dur (jamais vu) → force `-1` (sous la boîte 0). L'ordre monte en difficulté puis se
 * termine sur un **presque-su** (cf. `orderForVictory`).
 */
function strengthOf(entry: ScopeEntry): number {
  return entry.state === null ? -1 : entry.state.box;
}

/**
 * Compétences **présentes** dans le périmètre, dans l'ordre canonique d'ENGINE §1
 * (`SKILLS`). Une compétence sans aucun fait dans `scope` est omise. Sert de base au
 * choix du périmètre actif (§7) — ordre stable et déterministe.
 */
function skillsPresent(scope: readonly ScopeEntry[]): Skill[] {
  return SKILLS.filter((skill) => scope.some((entry) => entry.fact.skill === skill));
}

/**
 * **Maîtrise globale** du périmètre pour la bascule interleaving (ENGINE §7) :
 * proportion de faits **déjà vus** à `box ≥ interleaveMinBox`, rapportée à **tous** les
 * faits du périmètre (les faits neufs comptent au dénominateur → un périmètre presque
 * neuf reste « bloqué »). Appelée **uniquement** avec un périmètre **non vide**
 * (`selectActiveSkills` court-circuite sur `present` vide en amont). `[0, 1]`.
 */
function interleaveProgress(scope: readonly ScopeEntry[], config: EngineConfig): number {
  const strong = scope.filter(
    (entry) => entry.state !== null && entry.state.box >= config.interleaveMinBox,
  ).length;
  return strong / scope.length;
}

/**
 * **Faiblesse par compétence** (pour choisir la plus faible / le focus, ENGINE §7).
 * Score = proportion de faits **fragiles** (`box ≤ consolidationMaxBox`, faits neufs
 * comptés fragiles car jamais consolidés) parmi les faits de la compétence. Plus le
 * score est haut, plus la compétence est faible. Appelée **uniquement** avec une
 * compétence **présente** dans le scope (`selectActiveSkills` n'itère que sur
 * `skillsPresent`) → `entries` jamais vide. `[0, 1]`.
 */
function skillWeakness(scope: readonly ScopeEntry[], skill: Skill, config: EngineConfig): number {
  const entries = scope.filter((entry) => entry.fact.skill === skill);
  const weak = entries.filter(
    (entry) => entry.state === null || isWeak(entry.state, config),
  ).length;
  return weak / entries.length;
}

/**
 * Nombre de compétences actives selon la maîtrise du périmètre (ENGINE §7) :
 * **1** au départ (bloqué), **2** puis **3–4** à mesure que l'interleaving progresse.
 * Paliers : `< interleaveThresholdRatio` → 1 ; `< 2×seuil` → 2 ; `< 3×seuil` → 3 ;
 * au-delà → toutes (jusqu'à 4). Déterministe, borné à `[1, nb compétences présentes]`.
 */
function activeSkillCount(progress: number, config: EngineConfig, present: number): number {
  const t = config.interleaveThresholdRatio;
  let count = 1; // départ BLOQUÉ (§7)
  if (progress >= t) count = 2;
  if (progress >= 2 * t) count = 3;
  // NB game-design : le palier « 4 compétences » exige `progress ≥ 3·t`, or
  // `progress ∈ [0, 1]` → il n'est atteignable que si `t ≲ 1/3` (≈ 0.33). Au défaut
  // ⚙️ `interleaveThresholdRatio = 0.4`, `3·0.4 = 1.2 > 1` → le mélange **plafonne à
  // 3 compétences**. Comportement **accepté** en v1 (calibré au playtest, cf. issue de
  // suivi #76) : baisser le seuil ⚙️ suffit à débloquer le 4ᵉ palier sans toucher au code.
  if (progress >= 3 * t) count = 4;
  return Math.min(count, present);
}

/**
 * **Périmètre actif** (ENGINE §7) : la/les compétence(s) sur lesquelles composer le
 * niveau. Toujours **la plus faible en tête** (focus léger, §7) ; en cas d'égalité de
 * faiblesse, la **rotation douce** injectée départage (évite de toujours servir la
 * même compétence). Puis on complète par faiblesse décroissante jusqu'à
 * `activeSkillCount`. Ordre déterministe : (faiblesse ↓, rotation, ordre canonique).
 */
function selectActiveSkills(
  scope: readonly ScopeEntry[],
  config: EngineConfig,
  rotation: number,
): Skill[] {
  const present = skillsPresent(scope);
  if (present.length === 0) {
    return [];
  }
  const progress = interleaveProgress(scope, config);
  const count = activeSkillCount(progress, config, present.length);

  // Tri stable des compétences présentes par faiblesse décroissante, tie-break par
  // rotation douce déterministe (décalage circulaire piloté par `rotation`) puis
  // ordre canonique — aucun aléa, 100 % reproductible.
  const rotated = rotateStart(present, rotation);
  const byWeakness = [...rotated].sort(
    (a, b) => skillWeakness(scope, b, config) - skillWeakness(scope, a, config),
  );
  return byWeakness.slice(0, count);
}

/**
 * Décalage circulaire déterministe d'une liste selon `rotation` (rotation douce, §7).
 * Un `rotation` négatif ou nul laisse l'ordre inchangé (départ) ; sinon on fait
 * tourner le point de départ modulo la longueur → la compétence servie en cas
 * d'égalité **change à chaque niveau** sans aléa. Ne mute pas l'entrée. Appelée
 * **uniquement** avec une liste **non vide** (`present` garanti non vide en amont).
 */
function rotateStart<T>(items: readonly T[], rotation: number): T[] {
  const n = items.length;
  // Modulo sûr pour rotation négatif : (((r % n) + n) % n).
  const shift = ((rotation % n) + n) % n;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

/**
 * Ordonne les items pour **finir sur une victoire** (ENGINE §4) : facile (fort/su) →
 * un peu plus dur (faible/neuf) → **presque-su** en dernier. Concrètement : on trie
 * par difficulté croissante (force décroissante) pour la montée, puis on **remonte le
 * plus fort restant en toute fin** (le « presque-su » sur lequel finir). Tri stable et
 * déterministe (tie-break clé). Sans jamais placer deux fois le même fait d'affilée
 * (garanti en amont : items distincts avant re-ask).
 */
function orderForVictory(entries: readonly ScopeEntry[]): ScopeEntry[] {
  if (entries.length <= 1) {
    return [...entries];
  }
  // Difficulté croissante : force décroissante. Tie-break clé pour la stabilité.
  const byRising = [...entries].sort((a, b) => {
    const sa = strengthOf(a);
    const sb = strengthOf(b);
    if (sa !== sb) {
      return sb - sa; // plus fort (facile) d'abord
    }
    return byKey(a, b); // tie-break clé (total, pas de branche morte)
  });
  // « Finir sur un presque-su » : le fait le plus fort de tout le niveau clôt la
  // séquence. Il est en tête après le tri (facile d'abord) → on le déplace en fin.
  const [strongest, ...rest] = byRising;
  return [...rest, strongest];
}

/**
 * Insère les **re-ask** (ENGINE §4/§9) : chaque fait signalé raté revient **une fois**,
 * plus loin dans le niveau, **sans jamais** être adjacent à une autre occurrence du même
 * fait (« pas 2× le même fact d'affilée »). On vise la **fin** de la séquence
 * (renforcement court terme, après un intervalle) ; si insérer là collerait le re-ask à
 * son original (typiquement quand l'original est le **presque-su** placé en dernier par
 * `orderForVictory`), on **recule le point d'insertion** jusqu'à trouver une position
 * dont **aucun voisin** ne porte la même clé. Les items d'origine gardent leur ordre.
 */
function insertReasks(ordered: readonly ScopeEntry[], reaskKeys: ReadonlySet<string>): LevelItem[] {
  const items: LevelItem[] = ordered.map((entry) => ({ fact: entry.fact, isReask: false }));
  // Un re-ask par fait raté présent dans le niveau, dans l'ordre d'apparition.
  const toReask = ordered.filter((entry) => reaskKeys.has(entry.fact.key));
  for (const entry of toReask) {
    const reask: LevelItem = { fact: entry.fact, isReask: true };
    insertNonAdjacent(items, reask);
  }
  return items;
}

/**
 * Insère `reask` dans `items` à la **position la plus tardive** telle que ni le voisin
 * de gauche ni celui de droite ne portent la même clé (jamais deux occurrences du même
 * fait côte à côte, ENGINE §4). Balaye les points d'insertion `pos = length … 0` (fin
 * d'abord = re-ask le plus tard possible) et retient le premier sans collision. Avec au
 * moins **un autre fait** dans le niveau, une telle position existe toujours ; à défaut
 * (niveau réduit au seul fait re-ask — dégénéré), on retombe sur la fin. Mute `items`.
 */
function insertNonAdjacent(items: LevelItem[], reask: LevelItem): void {
  for (let pos = items.length; pos >= 0; pos--) {
    const leftOk = pos === 0 || items[pos - 1].fact.key !== reask.fact.key;
    const rightOk = pos === items.length || items[pos].fact.key !== reask.fact.key;
    if (leftOk && rightOk) {
      items.splice(pos, 0, reask);
      return;
    }
  }
  // Dégénéré (le niveau ne contient que ce fait) : aucune position non adjacente —
  // on l'ajoute en fin (les deux occurrences resteront voisines, cas indécidable).
  items.push(reask);
}

/**
 * Options de composition (ENGINE §4/§7). `rotation` et `reaskKeys` sont **injectés**
 * par l'appelant serveur (compteur de niveau + faits ratés au niveau précédent) →
 * garde la fonction pure et déterministe.
 */
export interface BuildLevelOptions {
  /**
   * Compteur de rotation douce (§7) : départage les compétences à faiblesse égale.
   * Défaut `0` (aucune rotation).
   */
  readonly rotation?: number;
  /**
   * Clés des faits à **re-ask** (ratés à revoir dans CE niveau, §4/§9). Un fait dont
   * la clé est ici et qui figure dans le niveau réapparaît une fois (non comptée).
   * Défaut : aucun re-ask.
   */
  readonly reaskKeys?: ReadonlySet<string>;
}

/**
 * **Compose un niveau** (~10 questions) à partir de la maîtrise du périmètre (ENGINE
 * §4 & §7). Étapes (pseudo-code §4) :
 *
 * 1. **périmètre actif** = 1 compétence (bloqué) → 2/3/4 (interleaving) selon la
 *    maîtrise, la plus faible en tête (rotation douce sur égalité) ;
 * 2. **pools** DUE / NEW / MAINT restreints au périmètre actif ;
 * 3. **cap de nouveaux** = `0` si `weak ≥ consolidationThreshold`, sinon
 *    `newMaxPerLevel` ;
 * 4. `~70 %` DUE d'abord (consolidation), puis NEW (≤ cap), puis MAINT ;
 * 5. si `< LEVEL_SIZE` (début de jeu, peu de DUE) → compléter avec du **NEW** en
 *    respectant le cap, puis MAINT restant ;
 * 6. **ordonner** facile → dur → presque-su (finir sur une victoire) ;
 * 7. insérer les **re-ask** (un par raté, jamais adjacent), tronquer à un niveau propre.
 *
 * @param scope état de maîtrise de **tous** les faits du domaine (fait + `state|null`).
 * @param config config moteur ⚙️ (3.2).
 * @param now instant courant **injecté** (epoch ms) — base des échéances DUE/MAINT.
 * @param options `rotation` (rotation douce) + `reaskKeys` (re-ask), injectés.
 * @returns liste ordonnée de `LevelItem` (~`LEVEL_SIZE`, plus les re-ask éventuels).
 *   Sans doublon d'items nominaux, jamais deux fois le même fait d'affilée.
 */
export function buildLevel(
  scope: readonly ScopeEntry[],
  config: EngineConfig,
  now: number,
  options: BuildLevelOptions = {},
): LevelItem[] {
  const rotation = options.rotation ?? 0;
  const reaskKeys = options.reaskKeys ?? new Set<string>();

  // 1. Périmètre actif (§7 : bloqué → interleaving).
  const activeSkills = new Set(selectActiveSkills(scope, config, rotation));
  const active = scope.filter((entry) => activeSkills.has(entry.fact.skill));

  // 2. Pools DUE / NEW / MAINT dans le périmètre actif (§4).
  const due = active
    .filter((entry) => entry.state !== null && isDue(entry.state, config, now))
    .sort(compareDue);
  const neu = active.filter((entry) => entry.state === null);
  const maint = active.filter((entry) => entry.state !== null && isMaint(entry.state, config, now));

  // 3. Cap de nouveaux : 0 si trop de fragiles (consolidation pure, §7), sinon ⚙️.
  const weak = active.filter(
    (entry) => entry.state === null || isWeak(entry.state!, config),
  ).length;
  const capNew = weak >= config.consolidationThreshold ? 0 : config.newMaxPerLevel;

  // 4. Composition : ~70 % DUE, puis NEW (≤ cap), puis MAINT (§4).
  const picked: ScopeEntry[] = [];
  const seen = new Set<string>(); // anti-doublon d'items nominaux
  const take = (pool: readonly ScopeEntry[], upTo: number): void => {
    for (const entry of pool) {
      if (picked.length >= upTo) {
        break;
      }
      if (!seen.has(entry.fact.key)) {
        picked.push(entry);
        seen.add(entry.fact.key);
      }
    }
  };

  take(due, DUE_TARGET); // priorité consolidation (~70 %)
  const newTaken = pickNew(neu, capNew, seen, picked); // introduit peu de nouveaux
  take(maint, LEVEL_SIZE); // entretien pour compléter le reste

  // 5. Début de jeu (peu de DUE/MAINT) : compléter par du DUE restant puis du NEW,
  //    toujours dans la limite du cap de nouveaux et de LEVEL_SIZE.
  take(due, LEVEL_SIZE); // DUE au-delà du quota des 70 % si la place reste
  pickNew(neu, capNew - newTaken, seen, picked); // NEW additionnel sous le cap résiduel

  const level = picked.slice(0, LEVEL_SIZE);

  // 6. Ordonner facile → dur → presque-su (finir sur une victoire, §4).
  const ordered = orderForVictory(level);

  // 7. Re-ask intra-niveau (un par raté, jamais adjacent, §4/§9).
  return insertReasks(ordered, reaskKeys);
}

/**
 * Prend jusqu'à `capNew` faits **NEW** non déjà retenus, en respectant l'anti-doublon
 * global et `LEVEL_SIZE`. Renvoie le **nombre effectivement pris** (pour décompter le
 * cap résiduel au remplissage de début de partie). Un `capNew ≤ 0` ne prend rien
 * (consolidation pure / cap déjà consommé). Mute `seen`/`picked` (helper interne).
 */
function pickNew(
  neu: readonly ScopeEntry[],
  capNew: number,
  seen: Set<string>,
  picked: ScopeEntry[],
): number {
  let taken = 0;
  for (const entry of neu) {
    if (taken >= capNew || picked.length >= LEVEL_SIZE) {
      break;
    }
    if (!seen.has(entry.fact.key)) {
      picked.push(entry);
      seen.add(entry.fact.key);
      taken += 1;
    }
  }
  return taken;
}
