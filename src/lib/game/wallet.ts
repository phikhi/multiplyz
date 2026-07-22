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
 * **Périmètre earn-side (5.1)** : crédit de pièces / éclats + ligne de journal
 * (`creditWalletInTx` / `creditWallet`). **Périmètre spend-side (R4.1)** : la **primitive de
 * débit** `debitWalletInTx` / `debitWallet` — miroir inversé du crédit (server-authoritative,
 * idempotente, anti-solde-négatif, atomique). **FONDATION uniquement** : la primitive de débit
 * n'a **aucun appelant runtime committé** ici — les vraies dépenses (œufs R4.2, boutique R4.3,
 * évolution R4.4, cosmétiques/coffre R4.5) la **consomment plus tard** (#155/#127 : on POSE la
 * primitive + on la prouve mutation-testée, on ne revendique **aucun** flux de dépense vécu).
 *
 * Aucune logique de barème (montants) : ce module écrit ce qu'on lui **donne** ; les taux/prix
 * ⚙️ (prix d'un œuf, doublon→éclats, coût d'évolution…) vivent dans la config éco
 * (`server-config.ts`) et l'appelant passe des **scalaires validés côté serveur**.
 *
 * **Sécurité (#282, forward-looking)** : toute future server-action de dépense **no-PIN /
 * bas-privilège** (ex. l'enfant achète un œuf sans PIN) qui réutilise cette primitive doit lui
 * passer des **SCALAIRES ISOLÉS** dérivés **côté serveur** (`profileId` issu de la **session**,
 * `amount`/`reason`/`refId` calculés par le serveur depuis la config + l'état) — **JAMAIS** un
 * objet fourni par le client (`{ profileId, amount, … }` posté brut). La primitive prend des
 * champs scalaires nommés, pas un patch client spreadé : les clés smugglées ne peuvent pas
 * élargir le mouvement écrit. La coercition/validation de la surface vit dans la server-action
 * consommatrice (R4.2+), gardée par la session enfant, comme le quick-mute 8.6 (#282).
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
 * `true` si un mouvement portant ce `(profileId, reason, refId)` **existe déjà** dans le
 * journal (garde d'idempotence **partagée earn + spend** — même clé de rejeu `(profil, raison,
 * ref_id)` que l'index UNIQUE composite du `ledger`). Un `refId` `null` n'est **jamais**
 * considéré déjà présent (pas de clé de rejeu = pas de dédoublonnage). Scan filtré (table
 * single-tenant, index différé). À appeler **dans** la transaction synchrone, avant le
 * mouvement, pour sérialiser check-then-write (anti-TOCTOU, LEARNINGS #36).
 *
 * Direction-agnostique **par conception** : les raisons earn (`level`, `star_bonus`, `boss`,
 * `daily_chest`, `treasure`) et spend (`egg`, `shop`, `evolution`, `cosmetic`, `booster`) sont
 * disjointes (ECONOMY §3.7) → un crédit et un débit ne partagent jamais la même `(raison, ref_id)`,
 * la fonction reste correcte pour les deux sans porter le sens du mouvement.
 */
export function ledgerEntryExists(
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
 * Valide le montant d'un mouvement d'économie (crédit **ou** débit) : entier **strictement
 * positif** (un earn n'ajoute jamais ≤ 0, un spend ne retire jamais ≤ 0 — le sens est porté par
 * `direction`, jamais par le signe du montant, ECONOMY §3.7). Extrait pour être appelé **avant**
 * d'entrer dans une transaction (garde de forme au plus tôt, comme la validation lourde de
 * `submitAttempt` — #36) : un montant invalide throw sans jamais ouvrir de transaction ni écrire.
 */
export function assertPositiveAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(
      `wallet: montant invalide (${amount}) — un mouvement d'économie exige un entier > 0.`,
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
 * - **Idempotent** : rejeu même `(profileId, reason, refId)` détecté (`ledgerEntryExists`) →
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
  if (ledgerEntryExists(tx, input.profileId, input.reason, input.refId)) {
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

// ============================================================================
// Spend-side (R4.1) — primitive de DÉBIT, miroir inversé du crédit.
// FONDATION : aucun appelant runtime committé (consommée en R4.2-R4.5, #155/#127).
// ============================================================================

/**
 * Un **débit** à porter au portefeuille + au journal (spend-side, ECONOMY §4.2-§4.5).
 * Miroir inversé de `CreditInput` : mêmes champs, sémantique **retirer**. `currency` est
 * restreint à `coins` | `shards` (le portefeuille ne porte pas d'`item` — la consommation
 * d'un consommable passe par `inventory_items`, pas par le solde).
 *
 * **Server-authoritative** : la primitive ne fait **jamais** foi d'un montant fourni par le
 * client — l'appelant (server-action R4.2+) passe des **scalaires validés côté serveur**
 * (`amount`/`reason` dérivés de la config ⚙️ + de l'état, `profileId` issu de la session),
 * jamais un objet client spreadé (#282).
 */
export interface DebitInput {
  readonly profileId: number;
  /** `coins` ou `shards` — le portefeuille ne porte pas d'`item`. */
  readonly currency: "coins" | "shards";
  /** Montant **retiré** (entier **strictement positif** — un spend ne retire jamais 0). */
  readonly amount: number;
  /** Raison (`egg`, `shop`, `evolution`, `cosmetic`, `booster`, … — ECONOMY §3.7). */
  readonly reason: string;
  /**
   * **Clé de rejeu** pour l'idempotence (ECONOMY §3.7, `ref_id`). Stable pour une même
   * dépense (ex. `egg:<eggId>`). Un rejeu réseau portant le même `(profileId, reason, refId)`
   * **ne re-débite pas** (retourne le solde inchangé, `applied: false`). `null` = pas de
   * dédoublonnage possible — à éviter pour une dépense rejouable (double-clic / retry).
   */
  readonly refId: string | null;
}

/** Résultat d'un débit : solde après opération + si le débit a été **appliqué**. */
export interface DebitResult {
  readonly balance: WalletBalance;
  /** `false` si l'appel était un rejeu déjà journalisé (aucun 2ᵉ débit). */
  readonly applied: boolean;
}

/**
 * Solde insuffisant pour un débit (garde **anti-solde-négatif**, ECONOMY §1/§3.1 : `coins ≥ 0`,
 * `shards ≥ 0`). Levée **dans** la transaction, **avant** toute écriture → aucun état partiel.
 * Classe dédiée (vs `Error` générique) pour que l'appelant R4.2+ distingue « pas les moyens »
 * (message doux à l'enfant, jamais un blocage d'apprentissage — ECONOMY §1) d'une vraie panne.
 */
export class InsufficientBalanceError extends Error {
  constructor(
    readonly profileId: number,
    readonly currency: "coins" | "shards",
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `debitWallet: solde ${currency} insuffisant (profil ${profileId}) — ` +
        `demandé ${requested}, disponible ${available}.`,
    );
    this.name = "InsufficientBalanceError";
  }
}

/**
 * **Débite** le portefeuille + journalise le mouvement **dans une transaction déjà ouverte**
 * (`tx`) — miroir inversé de `creditWalletInTx`. Cœur de débit réutilisable **à l'intérieur**
 * d'une transaction multi-écritures de l'appelant (ex. « acheter un œuf » : débit + tirage +
 * ajout collection **atomiques ensemble**, R4.2). L'atomicité et l'anti-TOCTOU sont portés par
 * la transaction **de l'appelant** (better-sqlite3 n'imbrique pas les transactions → on ne
 * wrappe PAS ici).
 *
 * - **Idempotent** : rejeu même `(profileId, reason, refId)` détecté (`ledgerEntryExists`) →
 *   **aucune 2ᵉ mutation**, solde inchangé, `applied: false`.
 * - **Anti-solde-négatif** : le solde courant de la monnaie est lu **dans** la transaction
 *   (anti-TOCTOU) ; si `solde < amount` → `InsufficientBalanceError` **avant toute écriture**
 *   (garde à effet observable — sans elle, un débit ferait passer le solde sous 0, ECONOMY §1).
 * - **Ordre des écritures** : (1) décrément du solde (côté SQL `-= amount`, pas de
 *   read-modify-write), PUIS (2) insertion de la ligne `ledger`. Cet ordre **rend le rollback
 *   observable** : si l'INSERT `ledger` (2ᵉ écriture) échoue APRÈS le décrément (1ʳᵉ), la
 *   transaction de l'appelant **annule** le débit déjà écrit (aucun solde amputé sans trace).
 *
 * La monnaie n'est **jamais** créée par un débit : la garde anti-solde-négatif garantit qu'une
 * ligne `wallet` existe (un profil sans ligne a un solde 0 → tout `amount > 0` échoue avant
 * écriture) → un `update` ciblé suffit (pas d'upsert, contrairement au crédit).
 *
 * ⚠️ **Ne valide pas le montant** (l'appelant l'a fait via `assertPositiveAmount` **avant** la
 * transaction). `now` = instant serveur injecté (jamais un `Date.now()` interne, LEARNINGS #46).
 */
export function debitWalletInTx(tx: DbHandle, input: DebitInput, now: Date): DebitResult {
  // Rejeu déjà journalisé (retry réseau / double-clic) → aucun 2ᵉ débit, solde inchangé.
  if (ledgerEntryExists(tx, input.profileId, input.reason, input.refId)) {
    return { balance: loadWallet(tx, input.profileId), applied: false };
  }

  // GARDE ANTI-SOLDE-NÉGATIF : solde lu DANS la transaction (anti-TOCTOU). Un solde < montant
  // refuse le débit AVANT toute écriture (le portefeuille ne descend jamais sous 0, ECONOMY §1).
  const balanceBefore = loadWallet(tx, input.profileId);
  const available = balanceBefore[input.currency];
  if (available < input.amount) {
    throw new InsufficientBalanceError(input.profileId, input.currency, input.amount, available);
  }

  const column = input.currency === "coins" ? wallet.coins : wallet.shards;
  // 1ʳᵉ ÉCRITURE : décrément ciblé du solde (la ligne existe forcément — garde ci-dessus).
  tx.update(wallet)
    .set({
      // Décrément côté SQL (pas de read-modify-write applicatif).
      [input.currency]: sql`${column} - ${input.amount}`,
      updatedAt: now,
    })
    .where(eq(wallet.profileId, input.profileId))
    .run();

  // 2ᵉ ÉCRITURE : journal append-only — trace la dépense (`direction: spend`) + clé de rejeu.
  // Son échec APRÈS la 1ʳᵉ écriture est ce qui déclenche le rollback (atomicité multi-write).
  tx.insert(ledger)
    .values({
      profileId: input.profileId,
      direction: "spend",
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
 * **Débite** le portefeuille (spend-side) + journalise le mouvement, de façon **atomique et
 * idempotente** (ECONOMY §4.2-§4.5, progression idempotente CLAUDE.md). Miroir inversé de
 * `creditWallet`.
 *
 * Ouvre **sa propre** transaction synchrone better-sqlite3 (dépense **autonome**) puis délègue à
 * `debitWalletInTx`. Pour une dépense **couplée** à d'autres écritures (ex. achat d'œuf : débit +
 * tirage + collection dans **une** transaction), appeler directement `debitWalletInTx` **dans** la
 * transaction de l'appelant (ne pas imbriquer les transactions).
 *
 * - **Atomique** : décrément du solde + insertion `ledger` dans **une seule transaction
 *   SYNCHRONE** (callback sans `await` → sérialisation, anti-TOCTOU #36) — rollback si la 2ᵉ
 *   écriture échoue.
 * - **Idempotent** : rejeu même `(profileId, reason, refId)` → aucun 2ᵉ débit, `applied: false`.
 * - **Anti-solde-négatif** : `InsufficientBalanceError` si le solde de la monnaie < `amount`
 *   (jamais de solde sous 0, ECONOMY §1) — **online-only** (le serveur est la source de vérité,
 *   aucun chemin de dépense hors-ligne).
 *
 * `now` = instant serveur injecté. `amount` doit être un entier > 0 (garde **avant** la
 * transaction : un montant invalide throw sans jamais l'ouvrir ni écrire).
 */
export function debitWallet(db: AppDatabase, input: DebitInput, now: Date): DebitResult {
  assertPositiveAmount(input.amount);
  return db.transaction((tx): DebitResult => debitWalletInTx(tx, input, now));
}
