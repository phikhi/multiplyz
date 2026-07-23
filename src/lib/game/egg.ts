/**
 * **Logique PURE du tirage d'œuf** (gacha) — story R4.2 (#393, ECONOMY §4.2/§5/§7). Module **pur**
 * (aucune I/O, aucun `server-only`) : la sélection de rareté (odds **normalisées** dans le pool
 * atteignable), la **pitié anti-malchance** et le barème doublon→éclats vivent ici, **testables à
 * 100 % sans base** (même discipline que `engine/*` / `game/session.ts` : extraire la logique en
 * modules purs plutôt que la noyer dans la transaction). La couche `game/egg-draw.ts` (server-only)
 * ne fait que **câbler** ces fonctions à la persistance atomique (débit + possession + éclats + pitié).
 *
 * **Odds NON normalisées par contrat (R4.1 #164)** : `eggOddsCommon`/`eggOddsRare` ne sont **jamais**
 * garanties sommer à 1 (chaque borne est calibrée indépendamment, cf. `EconomySpendConfig`). Le
 * tirage **normalise DANS le pool atteignable** : (a) le dénominateur de la sélection de rareté est
 * `oddsCommon + oddsRare` (jamais supposé = 1) ; (b) si une rareté est **absente** du pool des mondes
 * débloqués (ex. un monde sans rare encore débloqué), son poids retombe à 0 et l'autre rareté est
 * tirée à coup sûr. Aucune supposition d'un pool figé.
 *
 * **Aléa injecté** (`rand: () => number` dans `[0,1)`, comme l'horloge `now` — LEARNINGS #46) :
 * déterministe et reproductible en test, vrai `Math.random` en production. **Ordre de consommation
 * INVARIANT** : `drawFromEggPool` tire **toujours** exactement deux nombres — d'abord le *rarity roll*,
 * puis l'*index roll* — quelle que soit la composition du pool (même quand une seule rareté est
 * présente, le rarity roll est consommé mais sans effet) → séquence d'aléa stable, testable.
 */

/** Rareté **tirable** d'un œuf (les légendaires sont exclues : boss only, ECONOMY §2/§4.2). */
export type EggRarity = "common" | "rare";

/**
 * Une créature **candidate** du pool d'œufs (déjà filtrée `in_egg_pool = true` + mondes débloqués
 * par la couche server-only). `owned` = le profil la possède **déjà** (⇒ un tirage serait un doublon).
 */
export interface EggPoolCreature {
  readonly id: string;
  readonly worldIndex: number;
  readonly rarity: EggRarity;
  readonly owned: boolean;
}

/** Issue d'un tirage : la créature sélectionnée + si elle est **nouvelle** + si la **pitié** a agi. */
export interface EggDrawOutcome {
  readonly creature: EggPoolCreature;
  /** `true` si la créature n'était PAS encore possédée (⇒ nouvelle) ; `false` = doublon (→ éclats). */
  readonly isNew: boolean;
  /**
   * `true` si la **pitié** a **forcé** la sélection dans le sous-ensemble des non-possédées (garantie
   * anti-malchance ECONOMY §7). `false` si la pitié n'était pas active, OU si elle l'était mais qu'il
   * ne restait **aucune** nouveauté à garantir (complétude déjà atteinte — le tirage retombe alors
   * sur un doublon utile, jamais bloqué).
   */
  readonly pityApplied: boolean;
}

/**
 * `true` si la **pitié** doit s'appliquer au prochain tirage (ECONOMY §4.2/§7 : « après N doublons
 * d'affilée, le prochain tirage est garanti nouveau »). Le seuil est **atteint ou dépassé** (`>=`)
 * `pityThreshold` doublons consécutifs. Pure — le comptage persistant vit dans `egg-draw.ts`.
 *
 * Borne exacte **mutation-prouvée** (`consecutiveDuplicates === pityThreshold` = actif, `=== threshold − 1`
 * = inactif) : un `>` au lieu de `>=` retarderait la garantie d'un tirage (frustration), un `<` la
 * casserait — le test de borne rougit sur l'un comme sur l'autre.
 */
export function isPityActive(consecutiveDuplicates: number, pityThreshold: number): boolean {
  return consecutiveDuplicates >= pityThreshold;
}

