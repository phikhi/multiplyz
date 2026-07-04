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
 * **Crédite** le portefeuille (earn-side) + journalise le mouvement, de façon
 * **atomique et idempotente** (ECONOMY §4.1, progression idempotente CLAUDE.md).
 *
 * - **Atomique** : upsert du solde + insertion de la ligne `ledger` dans **une seule
 *   transaction SYNCHRONE** better-sqlite3 (callback sans `await` → sérialisation,
 *   anti-TOCTOU #36). Soit les deux écritures passent, soit aucune : si l'INSERT
 *   `ledger` échoue APRÈS l'upsert du solde, la transaction **rollback** le crédit
 *   (propriété prouvée par un test à effet observable — mutation-testée : retirer le
 *   wrapper `db.transaction` fait échouer le test d'atomicité, cf. `wallet.test.ts`).
 * - **Idempotent** : un rejeu portant le même `(profileId, reason, refId)` est détecté
 *   (`creditExists`) → **aucun 2ᵉ crédit, aucune 2ᵉ ligne de journal**. On renvoie le
 *   solde inchangé avec `applied: false`.
 * - **Solde monotone (earn)** : `coins`/`shards` ne font que croître ici (crédit).
 *   L'upsert incrémente la colonne côté SQL (`+= amount`) → pas de race read-modify-write.
 *
 * `now` est l'instant serveur injecté (jamais un `Date.now()` interne, LEARNINGS #46).
 * `amount` doit être un entier > 0 (garde explicite : un earn ne crédite jamais ≤ 0).
 */
export function creditWallet(db: AppDatabase, input: CreditInput, now: Date): CreditResult {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error(
      `creditWallet: montant invalide (${input.amount}) — un crédit earn exige un entier > 0.`,
    );
  }
  return db.transaction((tx): CreditResult => {
    // Rejeu déjà journalisé (retry réseau) → aucune 2ᵉ mutation, solde inchangé.
    if (creditExists(tx, input.profileId, input.reason, input.refId)) {
      return { balance: loadWallet(tx, input.profileId), applied: false };
    }

    const column = input.currency === "coins" ? wallet.coins : wallet.shards;
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

    // Journal append-only : trace le mouvement + porte la clé de rejeu (`ref_id`).
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
  });
}
