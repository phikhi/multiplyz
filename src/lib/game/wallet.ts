/**
 * Persistance du **portefeuille** (pièces / éclats) + **journal** des mouvements
 * (ECONOMY §3.1/§3.7, PLAN §Modèle de données). Source de vérité **serveur**
 * (online-first) : les gains sont tranchés côté serveur, jamais confiés au client.
 *
 * **SERVER-ONLY par transitivité** (importe la couche DB) — jamais dans un composant
 * client. Les fonctions prennent la connexion (`AppDatabase`) ou un handle de
 * transaction en paramètre → testables sur une base réelle, et utilisables **dans**
 * une transaction synchrone better-sqlite3 (anti-TOCTOU, LEARNINGS #36).
 *
 * **Périmètre 5.1 = earn-side uniquement** (ECONOMY §4.1) : crédit de pièces / éclats
 * + ligne de journal. Les dépenses (boutique, œufs, évolution) arrivent en 5.6+ —
 * **hors story** ici. Aucune logique de barème (montants) : ce module écrit ce qu'on
 * lui donne ; les taux ⚙️ (base niveau, bonus étoile…) vivent dans la config éco.
 */

import { and, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { ledger, wallet, type LedgerCurrency } from "@/lib/db/schema";

/**
 * Handle accepté par les écritures : la connexion applicative **ou** le handle de
 * transaction (`db.transaction((tx) => …)`). Les deux exposent la même API Drizzle.
 */
export type DbHandle = Pick<AppDatabase, "select" | "insert" | "update">;

/** Portefeuille lu : soldes courants d'un profil (ECONOMY §3.1). */
export interface WalletBalance {
  readonly coins: number;
  readonly shards: number;
}

/** Portefeuille vide (aucun mouvement encore) — soldes à 0. */
const EMPTY_WALLET: WalletBalance = { coins: 0, shards: 0 };

/**
 * Un crédit à porter au portefeuille + au journal (earn-side, ECONOMY §4.1).
 * `currency` est restreint à `coins` | `shards` (le crédit d'`item` — inventaire /
 * poisson au miel — passera par sa propre table `inventory_items` en 5.x, pas par le
 * solde du portefeuille).
 */
export interface CreditInput {
  readonly profileId: number;
  /** `coins` ou `shards` — le portefeuille ne porte pas d'`item`. */
  readonly currency: "coins" | "shards";
  /** Montant crédité (entier **strictement positif** — un earn n'ajoute jamais 0). */
  readonly amount: number;
  /** Raison (`level`, `star_bonus`, `boss`, `daily_chest`, … — ECONOMY §3.7). */
  readonly reason: string;
  /**
   * **Clé de rejeu** pour l'idempotence (ECONOMY §3.7, `ref_id`). Stable pour un
   * même événement (ex. `level:3:2` = fin du niveau 2 du monde 3). Un rejeu réseau
   * portant le même `(profileId, reason, refId)` **ne recrédite pas**. `null` = pas
   * de dédoublonnage possible (chaque appel crédite) — à éviter pour un earn rejouable.
   */
  readonly refId: string | null;
}

/** Résultat d'un crédit : solde après opération + si le crédit a été **appliqué**. */
export interface CreditResult {
  readonly balance: WalletBalance;
  /** `false` si l'appel était un rejeu déjà journalisé (aucun 2ᵉ crédit). */
  readonly applied: boolean;
}

/**
 * Solde courant du portefeuille d'un profil, ou `{ coins: 0, shards: 0 }` si aucune
 * ligne (profil sans mouvement — un solde à 0 est l'état initial normal). Lookup
 * direct par PK (`profile_id`).
 */
export function loadWallet(db: DbHandle, profileId: number): WalletBalance {
  const row = db
    .select({ coins: wallet.coins, shards: wallet.shards })
    .from(wallet)
    .where(eq(wallet.profileId, profileId))
    .limit(1)
    .get();
  return row === undefined ? EMPTY_WALLET : { coins: row.coins, shards: row.shards };
}

/**
 * `true` si un mouvement portant ce `(profileId, reason, refId)` **existe déjà** dans
 * le journal (garde d'idempotence du crédit). Un `refId` `null` n'est **jamais**
 * considéré déjà présent (pas de clé de rejeu = pas de dédoublonnage). Scan filtré
 * (table single-tenant, index différé). À appeler **dans** la transaction synchrone,
 * avant le crédit, pour sérialiser check-then-write (anti-TOCTOU, LEARNINGS #36).
 */
export function creditExists(
  db: DbHandle,
  profileId: number,
  reason: string,
  refId: string | null,
): boolean {
  if (refId === null) {
    return false;
  }
  const existing = db
    .select({ id: ledger.id })
    .from(ledger)
    .where(and(eq(ledger.profileId, profileId), eq(ledger.reason, reason), eq(ledger.refId, refId)))
    .limit(1)
    .get();
  return existing !== undefined;
}

/**
 * Valide le montant d'un crédit earn : entier **strictement positif** (un earn n'ajoute
 * jamais ≤ 0). Extrait pour être appelé **avant** d'entrer dans une transaction (garde de
 * forme au plus tôt, comme la validation lourde d'`submitAttempt` — #36) : un montant
 * invalide throw sans jamais ouvrir de transaction ni écrire.
 */
export function assertPositiveAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(
      `creditWallet: montant invalide (${amount}) — un crédit earn exige un entier > 0.`,
    );
  }
}

