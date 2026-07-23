import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { render } from "@testing-library/react";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { characters, collection, collectionKey, ledger, profiles } from "@/lib/db/schema";
import { CONFIG_DEFAULTS, type EconomyConfig, type MapConfig } from "@/config/server-config";
import { ResultsScreen } from "@/components/game/ResultsScreen";
import { loadStars, recordStars } from "./progress";
import { getUnlockedWorldCount } from "./unlock";
import { loadWallet } from "./wallet";
import { legendaryCharacterId, legendaryForWorld } from "./collection";
import { finishLevel, levelRewardRefId, type FinishLevelInput } from "./finish-level";

/**
 * Tests d'intégration de la **fin de niveau** (5.3 progression + 5.5 gains de pièces,
 * MAP §1/§4/§6, ECONOMY §4.1) sur **base réelle** (SQLite en mémoire + migrations).
 * Prouvent, à effet observable (rouge si la garde est mutée) : persistance monotone,
 * idempotence (pas de double effet / double déblocage / **double crédit**), gains de pièces
 * (base + étoiles + trésor), **atomicité multi-écritures (rollback)**, boss ⇒ déblocage,
 * niveau non-boss ⇒ PAS de déblocage, étoiles ≠ barrière, gardes de déblocage + de forme.
 */

let db: AppDatabase;
let profileId: number;
const NOW = new Date(Date.UTC(2026, 6, 4, 10, 0, 0));
const LATER = new Date(Date.UTC(2026, 6, 4, 11, 0, 0));
/** 10 niveaux + boss (index 10). `treasureEvery: 4` → nœuds 3 et 7 sont des trésors. */
const CONFIG: MapConfig = { levelsPerWorld: 10, treasureEvery: 4, bossQuestionCount: 13 };
const BOSS = CONFIG.levelsPerWorld; // 10
/** Barème ⚙️ (ECONOMY §5) : base 10, +5/étoile, +15 trésor, +50 boss. */
const ECONOMY: EconomyConfig = {
  levelBaseCoins: 10,
  starBonusCoins: 5,
  treasureBonusCoins: 15,
  bossBonusCoins: 50,
  // Le crédit de fin de niveau ne lit que le barème earn ; spend (R4.1) = défauts pour le type.
  spend: CONFIG_DEFAULTS.economy.spend,
};

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

/** Marque un niveau complété directement (met en place l'état de progression d'un test). */
function complete(worldIndex: number, levelIndex: number, stars: 0 | 1 | 2 | 3): void {
  recordStars(db, { profileId, worldIndex, levelIndex }, stars, NOW);
}

/** Complète linéairement les niveaux `0..upTo` (exclus) du monde 0 pour ouvrir le nœud voulu. */
function completeUpTo(worldIndex: number, upTo: number): void {
  for (let i = 0; i < upTo; i += 1) {
    complete(worldIndex, i, 3);
  }
}

function input(worldIndex: number, levelIndex: number, stars: number): FinishLevelInput {
  return { worldIndex, levelIndex, stars };
}

/** Wrapper : injecte le barème `ECONOMY` par défaut (surchargeable pour les tests de barème). */
function finish(
  worldIndex: number,
  levelIndex: number,
  stars: number,
  when: Date = NOW,
  economy: EconomyConfig = ECONOMY,
) {
  return finishLevel(db, profileId, input(worldIndex, levelIndex, stars), CONFIG, economy, when);
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  // Catalogue VIDÉ (R4.2 #382) : `runMigrations` amorce désormais le catalogue socle
  // (`seedSocleCreatures`, art réel), dont la légendaire `legendary:0`. Ces tests isolent le chemin
  // boss qui **crée** la ligne catalogue (rollback « catalogue annulé », contrôle « boss écrit
  // catalogue ») → on part d'un catalogue vide. En PROD la ligne est pré-seedée et `grantLegendaryInTx`
  // (onConflictDoNothing) reste idempotent (même art dérivé) → aucun changement de comportement.
  db.delete(collection).run();
  db.delete(characters).run();
  profileId = seedProfile("Léa");
});

