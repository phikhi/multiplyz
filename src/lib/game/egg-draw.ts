/**
 * **Achat + tirage d'œuf** (gacha, la boucle de dépense cœur) — story R4.2 (#393, ECONOMY §4.2/§6/§7).
 * Câble, dans **UNE** transaction synchrone better-sqlite3 (`db.transaction`, anti-TOCTOU #36) :
 *
 * 1. le **débit** de `eggPriceCoins` pièces (`debitWalletInTx`, R4.1) — **1ʳᵉ/2ᵉ écritures** (décrément
 *    wallet + ligne `ledger` `spend/coins/egg`), anti-solde-négatif + idempotent (`ref_id = egg:<drawId>`) ;
 * 2. le **tirage** d'une créature du pool `in_egg_pool = true` des **mondes débloqués** (légendaires
 *    exclues), odds **normalisées** + **pitié** (`game/egg.ts`, pur) — aucune I/O ;
 * 3. la **possession** : nouvelle → INSERT `collection` (**3ᵉ écriture**) ; doublon → `count++`
 *    (**3ᵉ écriture**) + **crédit d'éclats** (`creditWalletInTx`, `earn/shards/egg` — **4ᵉ/5ᵉ écritures**) ;
 * 4. la **mise à jour du compteur de pitié** `egg_pity` (**6ᵉ écriture**) : remis à 0 sur une nouveauté,
 *    incrémenté sur un doublon.
 *
 * **Atomicité (#122)** : les ≥ 2 écritures sont dans la MÊME transaction — un échec d'une écriture
 * **postérieure au débit** (possession/éclats/pitié) **rollback** le débit (aucune pièce dépensée sans
 * tirage persisté ; aucun solde amputé sans trace). Mutation-prouvé : retirer le wrapper `db.transaction`
 * casse le test de rollback de `egg-draw.test.ts` (la panne frappe l'écriture GARDÉE `collection`, jamais
 * une lecture en amont — règle #122). Le pool + la pitié sont **lus AVANT le débit** (gardes de forme au
 * plus tôt, #36) → un pool vide ne débite **jamais** (aucune écriture).
 *
 * **Server-authoritative (#282)** : la fonction **ne prend AUCUN montant/monnaie/raison du client** —
 * `amount`/`currency`/`reason` sont **dérivés côté serveur** de la config ⚙️ (`eggPriceCoins`,
 * `duplicateShards*`) et l'état ; le seul input client est le `drawId` opaque (clé d'idempotence,
 * validée string au bord). Les scalaires passés à `debitWalletInTx`/`creditWalletInTx` sont des **champs
 * nommés LITTÉRAUX** construits ici, jamais un objet client spreadé — les clés smugglées ne peuvent pas
 * élargir le mouvement écrit (même doctrine que le quick-mute 8.6, #282).
 *
 * **No-fail / no-FOMO (ECONOMY §1)** : solde insuffisant → `InsufficientBalanceError` (dans le débit) →
 * mappé en `{ ok: false, error: "BROKE" }` (message doux « pas les moyens », JAMAIS un blocage
 * d'apprentissage) ; doublon **toujours utile** (éclats) ; pitié + boutique (R4.3) garantissent la
 * complétude sans dépendre de la chance ; aucun timer/pression.
 *
 * **SERVER-ONLY par transitivité** (importe la couche DB) — jamais dans un composant client.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import type { EconomyConfig, MapConfig } from "@/config/server-config";
import type { AppDatabase } from "@/lib/db";
import { characters, collection, collectionKey, eggPity, type Rarity } from "@/lib/db/schema";
import {
  drawFromEggPool,
  duplicateShardsFor,
  isPityActive,
  type EggPoolCreature,
  type EggRarity,
} from "./egg";
import { loadCollectionEntry } from "./collection";
import { getUnlockedWorldCount } from "./unlock";
import {
  creditWalletInTx,
  debitWalletInTx,
  InsufficientBalanceError,
  type WalletBalance,
} from "./wallet";

/** Handle transaction (les écritures tournent DANS la transaction de `buyEggAndDraw`). */
type TxHandle = Pick<AppDatabase, "select" | "insert" | "update">;

