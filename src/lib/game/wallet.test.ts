import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { ledger, profiles, wallet } from "@/lib/db/schema";
import {
  creditWallet,
  debitWallet,
  InsufficientBalanceError,
  ledgerEntryExists,
  loadWallet,
  type CreditInput,
  type DebitInput,
} from "./wallet";

/**
 * Tests d'intégration de la couche portefeuille + journal (5.1) sur **base réelle**
 * (SQLite en mémoire + migrations). Vérifient l'atomicité (crédit + ledger dans une
 * transaction), l'idempotence du rejeu (clé `ref_id`) et la validation du montant —
 * gardes à effet observable (rouges si la garde est retirée / mutée).
 */

let db: AppDatabase;
let profileId: number;
const NOW = new Date(Date.UTC(2026, 6, 3, 10, 0, 0));
const LATER = new Date(Date.UTC(2026, 6, 3, 11, 0, 0));

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = seedProfile("Léa");
});

function earn(overrides: Partial<CreditInput> = {}): CreditInput {
  return {
    profileId,
    currency: "coins",
    amount: 10,
    reason: "level",
    refId: "level:0:0",
    ...overrides,
  };
}

describe("creditWallet — crédit atomique + journal", () => {
  it("crée le portefeuille au 1er crédit + journalise le mouvement", () => {
    const res = creditWallet(db, earn(), NOW);
    expect(res).toEqual({ balance: { coins: 10, shards: 0 }, applied: true });

    const w = db.select().from(wallet).where(eq(wallet.profileId, profileId)).get();
    expect(w).toMatchObject({ coins: 10, shards: 0 });
    expect(w?.updatedAt.getTime()).toBe(NOW.getTime());

    const [entry] = db.select().from(ledger).where(eq(ledger.profileId, profileId)).all();
    expect(entry).toMatchObject({
      direction: "earn",
      currency: "coins",
      amount: 10,
      reason: "level",
      refId: "level:0:0",
    });
  });

  it("incrémente le solde sur crédit répété (clés de rejeu distinctes)", () => {
    creditWallet(db, earn({ amount: 10, refId: "level:0:0" }), NOW);
    creditWallet(db, earn({ amount: 5, reason: "star_bonus", refId: "star:0:0" }), LATER);
    expect(loadWallet(db, profileId)).toEqual({ coins: 15, shards: 0 });
    // Deux lignes de journal (une par événement distinct).
    expect(db.select().from(ledger).where(eq(ledger.profileId, profileId)).all()).toHaveLength(2);
  });

  it("crédite coins et shards indépendamment (colonne ciblée par la monnaie)", () => {
    creditWallet(db, earn({ currency: "coins", amount: 10, refId: "c1" }), NOW);
    creditWallet(db, earn({ currency: "shards", amount: 7, reason: "egg", refId: "s1" }), NOW);
    expect(loadWallet(db, profileId)).toEqual({ coins: 10, shards: 7 });
  });

  // GARDE IDEMPOTENCE (progression idempotente, CLAUDE.md) : rejouer le MÊME
  // (profil, reason, refId) ne recrédite pas et n'ajoute pas de 2ᵉ ligne de journal.
  // Rouge si la garde `ledgerEntryExists` est retirée du chemin transactionnel.
  it("IDEMPOTENT : rejeu même (reason, ref_id) → solde inchangé, applied=false, 1 seule ligne", () => {
    const first = creditWallet(db, earn({ amount: 10, refId: "level:1:2" }), NOW);
    expect(first).toEqual({ balance: { coins: 10, shards: 0 }, applied: true });

    const replay = creditWallet(db, earn({ amount: 10, refId: "level:1:2" }), LATER);
    expect(replay).toEqual({ balance: { coins: 10, shards: 0 }, applied: false });

    // Aucun double crédit, une seule ligne de journal.
    expect(loadWallet(db, profileId)).toEqual({ coins: 10, shards: 0 });
    expect(db.select().from(ledger).where(eq(ledger.profileId, profileId)).all()).toHaveLength(1);
  });

  it("ne dédoublonne PAS deux earns au même refId mais reason différente", () => {
    // Même événement source, deux composantes (base + bonus étoile) → 2 crédits légitimes.
    creditWallet(db, earn({ amount: 10, reason: "level", refId: "level:0:0" }), NOW);
    creditWallet(db, earn({ amount: 5, reason: "star_bonus", refId: "level:0:0" }), NOW);
    expect(loadWallet(db, profileId)).toEqual({ coins: 15, shards: 0 });
    expect(db.select().from(ledger).where(eq(ledger.profileId, profileId)).all()).toHaveLength(2);
  });

  it("refId=null → jamais dédoublonné (chaque appel crédite)", () => {
    creditWallet(db, earn({ amount: 10, refId: null }), NOW);
    creditWallet(db, earn({ amount: 10, refId: null }), LATER);
    expect(loadWallet(db, profileId)).toEqual({ coins: 20, shards: 0 });
    expect(db.select().from(ledger).where(eq(ledger.profileId, profileId)).all()).toHaveLength(2);
  });

  // GARDE MONTANT : un earn ne crédite jamais ≤ 0 ni un non-entier. Rouge si la
  // validation est retirée (un montant 0/négatif corromprait le solde/journal).
  it("REJETTE un montant ≤ 0 ou non-entier (aucune écriture)", () => {
    expect(() => creditWallet(db, earn({ amount: 0 }), NOW)).toThrow(/montant invalide/);
    expect(() => creditWallet(db, earn({ amount: -5 }), NOW)).toThrow(/montant invalide/);
    expect(() => creditWallet(db, earn({ amount: 1.5 }), NOW)).toThrow(/montant invalide/);
    // Rien n'a été écrit (ni portefeuille, ni journal).
    expect(db.select().from(wallet).all()).toHaveLength(0);
    expect(db.select().from(ledger).all()).toHaveLength(0);
  });

  // GARDE MONNAIE (défense en profondeur #282, symétrie avec le débit) : le crédit refuse aussi
  // une monnaie hors {coins,shards}. Rouge si `assertKnownCurrency` est retirée de creditWalletInTx.
  it("REJETTE une monnaie inconnue (defense-in-depth #282)", () => {
    expect(() =>
      creditWallet(db, earn({ currency: "gems" as unknown as "coins", refId: "x" }), NOW),
    ).toThrow(/monnaie invalide/);
    expect(db.select().from(wallet).all()).toHaveLength(0);
    expect(db.select().from(ledger).all()).toHaveLength(0);
  });

  // GARDE ATOMICITÉ (effet observable, mutation-testée) : si l'INSERT du **journal**
  // échoue APRÈS que le crédit du portefeuille a réussi, tout est ANNULÉ (rollback de
  // la transaction). Le point subtil : `creditWallet` appelle d'abord `ledgerEntryExists`
  // (un `SELECT id FROM ledger`) — casser la table entière (`DROP`) ferait throw CE
  // select AVANT toute écriture wallet → test VACUOUS (passerait même sans transaction,
  // rétro #60/#61). On casse donc UNIQUEMENT l'INSERT : on rebuild `ledger` sans la
  // colonne `amount` que l'INSERT fournit. Alors : (1) le SELECT `id` de `ledgerEntryExists`
  // fonctionne toujours, (2) l'upsert `wallet` s'exécute (crédit +50), (3) l'INSERT
  // `ledger` jette « no such column: amount » → rollback. Sans le wrapper
  // `db.transaction`, le crédit wallet SURVIVRAIT à l'échec → ce test CASSE (vérifié
  // par mutation : retirer la transaction rend l'assertion `coins:0` fausse).
  it("ATOMIQUE : l'échec de l'INSERT journal annule le crédit déjà écrit (rollback)", () => {
    // Rebuild `ledger` sans `amount` : la structure reste requêtable (SELECT id ok),
    // mais l'INSERT de `creditWallet` (qui pose `amount`) échouera.
    db.run(sql`DROP TABLE ledger`);
    db.run(sql`CREATE TABLE ledger (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      profile_id integer NOT NULL,
      direction text NOT NULL,
      currency text NOT NULL,
      reason text NOT NULL,
      ref_id text,
      created_at integer NOT NULL
    )`);

    expect(() => creditWallet(db, earn({ amount: 50, refId: "atomic" }), NOW)).toThrow();

    // Preuve du rollback : le crédit du portefeuille (qui S'ÉTAIT écrit dans la
    // transaction) a été annulé → aucune ligne wallet, solde à 0.
    expect(loadWallet(db, profileId)).toEqual({ coins: 0, shards: 0 });
    expect(db.select().from(wallet).all()).toHaveLength(0);
  });
});

