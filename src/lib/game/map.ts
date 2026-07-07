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
 * - **Géométrie invariante** (MAP §4) : le monde a **toujours** `levelsPerWorld + 1`
 *   nœuds aux **mêmes positions** — la dette **ne change JAMAIS** le nombre de nœuds ni
 *   les positions ni les `level_index` (progression `progress` stable et monotone).
 * - **Boss toujours en dernier** (MAP §6) : le dernier nœud du chemin est le boss,
 *   quelle que soit la cadence des trésors ; **jamais** typé révision.
 * - **Cadence trésor** (MAP §3) : un nœud trésor ~tous les `treasureEvery` nœuds ⚙️
 *   (jamais à la place du boss).
 * - **Révision = overlay de type sur le nœud courant** (MAP §5) : si
 *   `dette_revision > revisionDebtThreshold` ⚙️ et le nœud **courant** (prochain à jouer)
 *   n'est pas le boss, ce **seul** nœud courant est **typé** `revision` au lieu de son
 *   type de base (remédiation **immédiate**). Ce n'est **pas** un nœud ajouté : la
 *   géométrie reste inchangée (MAP §4). L'overlay écrase le type de base même s'il était
 *   trésor (la remédiation prime le bonus pour ce créneau).
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
 * **Type de base** d'un nœud selon sa position (avant overlay/état). Boss en dernier
 * (prime sur tout), sinon trésor à cadence, sinon normal. La révision n'apparaît pas
 * ici : c'est un **overlay dynamique** posé sur le nœud **courant** (cf. `buildMap`),
 * pas un type dérivé d'une position fixe (MAP §5).
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
 * **Type de base d'un nœud à un `level_index` donné** (MAP §2/§3/§6), dérivé de la seule
 * géométrie ⚙️ (`levelsPerWorld`, `treasureEvery`) — **pur, sans I/O, sans dette**. Sert au
 * **serveur** (fin de niveau, 5.5) à déterminer le type du nœud complété (ex. bonus trésor)
 * **sans faire confiance au client** (source de vérité serveur, SYNC §1) : le montant de
 * pièces dépend du type, qui est recalculé côté serveur depuis la position, jamais transmis.
 *
 * Renvoie le type **de base** (`normal`/`treasure`/`boss`) — **pas** l'overlay `revision`,
 * qui est un état dynamique de l'affichage carte (MAP §5) : du point de vue du **gain**, un
 * nœud en révision reste le nœud de base à cette position (son bonus est celui de sa
 * position). La géométrie étant **invariante à la dette** (MAP §4, cf. `baseNodeTypes`), ce
 * type est **stable** pour un `level_index` donné → cohérent avec la clé de persistance.
 *
 * @param levelIndex position 0-based du nœud (son `level_index` de progression).
 * @param config ⚙️ carte (`MapConfig`) — `levelsPerWorld` fixe la position du boss (dernier),
 *   `treasureEvery` la cadence des trésors.
 */