/** Aléa injecté `[0,1)` (comme l'horloge — LEARNINGS #46). Défaut prod = `Math.random`, stub en test. */
export type RandomSource = () => number;

/** La créature révélée à l'ouverture de l'œuf (enrichie du catalogue, pour l'écran de révélation). */
export interface DrawnCreature {
  readonly characterId: string;
  /** Nom affiché (surnom si l'enfant a renommé un doublon, sinon nom par défaut). */
  readonly displayName: string;
  readonly rarity: Rarity;
  /** Réf d'art rendable (`socle/creature/<species>.png`) — VRAI art committé (R3.1). */
  readonly artRef: string;
  readonly story: string;
}

/** Résultat d'un achat+tirage d'œuf. */
export type EggDrawResult =
  | {
      readonly ok: true;
      readonly creature: DrawnCreature;
      /** `true` = nouvelle créature (célébration) ; `false` = doublon (→ éclats). */
      readonly isNew: boolean;
      /** Éclats ✨ crédités si doublon (0 si nouvelle). */
      readonly shardsAwarded: number;
      /** `true` si la pitié a garanti cette nouveauté (anti-malchance ECONOMY §7). */
      readonly pityApplied: boolean;
      /** Solde après opération (pièces débitées, éclats éventuels crédités). */
      readonly balance: WalletBalance;
    }
  | {
      readonly ok: false;
      /** `BROKE` = pas assez de pièces (doux, jamais bloquant) ; `REPLAY` = même `drawId` déjà traité
       *  (idempotent, aucun 2ᵉ débit/tirage) ; `NO_POOL` = aucune créature tirable (garde de forme). */
      readonly error: "BROKE" | "REPLAY" | "NO_POOL";
    };

/** Clé de rejeu du **débit** d'un œuf (`spend/coins/egg`) — idempotence par `drawId` client. */
export function eggDrawRefId(drawId: string): string {
  return `egg:${drawId}`;
}

/** Clé de rejeu du **crédit d'éclats** d'un doublon (`earn/shards/egg`) — DISTINCTE du débit (même
 *  `reason` "egg", `ref_id` différent → aucune collision sur l'index UNIQUE `(profil, raison, ref_id)`). */
export function eggShardRefId(drawId: string): string {
  return `egg-shards:${drawId}`;
}

/** `common`/`rare` typé-narrowed depuis la rareté catalogue ; `null` pour une légendaire (exclue). */
function eggRarityOf(rarity: Rarity): EggRarity | null {
  return rarity === "common" || rarity === "rare" ? rarity : null;
}

/**
 * **Pool d'œufs atteignable** du profil : créatures `in_egg_pool = true` des mondes **débloqués**
 * (`world_index < unlockedCount`), enrichies du drapeau `owned` (possession du profil). Les
 * **légendaires sont exclues** structurellement (`in_egg_pool = false`, jamais tirées — ECONOMY §2),
 * **DOUBLÉ** d'un filtre de rareté défensif (`eggRarityOf` — une légendaire mal-flaggée `in_egg_pool =
 * true` dans un catalogue corrompu reste écartée ; garde à effet observable, mutation-prouvée).
 *
 * La lecture de possession sélectionne **uniquement `character_id`** (jamais `stage`/`count`) → le test
 * de rollback #122 peut casser l'écriture GARDÉE `collection` (INSERT possession) sans casser cette
 * lecture en amont (règle #122 : la panne frappe une écriture, jamais une lecture avant le 1ᵉ write).
 */
