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
 * **Périmètre 5.5** : gain de **niveau** (base + étoiles) + **bonus trésor**. Le **gros lot
 * du boss** (`+50`, ECONOMY §5) et la **créature légendaire** sont **hors scope** (story 5.6) :
 * un nœud `boss` rapporte ici le **gain de niveau standard** (base + étoiles), sans bonus
 * spécifique — le bonus boss sera additionné en 5.6 sans changer ce module (juste un terme
 * de plus). Le nœud `revision` rapporte lui aussi le gain de niveau standard (c'est un niveau
 * comme un autre du point de vue du gain, sa spécificité est pédagogique — MAP §5).
 */

import type { EconomyConfig } from "@/config/server-config";
import type { NodeType } from "./map";
import type { Stars } from "@/lib/db/schema";

/** Raison ledger d'un mouvement de gain de fin de niveau (sous-ensemble d'ECONOMY §3.7). */
export type RewardReason = "level" | "star_bonus" | "treasure";

/**
 * **Décomposition** d'un gain de fin de niveau (transparence parent, ECONOMY §7 : le
 * `ledger` explique gains/dépenses). Chaque terme est un montant **≥ 0** en pièces. La
 * somme = `total`. Sert à l'affichage (écran résultats) **et** à un éventuel journal
 * détaillé (une ligne par terme non nul — cf. `finish-level.ts`).
 */
export interface RewardBreakdown {
  /** Pièces de **base** du niveau (toujours créditées, ECONOMY §5). */
  readonly base: number;
  /** Pièces **bonus** liées aux étoiles (`starBonusCoins × stars`, ECONOMY §5). */
  readonly starBonus: number;
  /** Pièces **bonus trésor** (nœud `treasure` uniquement, sinon `0` — PRODUCT §2.1). */
  readonly treasureBonus: number;
  /** Total crédité (somme des termes) — **toujours ≥ 0** (barème ≥ 0). */
  readonly total: number;
}

/**
 * `true` si le nœud rapporte le **bonus trésor** : uniquement le type `treasure` (PRODUCT
 * §2.1 « mini-défi court → pièces bonus »). Isolé en prédicat pur pour rester couvrable et
 * pour que l'ajout d'un futur type porteur de bonus (ex. `boss` en 5.6) soit un changement
 * **local et explicite** (jamais un `default` implicite qui créditerait par accident).
 */
function hasTreasureBonus(nodeType: NodeType): boolean {
  return nodeType === "treasure";
}

/**
 * **Calcule le gain de pièces** d'une fin de niveau (ECONOMY §4.1/§5). Pure et
 * déterministe : mêmes `(nodeType, stars, config)` ⇒ même décomposition.
 *
 * - **base** = `levelBaseCoins` (toujours, même à 0 étoile — no-fail : terminer rapporte
 *   toujours, ECONOMY §1 « ne bloque jamais l'apprentissage ») ;
 * - **starBonus** = `starBonusCoins × stars` (0..3 étoiles → 0..3× le bonus) ;
 * - **treasureBonus** = `treasureBonusCoins` **ssi** le nœud est un trésor, sinon `0`.
 *
 * @param nodeType type du nœud terminé (dérivé **serveur** de la géométrie de carte, jamais
 *   du client — cf. `finish-level.ts`). `normal`/`revision`/`boss` → pas de bonus trésor ;
 *   `treasure` → bonus trésor ajouté.
 * @param stars étoiles obtenues (0..3, MAP §4 / ENGINE §5) — **jamais** une barrière, juste
 *   un multiplicateur de bonus (ECONOMY §1 : l'éco ne bloque pas l'apprentissage).
 * @param config barème ⚙️ (`EconomyConfig`) — base/étoile/trésor. Jamais de valeur en dur.
 */
export function computeLevelReward(
  nodeType: NodeType,
  stars: Stars,
  config: EconomyConfig,
): RewardBreakdown {
  const base = config.levelBaseCoins;
  const starBonus = config.starBonusCoins * stars;
  const treasureBonus = hasTreasureBonus(nodeType) ? config.treasureBonusCoins : 0;
  return {
    base,
    starBonus,
    treasureBonus,
    total: base + starBonus + treasureBonus,
  };
}