describe("finishLevel — persistance (MAP §4)", () => {
  it("persiste la fin du niveau courant (0) → progress écrit, étoiles stockées, point de reprise", () => {
    const result = finish(0, 0, 2);
    expect(result.ok).toBe(true);
    expect(result.ok && result.stars).toBe(2);
    expect(result.ok && result.unlockedNextWorld).toBe(false);
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 0 })).toBe(2);
  });

  it("avance linéairement : compléter 0 ouvre 1, compléter 1 ouvre 2", () => {
    finish(0, 0, 3);
    expect(finish(0, 1, 3).ok).toBe(true);
    expect(finish(0, 2, 3).ok).toBe(true);
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 2 })).toBe(3);
  });

  // GARDE MONOTONE (MAP §4 / SYNC) : rejouer un niveau moins bien ne baisse jamais les étoiles.
  it("MONOTONE : rejoue le niveau 0 à 3★ puis 1★ → reste 3★", () => {
    finish(0, 0, 3);
    const after = finish(0, 0, 1, LATER);
    expect(after.ok && after.stars).toBe(3);
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 0 })).toBe(3);
  });

  it("MONOTONE : une meilleure reprise fait progresser (1★ puis 3★ → 3★)", () => {
    finish(0, 0, 1);
    const after = finish(0, 0, 3, LATER);
    expect(after.ok && after.stars).toBe(3);
  });
});

describe("finishLevel — gains de pièces (ECONOMY §4.1/§5, story #126)", () => {
  // GARDE « base + bonus étoiles » : un niveau normal à 2★ = 10 + 2×5 = 20 pièces créditées.
  it("niveau normal 2★ ⇒ base 10 + 2×5 = 20 pièces créditées + ledger + solde", () => {
    const result = finish(0, 0, 2); // nœud 0 = normal
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reward).toEqual({
      base: 10,
      starBonus: 10,
      treasureBonus: 0,
      bossBonus: 0,
      total: 20,
    });
    expect(result.coinsApplied).toBe(true);
    expect(result.balance.coins).toBe(20);
    // Solde persisté réellement (pas seulement la valeur renvoyée).
    expect(loadWallet(db, profileId).coins).toBe(20);
    // Ligne ledger tracée (earn/coins/level, ref_id de rejeu).
    const rows = db
      .select({ amount: ledger.amount, reason: ledger.reason, refId: ledger.refId })
      .from(ledger)
      .all();
    expect(rows).toEqual([{ amount: 20, reason: "level", refId: levelRewardRefId(0, 0) }]);
  });

  // GARDE « 0★ crédite quand même la base » (no-fail : terminer rapporte toujours, ECONOMY §1).
  it("niveau normal 0★ ⇒ base 10 seule créditée (no-fail : terminer rapporte toujours)", () => {
    const result = finish(0, 0, 0);
    expect(result.ok && result.reward.total).toBe(10);
    expect(loadWallet(db, profileId).coins).toBe(10);
  });

  // GARDE « bonus TRÉSOR » (effet observable) : le nœud 3 (treasureEvery=4 → (3+1)%4===0) est un
  // trésor → +15. À 1★ : 10 + 5 + 15 = 30. Le type est dérivé SERVEUR de la position (jamais
  // du client). Rouge si le bonus trésor cessait de s'appliquer, ou s'appliquait à un nœud normal.
  it("nœud TRÉSOR (index 3) ⇒ bonus trésor +15 ajouté (10 + 1×5 + 15 = 30)", () => {
    completeUpTo(0, 3); // ouvre le nœud 3 (trésor)
    const result = finish(0, 3, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reward).toEqual({
      base: 10,
      starBonus: 5,
      treasureBonus: 15,
      bossBonus: 0,
      total: 30,
    });
    expect(loadWallet(db, profileId).coins).toBe(30);
  });

  // GARDE « nœud NORMAL n'a PAS de bonus trésor » (contraste avec le test ci-dessus) : le nœud 2
  // (voisin du trésor 3) ne reçoit AUCUN bonus trésor.
  it("nœud NORMAL voisin d'un trésor (index 2) ⇒ AUCUN bonus trésor", () => {
    completeUpTo(0, 2);
    const result = finish(0, 2, 1);
    expect(result.ok && result.reward.treasureBonus).toBe(0);
    expect(result.ok && result.reward.total).toBe(15); // 10 + 5, pas de +15
  });

  // GARDE « boss ⇒ gros lot +50, jamais bonus trésor » (story 5.6) : le boss (dernier nœud)
  // rapporte le gain de niveau standard + le bonus boss (+50), jamais un bonus trésor (le boss
  // n'est jamais un trésor, MAP §6). À 3★ : 10 + 3×5 + 50 = 75.
  it("BOSS (dernier nœud) ⇒ gros lot +50 ajouté, AUCUN bonus trésor (10 + 3×5 + 50 = 75)", () => {
    completeUpTo(0, BOSS);
    const result = finish(0, BOSS, 3);
    expect(result.ok && result.reward.treasureBonus).toBe(0);
    expect(result.ok && result.reward.bossBonus).toBe(50);
    expect(result.ok && result.reward.total).toBe(75); // 10 + 3×5 + 50
    // Le gros lot est réellement crédité au portefeuille.
    expect(loadWallet(db, profileId).coins).toBe(75);
  });

  // GARDE « barème = config versionnée » : un barème différent change le montant (rouge si un
  // montant était figé en dur au lieu de lire EconomyConfig).
  it("barème ⚙️ différent ⇒ montant différent (config versionnée, pas de valeur en dur)", () => {
    const richConfig: EconomyConfig = {
      levelBaseCoins: 100,
      starBonusCoins: 50,
      treasureBonusCoins: 0,
      bossBonusCoins: 0,
      spend: CONFIG_DEFAULTS.economy.spend,
    };
    const result = finish(0, 0, 2, NOW, richConfig);
    expect(result.ok && result.reward.total).toBe(200); // 100 + 2×50
    expect(loadWallet(db, profileId).coins).toBe(200);
  });

  // GARDE « barème entièrement nul ⇒ aucun crédit » (branche total===0, coverage 100%) : un
  // niveau à 0★ avec base 0 ne crédite rien (creditWalletInTx exige amount > 0) — solde reste 0.
  it("barème NUL + 0★ ⇒ aucun crédit (solde inchangé), coinsApplied false, progress quand même écrit", () => {
    const zeroConfig: EconomyConfig = {
      levelBaseCoins: 0,
      starBonusCoins: 0,
      treasureBonusCoins: 0,
      bossBonusCoins: 0,
      spend: CONFIG_DEFAULTS.economy.spend,
    };
    const result = finish(0, 0, 0, NOW, zeroConfig);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reward.total).toBe(0);
    expect(result.coinsApplied).toBe(false);
    expect(result.balance.coins).toBe(0);
    expect(loadWallet(db, profileId).coins).toBe(0);
    // Aucune ligne ledger (aucun crédit tenté).
    expect(db.select({ id: ledger.id }).from(ledger).all()).toEqual([]);
    // Mais la progression EST écrite (fin de niveau persistée même sans gain).
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 0 })).toBe(0);
  });
});

