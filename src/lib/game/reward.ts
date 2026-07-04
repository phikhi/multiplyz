/**
 * **Barème des gains de pièces** de fin de niveau (ECONOMY §4.1/§5, PRODUCT §2.1/§2.3).
 * Fonction **pure** (aucune I/O, aucune horloge) : transforme `(type de nœud, étoiles,
 * barème ⚙️)` en un **montant de pièces** + sa décomposition. Le barème (base, bonus par
 * étoile, bonus trésor) vient de `EconomyConfig` (config **versionnée**, pas de valeur en
 * dur — ECONOMY §3 note) ; ce module ne fige aucun montant.
 *
 * **Client-safe** (aucun import de la couche DB server-only, pattern `map.ts`) — le type de
 * nœud (`NodeType`) est un type pur partagé. La couche serveur (`finish-level.ts`) appelle
 * ce module **dans** la transaction de fin de niveau pour décider le crédit, puis
 * `creditWallet` (5.1) écrit le montant + le journal de façon atomique/idempotente.
 *
 * **Garde-fou éco** (ECONOMY §1) : l'économie ne **bloque jamais** l'apprentissage — un gain
 * n'a **jamais** de montant négatif (le barème est ≥ 0 par construction, cf. `EconomyConfig`).
 * Le montant total est **toujours ≥ 0** ; une valeur `0` reste un état légitime (barème
 * désactivé) mais `creditWallet` (5.1) exige un montant **strictement positif** — l'appelant
 * ne crédite donc que si `total > 0` (cf. `finish-level.ts`).
 *
 * **Périmètre 5.6** : gain de **niveau** (base + étoiles) + **bonus trésor** (nœud trésor) +
 * **bonus boss** (nœud boss — « gros lot de pièces », MAP §6 / ECONOMY §5 `+50`). Le nœud
 * `boss` rapporte donc le gain de niveau standard **plus** le bonus boss (un terme de plus,
 * ajouté sans changer la forme du barème). La **créature légendaire garantie** n'est **pas**
 * un gain de pièces (couche collection `collection.ts`, hors barème). Le nœud `revision`
 * rapporte le gain de niveau standard (sa spécificité est pédagogique — MAP §5, pas un bonus).
 */

import type { EconomyConfig } from "@/config/server-config";
import type { NodeType } from "./map";
import type { Stars } from "@/lib/db/schema";

/** Raison ledger d'un mouvement de gain de fin de niveau (sous-ensemble d'ECONOMY §3.7). */
export type RewardReason = "level" | "star_bonus" | "treasure" | "boss";

/**
 * **Décomposition** d'un gain de fin de niveau (transparence parent, ECONOMY §7 : le
 * `ledger` explique gains/dépenses). Chaque terme est un montant **≥ 0** en pièces. La
 * somme = `total`. Sert à l'affichage (écran résultats). Un journal détaillé (une ligne
 * par terme non nul) est une piste prospective — `finish-level.ts` (5.5) écrit
 * aujourd'hui une seule ligne ledger agrégée (`reason: "level"`, montant = `total`).
 */
export interface RewardBreakdown {
  /** Pièces de **base** du niveau (toujours créditées, ECONOMY §5). */
  readonly base: number;
  /** Pièces **bonus** liées aux étoiles (`starBonusCoins × stars`, ECONOMY §5). */
  readonly starBonus: number;
  /** Pièces **bonus trésor** (nœud `treasure` uniquement, sinon `0` — PRODUCT §2.1). */
  readonly treasureBonus: number;
  /** Pièces **bonus boss** (nœud `boss` uniquement, sinon `0` — « gros lot », MAP §6). */
  readonly bossBonus: number;
  /** Total crédité (somme des termes) — **toujours ≥ 0** (barème ≥ 0). */
  readonly total: number;
}

/**
 * `true` si le nœud rapporte le **bonus trésor** : uniquement le type `treasure` (PRODUCT
 * §2.1 « mini-défi court → pièces bonus »). Isolé en prédicat pur pour rester couvrable et
 * pour qu'un futur type porteur de bonus soit un changement **local et explicite** (jamais
 * un `default` implicite qui créditerait par accident).
 */
function hasTreasureBonus(nodeType: NodeType): boolean {
  return nodeType === "treasure";
}

/**
 * `true` si le nœud rapporte le **bonus boss** (« gros lot de pièces », MAP §6) : uniquement
 * le type `boss` (dernier nœud du monde). Isolé en prédicat pur (même discipline que
 * `hasTreasureBonus`) — le boss n'est jamais un trésor (MAP §6), donc les deux bonus ne se
 * cumulent jamais sur un même nœud.
 */
function hasBossBonus(nodeType: NodeType): boolean {
  return nodeType === "boss";
}

/**
 * **Calcule le gain de pièces** d'une fin de niveau (ECONOMY §4.1/§5). Pure et
 * déterministe : mêmes `(nodeType, stars, config)` ⇒ même décomposition.
 *
 * - **base** = `levelBaseCoins` (toujours, même à 0 étoile — no-fail : terminer rapporte
 *   toujours, ECONOMY §1 « ne bloque jamais l'apprentissage ») ;
 * - **starBonus** = `starBonusCoins × stars` (0..3 étoiles → 0..3× le bonus) ;
 * - **treasureBonus** = `treasureBonusCoins` **ssi** le nœud est un trésor, sinon `0` ;
 * - **bossBonus** = `bossBonusCoins` **ssi** le nœud est un boss (« gros lot », MAP §6),
 *   sinon `0`. Boss et trésor étant exclusifs (MAP §6 : le boss n'est jamais un trésor),
 *   au plus **un** de ces deux termes est non nul.
 *
 * @param nodeType type du nœud terminé (dérivé **serveur** de la géométrie de carte, jamais
 *   du client — cf. `finish-level.ts`). `normal`/`revision` → aucun bonus ; `treasure` →
 *   bonus trésor ; `boss` → bonus boss.
 * @param stars étoiles obtenues (0..3, MAP §4 / ENGINE §5) — **jamais** une barrière, juste
 *   un multiplicateur de bonus (ECONOMY §1 : l'éco ne bloque pas l'apprentissage).
 * @param config barème ⚙️ (`EconomyConfig`) — base/étoile/trésor/boss. Jamais de valeur en dur.
 */
export function computeLevelReward(
  nodeType: NodeType,
  stars: Stars,
  config: EconomyConfig,
): RewardBreakdown {
  const base = config.levelBaseCoins;
  const starBonus = config.starBonusCoins * stars;
  const treasureBonus = hasTreasureBonus(nodeType) ? config.treasureBonusCoins : 0;
  const bossBonus = hasBossBonus(nodeType) ? config.bossBonusCoins : 0;
  return {
    base,
    starBonus,
    treasureBonus,
    bossBonus,
    total: base + starBonus + treasureBonus + bossBonus,
  };
}
