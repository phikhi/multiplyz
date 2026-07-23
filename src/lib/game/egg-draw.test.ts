import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import {
  characters,
  collection,
  collectionKey,
  eggPity,
  ledger,
  profiles,
  wallet,
} from "@/lib/db/schema";
import { CONFIG_DEFAULTS } from "@/config/server-config";
import { isRenderableAssetRef } from "@/lib/game/world-theme";
import { buyEggAndDraw, eggDrawRefId, loadEggPool, loadPityCount } from "./egg-draw";

/**
 * Tests de la **couche achat+tirage d'œuf** (story R4.2 #393, ECONOMY §4.2/§6/§7), sur **base réelle**
 * (SQLite en mémoire + migrations, catalogue socle réel seedé par `runMigrations`). Prouvent à effet
 * observable + mutation-prouvé (test NOMMÉ, jamais un cardinal, #173/#206) :
 * - **atomicité multi-écritures** (#122 : panne APRÈS le débit → rollback du débit) ;
 * - **doublon → éclats** (crédit selon rareté) + **pitié** (nouveauté garantie) chacune par SA garde ;
 * - **anti-solde-négatif / no-fail** (broke → doux, aucune écriture) ;
 * - **idempotence** (même drawId → REPLAY, un seul débit) ;
 * - **exclusion des légendaires** (primaire + défense en profondeur) ;
 * - **server-authoritative** (#282 : montant/monnaie/raison dérivés serveur, jamais du client) ;
 * - **#180 : l'enfant obtient une créature au VRAI art committé** (ref rendable).
 */

const ECONOMY = CONFIG_DEFAULTS.economy;
const MAP = CONFIG_DEFAULTS.map;
const NOW = new Date(Date.UTC(2026, 6, 23, 10, 0, 0));

let db: AppDatabase;
let profileId: number;

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

/** Crédite un solde de pièces de départ (état contrôlé, hors du chemin de gain). */
function giveCoins(n: number): void {
  db.insert(wallet).values({ profileId, coins: n, shards: 0, updatedAt: NOW }).run();
}

/** Aléa déterministe : rend les valeurs fournies dans l'ordre (rarityRoll, indexRoll). */
function seqRand(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++];
}

/** rand qui tire TOUJOURS une commune, 1ʳᵉ de la liste (rarityRoll 0 ⇒ commune ; indexRoll 0 ⇒ index 0). */
const drawFirstCommon = () => seqRand([0, 0]);
/** rand qui tire TOUJOURS une rare, 1ʳᵉ de la liste (rarityRoll ~1 ⇒ rare ; indexRoll 0 ⇒ index 0). */
const drawFirstRare = () => seqRand([0.999, 0]);

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db); // amorce le catalogue socle réel (seedSocleCreatures) — le pool d'œufs vient d'ici.
  profileId = seedProfile("Léa");
});

describe("loadEggPool (pool atteignable — mondes débloqués, légendaires exclues)", () => {
  it("monde 0 débloqué ⇒ pool = communes + rares du monde 0, JAMAIS de légendaire (primaire in_egg_pool)", () => {
    const pool = loadEggPool(db, profileId, 1);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.some((c) => c.rarity === "common")).toBe(true);
    // Exclusion PRIMAIRE : la légendaire du monde 0 (in_egg_pool=false) n'est jamais dans le pool.
    expect(pool.some((c) => c.id === "legendary:0")).toBe(false);
    for (const c of pool) {
      expect(c.rarity === "common" || c.rarity === "rare").toBe(true);
      expect(c.worldIndex).toBe(0);
    }
  });

  it("mondes verrouillés exclus : unlockedCount = 1 ⇒ aucune créature d'un monde ≥ 1", () => {
    const pool = loadEggPool(db, profileId, 1);
    expect(pool.every((c) => c.worldIndex < 1)).toBe(true);
  });

  it("unlockedCount = 0 ⇒ pool vide (garde de forme — aucun monde débloqué)", () => {
    expect(loadEggPool(db, profileId, 0)).toEqual([]);
  });

  it("DÉFENSE EN PROFONDEUR (#ECONOMY §2) : légendaire mal-flaggée in_egg_pool=true ⇒ TOUJOURS exclue (mutation-prouvé)", () => {
    // Corrompt le catalogue : la légendaire du monde 0 devient in_egg_pool=true (catalogue invalide).
    db.update(characters).set({ inEggPool: true }).where(eq(characters.id, "legendary:0")).run();
    const pool = loadEggPool(db, profileId, 1);
    // La garde de rareté `eggRarityOf` l'écarte quand même. Retirer ce filtre ferait apparaître
    // `legendary:0` (rarity="legendary") dans le pool → ce test rougit.
    expect(pool.some((c) => c.id === "legendary:0")).toBe(false);
    expect(pool.every((c) => c.rarity === "common" || c.rarity === "rare")).toBe(true);
  });
});