describe("finishLevel — idempotence du gain (SYNC §2, story #126)", () => {
  // GARDE « pas de DOUBLE crédit au rejeu » (effet observable) : rejouer la même fin de niveau
  // ne recrédite PAS (ref_id déjà journalisé) — le solde reste le gain d'un seul niveau, une
  // seule ligne ledger. Rouge si l'idempotence du crédit sautait (double pièces).
  it("REJEU d'une même fin ⇒ PAS de double crédit (solde inchangé, une seule ligne ledger)", () => {
    const first = finish(0, 0, 2, NOW);
    expect(first.ok && first.coinsApplied).toBe(true);
    expect(first.ok && first.balance.coins).toBe(20);

    const replay = finish(0, 0, 2, LATER); // rejeu réseau
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    // Aucun 2ᵉ crédit : solde toujours 20, crédit NON appliqué.
    expect(replay.coinsApplied).toBe(false);
    expect(replay.balance.coins).toBe(20);
    expect(loadWallet(db, profileId).coins).toBe(20);
    // Une SEULE ligne ledger (pas de doublon).
    expect(db.select({ id: ledger.id }).from(ledger).all()).toHaveLength(1);
  });

  // GARDE « rejeu MEILLEUR ne recrédite pas non plus » : même un rejeu à plus d'étoiles ne
  // recrédite pas (la clé de rejeu est (world, level), indépendante des étoiles) → le crédit
  // reste celui du 1er passage (idempotence par ref_id).
  it("rejeu à plus d'étoiles ⇒ étoiles progressent (monotone) MAIS crédit NON re-appliqué", () => {
    finish(0, 0, 1, NOW); // 10 + 5 = 15
    const better = finish(0, 0, 3, LATER); // meilleur score
    expect(better.ok && better.stars).toBe(3); // étoiles montées (monotone)
    expect(better.ok && better.coinsApplied).toBe(false); // mais pas de 2ᵉ crédit
    expect(loadWallet(db, profileId).coins).toBe(15); // solde = crédit du 1er passage
  });
});