export function loadEggPool(
  db: TxHandle,
  profileId: number,
  unlockedCount: number,
): EggPoolCreature[] {
  if (unlockedCount <= 0) {
    return [];
  }
  const catalog = db
    .select({
      id: characters.id,
      worldIndex: characters.worldIndex,
      rarity: characters.rarity,
    })
    .from(characters)
    .where(and(eq(characters.inEggPool, true), lt(characters.worldIndex, unlockedCount)))
    .all();
  const ownedRows = db
    .select({ characterId: collection.characterId })
    .from(collection)
    .where(eq(collection.profileId, profileId))
    .all();
  const owned = new Set(ownedRows.map((r) => r.characterId));

  const pool: EggPoolCreature[] = [];
  for (const c of catalog) {
    const eggRarity = eggRarityOf(c.rarity);
    // Défense en profondeur (ECONOMY §2) : légendaire mal-flaggée `in_egg_pool = true` → JAMAIS tirée.
    if (eggRarity === null) {
      continue;
    }
    pool.push({ id: c.id, worldIndex: c.worldIndex, rarity: eggRarity, owned: owned.has(c.id) });
  }
  return pool;
}

/** Compteur de pitié courant du profil (0 si aucune ligne — profil neuf). Lu DANS la transaction. */
export function loadPityCount(db: TxHandle, profileId: number): number {
  const row = db
    .select({ consecutiveDuplicates: eggPity.consecutiveDuplicates })
    .from(eggPity)
    .where(eq(eggPity.profileId, profileId))
    .limit(1)
    .get();
  return row === undefined ? 0 : row.consecutiveDuplicates;
}

/**
 * **Achète un œuf et tire une créature** — atomique, idempotent, anti-solde-négatif (cf. en-tête).
 *
 * @param db connexion applicative (source de vérité serveur).
 * @param profileId profil **de la session** (jamais un profil client, #63/#42).
 * @param economyConfig ⚙️ barème (prix œuf, odds, pitié, doublon→éclats — `EconomySpendConfig`).
 * @param mapConfig ⚙️ carte (fournit `levelsPerWorld` pour le calcul des mondes débloqués).
 * @param drawId **clé d'idempotence** opaque fournie par le client (validée string au bord) — un rejeu
 *   même `drawId` ne re-débite ni ne re-tire (`REPLAY`).
 * @param now instant serveur injecté (jamais un `Date.now()` interne, LEARNINGS #46).
 * @param rand aléa injecté `[0,1)` (défaut `Math.random`) — déterministe en test.
 */