describe("buyEggAndDraw — tirage d'une NOUVELLE créature (#180 : l'enfant obtient une créature au VRAI art)", () => {
  it("débite 50 pièces, tire une nouvelle créature possédée, art RÉEL committé rendable, pitié à 0", () => {
    giveCoins(50);
    const result = buyEggAndDraw(db, profileId, ECONOMY, MAP, "draw-1", NOW, drawFirstCommon());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isNew).toBe(true);
    expect(result.shardsAwarded).toBe(0);
    expect(result.balance.coins).toBe(0); // 50 − 50.

    // #180 : la créature obtenue porte un art RÉEL committé (ref rendable `socle/creature/…`).
    expect(isRenderableAssetRef(result.creature.artRef)).toBe(true);
    expect(result.creature.artRef).toMatch(/^socle\/creature\/creature_world_0_\d+\.png$/);
    expect(result.creature.displayName.length).toBeGreaterThan(0);

    // Possession écrite (1 exemplaire).
    const owned = db
      .select({ count: collection.count })
      .from(collection)
      .where(eq(collection.id, collectionKey(profileId, result.creature.characterId)))
      .get();
    expect(owned?.count).toBe(1);

    // Nouveauté ⇒ compteur de pitié remis/laissé à 0.
    expect(loadPityCount(db, profileId)).toBe(0);
  });

  it("#282 : le mouvement de DÉBIT persisté porte des scalaires SERVEUR EXACTS (jamais du client)", () => {
    giveCoins(50);
    buyEggAndDraw(db, profileId, ECONOMY, MAP, "draw-282", NOW, drawFirstCommon());
    // `amount`/`currency`/`reason`/`ref_id` sont DÉRIVÉS serveur (config + drawId), jamais fournis
    // par le client. Deep-equal EXACT sur la ligne ledger de dépense (pas objectContaining).
    const spend = db
      .select({
        direction: ledger.direction,
        currency: ledger.currency,
        amount: ledger.amount,
        reason: ledger.reason,
        refId: ledger.refId,
      })
      .from(ledger)
      .where(eq(ledger.direction, "spend"))
      .get();
    expect(spend).toEqual({
      direction: "spend",
      currency: "coins",
      amount: 50, // = eggPriceCoins de la config, jamais un montant client.
      reason: "egg",
      refId: eggDrawRefId("draw-282"),
    });
  });
});