describe("finishLevel — ATOMICITÉ multi-écritures / rollback (règle #122/#124, story #126)", () => {
  // GARDE ROLLBACK MULTI-ÉCRITURES (effet observable, mutation-prouvé) :
  // La transaction protège ≥2 écritures : (1) recordStars (progress), puis (2)/(3) creditWalletInTx
  // (upsert wallet + INSERT ledger). On induit la panne à la 2ᵉ/3ᵉ écriture GARDÉE — l'INSERT
  // `ledger` — en DROPPANT la colonne `amount` de `ledger` (rebuild sans `amount`). Le
  // `ledgerEntryExists` en amont fait `SELECT id FROM ledger WHERE …` : il reste requêtable (colonnes
  // id/profile_id/reason/ref_id présentes) → il NE court-circuite PAS avant la 1ʳᵉ écriture (règle
  // #122 : la panne frappe l'écriture gardée, jamais une lecture en amont). L'ordre observé :
  //   1. recordStars réussit (progress écrit)   ← 1ʳᵉ écriture
  //   2. upsert wallet réussit (+coins)          ← 2ᵉ écriture
  //   3. INSERT ledger ÉCHOUE (colonne `amount` manquante) ← 3ᵉ écriture gardée
  //   ⇒ la transaction ROLLBACK : ni progress, ni wallet ne persistent.
  // PREUVE : retirer le wrapper `db.transaction` de finishLevel casse PRÉCISÉMENT ce test
  // (progress + wallet resteraient écrits malgré l'échec du ledger). Vérifié par mutation manuelle.
  it("ROLLBACK : panne de l'INSERT ledger (2ᵉ/3ᵉ écriture) ⇒ progress ET wallet annulés (aucun état partiel)", () => {
    // Rebuild `ledger` SANS la colonne `amount` : le SELECT de `ledgerEntryExists` (id/reason/ref_id)
    // reste valide → l'échec survient à l'INSERT (qui pose `amount`), APRÈS recordStars + wallet.
    db.run(sql`DROP TABLE ledger`);
    db.run(
      sql`CREATE TABLE ledger (
        id integer PRIMARY KEY AUTOINCREMENT,
        profile_id integer NOT NULL,
        direction text NOT NULL,
        currency text NOT NULL,
        reason text NOT NULL,
        ref_id text,
        created_at integer NOT NULL DEFAULT (unixepoch())
      )`,
    );

    expect(() => finish(0, 0, 2)).toThrow();

    // ROLLBACK PROUVÉ : aucune ligne progress (étoiles = 0 = jamais joué), solde à 0.
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 0 })).toBe(0);
    expect(loadWallet(db, profileId).coins).toBe(0);
  });

  // Contrôle NÉGATIF du test ci-dessus : le MÊME scénario SANS panne écrit bien progress + wallet
  // (prouve que la panne ci-dessus est la SEULE cause du rollback, pas une garde en amont).
  it("CONTRÔLE : sans panne, la même fin écrit bien progress ET wallet (le rollback n'est dû qu'à la panne)", () => {
    const result = finish(0, 0, 2);
    expect(result.ok).toBe(true);
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 0 })).toBe(2);
    expect(loadWallet(db, profileId).coins).toBe(20);
  });

  // GARDE ROLLBACK BOSS — panne de l'INSERT `collection` (5ᵉ écriture, story 5.6) :
  // Le chemin boss protège ≥2 écritures dans la MÊME transaction : recordStars (progress, 1ʳᵉ)
  // → upsert wallet (2ᵉ) → INSERT ledger (3ᵉ) → upsert characters (4ᵉ) → INSERT collection (5ᵉ).
  // On induit la panne à la 5ᵉ écriture GARDÉE — l'INSERT `collection` — en DROPPANT la colonne
  // `count` de `collection` (rebuild sans `count`). Le `SELECT id FROM collection WHERE …`
  // d'idempotence en amont (dans `grantLegendaryInTx`) reste requêtable (colonne id présente) →
  // il NE court-circuite PAS avant la 1ʳᵉ écriture (règle #122 : la panne frappe l'écriture
  // gardée, jamais une lecture en amont). L'ordre observé :
  //   1. recordStars réussit (progress)            ← 1ʳᵉ écriture
  //   2. upsert wallet réussit (+coins)            ← 2ᵉ écriture
  //   3. INSERT ledger réussit                     ← 3ᵉ écriture
  //   4. upsert characters réussit (catalogue)     ← 4ᵉ écriture
  //   5. INSERT collection ÉCHOUE (colonne `count` manquante) ← 5ᵉ écriture gardée
  //   ⇒ la transaction ROLLBACK : NI progress, NI wallet, NI ledger, NI catalogue ne persistent.
  // PREUVE : retirer le wrapper `db.transaction` de finishLevel casse PRÉCISÉMENT ce test
  // (progress + wallet + ledger + catalogue resteraient écrits malgré l'échec du collection insert).
  it("ROLLBACK BOSS : panne de l'INSERT collection (5ᵉ écriture) ⇒ progress, wallet, ledger ET catalogue annulés", () => {
    completeUpTo(0, BOSS); // ouvre le boss

    // Rebuild `collection` SANS la colonne `count` : le SELECT d'idempotence (id) reste valide →
    // l'échec survient à l'INSERT (qui pose `count`), APRÈS recordStars + wallet + ledger + characters.
    db.run(sql`DROP TABLE collection`);
    db.run(
      sql`CREATE TABLE collection (
        id text PRIMARY KEY NOT NULL,
        profile_id integer NOT NULL,
        character_id text NOT NULL,
        stage integer NOT NULL DEFAULT 1,
        nickname text,
        unlocked_at integer NOT NULL DEFAULT (unixepoch())
      )`,
    );

    expect(() => finish(0, BOSS, 3)).toThrow();

    // ROLLBACK PROUVÉ : rien n'a persisté du boss — ni progression, ni pièces, ni ledger, ni
    // catalogue de la légendaire (aucun état partiel : pas de légendaire sans progression, etc.).
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: BOSS })).toBe(0);
    // Le solde ne porte que les crédits des niveaux 0..9 (completeUpTo) — recordStars direct
    // n'écrit pas de wallet ; aucun crédit boss n'a été appliqué → solde à 0.
    expect(loadWallet(db, profileId).coins).toBe(0);
    // Aucune ligne ledger (le crédit boss a été annulé).
    expect(db.select({ id: ledger.id }).from(ledger).all()).toEqual([]);
    // Le catalogue de la légendaire a été annulé (rollback de l'upsert characters).
    expect(db.select().from(characters).all()).toEqual([]);
  });

  // Contrôle NÉGATIF du rollback boss : le MÊME boss SANS panne écrit progress + wallet + ledger
  // + catalogue + possession (prouve que la panne est la SEULE cause du rollback boss).
  it("CONTRÔLE BOSS : sans panne, le boss écrit progress, wallet, catalogue ET possession", () => {
    completeUpTo(0, BOSS);
    const result = finish(0, BOSS, 3);
    expect(result.ok).toBe(true);
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: BOSS })).toBe(3);
    expect(loadWallet(db, profileId).coins).toBe(75); // 10 + 3×5 + 50 boss
    expect(db.select().from(characters).all()).toHaveLength(1);
    expect(db.select().from(collection).all()).toHaveLength(1);
  });
});

