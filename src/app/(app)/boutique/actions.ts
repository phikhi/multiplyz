"use server";

import { revalidatePath } from "next/cache";
import { getEconomyConfig, getMapConfig } from "@/config/server-config";
import { getDb } from "@/lib/db";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { buyEggAndDraw, type DrawnCreature } from "@/lib/game/egg-draw";
import { loadWallet } from "@/lib/game/wallet";

/**
 * Server actions de la **Boutique / Œufs** (story R4.2 #393, WIREFRAMES §6, ECONOMY §4.2/§6/§7).
 * Adaptateurs **minces** au-dessus de `@/lib/game/egg-draw` : l'achat + le tirage (débit atomique,
 * odds normalisées, doublon→éclats, pitié) vivent côté serveur (source de vérité). Le `profile_id`
 * vient **toujours** de la session enfant (`getCurrentChildProfileId`, jamais du client, #63/#42).
 *
 * **Server-authoritative (#282)** : l'unique input client est le `drawId` opaque (clé d'idempotence) —
 * validé **string bornée** ici, au bord. `amount`/`currency`/`reason` du mouvement sont dérivés côté
 * serveur (config ⚙️ + état) dans `buyEggAndDraw`, jamais confiés au client ; aucun objet client n'est
 * transmis à la primitive de débit/crédit.
 *
 * **No-fail (ECONOMY §1)** : solde insuffisant → `{ ok: false, error: "BROKE" }` (message doux, jamais
 * un blocage). Runtime **Node** (transaction better-sqlite3) — déjà imposé par la page du groupe `(app)`.
 * Non authentifié → `{ ok: false, error: "UNAUTHENTICATED" }` générique (pas de fuite).
 */

/** Longueur max ⚙️ d'un `drawId` client (uuid v4 = 36 ; borne large anti-abus, jamais un blob). */
const DRAW_ID_MAX_LENGTH = 64;

/** État initial de la boutique (prix de l'œuf + solde courant) — pour l'affichage de l'écran. */
export interface BoutiqueStateResult {
  readonly ok: boolean;
  /** Prix d'un œuf en pièces (⚙️ `eggPriceCoins`) — affiché sur la carte œuf (WIREFRAMES §6a). */
  readonly eggPriceCoins: number;
  /** Solde de pièces courant (indice « pas les moyens » doux si < prix ; l'anti-négatif reste serveur). */
  readonly coins: number;
  /** Solde d'éclats courant. */
  readonly shards: number;
}

/**
 * État de la boutique de la session enfant (prix de l'œuf + solde). Lecture seule. `ok: false` +
 * soldes à 0 si pas de session enfant valide (générique, l'écran retombe sur son état non authentifié).
 */
export async function boutiqueStateAction(): Promise<BoutiqueStateResult> {
  const eggPriceCoins = getEconomyConfig().spend.eggPriceCoins;
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { ok: false, eggPriceCoins, coins: 0, shards: 0 };
  }
  const wallet = loadWallet(getDb(), profileId);
  return { ok: true, eggPriceCoins, coins: wallet.coins, shards: wallet.shards };
}

/** Résultat client d'un achat+tirage d'œuf (miroir de `EggDrawResult`, sans fuite serveur). */
export type BuyEggActionResult =
  | {
      readonly ok: true;
      readonly creature: DrawnCreature;
      readonly isNew: boolean;
      readonly shardsAwarded: number;
      readonly pityApplied: boolean;
      readonly coins: number;
      readonly shards: number;
    }
  | {
      readonly ok: false;
      /** `BROKE` = pas assez de pièces (doux) ; `REPLAY` = drawId déjà traité ; `NO_POOL` = rien à tirer ;
       *  `INVALID` = drawId mal formé ; `UNAUTHENTICATED` = pas de session enfant. */
      readonly error: "BROKE" | "REPLAY" | "NO_POOL" | "INVALID" | "UNAUTHENTICATED";
    };

/**
 * **Achète un œuf et tire une créature** pour la session enfant courante (débit atomique, odds
 * normalisées, doublon→éclats, pitié — cf. `buyEggAndDraw`). L'horloge serveur (`new Date()`) et
 * l'aléa (`Math.random`) sont injectés **ici** (la frontière) → le cœur reste déterministe/testable.
 *
 * @param drawId clé d'idempotence opaque **fournie par le client** (uuid généré à l'intention de tirage)
 *   — validée string bornée ; un rejeu même `drawId` ne re-débite ni ne re-tire (`REPLAY`).
 */
export async function buyEggAction(drawId: unknown): Promise<BuyEggActionResult> {
  // #282 : le drawId client est validé string bornée au bord (jamais un objet spreadé). C'est le SEUL
  // input client ; il ne sert qu'à composer le `ref_id` d'idempotence, jamais un montant/monnaie.
  if (typeof drawId !== "string" || drawId.length === 0 || drawId.length > DRAW_ID_MAX_LENGTH) {
    return { ok: false, error: "INVALID" };
  }
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { ok: false, error: "UNAUTHENTICATED" };
  }

  const result = buyEggAndDraw(
    getDb(),
    profileId,
    getEconomyConfig(),
    getMapConfig(),
    drawId,
    new Date(),
    Math.random,
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // Le solde a changé (pièces débitées, éclats éventuels) → rafraîchit le bandeau `AppShell`
  // (solde lu serveur par `(app)/layout.tsx`) au prochain rendu de la route.
  revalidatePath("/boutique");

  return {
    ok: true,
    creature: result.creature,
    isNew: result.isNew,
    shardsAwarded: result.shardsAwarded,
    pityApplied: result.pityApplied,
    coins: result.balance.coins,
    shards: result.balance.shards,
  };
}
