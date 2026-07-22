/**
 * Orchestration serveur de la **fin de niveau** (MAP §1/§4/§6, PRODUCT §1.3/§2.2/§2.3,
 * ECONOMY §4.1, SYNC).
 *
 * Câble, dans **UNE** transaction synchrone better-sqlite3 (`db.transaction`, callback
 * **sans `await`**), la garde de déblocage (`unlock.ts`) à **plusieurs écritures atomiques** :
 * 1. la progression monotone (`recordStars`, 5.1) — 1ʳᵉ écriture ;
 * 2. le crédit de pièces au portefeuille (`creditWalletInTx`, 5.1) — 2ᵉ écriture ;
 * 3. la ligne de journal `ledger` (dans `creditWalletInTx`) — 3ᵉ écriture ;
 * 4. **(boss uniquement, 5.6)** l'ajout de la **légendaire garantie** à la collection
 *    (`grantLegendaryInTx` : upsert catalogue + INSERT possession) — 4ᵉ/5ᵉ écritures.
 *
 * **Transaction MULTI-ÉCRITURES (≥2)** — atomicité **requise et prouvée** (règle #122/#124) :
 * la transaction protège **plusieurs écritures** (progress + wallet + ledger + collection).
 * Si une écriture **postérieure** à la 1ʳᵉ échoue (ex. l'INSERT `collection`), la transaction
 * **rollback** : ni les étoiles, ni le crédit, ni la légendaire ne sont persistés (aucun état
 * partiel — un enfant ne peut pas se retrouver avec la légendaire sans progression, ni
 * l'inverse). Cette propriété est **mutation-prouvée** : retirer le wrapper `db.transaction`
 * casse le test de rollback de `finish-level.test.ts` (la panne frappe l'écriture **gardée** —
 * colonne manquante — APRÈS la 1ʳᵉ écriture `recordStars`, jamais une lecture en amont ; cf.
 * règle durcie #122 : `DROP TABLE` d'une table lue en amont = anti-pattern, on casse l'écriture).
 *
 * **Idempotence** (progression idempotente CLAUDE.md, SYNC §2) — rejeu d'une **même fin de
 * niveau** ⇒ **aucun double effet** :
 * - `recordStars` upsert par PK encodée → une seule ligne progress, `max(existant, nouveau)` ;
 * - `creditWalletInTx` détecte la clé de rejeu `ref_id = level:<world>:<level>` déjà
 *   journalisée → **aucun 2ᵉ crédit, aucune 2ᵉ ligne ledger** (`applied: false`).
 * Le rejeu renvoie donc le solde **inchangé** et le breakdown du barème (idempotent, pas
 * de double pièces) — testé à effet observable (`finish-level.test.ts`).
 *
 * **Barème = config versionnée** (ECONOMY §3) : le montant vient de `EconomyConfig` +
 * `computeLevelReward` (`reward.ts`, pur) — **jamais** de valeur en dur. Le **type de nœud**
 * (pour le bonus trésor) est **dérivé serveur** de la géométrie (`baseNodeTypeAt`), jamais
 * transmis par le client (source de vérité serveur, SYNC §1).
 *
 * **SERVER-ONLY** (importe la couche DB). Le `profileId` vient **toujours** de la session
 * (jamais du client, SYNC §1). `now` est injecté (horloge serveur, LEARNINGS #46).
 *
 * **Invariants** :
 * - **Source de vérité serveur** : un client ne peut pas persister la complétion d'un
 *   niveau **verrouillé** (au-delà du nœud courant) — la garde `isLevelPlayable` rejette
 *   (déblocage linéaire MAP §1). Seul le nœud courant (ou un déjà-complété, rejoue) passe.
 * - **Déblocage jamais fondé sur les étoiles** (MAP §1/§8) : compléter le boss (dernier
 *   nœud) ouvre le monde suivant quel que soit le nombre d'étoiles.
 * - **L'éco ne bloque jamais l'apprentissage** (ECONOMY §1) : le crédit est **earn-side**
 *   pur (jamais de débit ici), et un échec de crédit rollback la fin de niveau entière —
 *   mais le barème est ≥ 0 par construction (`EconomyConfig`), donc le seul chemin d'échec
 *   réel est une panne d'infrastructure (colonne/table), pas une valeur métier.
 */

import type { AppDatabase } from "@/lib/db";
import type { EconomyConfig, MapConfig } from "@/config/server-config";
import type { Stars } from "@/lib/db/schema";
import { recordStars } from "./progress";
import { isLevelPlayable, isWorldUnlocked, loadWorldProgress } from "./unlock";
import { baseNodeTypeAt } from "./map";
import { computeLevelReward, type RewardBreakdown } from "./reward";
import { assertPositiveAmount, creditWalletInTx, loadWallet, type WalletBalance } from "./wallet";
import { grantLegendaryInTx, legendaryForWorld } from "./collection";