export function baseNodeTypeAt(levelIndex: number, config: MapConfig): NodeType {
  // Géométrie invariante (MAP §4) : `levelsPerWorld + 1` nœuds, boss = dernier index.
  const lastIndex = config.levelsPerWorld;
  return typeForPosition(levelIndex, lastIndex, config.treasureEvery);
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
 * valeur, seule l'esthétique du tracé. Remonté 0.35 → 0.5 (ADR 0010, playtest) pour un
 * serpentin plus marqué : `x` couvre ~tout `[0, 1]` (translateX ≈ ±50% de la pastille)
 * sans jamais épingler durablement les nœuds aux bords (0.5 n'atteint le clamp qu'aux
 * extrêmes rand=0/1, mesure nulle) — combiné au trait désormais visible, le tracé se
 * lit comme un chemin voulu et non comme des ronds désalignés.
 */
const JITTER_X = 0.5;

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
 * Séquence des **types de base** des nœuds d'un monde (MAP §3/§6), dans l'ordre du
 * chemin — **indépendante de la dette**. Base = `levelsPerWorld` niveaux (normal/trésor
 * selon la cadence) + 1 boss en dernier, soit `levelsPerWorld + 1` nœuds.
 *
 * **Géométrie invariante** (MAP §4, exigence data) : la dette **ne change JAMAIS** le
 * nombre de nœuds ni les positions. La révision est un **overlay de type** sur le nœud
 * courant (cf. `buildMap`), pas un nœud ajouté — le monde a toujours le même nombre de
 * nœuds et les mêmes `level_index` d'une visite à l'autre → `progress` stable et monotone
 * (MAP §4). Le boss reste **toujours en dernier** (dernier index).
 */
function baseNodeTypes(config: MapBuildConfig): NodeType[] {
  const { levelsPerWorld, treasureEvery } = config;
  // Nœuds normaux + boss. Le boss est le **dernier** — son index dans la base est
  // `levelsPerWorld` (0-based), soit `levelsPerWorld + 1` nœuds au total.
  const baseCount = levelsPerWorld + 1;
  const bossIndex = baseCount - 1;
  const types: NodeType[] = [];
  for (let i = 0; i < baseCount; i += 1) {
    types.push(typeForPosition(i, bossIndex, treasureEvery));
  }
  return types;
}

/**
 * Index du **nœud courant** = 1ᵉʳ index **non terminé** (déblocage linéaire, MAP §1). Un
 * niveau est terminé s'il a une entrée de progression. Renvoie `count` (au-delà du dernier
 * index) si **tout** est terminé → **aucun** nœud courant (le monde est bouclé, le boss
 * ouvre le monde suivant, hors 5.2). Balayage unique, déterministe.
 */
function firstUnfinishedIndex(starsByLevel: WorldProgress["starsByLevel"], count: number): number {
  for (let i = 0; i < count; i += 1) {
    if (!starsByLevel.has(i)) {
      return i;
    }
  }
  return count;
}

/**
 * `true` si le **nœud courant** doit être typé **révision** (MAP §5) : la dette dépasse
 * **strictement** le seuil ⚙️ (`debt > revisionDebtThreshold`, jamais `>=` — MAP §5
 * « > 12 »), un nœud courant existe (`currentIndex` dans les bornes → monde non 100 %
 * terminé), **et** ce nœud courant n'est **pas le boss** (le boss reste boss, priorité
 * MAP §6). L'overlay remplace le type de base du **seul** nœud courant (« prochain nœud à
 * jouer = révision », remédiation **immédiate**) — la géométrie (nombre de nœuds,
 * positions, `level_index`) reste **inchangée** (MAP §4).
 */
function shouldOverlayRevision(
  currentIndex: number,
  baseTypes: readonly NodeType[],
  debt: number,
  config: MapBuildConfig,
): boolean {
  // Pas de nœud courant (monde 100 % terminé) → `currentIndex === baseTypes.length` →
  // hors bornes → pas d'overlay.
  if (currentIndex >= baseTypes.length) {
    return false;
  }
  // Le nœud courant est le boss (il ne reste que lui) → pas d'overlay (priorité boss).
  if (baseTypes[currentIndex] === "boss") {
    return false;
  }
  // Borne stricte du seuil (MAP §5 « > 12 »).
  return debt > config.revisionDebtThreshold;
}

/**
 * **Compose la carte procédurale** d'un monde (MAP §3/§5/§6). Pure et déterministe :
 * mêmes `(worldIndex, input, config)` ⇒ même `WorldMap`.
 *
 * 1. **types de base** (normal/trésor/boss) + **positions**, déterministes depuis la seed
 *    `worldIndex` — **géométrie invariante** : indépendante de la dette (MAP §4) ;
 * 2. **nœud courant** = 1ᵉʳ non terminé (déblocage linéaire, MAP §1) ;
 * 3. **overlay révision** (MAP §5) : si `debt > seuil` et le nœud courant n'est pas le
 *    boss, ce **seul** nœud courant est typé `revision` (remédiation immédiate) — l'overlay
 *    écrase le type de base même s'il était trésor (la remédiation prime le bonus pour ce
 *    créneau) ; la géométrie ne bouge pas ;
 * 4. **état** de chaque nœud dérivé du progrès (jamais des étoiles) + **étoiles**
 *    d'affichage reportées.
 *
 * @param worldIndex index du monde (seed de la géométrie, MAP §3).
 * @param input progrès du monde (5.1) + dette de révision (moteur 3.4).
 * @param config ⚙️ carte (`MapBuildConfig`) — nb de niveaux, cadence trésor, seuil
 *   révision. Jamais de valeur en dur (CLAUDE.md §Paramètres ⚙️).
 * @returns la carte du monde (nœuds ordonnés, boss en dernier ; nombre de nœuds et
 *   positions **indépendants de la dette**).
 */
export function buildMap(
  worldIndex: number,
  input: BuildMapInput,
  config: MapBuildConfig,
): WorldMap {
  // 1. Géométrie **invariante** : types de base + positions ne dépendent que de la seed et
  //    de la config de structure — **jamais** de la dette (MAP §4 : `level_index` stable).
  const baseTypes = baseNodeTypes(config);
  const positions = computePositions(worldIndex, baseTypes.length);
  const { starsByLevel } = input.progress;

  // 2. Nœud courant (déblocage linéaire, MAP §1).
  const currentIndex = firstUnfinishedIndex(starsByLevel, baseTypes.length);

  // 3. Overlay révision sur le **seul** nœud courant (MAP §5) — remédiation immédiate,
  //    géométrie inchangée. Décidé une fois (pas dans la boucle) : un seul overlay possible.
  const overlayRevision = shouldOverlayRevision(currentIndex, baseTypes, input.debt, config);

  const nodes: MapNode[] = baseTypes.map((baseType, index) => {
    const completed = starsByLevel.has(index);
    // Le type effectif = révision si l'overlay s'applique à CE nœud (le courant), sinon
    // le type de base. Le boss n'est jamais overlay-é (garanti par `shouldOverlayRevision`).
    const type: NodeType = overlayRevision && index === currentIndex ? "revision" : baseType;
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
