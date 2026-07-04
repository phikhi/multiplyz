/**
 * Carte procédurale d'un monde (MAP.md §3/§5/§6) — **géométrie déterministe** +
 * **types de nœuds**. Fonction **pure** et **déterministe** : `buildMap` transforme
 * `(world_index, progress, dette)` en une **liste de nœuds** (index, position, type,
 * état) → **rien à stocker** par nœud (MAP §3 : la géométrie est régénérée à la volée
 * depuis la seed `world_index`).
 *
 * Invariants (garde-fous testés à effet observable, cf. CLAUDE.md §Tests/CI) :
 * - **Déterminisme total** : même `world_index` ⇒ mêmes positions. Aucun `Math.random`
 *   ni `Date.now()` — la seule source d'aléa est un **PRNG seedé** par `world_index`
 *   (LEARNINGS aléa/#34 : pas de branche probabiliste sous gate coverage 100 %).
 * - **Boss toujours en dernier** (MAP §6) : le dernier nœud du chemin est le boss,
 *   quelles que soient la cadence des trésors et l'insertion de révision.
 * - **Cadence trésor** (MAP §3) : un nœud trésor ~tous les `treasureEvery` nœuds ⚙️
 *   (jamais à la place du boss).
 * - **Révision dynamique** (MAP §5) : si `dette_revision > revisionDebtThreshold` ⚙️,
 *   un nœud **révision** est inséré (le monde compte alors un nœud de plus — on ne
 *   « vole » pas un niveau normal, l'aventure garde son fil).
 * - **Déblocage linéaire** (MAP §1) : l'état d'un nœud dérive du **progrès** (niveaux
 *   terminés), **jamais** des étoiles — les étoiles sont une récompense d'affichage,
 *   **jamais** une barrière. Un seul nœud « courant » (le 1ᵉʳ non terminé) ; les
 *   suivants sont verrouillés, les précédents terminés.
 *
 * **Pur / sans I/O** : l'appelant serveur fournit `progress` (mappé depuis la table
 * `progress`, 5.1) et `debt` (via `computeRevisionDebt` du moteur, 3.4) — ce module ne
 * lit ni la DB ni l'horloge. La **dette** est calculée par le moteur (CLAUDE.md : la
 * logique de maîtrise/dus vit côté serveur, non réinventée dans la couche jeu).
 */

import type { MapConfig } from "@/config/server-config";

/**
 * ⚙️ nécessaires à la composition de la carte. La **structure** (`MapConfig` :
 * `levelsPerWorld`, `treasureEvery`, `bossQuestionCount`) vient du bloc **carte** de la
 * config ; le **seuil de dette de révision** (`revisionDebtThreshold`) est un seuil
 * **pédagogique** qui vit dans `EngineConfig` (même famille que `consolidationThreshold`,
 * comparé à une dette calculée par le moteur — CLAUDE.md). L'appelant serveur compose ce
 * type depuis `getMapConfig()` + `getEngineConfig().revisionDebtThreshold` → `buildMap`
 * reste **pure** et n'importe pas la couche config au runtime (juste le type).
 */
export type MapBuildConfig = MapConfig & {
  /** Seuil de dette de révision (MAP §5, source = `EngineConfig.revisionDebtThreshold`). */
  readonly revisionDebtThreshold: number;
};

/** Type d'un nœud de la carte (MAP §2). */
export type NodeType = "normal" | "treasure" | "boss" | "revision";

/** État d'un nœud dérivé du progrès (déblocage linéaire, MAP §1/§4). */
export type NodeStatus = "completed" | "current" | "locked";

/**
 * Étoiles d'un niveau (0..3, MAP §4). Miroir du type `Stars` du schéma (5.1) — dupliqué
 * ici pour garder `map.ts` **pur et client-safe** (aucun import de la couche DB
 * server-only, LEARNINGS #? : constantes/formes partagées dans un module pur).
 */