/**
 * Cible **brute** (non fiable) d'une fin de niveau (endpoint public) — chaque champ est
 * validé au runtime avant usage (#36). `profileId` n'y figure **pas** : il vient de la
 * session (jamais du client, SYNC §1).
 */
export interface FinishLevelInput {
  /** Monde terminé — validé (entier ≥ 0, monde débloqué). */
  readonly worldIndex: unknown;
  /** Niveau terminé — validé (entier dans les bornes du monde, nœud jouable). */
  readonly levelIndex: unknown;
  /** Étoiles obtenues (0..3) — validées ; **jamais** une barrière de déblocage (MAP §1/§8). */
  readonly stars: unknown;
}

/**
 * **Légendaire garantie** d'un monde présentée à l'UI (écran résultats du boss, MAP §6).
 * Sous-ensemble d'affichage du descripteur catalogue (`legendaryForWorld`) — nom + histoire
 * + rareté + réf d'art **RÉELLE** de la légendaire (illustration committée, story R3.1 #378) ;
 * un `placeholder://…` ne subsiste que **hors socle** (repli no-fail côté UI, jamais bloquant).
 */
export interface GrantedLegendary {
  /** Clé de catalogue (`legendary:<world>`). */
  readonly characterId: string;
  /** Nom par défaut (déterministe, MAP §6) — renommable ensuite dans la collection. */
  readonly name: string;
  /** Ligne d'histoire déterministe de la légendaire (MAP §6, banques centralisées). */
  readonly story: string;
  /**
   * Réf d'art **RÉELLE** de la légendaire (`socle/creature/legendary_world_<i>.png`, art committé
   * R3.1 #378) → vrai art dans le médaillon de révélation. Un `placeholder://…` (hors socle) retombe
   * sur la silhouette/emoji de repli côté UI (`<AssetImage>` no-fail).
   */
  readonly artRef: string;
}

/** Motif de refus d'une fin de niveau mal formée / non autorisée (mappé vers une réponse neutre). */
export type FinishLevelError =
  /** Champ mal formé (non-entier, hors 0..3 pour les étoiles, index négatif). */
  | "INVALID_INPUT"
  /** Monde verrouillé (boss du monde précédent non complété) — déblocage linéaire. */
  | "WORLD_LOCKED"
  /** Niveau verrouillé dans le monde (au-delà du nœud courant) — déblocage linéaire. */
  | "LEVEL_LOCKED";

/** Issue d'une fin de niveau. */
export type FinishLevelResult =
  /** Persistée (ou rejouée) : étoiles **stockées** + pièces gagnées + si le monde suivant est ouvert. */
  | {
      readonly ok: true;
      /** Étoiles effectivement stockées après l'écriture monotone (`max(existant, nouveau)`). */
      readonly stars: Stars;
      /**
       * `true` si compléter ce niveau était le **boss** (dernier nœud) → monde suivant
       * **débloqué** (dérivé du progress, MAP §6). `false` pour un niveau non-boss.
       */
      readonly unlockedNextWorld: boolean;
      /**
       * **Décomposition** du gain de pièces (base + bonus étoiles + bonus trésor, ECONOMY
       * §4.1/§5). Toujours renvoyée (même montant au rejeu — barème déterministe). Le
       * `total` a été **crédité** au 1ᵉʳ passage ; au rejeu il n'est **pas re-crédité**
       * (idempotence) mais reste affiché (le breakdown décrit ce que le niveau **vaut**).
       */
      readonly reward: RewardBreakdown;
      /**
       * **Solde du portefeuille après** la fin de niveau (pièces + éclats, ECONOMY §3.1).
       * Reflète le crédit s'il a été appliqué ; au rejeu, c'est le solde **inchangé**
       * (aucun double crédit) → l'UI affiche un solde cohérent (source de vérité serveur).
       */
      readonly balance: WalletBalance;
      /** `false` si le crédit était un **rejeu** déjà journalisé (aucun 2ᵉ crédit appliqué). */
      readonly coinsApplied: boolean;
      /**
       * **Légendaire garantie** obtenue en battant le boss (MAP §6, ECONOMY §3.2), ou `null`
       * pour un niveau non-boss. Toujours renvoyée sur un boss (même au rejeu — la légendaire
       * décrit ce que le monde **donne**), mais `legendaryAdded` distingue la 1ʳᵉ obtention.
       */
      readonly legendary: GrantedLegendary | null;
      /**
       * `true` si la légendaire vient d'être **ajoutée** à la collection (1ʳᵉ victoire du boss) ;
       * `false` sur un niveau non-boss **ou** au rejeu d'un boss déjà battu (aucun doublon parasite).
       */
      readonly legendaryAdded: boolean;
    }
  /** Refus **propre** (pas un 500) : forme invalide ou niveau/monde verrouillé. */
  | { readonly ok: false; readonly error: FinishLevelError };