/**
 * **Crédite** le portefeuille + journalise le mouvement **dans une transaction déjà
 * ouverte** (`tx`), sans en ouvrir une nouvelle — c'est le cœur de crédit réutilisable
 * **à l'intérieur** d'une transaction multi-écritures (ex. la fin de niveau, 5.5 :
 * `recordStars` + crédit + ledger doivent être **atomiques ensemble**). L'atomicité et
 * l'anti-TOCTOU sont portés par la transaction **de l'appelant** (better-sqlite3 ne
 * supporte pas les transactions imbriquées : nesting = erreur → on ne wrappe PAS ici).
 *
 * - **Idempotent** : rejeu même `(profileId, reason, refId)` détecté (`creditExists`) →
 *   **aucune 2ᵉ mutation** (ni pièces ni ligne ledger dupliquée), solde inchangé,
 *   `applied: false`.
 * - **Ordre des écritures** : (1) upsert du solde (incrément côté SQL `+= amount`, pas de
 *   read-modify-write), PUIS (2) insertion de la ligne `ledger`. Cet ordre est **ce qui
 *   rend le rollback observable** dans la transaction de l'appelant : si l'INSERT `ledger`
 *   (2ᵉ écriture) échoue APRÈS l'upsert du solde (1ʳᵉ), la transaction de l'appelant
 *   **annule** le crédit déjà écrit (aucun solde partiel — cf. test de rollback
 *   `finish-level.test.ts`, mutation-prouvé).
 *
 * ⚠️ **Ne valide pas le montant** (l'appelant l'a fait via `assertPositiveAmount` **avant**
 * d'ouvrir la transaction) : throw ici, une fois la transaction ouverte, laisserait
 * l'appelant gérer le rollback — on garde la garde de forme au plus tôt (hors transaction).
 *
 * `now` = instant serveur injecté (jamais un `Date.now()` interne, LEARNINGS #46).
 */
export function creditWalletInTx(tx: DbHandle, input: CreditInput, now: Date): CreditResult {
  // Rejeu déjà journalisé (retry réseau) → aucune 2ᵉ mutation, solde inchangé.
  if (creditExists(tx, input.profileId, input.reason, input.refId)) {
    return { balance: loadWallet(tx, input.profileId), applied: false };
  }

  const column = input.currency === "coins" ? wallet.coins : wallet.shards;
  // 1ʳᵉ ÉCRITURE : upsert du solde.
  tx.insert(wallet)
    .values({
      profileId: input.profileId,
      // 1ʳᵉ ligne : la monnaie créditée porte le montant, l'autre reste à 0 (défaut).
      coins: input.currency === "coins" ? input.amount : 0,
      shards: input.currency === "shards" ? input.amount : 0,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: wallet.profileId,
      set: {
        // Incrément côté SQL (pas de read-modify-write applicatif).
        [input.currency]: sql`${column} + ${input.amount}`,
        updatedAt: now,
      },
    })
    .run();

  // 2ᵉ ÉCRITURE : journal append-only — trace le mouvement + porte la clé de rejeu (`ref_id`).
  // Son échec APRÈS la 1ʳᵉ écriture est ce qui déclenche le rollback (atomicité multi-write).
  tx.insert(ledger)
    .values({
      profileId: input.profileId,
      direction: "earn",
      currency: input.currency satisfies LedgerCurrency,
      amount: input.amount,
      reason: input.reason,
      refId: input.refId,
      createdAt: now,
    })
    .run();

  return { balance: loadWallet(tx, input.profileId), applied: true };
}

/**
 * **Crédite** le portefeuille (earn-side) + journalise le mouvement, de façon
 * **atomique et idempotente** (ECONOMY §4.1, progression idempotente CLAUDE.md).
 *
 * Ouvre **sa propre** transaction synchrone better-sqlite3 (crédit **autonome** — ex. un
 * gain isolé) puis délègue à `creditWalletInTx`. Pour un crédit **couplé** à d'autres
 * écritures (ex. fin de niveau : `recordStars` + crédit dans **une** transaction),
 * appeler directement `creditWalletInTx` **dans** la transaction de l'appelant (ne pas
 * imbriquer les transactions).
 *
 * - **Atomique** : upsert du solde + insertion de la ligne `ledger` dans **une seule
 *   transaction SYNCHRONE** (callback sans `await` → sérialisation, anti-TOCTOU #36).
 * - **Idempotent** : rejeu même `(profileId, reason, refId)` → aucune 2ᵉ mutation,
 *   `applied: false`.
 * - **Solde monotone (earn)** : `coins`/`shards` ne font que croître ici (crédit).
 *
 * `now` = instant serveur injecté. `amount` doit être un entier > 0 (garde **avant** la
 * transaction : un montant invalide throw sans jamais l'ouvrir ni écrire).
 */
export function creditWallet(db: AppDatabase, input: CreditInput, now: Date): CreditResult {
  assertPositiveAmount(input.amount);
  return db.transaction((tx): CreditResult => creditWalletInTx(tx, input, now));
}