export type MapStars = 0 | 1 | 2 | 3;

/**
 * **Progression d'un monde** vue par la carte : les étoiles obtenues **par niveau**
 * (clé = `level_index`). Fourni par l'appelant serveur (lignes `progress` du monde,
 * 5.1). Un `level_index` absent = niveau **jamais joué** (0 étoile, pas encore
 * terminé — no-fail : « pas encore fait » est un état normal, MAP §4).
 */
export interface WorldProgress {
  /**
   * Étoiles par `level_index` **normal** (0-based sur les nœuds jouables : niveaux
   * normaux + révision + trésor + boss, dans l'ordre du chemin). Une entrée présente ⇒
   * le nœud est **terminé**. Absente ⇒ pas encore terminé.
   */
  readonly starsByLevel: ReadonlyMap<number, MapStars>;
}

/** Un nœud de la carte (MAP §2/§3). Structure dérivée, non stockée (MAP §3). */
export interface MapNode {
  /**
   * Position du nœud dans le chemin (0-based) = son `level_index` de progression. Le
   * dernier index est le boss. Contigu et croissant.
   */
  readonly index: number;
  /**
   * Position **géométrique** normalisée dans `[0, 1]²` (MAP §3) — déterministe depuis
   * `world_index`. L'UI (hors 5.2) la projette dans son viewport.
   */
  readonly position: MapPosition;
  /** Type du nœud (MAP §2). */
  readonly type: NodeType;
  /** État dérivé du progrès (déblocage linéaire, MAP §1). */
  readonly status: NodeStatus;
  /**
   * Étoiles obtenues sur ce nœud (0..3). `0` si pas encore terminé (no-fail). Sert à
   * l'**affichage/collection**, **jamais** au déblocage (MAP §4).
   */
  readonly stars: MapStars;
}

/** Position géométrique normalisée d'un nœud dans `[0, 1]²` (MAP §3). */
export interface MapPosition {
  readonly x: number;
  readonly y: number;
}

/** La carte procédurale complète d'un monde. */
export interface WorldMap {
  /** Index du monde (seed de la géométrie, MAP §3). */
  readonly worldIndex: number;
  /** Nœuds dans l'ordre du chemin (le dernier est le boss). */
  readonly nodes: readonly MapNode[];
}

/** Entrées de `buildMap` (progrès du monde + dette de révision du profil). */
export interface BuildMapInput {
  /** Étoiles par niveau du monde (5.1). */
  readonly progress: WorldProgress;
  /**
   * **Dette de révision** du profil (nombre de faits DUE, MAP §5) — calculée par le
   * moteur (`computeRevisionDebt`, 3.4/CLAUDE.md), injectée ici. La carte ne fait que la
   * **comparer** au seuil ⚙️, elle ne recalcule pas la maîtrise.
   */
  readonly debt: number;
}

/**
 * **Type intrinsèque** d'un nœud selon sa position (avant état de progression). Boss en
 * dernier (prime sur tout), sinon trésor à cadence, sinon normal. La révision n'apparaît
 * pas ici : elle est **insérée dynamiquement** (cf. `buildMap`), pas dérivée d'une
 * position fixe (MAP §5).
 *
 * @param index position 0-based du nœud dans le chemin.
 * @param lastIndex index du **dernier** nœud (= boss).
 * @param treasureEvery cadence ⚙️ des trésors (MAP §3).
 */
function typeForPosition(index: number, lastIndex: number, treasureEvery: number): NodeType {
  // Boss **toujours** en dernier (MAP §6) — priorité absolue : même si la position du
  // boss tombe sur un multiple de la cadence trésor, elle reste boss.
  if (index === lastIndex) {
    return "boss";
  }
  // Trésor ~tous les `treasureEvery` nœuds (MAP §3). On compte à partir de 1 (le
  // `treasureEvery`-ième, le `2×`-ième…) : `(index + 1) % treasureEvery === 0`. Le nœud
  // 0 n'est donc jamais un trésor (démarrage sur un niveau normal).
  if ((index + 1) % treasureEvery === 0) {
    return "treasure";
  }
  return "normal";
}