describe("loadWallet", () => {
  it("renvoie coins=0/shards=0 pour un profil sans mouvement", () => {
    expect(loadWallet(db, profileId)).toEqual({ coins: 0, shards: 0 });
  });
});

describe("ledgerEntryExists (garde d'idempotence partagée earn + spend)", () => {
  it("false quand refId est null (jamais de dédoublonnage sans clé)", () => {
    expect(ledgerEntryExists(db, profileId, "level", null)).toBe(false);
  });

  it("false quand aucune ligne ne porte cette (reason, ref_id)", () => {
    expect(ledgerEntryExists(db, profileId, "level", "level:0:0")).toBe(false);
  });

  it("true après un crédit portant cette (reason, ref_id)", () => {
    creditWallet(db, earn({ reason: "level", refId: "level:0:0" }), NOW);
    expect(ledgerEntryExists(db, profileId, "level", "level:0:0")).toBe(true);
  });

  it("est scopé au profil (même clé, autre profil → false)", () => {
    const other = seedProfile("Tom");
    creditWallet(db, earn({ reason: "level", refId: "level:0:0" }), NOW);
    expect(ledgerEntryExists(db, other, "level", "level:0:0")).toBe(false);
  });
});

// ===========================================================================
// Primitive de DÉBIT (R4.1) — miroir inversé du crédit. Server-authoritative,
// idempotente, anti-solde-négatif, atomique (ECONOMY §3.1/§3.7/§4.2-§4.5).
// ===========================================================================