describe("finishLevel — déblocage linéaire boss ⇒ monde suivant (MAP §6)", () => {
  // GARDE « boss ⇒ déblocage » (effet observable) : compléter le boss (dernier nœud) ouvre
  // le monde suivant. Rouge si `unlockedNextWorld` cessait de dépendre de `levelIndex === boss`.
  it("BOSS COMPLÉTÉ ⇒ unlockedNextWorld: true ET monde suivant réellement débloqué", () => {
    completeUpTo(0, BOSS); // ouvre le boss (nœud courant = 10)
    const result = finish(0, BOSS, 3);
    expect(result.ok && result.stars).toBe(3);
    expect(result.ok && result.unlockedNextWorld).toBe(true);
    // Effet réel dérivé du progress : le monde 1 est désormais débloqué.
    expect(getUnlockedWorldCount(db, profileId, CONFIG.levelsPerWorld)).toBe(2);
  });

  // GARDE « niveau NON-boss ne débloque PAS » (effet observable, contraste avec le test ci-dessus).
  it("NIVEAU NON-BOSS complété ⇒ unlockedNextWorld: false ET monde suivant TOUJOURS verrouillé", () => {
    const result = finish(0, 0, 3);
    expect(result.ok && result.unlockedNextWorld).toBe(false);
    expect(getUnlockedWorldCount(db, profileId, CONFIG.levelsPerWorld)).toBe(1); // pas de déblocage
  });

  // GARDE « ÉTOILES ≠ BARRIÈRE » (MAP §1/§8) : boss à 1★ débloque EXACTEMENT comme à 3★.
  it("ÉTOILES ≠ BARRIÈRE : boss complété avec 1★ débloque le monde suivant (comme 3★)", () => {
    completeUpTo(0, BOSS);
    const result = finish(0, BOSS, 1);
    expect(result.ok && result.stars).toBe(1);
    expect(result.ok && result.unlockedNextWorld).toBe(true);
    expect(getUnlockedWorldCount(db, profileId, CONFIG.levelsPerWorld)).toBe(2);
  });
});