describe("buyEggAndDraw — DOUBLON → éclats (« jamais rien », ECONOMY §1/§4.2)", () => {
  it("doublon COMMUN ⇒ +10 éclats crédités, count++, ledger earn/shards/egg (mutation-prouvé)", () => {
    const pool = loadEggPool(db, profileId, 1);
    const firstCommon = pool.find((c) => c.rarity === "common");
    expect(firstCommon).toBeDefined();
    // Pré-possède la 1ʳᵉ commune → le tirage `drawFirstCommon` retombe dessus = DOUBLON.
    db.insert(collection)
      .values({
        id: collectionKey(profileId, firstCommon!.id),
        profileId,
        characterId: firstCommon!.id,
        count: 1,
        stage: 1,
        unlockedAt: NOW,
      })
      .run();
    giveCoins(50);

    const result = buyEggAndDraw(db, profileId, ECONOMY, MAP, "dup-c", NOW, drawFirstCommon());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isNew).toBe(false);
    // Crédit d'éclats OBSERVABLE : retirer le `creditWalletInTx` du chemin doublon → shards restent 0.
    expect(result.shardsAwarded).toBe(ECONOMY.spend.duplicateShardsCommon); // 10
    expect(result.balance.shards).toBe(10);
    expect(result.balance.coins).toBe(0); // 50 débité.

    const owned = db
      .select({ count: collection.count })
      .from(collection)
      .where(eq(collection.id, collectionKey(profileId, firstCommon!.id)))
      .get();
    expect(owned?.count).toBe(2); // count++.

    // Ligne ledger earn/shards/egg tracée (transparence parent).
    const earn = db
      .select({ amount: ledger.amount, currency: ledger.currency })
      .from(ledger)
      .where(eq(ledger.direction, "earn"))
      .get();
    expect(earn).toEqual({ amount: 10, currency: "shards" });
  });

  it("doublon RARE ⇒ +25 éclats (barème par rareté distinct — mutation-prouvé vs commune)", () => {
    const pool = loadEggPool(db, profileId, 1);
    const firstRare = pool.find((c) => c.rarity === "rare");
    expect(firstRare).toBeDefined();
    db.insert(collection)
      .values({
        id: collectionKey(profileId, firstRare!.id),
        profileId,
        characterId: firstRare!.id,
        count: 1,
        stage: 1,
        unlockedAt: NOW,
      })
      .run();
    giveCoins(50);

    const result = buyEggAndDraw(db, profileId, ECONOMY, MAP, "dup-r", NOW, drawFirstRare());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isNew).toBe(false);
    expect(result.creature.rarity).toBe("rare");
    expect(result.shardsAwarded).toBe(ECONOMY.spend.duplicateShardsRare); // 25 (≠ 10 commune).
    expect(result.balance.shards).toBe(25);
  });

  it("doublon ⇒ compteur de pitié INCRÉMENTÉ (mutation-prouvé : sans l'incrément, reste à 0)", () => {
    const pool = loadEggPool(db, profileId, 1);
    const firstCommon = pool.find((c) => c.rarity === "common")!;
    db.insert(collection)
      .values({
        id: collectionKey(profileId, firstCommon.id),
        profileId,
        characterId: firstCommon.id,
        count: 1,
        stage: 1,
        unlockedAt: NOW,
      })
      .run();
    giveCoins(50);
    buyEggAndDraw(db, profileId, ECONOMY, MAP, "dup-pity", NOW, drawFirstCommon());
    // Doublon ⇒ +1 (partant de 0). Une nouveauté le remettrait à 0 (cf. test tirage nouveau).
    expect(loadPityCount(db, profileId)).toBe(1);
  });
});

describe("buyEggAndDraw — PITIÉ anti-malchance (ECONOMY §4.2/§7, #206 garde nommée)", () => {
  it("après pityThreshold doublons ⇒ prochaine créature GARANTIE nouvelle + pitié remise à 0 (mutation-prouvé)", () => {
    const pool = loadEggPool(db, profileId, 1);
    // Possède TOUTES les créatures du pool SAUF la dernière → une seule nouveauté possible.
    const lastId = pool[pool.length - 1].id;
    for (const c of pool) {
      if (c.id === lastId) continue;
      db.insert(collection)
        .values({
          id: collectionKey(profileId, c.id),
          profileId,
          characterId: c.id,
          count: 1,
          stage: 1,
          unlockedAt: NOW,
        })
        .run();
    }
    // Pitié ARMÉE : consecutiveDuplicates = seuil (5). Le tirage suivant DOIT garantir la nouveauté.
    db.insert(eggPity)
      .values({ profileId, consecutiveDuplicates: ECONOMY.spend.pityThreshold, updatedAt: NOW })
      .run();
    giveCoins(50);

    // `drawFirstCommon` retomberait sur une commune POSSÉDÉE sans la pitié (doublon). Avec la pitié
    // active, les candidates sont restreintes aux non-possédées → la SEULE nouveauté (`lastId`).
    const result = buyEggAndDraw(db, profileId, ECONOMY, MAP, "pity-1", NOW, drawFirstCommon());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isNew).toBe(true);
    expect(result.pityApplied).toBe(true);
    expect(result.creature.characterId).toBe(lastId);
    // Nouveauté (même forcée) ⇒ compteur de pitié REMIS à 0.
    expect(loadPityCount(db, profileId)).toBe(0);
  });
});