/** Approvisionne le portefeuille du profil courant (earn) pour pouvoir dépenser ensuite. */
function fund(coins: number, shards = 0): void {
  if (coins > 0) creditWallet(db, earn({ currency: "coins", amount: coins, refId: "fund:c" }), NOW);
  if (shards > 0)
    creditWallet(
      db,
      earn({ currency: "shards", amount: shards, reason: "egg", refId: "fund:s" }),
      NOW,
    );
}

function spend(overrides: Partial<DebitInput> = {}): DebitInput {
  return {
    profileId,
    currency: "coins",
    amount: 50,
    reason: "egg",
    refId: "egg:1",
    ...overrides,
  };
}

describe("debitWallet — débit atomique + journal", () => {
  it("décrémente le solde + journalise un mouvement spend + renvoie le nouveau solde", () => {
    fund(100);
    const res = debitWallet(db, spend({ amount: 50, refId: "egg:1" }), LATER);
    expect(res).toEqual({ balance: { coins: 50, shards: 0 }, applied: true });

    const w = db.select().from(wallet).where(eq(wallet.profileId, profileId)).get();
    expect(w).toMatchObject({ coins: 50, shards: 0 });
    expect(w?.updatedAt.getTime()).toBe(LATER.getTime());

    // La ligne de dépense porte direction=spend, amount POSITIF (le signe est dans direction).
    const spendRow = db.select().from(ledger).where(eq(ledger.direction, "spend")).get();
    expect(spendRow).toMatchObject({
      direction: "spend",
      currency: "coins",
      amount: 50,
      reason: "egg",
      refId: "egg:1",
    });
  });

  it("débite coins et shards indépendamment (colonne ciblée par la monnaie)", () => {
    fund(60, 150);
    debitWallet(db, spend({ currency: "coins", amount: 50, reason: "egg", refId: "egg:1" }), LATER);
    debitWallet(
      db,
      spend({ currency: "shards", amount: 150, reason: "shop", refId: "shop:1" }),
      LATER,
    );
    expect(loadWallet(db, profileId)).toEqual({ coins: 10, shards: 0 });
  });

  it("autorise un débit qui vide EXACTEMENT le solde (solde == montant → 0, jamais négatif)", () => {
    fund(50);
    const res = debitWallet(db, spend({ amount: 50, refId: "egg:1" }), LATER);
    expect(res).toEqual({ balance: { coins: 0, shards: 0 }, applied: true });
  });

  it("refId=null → jamais dédoublonné (chaque appel débite)", () => {
    fund(100);
    debitWallet(db, spend({ amount: 30, refId: null }), NOW);
    debitWallet(db, spend({ amount: 30, refId: null }), LATER);
    expect(loadWallet(db, profileId)).toEqual({ coins: 40, shards: 0 });
    // Deux lignes spend (aucun dédoublonnage sans clé de rejeu).
    expect(db.select().from(ledger).where(eq(ledger.direction, "spend")).all()).toHaveLength(2);
  });

  // GARDE MONTANT (réutilise assertPositiveAmount) : un spend ne retire jamais ≤ 0 ni un
  // non-entier. Rouge si la validation est retirée.
  it("REJETTE un montant ≤ 0 ou non-entier (aucune écriture)", () => {
    fund(100);
    expect(() => debitWallet(db, spend({ amount: 0 }), NOW)).toThrow(/montant invalide/);
    expect(() => debitWallet(db, spend({ amount: -5 }), NOW)).toThrow(/montant invalide/);
    expect(() => debitWallet(db, spend({ amount: 1.5 }), NOW)).toThrow(/montant invalide/);
    // Le solde n'a pas bougé, aucune ligne spend.
    expect(loadWallet(db, profileId)).toEqual({ coins: 100, shards: 0 });
    expect(db.select().from(ledger).where(eq(ledger.direction, "spend")).all()).toHaveLength(0);
  });

  // GARDE ANTI-SOLDE-NÉGATIF (effet observable, mutation-testée) : un débit qui dépasse le
  // solde est REFUSÉ (InsufficientBalanceError) et n'écrit RIEN — le portefeuille ne descend
  // JAMAIS sous 0 (ECONOMY §1). Mutation : retirer le `if (available < amount) throw` →
  // le débit passe, le solde devient négatif → CE test rougit (solde -20 ≠ 30, ligne spend créée).
  it("ANTI-NÉGATIF : refuse un débit > solde (InsufficientBalanceError), aucune écriture", () => {
    fund(30);
    expect(() => debitWallet(db, spend({ amount: 50, refId: "egg:1" }), LATER)).toThrow(
      InsufficientBalanceError,
    );
    // Solde intact (jamais négatif), aucune ligne spend journalisée.
    expect(loadWallet(db, profileId)).toEqual({ coins: 30, shards: 0 });
    expect(db.select().from(ledger).where(eq(ledger.direction, "spend")).all()).toHaveLength(0);
  });

  it("ANTI-NÉGATIF : refuse un débit sur un profil SANS portefeuille (solde 0 < montant)", () => {
    // Aucun `fund` → pas de ligne wallet, solde 0. Tout montant > 0 est refusé avant écriture.
    expect(() => debitWallet(db, spend({ amount: 10, refId: "egg:1" }), NOW)).toThrow(
      InsufficientBalanceError,
    );
    expect(db.select().from(wallet).all()).toHaveLength(0);
  });

  // GARDE MONNAIE (défense en profondeur #282, mutation-testée) : une monnaie hors {coins,shards}
  // est REFUSÉE au sommet de la primitive. C'est le cas #282 « input client brut au runtime » : le
  // type TS `"coins"|"shards"` ne protège pas. SANS `assertKnownCurrency`, `balanceBefore["gems"]`
  // serait `undefined` → `undefined < amount` = false → la GARDE ANTI-SOLDE-NÉGATIF serait
  // CONTOURNÉE (le débit passerait sans fonds). Mutation : retirer `assertKnownCurrency` de
  // `debitWalletInTx` → ce test rougit (plus de throw `/monnaie invalide/`, écriture incohérente).
  // Épingle `assertKnownCurrency` (pas la garde anti-négatif : ici la monnaie n'atteint jamais
  // le check de solde) — crédité par CE test nommé (#173).
  it("MONNAIE : refuse une monnaie inconnue (defense-in-depth #282, anti-bypass garde négatif)", () => {
    fund(100, 100);
    expect(() =>
      debitWallet(
        db,
        spend({ currency: "gems" as unknown as "coins", amount: 50, refId: "egg:1" }),
        LATER,
      ),
    ).toThrow(/monnaie invalide/);
    // Aucune écriture : soldes intacts (ni coins ni shards touchés), aucune ligne spend.
    expect(loadWallet(db, profileId)).toEqual({ coins: 100, shards: 100 });
    expect(db.select().from(ledger).where(eq(ledger.direction, "spend")).all()).toHaveLength(0);
  });

  it("porte le solde disponible réel dans InsufficientBalanceError (message + champs)", () => {
    fund(30);
    try {
      debitWallet(db, spend({ currency: "coins", amount: 50, refId: "egg:1" }), LATER);
      expect.unreachable("le débit aurait dû lever InsufficientBalanceError");
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientBalanceError);
      const e = err as InsufficientBalanceError;
      expect(e).toMatchObject({ currency: "coins", requested: 50, available: 30 });
    }
  });

  // GARDE IDEMPOTENCE (progression idempotente, CLAUDE.md) : rejouer le MÊME (profil, reason,
  // refId) ne re-débite pas et n'ajoute pas de 2ᵉ ligne. Mutation : retirer la garde
  // `ledgerEntryExists` du chemin de débit → le rejeu re-débite (solde 0 ≠ 50, 2 lignes) → RED.
  it("IDEMPOTENT : rejeu même (reason, ref_id) → solde inchangé, applied=false, 1 seule ligne", () => {
    fund(100);
    const first = debitWallet(db, spend({ amount: 50, refId: "egg:1" }), NOW);
    expect(first).toEqual({ balance: { coins: 50, shards: 0 }, applied: true });

    const replay = debitWallet(db, spend({ amount: 50, refId: "egg:1" }), LATER);
    expect(replay).toEqual({ balance: { coins: 50, shards: 0 }, applied: false });

    // Aucun double débit, une seule ligne spend.
    expect(loadWallet(db, profileId)).toEqual({ coins: 50, shards: 0 });
    expect(db.select().from(ledger).where(eq(ledger.direction, "spend")).all()).toHaveLength(1);
  });

  // GARDE ATOMICITÉ #122 (effet observable, mutation-testée) : la panne frappe la **2ᵉ écriture**
  // (INSERT ledger) APRÈS que la **1ʳᵉ** (décrément wallet) a réussi — jamais un statement amont
  // (le SELECT id de `ledgerEntryExists` et le SELECT solde de la garde anti-négatif fonctionnent
  // toujours, la garde PASSE car le profil est approvisionné). On rebuild `ledger` sans la colonne
  // `amount` que l'INSERT fournit → l'INSERT jette « no such column: amount » APRÈS le décrément.
  // Sans le wrapper `db.transaction`, le décrément wallet SURVIVRAIT → CE test casse (solde 70 ≠
  // 100 restauré). Preuve #122 : retirer `db.transaction` de `debitWallet` rend ce test rouge.
  it("ATOMIQUE : l'échec de l'INSERT journal annule le débit déjà écrit (rollback #122)", () => {
    fund(100);
    // Rebuild `ledger` sans `amount` : SELECT id (idempotence) reste OK, INSERT (qui pose
    // `amount`) échouera — la panne survient APRÈS le décrément wallet (1ʳᵉ écriture).
    db.run(sql`DROP TABLE ledger`);
    db.run(sql`CREATE TABLE ledger (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      profile_id integer NOT NULL,
      direction text NOT NULL,
      currency text NOT NULL,
      reason text NOT NULL,
      ref_id text,
      created_at integer NOT NULL
    )`);

    expect(() => debitWallet(db, spend({ amount: 30, refId: "egg:atomic" }), LATER)).toThrow();

    // Preuve du rollback : le décrément wallet (écrit DANS la transaction) a été annulé →
    // le solde est resté à 100 (jamais amputé sans trace journal).
    expect(loadWallet(db, profileId)).toEqual({ coins: 100, shards: 0 });
  });
});
