import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { ledger, profiles, wallet } from "@/lib/db/schema";
import { creditExists, creditWallet, loadWallet, type CreditInput } from "./wallet";

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
  // Rouge si la garde `creditExists` est retirée du chemin transactionnel.
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

  // GARDE ATOMICITÉ : si l'écriture du **journal** échoue, le crédit du portefeuille
  // est ANNULÉ (rollback de toute la transaction). On force l'échec du 2ᵉ INSERT en
  // supprimant la table `ledger` juste avant l'appel : le wallet s'écrit puis le
  // ledger jette ("no such table") → la transaction synchrone rollback l'ensemble.
  // Rouge si les deux écritures ne sont PAS dans la même transaction (le solde
  // resterait crédité malgré l'échec du journal).
  it("ATOMIQUE : l'échec du journal annule le crédit du portefeuille (rollback)", () => {
    db.run(sql`DROP TABLE ledger`);
    expect(() => creditWallet(db, earn({ amount: 50, refId: "atomic" }), NOW)).toThrow();
    // Le crédit du portefeuille a été annulé : aucune ligne wallet ne subsiste.
    expect(loadWallet(db, profileId)).toEqual({ coins: 0, shards: 0 });
    expect(db.select().from(wallet).all()).toHaveLength(0);
  });
});

describe("loadWallet", () => {
  it("renvoie coins=0/shards=0 pour un profil sans mouvement", () => {
    expect(loadWallet(db, profileId)).toEqual({ coins: 0, shards: 0 });
  });
});

describe("creditExists (garde d'idempotence)", () => {
  it("false quand refId est null (jamais de dédoublonnage sans clé)", () => {
    expect(creditExists(db, profileId, "level", null)).toBe(false);
  });

  it("false quand aucune ligne ne porte cette (reason, ref_id)", () => {
    expect(creditExists(db, profileId, "level", "level:0:0")).toBe(false);
  });

  it("true après un crédit portant cette (reason, ref_id)", () => {
    creditWallet(db, earn({ reason: "level", refId: "level:0:0" }), NOW);
    expect(creditExists(db, profileId, "level", "level:0:0")).toBe(true);
  });

  it("est scopé au profil (même clé, autre profil → false)", () => {
    const other = seedProfile("Tom");
    creditWallet(db, earn({ reason: "level", refId: "level:0:0" }), NOW);
    expect(creditExists(db, other, "level", "level:0:0")).toBe(false);
  });
});