/**
 * Éclats ✨ rendus par un **doublon** selon sa rareté (ECONOMY §4.2/§5, défaut commune 10 / rare 25).
 * Pure. Un doublon est **toujours utile** (« jamais rien », garde-fou verrouillé ECONOMY §1) : les
 * montants viennent de la config ⚙️ (déjà bornés `≥ 1` au chargement, jamais 0/négatif ici).
 *
 * Barème **mutation-prouvé** : intervertir les deux montants (commune↔rare) rougit le test nommé
 * « doublon commune → 10 ✨ / rare → 25 ✨ ».
 */
export function duplicateShardsFor(
  rarity: EggRarity,
  duplicateShardsCommon: number,
  duplicateShardsRare: number,
): number {
  return rarity === "common" ? duplicateShardsCommon : duplicateShardsRare;
}

/**
 * **Sélectionne une créature du pool d'œufs** (gacha, ECONOMY §4.2). Pure et déterministe pour un
 * `rand` donné. Retourne `null` **uniquement** si le pool est vide (aucune créature tirable — garde de
 * forme ; la couche server-only n'entre jamais ici avec un pool vide, elle débite déjà pas).
 *
 * Algorithme :
 * 1. **Pitié** (ECONOMY §7) : si `pityActive` ET qu'il existe ≥ 1 créature **non possédée** dans le
 *    pool → on **restreint** les candidates à ces non-possédées (⇒ nouveauté **garantie**,
 *    `pityApplied = true`). Sinon les candidates = tout le pool (`pityApplied = false` — pitié inactive,
 *    OU aucune nouveauté à garantir : complétude atteinte, on tire un doublon utile).
 * 2. **Rareté** (odds **normalisées dans le pool atteignable**) : si les candidates contiennent des
 *    communes ET des rares, on tire la rareté avec `rarityRoll × (oddsCommon + oddsRare) < oddsCommon`
 *    (dénominateur = somme réelle, **jamais supposée 1**, R4.1 #164). Si une seule rareté est présente,
 *    elle est choisie d'office (poids de l'autre = 0, normalisation par composition).
 * 3. **Créature** : tirage **uniforme** dans la rareté choisie via `indexRoll`.
 *
 * `rand()` est appelé **exactement deux fois** (rarity roll puis index roll), toujours dans cet ordre,
 * quelle que soit la composition (séquence d'aléa invariante — cf. en-tête du module).
 */
export function drawFromEggPool(
  pool: readonly EggPoolCreature[],
  oddsCommon: number,
  oddsRare: number,
  pityActive: boolean,
  rand: () => number,
): EggDrawOutcome | null {
  if (pool.length === 0) {
    return null;
  }

  // 1. PITIÉ : restreint aux non-possédées SEULEMENT si la pitié est active ET qu'une nouveauté existe.
  const unowned = pool.filter((c) => !c.owned);
  const pityApplied = pityActive && unowned.length > 0;
  const candidates = pityApplied ? unowned : pool;

  // Ordre de consommation INVARIANT : rarity roll PUIS index roll (toujours 2 tirages, cf. en-tête).
  const rarityRoll = rand();
  const indexRoll = rand();

  // 2. RARETÉ (odds normalisées dans le pool atteignable — dénominateur = somme réelle, jamais 1).
  const commons = candidates.filter((c) => c.rarity === "common");
  const rares = candidates.filter((c) => c.rarity === "rare");
  let chosen: readonly EggPoolCreature[];
  if (commons.length > 0 && rares.length > 0) {
    const total = oddsCommon + oddsRare;
    // `total > 0` par contrat (odds `]0,1]`) ; garde de forme si une calibration extrême donnait 0.
    const wantCommon = total > 0 ? rarityRoll * total < oddsCommon : true;
    chosen = wantCommon ? commons : rares;
  } else if (commons.length > 0) {
    chosen = commons; // pool sans rare atteignable → commune à coup sûr (normalisation par composition).
  } else {
    chosen = rares; // pool sans commune atteignable → rare à coup sûr.
  }

  // 3. CRÉATURE : tirage uniforme dans la rareté choisie (borne haute clampée pour `indexRoll → 1`).
  const index = Math.min(chosen.length - 1, Math.floor(indexRoll * chosen.length));
  const creature = chosen[index];
  return { creature, isNew: !creature.owned, pityApplied };
}