describe("finishLevel — légendaire garantie du boss (MAP §6, ECONOMY §3.2/§3.3, story 5.6)", () => {
  // GARDE « boss ⇒ légendaire ajoutée » (effet observable) : battre le boss ajoute la légendaire
  // déterministe du monde à la collection (hors œufs). Rouge si l'ajout cessait d'avoir lieu.
  it("BOSS battu ⇒ légendaire du monde ajoutée à la collection (déterministe, hors œufs)", () => {
    completeUpTo(0, BOSS);
    const result = finish(0, BOSS, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legendaryAdded).toBe(true);
    // La légendaire renvoyée = la légendaire déterministe du monde 0.
    const expected = legendaryForWorld(0);
    expect(result.legendary).toEqual({
      characterId: expected.id,
      name: expected.nameDefault,
      story: expected.story,
      artRef: expected.artRef,
    });
    // Effet réel persisté : la possession existe dans `collection`, le catalogue est amorcé.
    const owned = db
      .select()
      .from(collection)
      .where(eq(collection.id, collectionKey(profileId, legendaryCharacterId(0))))
      .get();
    expect(owned?.characterId).toBe(legendaryCharacterId(0));
    expect(owned?.count).toBe(1);
    const cat = db
      .select()
      .from(characters)
      .where(eq(characters.id, legendaryCharacterId(0)))
      .get();
    expect(cat?.rarity).toBe("legendary");
    // HORS ŒUFS (ECONOMY §4.2) : la légendaire du catalogue est exclue du pool d'œufs.
    expect(cat?.inEggPool).toBe(false);
  });

  // GARDE « niveau NON-boss ⇒ AUCUNE légendaire » (effet observable, contraste) : un niveau
  // normal ne donne jamais de légendaire (la collection reste vide).
  it("niveau NON-BOSS ⇒ AUCUNE légendaire (collection vide, legendary null)", () => {
    const result = finish(0, 0, 3);
    expect(result.ok && result.legendary).toBeNull();
    expect(result.ok && result.legendaryAdded).toBe(false);
    expect(db.select().from(collection).all()).toHaveLength(0);
  });

  // GARDE « déterminisme par monde » : le monde 1 donne une légendaire DIFFÉRENTE du monde 0
  // (id/nom dérivés de `world_index`). Rouge si la légendaire ne dépendait pas du monde.
  it("chaque monde a SA légendaire déterministe (monde 1 ≠ monde 0)", () => {
    // Ouvre le monde 1 en battant le boss du monde 0.
    completeUpTo(0, BOSS);
    finish(0, BOSS, 3);
    // Bat le boss du monde 1.
    for (let i = 0; i < BOSS; i += 1)
      recordStars(db, { profileId, worldIndex: 1, levelIndex: i }, 3, NOW);
    const result = finish(1, BOSS, 3);
    expect(result.ok && result.legendary?.characterId).toBe(legendaryCharacterId(1));
    // Deux légendaires distinctes possédées (une par monde).
    expect(db.select().from(collection).all()).toHaveLength(2);
    expect(legendaryCharacterId(1)).not.toBe(legendaryCharacterId(0));
  });

  // GARDE « IDEMPOTENCE : rejeu du boss ⇒ PAS de doublon parasite » (effet observable) : re-battre
  // le boss n'ajoute JAMAIS une 2ᵉ ligne (la légendaire est garantie UNE fois). Rouge si l'ajout
  // n'était pas idempotent (2ᵉ ligne / count incrémenté).
  it("REJEU du boss ⇒ PAS de doublon parasite (une seule possession, legendaryAdded false au rejeu)", () => {
    completeUpTo(0, BOSS);
    const first = finish(0, BOSS, 3, NOW);
    expect(first.ok && first.legendaryAdded).toBe(true);

    const replay = finish(0, BOSS, 3, LATER); // rejeu réseau
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    // La légendaire est TOUJOURS décrite (le monde la donne), mais NON ré-ajoutée.
    expect(replay.legendary?.characterId).toBe(legendaryCharacterId(0));
    expect(replay.legendaryAdded).toBe(false);
    // Une SEULE possession (pas de doublon), count inchangé.
    const owned = db.select().from(collection).all();
    expect(owned).toHaveLength(1);
    expect(owned[0]?.count).toBe(1);
    // Un SEUL catalogue amorcé (upsert idempotent).
    expect(db.select().from(characters).all()).toHaveLength(1);
  });
});