export function buyEggAndDraw(
  db: AppDatabase,
  profileId: number,
  economyConfig: EconomyConfig,
  mapConfig: MapConfig,
  drawId: string,
  now: Date,
  rand: RandomSource = Math.random,
): EggDrawResult {
  const { spend } = economyConfig;
  const price = spend.eggPriceCoins;
  const refId = eggDrawRefId(drawId);

  try {
    return db.transaction((tx): EggDrawResult => {
      // GARDES DE FORME au plus tôt (lectures AVANT tout write, #36) : pool atteignable + pitié.
      // Un pool vide ne débite JAMAIS (aucune écriture) — impossible en pratique (le monde 0 a
      // toujours des communes), garde de forme.
      const unlocked = getUnlockedWorldCount(tx, profileId, mapConfig.levelsPerWorld);
      const pool = loadEggPool(tx, profileId, unlocked);
      if (pool.length === 0) {
        return { ok: false, error: "NO_POOL" };
      }
      const pityCount = loadPityCount(tx, profileId);
      const pityActive = isPityActive(pityCount, spend.pityThreshold);

      // 1ʳᵉ/2ᵉ ÉCRITURES : DÉBIT des pièces — SCALAIRES ISOLÉS server-derived (#282), jamais un objet
      // client. `debitWalletInTx` throw `InsufficientBalanceError` si le solde < prix (anti-négatif),
      // AVANT toute écriture → rollback vide (aucun tirage sans paiement).
      const debit = debitWalletInTx(
        tx,
        { profileId, currency: "coins", amount: price, reason: "egg", refId },
        now,
      );
      // Rejeu (même drawId déjà journalisé) → idempotent : aucun 2ᵉ débit, aucun 2ᵉ tirage.
      if (!debit.applied) {
        return { ok: false, error: "REPLAY" };
      }

      // TIRAGE (pur) : odds normalisées + pitié. Pool non vide (garde ci-dessus) → jamais null.
      const outcome = drawFromEggPool(
        pool,
        spend.eggOddsCommon,
        spend.eggOddsRare,
        pityActive,
        rand,
      );
      /* v8 ignore next 3 -- pool non vide garanti ci-dessus ; garde de type pour l'exhaustivité */
      if (outcome === null) {
        return { ok: false, error: "NO_POOL" };
      }
      const drawn = outcome.creature;
      const key = collectionKey(profileId, drawn.id);

      let shardsAwarded = 0;
      let balance = debit.balance;
      if (outcome.isNew) {
        // 3ᵉ ÉCRITURE : nouvelle possession (1ʳᵉ obtention). `onConflictDoNothing` = idempotent.
        tx.insert(collection)
          .values({
            id: key,
            profileId,
            characterId: drawn.id,
            count: 1,
            stage: 1,
            unlockedAt: now,
          })
          .onConflictDoNothing({ target: collection.id })
          .run();
      } else {
        // 3ᵉ ÉCRITURE : doublon → `count++` (doublons comptés, ECONOMY §3.3).
        tx.update(collection)
          .set({ count: sql`${collection.count} + 1` })
          .where(eq(collection.id, key))
          .run();
        // 4ᵉ/5ᵉ ÉCRITURES : doublon → **éclats** (« jamais rien », ECONOMY §1/§4.2). Montant
        // server-derived (barème ⚙️ selon rareté), scalaires isolés (#282). `earn/shards/egg`,
        // `ref_id` DISTINCT du débit (aucune collision UNIQUE).
        shardsAwarded = duplicateShardsFor(
          drawn.rarity,
          spend.duplicateShardsCommon,
          spend.duplicateShardsRare,
        );
        const credit = creditWalletInTx(
          tx,
          {
            profileId,
            currency: "shards",
            amount: shardsAwarded,
            reason: "egg",
            refId: eggShardRefId(drawId),
          },
          now,
        );
        balance = credit.balance;
      }

      // 6ᵉ ÉCRITURE : compteur de PITIÉ (ECONOMY §4.2/§7). Nouveauté → remis à 0 (y compris quand la
      // pitié vient de forcer la nouveauté) ; doublon → +1. Upsert par PK profil.
      const newConsecutive = outcome.isNew ? 0 : pityCount + 1;
      tx.insert(eggPity)
        .values({ profileId, consecutiveDuplicates: newConsecutive, updatedAt: now })
        .onConflictDoUpdate({
          target: eggPity.profileId,
          set: { consecutiveDuplicates: newConsecutive, updatedAt: now },
        })
        .run();

      // Enrichissement catalogue pour la révélation (réutilise le lecteur testé `loadCollectionEntry`
      // — la créature vient d'être possédée → jamais null). Nom affiché = surnom si renommé, sinon défaut.
      const entry = loadCollectionEntry(tx, profileId, drawn.id);
      /* v8 ignore next 3 -- possession écrite juste au-dessus → entry non null ; garde de forme */
      if (entry === null) {
        return { ok: false, error: "NO_POOL" };
      }
      return {
        ok: true,
        creature: {
          characterId: entry.characterId,
          displayName: entry.displayName,
          rarity: entry.rarity,
          artRef: entry.artRef,
          story: entry.story,
        },
        isNew: outcome.isNew,
        shardsAwarded,
        pityApplied: outcome.pityApplied,
        balance,
      };
    });
  } catch (error) {
    // Solde insuffisant : message DOUX à l'enfant (« pas les moyens »), jamais un blocage
    // d'apprentissage (ECONOMY §1). Toute autre panne remonte (bug réel).
    if (error instanceof InsufficientBalanceError) {
      return { ok: false, error: "BROKE" };
    }
    throw error;
  }
}