/** `true` si `value` est un entier fini ≥ 0 (garde de forme d'un index de monde/niveau). */
function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** `true` si `value` est un nombre d'étoiles valide (entier 0..3, MAP §4). */
function isStars(value: unknown): value is Stars {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3;
}

/**
 * **Clé de rejeu** (`ledger.ref_id`) d'un gain de fin de niveau (idempotence, ECONOMY §3.7).
 * Stable pour un `(monde, niveau)` donné → un rejeu réseau portant le même `(profileId,
 * reason, refId)` **ne recrédite pas** (`creditWalletInTx`). Pure : mêmes index ⇒ même clé.
 * Format `level:<world>:<level>` (les index sont des entiers → pas d'ambiguïté).
 */
export function levelRewardRefId(worldIndex: number, levelIndex: number): string {
  return `level:${worldIndex}:${levelIndex}`;
}

/**
 * **Persiste la fin d'un niveau** (MAP §1/§4/§6, ECONOMY §4.1, SYNC), avec garde de
 * déblocage linéaire côté serveur, puis **crédite les pièces** (base + bonus étoiles +
 * bonus trésor) — le tout dans **une transaction multi-écritures atomique**. Étapes :
 * 1. **gardes de forme** (payload public non fiable, #36) : `worldIndex`/`levelIndex`
 *    entiers ≥ 0, `stars` entier 0..3 → refus propre sinon ;
 * 2. **barème hors transaction** : le type du nœud est dérivé serveur (`baseNodeTypeAt`) et
 *    le montant calculé (`computeLevelReward`) — pur, sans I/O, avant d'ouvrir la
 *    transaction (barème ≥ 0 ⇒ `total` ≥ 0) ;
 * 3. **transaction SYNCHRONE** (callback sans `await`) : garde de déblocage (monde débloqué
 *    + niveau jouable, lu dans la même transaction → cohérence de snapshot) → refus si
 *    verrouillé ; sinon **1ʳᵉ écriture** `recordStars` (monotone, idempotente), **puis**
 *    crédit `creditWalletInTx` (**2ᵉ/3ᵉ écritures** : upsert wallet + ligne ledger,
 *    idempotent via `ref_id`) — un crédit **strictement positif** seulement (si le barème
 *    donne 0, aucun crédit : `creditWalletInTx` exige `amount > 0`, garde `total > 0`) ;
 * 4. **si le niveau était le boss** (dernier nœud, MAP §6) : ajout de la **légendaire
 *    garantie** à la collection (`grantLegendaryInTx`, **4ᵉ/5ᵉ écritures** : upsert catalogue +
 *    INSERT possession, idempotent — rejeu ⇒ pas de doublon) **dans la même transaction** ;
 * 5. `unlockedNextWorld` = le niveau complété **était le boss** (MAP §6), **jamais**
 *    conditionné aux étoiles (MAP §1/§8).
 *
 * @param db connexion applicative (source de vérité serveur).
 * @param profileId profil **de la session** (jamais un profil client).
 * @param input cible brute (monde/niveau/étoiles) — validée ici.
 * @param mapConfig ⚙️ carte (`MapConfig`) — `levelsPerWorld` fixe la géométrie (boss =
 *   dernier), `treasureEvery` le type du nœud (bonus trésor).
 * @param economyConfig ⚙️ barème (`EconomyConfig`, config versionnée) — base/étoile/trésor/boss.
 * @param now instant serveur injecté (jamais un `Date.now()` interne, LEARNINGS #46).
 */