describe("finishLevel — idempotence progression + déblocage (SYNC §2)", () => {
  it("rejeu de la même fin de niveau ⇒ pas de double ligne, étoiles inchangées (monotone)", () => {
    completeUpTo(0, BOSS);
    finish(0, BOSS, 2, NOW);
    finish(0, BOSS, 2, LATER);
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: BOSS })).toBe(2);
  });

  // GARDE « pas de DOUBLE déblocage » : le déblocage est DÉRIVÉ du progress (pas incrémenté),
  // donc rejouer le boss ne double jamais le compte de mondes.
  it("rejeu du boss ⇒ PAS de double déblocage (déblocage dérivé, pas incrémenté)", () => {
    completeUpTo(0, BOSS);
    finish(0, BOSS, 3, NOW);
    finish(0, BOSS, 3, LATER); // rejeu
    // Toujours exactement 2 mondes débloqués (monde 0 + monde 1), pas 3.
    expect(getUnlockedWorldCount(db, profileId, CONFIG.levelsPerWorld)).toBe(2);
  });
});

describe("finishLevel — gardes de déblocage linéaire (source de vérité serveur)", () => {
  // GARDE « monde verrouillé refusé » (effet observable) : on ne persiste pas la fin d'un
  // niveau d'un monde non débloqué (boss du précédent non fait).
  it("monde verrouillé (boss du monde 0 non complété) ⇒ WORLD_LOCKED, aucune écriture", () => {
    const result = finish(1, 0, 3);
    expect(result).toEqual({ ok: false, error: "WORLD_LOCKED" });
    expect(loadStars(db, { profileId, worldIndex: 1, levelIndex: 0 })).toBe(0); // rien écrit
    expect(loadWallet(db, profileId).coins).toBe(0); // aucun crédit non plus
  });

  it("monde débloqué → la fin de son 1ᵉʳ niveau passe", () => {
    completeUpTo(0, BOSS);
    finish(0, BOSS, 3); // ouvre le monde 1
    const result = finish(1, 0, 2);
    expect(result.ok && result.stars).toBe(2);
    expect(result.ok && result.unlockedNextWorld).toBe(false);
  });

  // GARDE « niveau verrouillé refusé » (effet observable) : sauter un niveau dans un monde
  // débloqué est refusé (déblocage linéaire intra-monde).
  it("niveau sauté (au-delà du courant) ⇒ LEVEL_LOCKED, aucune écriture", () => {
    // courant du monde 0 = niveau 0 ; tenter le niveau 3 (sauté).
    const result = finish(0, 3, 3);
    expect(result).toEqual({ ok: false, error: "LEVEL_LOCKED" });
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 3 })).toBe(0);
    expect(loadWallet(db, profileId).coins).toBe(0);
  });

  it("rejoue d'un niveau déjà complété (monotone) est autorisée", () => {
    complete(0, 0, 1);
    const result = finish(0, 0, 3, LATER);
    expect(result.ok && result.stars).toBe(3);
    expect(result.ok && result.unlockedNextWorld).toBe(false);
  });
});