describe("buyEggAndDraw — no-fail / anti-solde-négatif (ECONOMY §1)", () => {
  it("solde insuffisant ⇒ BROKE doux, AUCUNE écriture (pas de débit, pas de possession, pas de ledger)", () => {
    giveCoins(30); // < 50.
    const result = buyEggAndDraw(db, profileId, ECONOMY, MAP, "broke-1", NOW, drawFirstCommon());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("BROKE");
    // Rien débité, rien possédé, aucune ligne ledger (le solde ne descend jamais sous 0, ECONOMY §1).
    expect(db.select({ coins: wallet.coins }).from(wallet).get()?.coins).toBe(30);
    expect(db.select().from(collection).all()).toHaveLength(0);
    expect(db.select().from(ledger).all()).toHaveLength(0);
  });

  it("catalogue vide (aucune créature tirable) ⇒ NO_POOL, aucun débit (garde de forme)", () => {
    db.delete(collection).run();
    db.delete(characters).run(); // vide le catalogue → pool vide.
    giveCoins(50);
    const result = buyEggAndDraw(db, profileId, ECONOMY, MAP, "nopool", NOW, drawFirstCommon());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("NO_POOL");
    expect(db.select({ coins: wallet.coins }).from(wallet).get()?.coins).toBe(50); // jamais débité.
  });
});

describe("buyEggAndDraw — idempotence (rejeu même drawId, ECONOMY §3.7)", () => {
  it("même drawId rejoué ⇒ REPLAY, UN SEUL débit (jamais 2ᵉ tirage ni double-débit)", () => {
    giveCoins(50);
    const first = buyEggAndDraw(db, profileId, ECONOMY, MAP, "same-id", NOW, drawFirstCommon());
    expect(first.ok).toBe(true);
    const second = buyEggAndDraw(db, profileId, ECONOMY, MAP, "same-id", NOW, drawFirstCommon());
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe("REPLAY");
    // Un SEUL débit (50 → 0, jamais −50), une SEULE ligne de dépense.
    expect(db.select({ coins: wallet.coins }).from(wallet).get()?.coins).toBe(0);
    expect(db.select().from(ledger).where(eq(ledger.direction, "spend")).all()).toHaveLength(1);
  });
});

describe("buyEggAndDraw — ATOMICITÉ multi-écritures / rollback (#122)", () => {
  // La transaction protège ≥2 écritures : (1)/(2) débit (wallet − ledger spend), puis (3) INSERT
  // possession `collection`. On induit la panne à la 3ᵉ écriture GARDÉE (APRÈS le débit) en RETIRANT
  // la colonne `stage` de `collection` : le SELECT `character_id` de `loadEggPool` (en amont) reste
  // valide → la panne frappe bien l'INSERT possession (qui pose `stage`), jamais une lecture avant le
  // 1ᵉ write (règle #122). PREUVE : retirer le wrapper `db.transaction` de `buyEggAndDraw` laisserait
  // le débit persister malgré l'échec de la possession → ce test rougirait précisément.
  it("ROLLBACK : panne de l'INSERT possession (3ᵉ écriture) ⇒ débit ANNULÉ (aucun solde amputé sans tirage)", () => {
    giveCoins(50);
    // Retire `stage` de `collection` : l'INSERT possession (qui pose stage:1) échoue APRÈS le débit.
    db.run(sql`ALTER TABLE collection DROP COLUMN stage`);

    expect(() =>
      buyEggAndDraw(db, profileId, ECONOMY, MAP, "rollback-1", NOW, drawFirstCommon()),
    ).toThrow();

    // ROLLBACK PROUVÉ : le solde de pièces est INTACT (le débit a été annulé), aucune ligne ledger.
    expect(db.select({ coins: wallet.coins }).from(wallet).get()?.coins).toBe(50);
    expect(db.select().from(ledger).all()).toHaveLength(0);
  });

  it("CONTRÔLE : sans panne, le MÊME tirage écrit bien le débit ET la possession (rollback dû à la seule panne)", () => {
    giveCoins(50);
    const result = buyEggAndDraw(
      db,
      profileId,
      ECONOMY,
      MAP,
      "rollback-ctl",
      NOW,
      drawFirstCommon(),
    );
    expect(result.ok).toBe(true);
    expect(db.select({ coins: wallet.coins }).from(wallet).get()?.coins).toBe(0);
    expect(db.select().from(collection).all()).toHaveLength(1);
    expect(db.select().from(ledger).where(eq(ledger.direction, "spend")).all()).toHaveLength(1);
  });
});