export function finishLevel(
  db: AppDatabase,
  profileId: number,
  input: FinishLevelInput,
  mapConfig: MapConfig,
  economyConfig: EconomyConfig,
  now: Date,
): FinishLevelResult {
  // 1. Gardes de forme (avant toute lecture/écriture, #36).
  if (!isNonNegativeInt(input.worldIndex) || !isNonNegativeInt(input.levelIndex)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (!isStars(input.stars)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const worldIndex = input.worldIndex;
  const levelIndex = input.levelIndex;
  const stars = input.stars;
  const { levelsPerWorld } = mapConfig;
  // Géométrie invariante (MAP §4) : `levelsPerWorld + 1` nœuds ; le boss est le dernier.
  const nodeCount = levelsPerWorld + 1;
  const bossIndex = levelsPerWorld;

  // 2. Barème (hors transaction, pur) : type de nœud dérivé **serveur** (jamais du client,
  //    SYNC §1) → montant de pièces. Le barème est ≥ 0 (EconomyConfig) → `total` ≥ 0.
  const nodeType = baseNodeTypeAt(levelIndex, mapConfig);
  const reward = computeLevelReward(nodeType, stars, economyConfig);

  // 3. Garde de déblocage + persistance dans une transaction SYNCHRONE (callback sans await).
  //    MULTI-ÉCRITURES : recordStars (1ʳᵉ) + creditWalletInTx (2ᵉ/3ᵉ) + grantLegendaryInTx
  //    (4ᵉ/5ᵉ, boss) sont atomiques ensemble — un échec d'une écriture postérieure rollback
  //    la 1ʳᵉ (aucun état partiel, règle #122). Mutation-prouvé : retirer ce wrapper casse les
  //    tests de rollback (ledger ET collection boss) de `finish-level.test.ts`.
  return db.transaction((tx): FinishLevelResult => {
    // Déblocage linéaire inter-mondes : le monde doit être ouvert (boss des mondes
    // précédents complété). Jamais fondé sur les étoiles (MAP §1/§8).
    if (!isWorldUnlocked(tx, profileId, worldIndex, levelsPerWorld)) {
      return { ok: false, error: "WORLD_LOCKED" };
    }
    // Déblocage linéaire intra-monde : seul le nœud courant (ou un déjà-complété = rejoue
    // monotone) est complétable — un nœud sauté est verrouillé.
    const { starsByLevel } = loadWorldProgress(tx, profileId, worldIndex);
    const completed = new Set(starsByLevel.keys());
    if (!isLevelPlayable(levelIndex, completed, nodeCount)) {
      return { ok: false, error: "LEVEL_LOCKED" };
    }

    // 1ʳᵉ ÉCRITURE : progression monotone + idempotente (5.1) : `max(existant, nouveau)`.
    const storedStars = recordStars(tx, { profileId, worldIndex, levelIndex }, stars, now);

    // 2ᵉ/3ᵉ ÉCRITURES : crédit de pièces + ligne ledger, **dans la même transaction**
    // (atomique avec la progression). Idempotent via `ref_id = level:<world>:<level>` → un
    // rejeu ne recrédite pas (`applied: false`). Un crédit **strictement positif** seulement
    // (creditWalletInTx exige `amount > 0`) : si le barème donne 0, aucune écriture de crédit
    // n'est tentée (le total ne peut être ≤ 0 qu'avec un barème entièrement nul, cas de
    // calibration extrême — on affiche alors le solde courant, non modifié).
    let balance: WalletBalance;
    let coinsApplied: boolean;
    if (reward.total > 0) {
      assertPositiveAmount(reward.total);
      const credit = creditWalletInTx(
        tx,
        {
          profileId,
          currency: "coins",
          amount: reward.total,
          reason: "level",
          refId: levelRewardRefId(worldIndex, levelIndex),
        },
        now,
      );
      balance = credit.balance;
      coinsApplied = credit.applied;
    } else {
      // Barème entièrement nul (⚙️ tout à 0) : aucun crédit à porter — on lit le solde tel
      // quel (dans la transaction) pour renvoyer un contrat de retour stable (pas de crédit
      // ⇒ `coinsApplied` false).
      balance = loadWallet(tx, profileId);
      coinsApplied = false;
    }

    // Déblocage du monde suivant = ce niveau était le boss (dernier nœud). Dérivé du progress
    // — jamais un incrément séparé (pas de double effet au rejeu). Indépendant des étoiles.
    const isBoss = levelIndex === bossIndex;
    const unlockedNextWorld = isBoss;

    // 4ᵉ/5ᵉ ÉCRITURES (boss uniquement, 5.6) : **légendaire garantie** ajoutée à la collection
    // (déterministe, HORS œufs — MAP §6). Idempotent : rejeu du boss ⇒ aucun doublon parasite
    // (`grantLegendaryInTx` renvoie `added: false`). L'ajout est **dans la même transaction** →
    // atomique avec progression + crédit (un échec de l'INSERT `collection` rollback TOUT : ni
    // étoiles, ni pièces, ni légendaire — aucun état partiel, règle #122).
    let legendary: GrantedLegendary | null = null;
    let legendaryAdded = false;
    if (isBoss) {
      const grant = grantLegendaryInTx(tx, profileId, worldIndex, now);
      legendaryAdded = grant.added;
      const descriptor = legendaryForWorld(worldIndex);
      legendary = {
        characterId: descriptor.id,
        name: descriptor.nameDefault,
        story: descriptor.story,
        artRef: descriptor.artRef,
      };
    }

    return {
      ok: true,
      stars: storedStars,
      unlockedNextWorld,
      reward,
      balance,
      coinsApplied,
      legendary,
      legendaryAdded,
    };
  });
}