describe("finishLevel — gardes de forme (payload public non fiable, #36)", () => {
  it("worldIndex non-entier ⇒ INVALID_INPUT", () => {
    expect(finish(0.5, 0, 2)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("worldIndex négatif ⇒ INVALID_INPUT", () => {
    expect(finish(-1, 0, 2)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("levelIndex non-numérique ⇒ INVALID_INPUT", () => {
    expect(
      finishLevel(
        db,
        profileId,
        { worldIndex: 0, levelIndex: "boss", stars: 2 },
        CONFIG,
        ECONOMY,
        NOW,
      ),
    ).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("stars hors bornes (4) ⇒ INVALID_INPUT", () => {
    expect(finish(0, 0, 4)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("stars négatif ⇒ INVALID_INPUT", () => {
    expect(finish(0, 0, -1)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("stars non-entier ⇒ INVALID_INPUT", () => {
    expect(finish(0, 0, 2.5)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("stars = 0 accepté (niveau complété sans étoile — no-fail, étoiles ≠ barrière)", () => {
    const result = finish(0, 0, 0);
    expect(result.ok && result.stars).toBe(0);
    // Le niveau est bien complété (ligne progress présente) même à 0★.
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 0 })).toBe(0);
  });
});

describe("finishLevel → ResultsScreen — chemin de révélation RÉEL bout-en-bout (story R3.3, #381)", () => {
  // ▶▶ MUTATION-PROUVÉ SUR LE CHEMIN DE RÉVÉLATION (AC2 #381, garde #206) : ce test rend
  // ENSEMBLE la sortie RÉELLE de `finishLevel` (jamais un objet `legendary` reconstruit à la
  // main dans le test, contrairement à `ResultsScreen.test.tsx`) branchée dans
  // `ResultsScreen`/`LegendaryReveal` — la VRAIE chaîne serveur → UI du reveal boss. ROUGIT si
  // le chemin casse à N'IMPORTE quel maillon :
  //  (a) `finishLevel`/`legendaryForWorld` régresse vers `placeholder://legendary/<i>` (au lieu
  //      du vrai `socle/creature/legendary_world_<i>.png`, R3.1 #378) ;
  //  (b) `LegendaryReveal` cesse de propager `legendary.artRef` à `<AssetImage assetRef=…>` ;
  //  (c) `isRenderableAssetRef` rejette la forme `socle/creature/…`.
  // Distinct de `collection.test.ts` (pin `legendaryForWorld` ISOLÉMENT, jamais le rendu) ET de
  // `ResultsScreen.test.tsx` (pin le rendu à partir d'un `artRef` CHOISI À LA MAIN, jamais issu
  // d'un vrai `finishLevel`) : ni l'un ni l'autre ne rougirait si SEUL le câblage de
  // `finish-level.ts` (l'affectation `artRef: descriptor.artRef`) régressait vers un
  // placeholder en dur — ce test-ci le couvre spécifiquement (src attendu en LITTÉRAL, jamais
  // recalculé via `legendaryForWorld`/`result` dans l'assertion, pour ne pas retomber dans le
  // piège tautologique #206).
  it("BOSS battu ⇒ la révélation rend un VRAI <img> (pas le placeholder), src exact", () => {
    completeUpTo(0, BOSS);
    const result = finish(0, BOSS, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legendary).not.toBeNull();
    if (result.legendary === null) return;

    render(
      createElement(ResultsScreen, {
        stars: result.stars,
        coins: result.balance.coins,
        legendary: result.legendary,
        onContinue: () => {},
      }),
    );

    const art = document.querySelector('[data-asset="results-legendary-art"]');
    expect(art?.tagName).toBe("IMG");
    expect(art).toHaveAttribute("data-asset-state", "rendered");
    // Réf LITTÉRALE (monde 0 socle) — pas `placeholder://legendary/0`.
    expect(art).toHaveAttribute("src", "/generated/socle/creature/legendary_world_0.png");
  });
});