/**
 * PRNG **déterministe** seedé (mulberry32) — aucune dépendance à `Math.random`. Produit
 * une suite reproductible de flottants `[0, 1)` à partir d'une seed entière. Utilisé pour
 * jitterer les positions des nœuds : même `world_index` ⇒ même suite ⇒ mêmes positions
 * (MAP §3 « géométrie déterministe depuis world_index »). Générateur pur (état capturé
 * par la clôture), pas de branche probabiliste exposée au gate coverage.
 */
function makeSeededRandom(seed: number): () => number {
  // `>>> 0` : force un entier non signé 32 bits (seed négative/flottante normalisée).
  let a = seed >>> 0;
  return () => {
    a += 0x6d_2b_79_f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Amplitude du jitter horizontal (fraction de `[0, 1]`) autour de l'axe serpentin. Le
 * chemin monte régulièrement en `y` (progression), et `x` serpente ±`JITTER_X` autour
 * du centre pour un tracé « Candy Crush » organique mais **déterministe**. ⚙️ visuel
 * local (pas un réglage pédagogique) — la structure/les types ne dépendent pas de sa
 * valeur, seule l'esthétique du tracé.
 */
const JITTER_X = 0.35;

/**
 * Positions **déterministes** des `count` nœuds d'un monde (MAP §3). Le chemin progresse
 * en `y` de haut (0) en bas (1) — un pas régulier `i / (count − 1)` — et serpente en `x`
 * autour du centre `0.5` avec un décalage seedé par `world_index`. Reproductible : même
 * `world_index` + même `count` ⇒ mêmes positions.
 *
 * Pour `count === 1` (monde dégénéré, cf. bornes de config), le seul nœud est centré
 * (`y = 0`) — pas de division par zéro (`count − 1 = 0`).
 */
function computePositions(worldIndex: number, count: number): MapPosition[] {
  const rand = makeSeededRandom(worldIndex);
  const positions: MapPosition[] = [];
  for (let i = 0; i < count; i += 1) {
    // `y` : progression régulière du chemin. `count === 1` → dénominateur 0 → on force 0.
    const y = count === 1 ? 0 : i / (count - 1);
    // `x` : serpentin centré. `rand()` ∈ [0,1) → décalage ∈ [−JITTER_X, +JITTER_X),
    // clampé dans [0, 1] pour rester dans le cadre normalisé.
    const offset = (rand() * 2 - 1) * JITTER_X;
    const x = Math.min(1, Math.max(0, 0.5 + offset));
    positions.push({ x, y });
  }
  return positions;
}

/**
 * Résout l'**état** (déblocage linéaire, MAP §1/§4) d'un nœud à partir du progrès.
 *
 * - **terminé** : le niveau a une entrée de progression (joué au moins une fois) ;
 * - **courant** : le **premier** niveau non terminé (le seul nœud jouable « ouvert ») ;
 * - **verrouillé** : tout niveau après le courant.
 *
 * **Jamais** fondé sur les étoiles (MAP §1 : les étoiles ne sont **pas** une barrière) —
 * seul le fait d'avoir terminé un niveau ouvre le suivant. `currentIndex` = index du
 * premier non-terminé (fourni par `buildMap` après un balayage unique).
 */
function statusForNode(index: number, currentIndex: number, completed: boolean): NodeStatus {
  if (completed) {
    return "completed";
  }
  return index === currentIndex ? "current" : "locked";
}

/**
 * Séquence des **types** de nœuds d'un monde (MAP §3/§5/§6), dans l'ordre du chemin.
 *
 * Base = `levelsPerWorld` niveaux (normal/trésor selon la cadence) + 1 boss en dernier.
 * **Insertion révision** (MAP §5) : si `debt > revisionDebtThreshold`, un nœud
 * **révision** est **ajouté** juste avant le boss (le monde a alors un nœud de plus) —
 * on ne remplace pas un niveau normal (le fil de l'aventure et le compte de niveaux
 * normaux sont préservés ; la révision est un « en plus » pour résorber la dette).
 *
 * Le boss reste **toujours en dernier** après insertion (garde-fou testé à effet
 * observable). La cadence des trésors est calculée sur les positions **normales** (avant
 * insertion révision) → l'ajout d'un nœud révision ne décale pas la cadence des trésors.
 */
function nodeTypes(debt: number, config: MapBuildConfig): NodeType[] {
  const { levelsPerWorld, treasureEvery } = config;
  // Nœuds normaux + boss. Le boss est le **dernier** — son index dans la base est
  // `levelsPerWorld` (0-based), soit `levelsPerWorld + 1` nœuds au total.
  const baseCount = levelsPerWorld + 1;
  const bossIndex = baseCount - 1;
  const types: NodeType[] = [];
  for (let i = 0; i < baseCount; i += 1) {
    types.push(typeForPosition(i, bossIndex, treasureEvery));
  }
  // Insertion **révision** dynamique (MAP §5) : au-dessus du seuil, ajouter un nœud
  // révision **juste avant le boss** (avant-dernière position). `splice(len − 1, 0, …)`
  // insère avant le dernier élément → le boss reste en dernier.
  if (debt > config.revisionDebtThreshold) {
    types.splice(types.length - 1, 0, "revision");
  }
  return types;
}

/**
 * **Compose la carte procédurale** d'un monde (MAP §3/§5/§6). Pure et déterministe :
 * mêmes `(worldIndex, input, config)` ⇒ même `WorldMap`.
 *
 * 1. **types** des nœuds (normal/trésor/boss + révision dynamique selon la dette) ;
 * 2. **positions** déterministes seedées par `worldIndex` (une par nœud, révision
 *    comprise) ;
 * 3. **état** de chaque nœud dérivé du progrès (déblocage linéaire, jamais des étoiles) ;
 * 4. **étoiles** d'affichage reportées depuis le progrès.
 *
 * @param worldIndex index du monde (seed de la géométrie, MAP §3).
 * @param input progrès du monde (5.1) + dette de révision (moteur 3.4).
 * @param config ⚙️ carte (`MapBuildConfig`) — nb de niveaux, cadence trésor, seuil
 *   révision. Jamais de valeur en dur (CLAUDE.md §Paramètres ⚙️).
 * @returns la carte du monde (nœuds ordonnés, boss en dernier).
 */
export function buildMap(
  worldIndex: number,
  input: BuildMapInput,
  config: MapBuildConfig,
): WorldMap {
  const types = nodeTypes(input.debt, config);
  const positions = computePositions(worldIndex, types.length);
  const { starsByLevel } = input.progress;

  // Nœud courant = 1ᵉʳ index **non terminé** (déblocage linéaire, MAP §1). Un niveau est
  // terminé s'il a une entrée de progression. `types.length` (au-delà du dernier index)
  // si **tout** est terminé → aucun nœud « courant » (le monde est bouclé, le boss ouvre
  // le monde suivant, hors 5.2).
  let currentIndex = types.length;
  for (let i = 0; i < types.length; i += 1) {
    if (!starsByLevel.has(i)) {
      currentIndex = i;
      break;
    }
  }

  const nodes: MapNode[] = types.map((type, index) => {
    const completed = starsByLevel.has(index);
    return {
      index,
      position: positions[index],
      type,
      status: statusForNode(index, currentIndex, completed),
      // Étoiles d'affichage : la valeur du progrès si terminé, 0 sinon (no-fail).
      stars: starsByLevel.get(index) ?? 0,
    };
  });

  return { worldIndex, nodes };
}
