import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { characters, collection, collectionKey, profiles } from "@/lib/db/schema";
import { isRenderableAssetRef } from "@/lib/game/world-theme";
import { strings } from "@/strings";
import {
  ensureCharacterInTx,
  grantLegendaryInTx,
  isInEggPool,
  legendaryCharacterId,
  legendaryForWorld,
  legendarySpeciesKey,
  loadCollection,
  loadCollectionEntry,
  NICKNAME_MAX_LENGTH,
  normalizeNickname,
  pickDeterministic,
  renameCharacter,
} from "./collection";

/**
 * Tests de la **couche collection** (story 5.6, ECONOMY §3.2/§3.3, MAP §6, PRODUCT §2.3),
 * sur **base réelle** (SQLite en mémoire + migrations). Prouvent à effet observable :
 * - seed **déterministe** de la légendaire par `world_index` (id/species/nom/histoire) ;
 * - ajout **idempotent** + **hors œufs** (pas de doublon parasite au rejeu) ;
 * - **exclusion du pool d'œufs** (garde `isInEggPool` — légendaire false, commune true) ;
 * - lecture du Pokédex (nom affiché = nickname sinon défaut, tri par obtention) ;
 * - **renommage** validé (forme + propriété) et persisté.
 */

let db: AppDatabase;
let profileId: number;
const NOW = new Date(Date.UTC(2026, 6, 4, 10, 0, 0));
const LATER = new Date(Date.UTC(2026, 6, 4, 11, 0, 0));

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

describe("clés déterministes de la légendaire (MAP §6)", () => {
  it("id / species / art dérivent du world_index (déterministe, reproductible)", () => {
    expect(legendaryCharacterId(0)).toBe("legendary:0");
    expect(legendaryCharacterId(7)).toBe("legendary:7");
    expect(legendarySpeciesKey(3)).toBe("legendary_world_3");
    // Art RÉEL (story R3.1, #378) : réf relative rendable `socle/creature/legendary_world_<i>.png`
    // (l'art committé du run payant, plus de `placeholder://…`) — dérivée du world_index.
    expect(legendaryForWorld(2).artRef).toBe("socle/creature/legendary_world_2.png");
    expect(isRenderableAssetRef(legendaryForWorld(2).artRef)).toBe(true);
  });

  it("mondes différents ⇒ ids différents (une légendaire par monde)", () => {
    expect(legendaryCharacterId(0)).not.toBe(legendaryCharacterId(1));
  });
});

describe("pickDeterministic (pioche stable par world_index, sans RNG)", () => {
  it("pioche le même élément pour le même index (modulo)", () => {
    const pool = ["a", "b", "c"] as const;
    expect(pickDeterministic(pool, 0)).toBe("a");
    expect(pickDeterministic(pool, 1)).toBe("b");
    expect(pickDeterministic(pool, 2)).toBe("c");
    // Modulo : l'index 3 boucle sur le 1ᵉʳ élément (déterministe, jamais hors bornes).
    expect(pickDeterministic(pool, 3)).toBe("a");
  });
});

describe("legendaryForWorld (descripteur déterministe, MAP §6)", () => {
  it("dérive un descripteur complet du world_index (légendaire, hors œufs)", () => {
    const legendary = legendaryForWorld(0);
    expect(legendary).toEqual({
      id: "legendary:0",
      worldIndex: 0,
      speciesKey: "legendary_world_0",
      nameDefault: strings.collection.legendaryNames[0],
      rarity: "legendary",
      inEggPool: false,
      artRef: "socle/creature/legendary_world_0.png",
      story: strings.collection.legendaryStories[0],
    });
  });

  it("est déterministe : deux appels sur le même monde donnent le même descripteur", () => {
    expect(legendaryForWorld(5)).toEqual(legendaryForWorld(5));
  });

  it("noms/histoires piochés dans les banques centralisées (jamais en dur)", () => {
    const legendary = legendaryForWorld(1);
    expect(strings.collection.legendaryNames).toContain(legendary.nameDefault);
    expect(strings.collection.legendaryStories).toContain(legendary.story);
  });
});

describe("ensureCharacterInTx (amorçage idempotent du catalogue)", () => {
  it("amorce la ligne catalogue si absente", () => {
    db.transaction((tx) => ensureCharacterInTx(tx, legendaryForWorld(0)));
    const row = db.select().from(characters).where(eq(characters.id, "legendary:0")).get();
    expect(row?.rarity).toBe("legendary");
    expect(row?.inEggPool).toBe(false);
  });

  it("ne réécrit JAMAIS une ligne existante (onConflictDoNothing — art réel épic #6 préservé)", () => {
    // 1ʳᵉ amorce avec un art réel simulé (épic #6).
    db.insert(characters)
      .values({
        id: "legendary:0",
        worldIndex: 0,
        speciesKey: "legendary_world_0",
        nameDefault: "Braisille",
        rarity: "legendary",
        inEggPool: false,
        artRef: "cdn://real-art/legendary-0.png",
      })
      .run();
    // Ré-amorce avec le placeholder → ne doit PAS écraser l'art réel.
    db.transaction((tx) => ensureCharacterInTx(tx, legendaryForWorld(0)));
    const row = db.select().from(characters).where(eq(characters.id, "legendary:0")).get();
    expect(row?.artRef).toBe("cdn://real-art/legendary-0.png");
    expect(db.select().from(characters).all()).toHaveLength(1);
  });
});

describe("grantLegendaryInTx (ajout garanti hors œufs, idempotent — MAP §6)", () => {
  it("ajoute la légendaire du monde à la collection (1ʳᵉ obtention)", () => {
    const result = db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, NOW));
    expect(result.added).toBe(true);
    const owned = db
      .select()
      .from(collection)
      .where(eq(collection.id, collectionKey(profileId, "legendary:0")))
      .get();
    expect(owned?.characterId).toBe("legendary:0");
    expect(owned?.count).toBe(1);
    expect(owned?.stage).toBe(1);
    expect(owned?.nickname).toBeNull();
    // Le catalogue est amorcé (hors œufs).
    expect(isInEggPool(db, "legendary:0")).toBe(false);
  });

  // GARDE IDEMPOTENCE (effet observable) : re-gagner le boss n'ajoute PAS de 2ᵉ ligne ni
  // n'incrémente `count` (la légendaire est garantie UNE fois). Rouge si l'ajout n'était pas
  // idempotent (2ᵉ possession / count 2).
  it("REJEU ⇒ PAS de doublon parasite (added false, une seule possession, count inchangé)", () => {
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, NOW));
    const replay = db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, LATER));
    expect(replay.added).toBe(false);
    const owned = db.select().from(collection).all();
    expect(owned).toHaveLength(1);
    expect(owned[0]?.count).toBe(1);
  });

  it("deux profils gagnent la même légendaire indépendamment (une possession chacun)", () => {
    const other = seedProfile("Noé");
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, NOW));
    db.transaction((tx) => grantLegendaryInTx(tx, other, 0, NOW));
    expect(db.select().from(collection).all()).toHaveLength(2);
    // Un SEUL catalogue partagé (pas dupliqué par profil).
    expect(db.select().from(characters).all()).toHaveLength(1);
  });
});

describe("isInEggPool (exclusion des légendaires du pool d'œufs — ECONOMY §4.2)", () => {
  // GARDE EXCLUSION (effet observable) : une légendaire amorcée est HORS pool d'œufs (false).
  // Rouge si `in_egg_pool` de la légendaire passait à true (elle tomberait dans le tirage d'œuf).
  it("la légendaire est EXCLUE du pool d'œufs (in_egg_pool false)", () => {
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, NOW));
    expect(isInEggPool(db, "legendary:0")).toBe(false);
  });

  // GARDE CONTRASTE (effet observable) : une commune EST dans le pool d'œufs (true). Prouve que
  // `isInEggPool` reflète réellement la colonne, pas un `false` constant.
  it("une créature COMMUNE est DANS le pool d'œufs (in_egg_pool true) — contraste", () => {
    db.insert(characters)
      .values({
        id: "common:0",
        worldIndex: 0,
        speciesKey: "common_world_0",
        nameDefault: "Goupil",
        rarity: "common",
        artRef: "placeholder://common/0",
      })
      .run();
    expect(isInEggPool(db, "common:0")).toBe(true);
  });

  it("une créature inconnue du catalogue n'est jamais dans le pool (garde de forme)", () => {
    expect(isInEggPool(db, "ghost:404")).toBe(false);
  });
});

describe("loadCollection (Pokédex — PRODUCT §2.3)", () => {
  it("collection vide → liste vide (aucun boss battu)", () => {
    expect(loadCollection(db, profileId)).toEqual([]);
  });

  it("enrichit chaque possession du catalogue (nom affiché = défaut si non renommé)", () => {
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, NOW));
    const entries = loadCollection(db, profileId);
    expect(entries).toHaveLength(1);
    const legendary = legendaryForWorld(0);
    expect(entries[0]).toEqual({
      characterId: "legendary:0",
      displayName: legendary.nameDefault, // pas de nickname → nom par défaut
      defaultName: legendary.nameDefault,
      nickname: null,
      rarity: "legendary",
      story: legendary.story,
      stage: 1,
      maxStage: 1,
      count: 1,
      artRef: legendary.artRef,
    });
  });

  it("nom affiché = nickname si l'enfant a renommé (dérivé, jamais persisté en double)", () => {
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, NOW));
    renameCharacter(db, profileId, "legendary:0", "Flamme");
    const entry = loadCollection(db, profileId)[0];
    expect(entry.displayName).toBe("Flamme");
    expect(entry.nickname).toBe("Flamme");
    expect(entry.defaultName).toBe(legendaryForWorld(0).nameDefault);
  });

  it("story null (catalogue sans histoire) → chaîne vide (jamais null côté UI)", () => {
    // Amorce une créature au catalogue SANS story (nullable).
    db.insert(characters)
      .values({
        id: "legendary:0",
        worldIndex: 0,
        speciesKey: "legendary_world_0",
        nameDefault: "Braisille",
        rarity: "legendary",
        inEggPool: false,
        artRef: "placeholder://legendary/0",
        // story omis → NULL
      })
      .run();
    db.insert(collection)
      .values({
        id: collectionKey(profileId, "legendary:0"),
        profileId,
        characterId: "legendary:0",
      })
      .run();
    expect(loadCollection(db, profileId)[0].story).toBe("");
  });

  // GARDE TRI (effet observable) : les entrées sont triées par ordre d'obtention (unlocked_at).
  it("trie par ordre d'obtention (unlocked_at croissant)", () => {
    // Monde 1 gagné en premier (NOW), monde 0 ensuite (LATER) → l'ordre de tri = par date.
    db.insert(characters)
      .values({
        id: "legendary:1",
        worldIndex: 1,
        speciesKey: "legendary_world_1",
        nameDefault: "Aquagon",
        rarity: "legendary",
        inEggPool: false,
        artRef: "placeholder://legendary/1",
      })
      .run();
    db.insert(collection)
      .values({
        id: collectionKey(profileId, "legendary:1"),
        profileId,
        characterId: "legendary:1",
        unlockedAt: NOW,
      })
      .run();
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, LATER));
    const entries = loadCollection(db, profileId);
    expect(entries.map((e) => e.characterId)).toEqual(["legendary:1", "legendary:0"]);
  });

  it("ne renvoie que les créatures du profil demandé (isolation par profil)", () => {
    const other = seedProfile("Noé");
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, NOW));
    db.transaction((tx) => grantLegendaryInTx(tx, other, 1, NOW));
    expect(loadCollection(db, profileId).map((e) => e.characterId)).toEqual(["legendary:0"]);
    expect(loadCollection(db, other).map((e) => e.characterId)).toEqual(["legendary:1"]);
  });

  // GARDE TIE-BREAK (effet observable) : deux possessions au MÊME instant (unlocked_at égal)
  // sont ordonnées de façon **stable** par `characterId` (le `||` du tri). Rouge si le
  // tie-break sautait (ordre non déterministe pour un même instant). On amorce les deux au
  // MÊME `NOW` → seule la comparaison de characterId départage.
  it("ordre STABLE quand deux créatures partagent le même unlocked_at (tie-break par characterId)", () => {
    // Deux mondes battus « au même instant » (même NOW) → même unlocked_at.
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, 2, NOW));
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, NOW));
    // legendary:0 < legendary:2 lexicographiquement → 0 avant 2, quel que soit l'ordre d'insertion.
    expect(loadCollection(db, profileId).map((e) => e.characterId)).toEqual([
      "legendary:0",
      "legendary:2",
    ]);
  });
});

describe("loadCollectionEntry (fiche créature — story R3.2 #379, WIREFRAMES §5b)", () => {
  it("créature possédée ⇒ entrée enrichie (même forme que loadCollection, + maxStage)", () => {
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, NOW));
    const legendary = legendaryForWorld(0);
    expect(loadCollectionEntry(db, profileId, "legendary:0")).toEqual({
      characterId: "legendary:0",
      displayName: legendary.nameDefault,
      defaultName: legendary.nameDefault,
      nickname: null,
      rarity: "legendary",
      story: legendary.story,
      stage: 1,
      maxStage: 1,
      count: 1,
      artRef: legendary.artRef,
    });
  });

  it("nom affiché = nickname si l'enfant a renommé (même dérivation que loadCollection)", () => {
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, 0, NOW));
    renameCharacter(db, profileId, "legendary:0", "Flamme");
    const entry = loadCollectionEntry(db, profileId, "legendary:0");
    expect(entry?.displayName).toBe("Flamme");
    expect(entry?.nickname).toBe("Flamme");
  });

  // GARDE PROPRIÉTÉ (effet observable, mutation-prouvé) : une créature qui n'existe pas du
  // tout (id inconnu) ⇒ null, jamais un plantage.
  it("id inconnu ⇒ null (jamais un plantage)", () => {
    expect(loadCollectionEntry(db, profileId, "legendary:999")).toBeNull();
  });

  // GARDE PROPRIÉTÉ (effet observable, mutation-prouvé) : une créature possédée par un AUTRE
  // profil ⇒ null pour CE profil — rougit si la garde `AND collection.profileId = ?` sautait
  // (fuite de la créature d'un autre profil, même piège que `renameCharacter`).
  it("créature possédée par un AUTRE profil ⇒ null (jamais de fuite inter-profil)", () => {
    const other = seedProfile("Noé");
    db.transaction((tx) => grantLegendaryInTx(tx, other, 0, NOW));
    expect(loadCollectionEntry(db, profileId, "legendary:0")).toBeNull();
    // Le propriétaire réel la voit bien.
    expect(loadCollectionEntry(db, other, "legendary:0")?.characterId).toBe("legendary:0");
  });

  it("story null (catalogue sans histoire) → chaîne vide (même repli que loadCollection)", () => {
    db.insert(characters)
      .values({
        id: "legendary:0",
        worldIndex: 0,
        speciesKey: "legendary_world_0",
        nameDefault: "Braisille",
        rarity: "legendary",
        inEggPool: false,
        artRef: "placeholder://legendary/0",
        // story omis → NULL
      })
      .run();
    db.insert(collection)
      .values({
        id: collectionKey(profileId, "legendary:0"),
        profileId,
        characterId: "legendary:0",
      })
      .run();
    expect(loadCollectionEntry(db, profileId, "legendary:0")?.story).toBe("");
  });
});

describe("normalizeNickname (validation de forme, PRODUCT §2.3)", () => {
  it("trim + accepte un nom valide", () => {
    expect(normalizeNickname("  Flamme  ")).toBe("Flamme");
  });

  it("refuse le vide (après trim), le trop long, et le non-string", () => {
    expect(normalizeNickname("")).toBeNull();
    expect(normalizeNickname("   ")).toBeNull();
    expect(normalizeNickname("x".repeat(NICKNAME_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeNickname(42)).toBeNull();
    expect(normalizeNickname(null)).toBeNull();
    expect(normalizeNickname(undefined)).toBeNull();
  });

  it("accepte exactement la longueur max (borne inclusive)", () => {
    const name = "x".repeat(NICKNAME_MAX_LENGTH);
    expect(normalizeNickname(name)).toBe(name);
  });
});

describe("renameCharacter (renommage validé + propriété — PRODUCT §2.3)", () => {
  function grant(worldIndex = 0): void {
    db.transaction((tx) => grantLegendaryInTx(tx, profileId, worldIndex, NOW));
  }

  it("renomme une créature possédée (persisté)", () => {
    grant();
    const result = renameCharacter(db, profileId, "legendary:0", "  Flamme  ");
    expect(result).toEqual({ ok: true, nickname: "Flamme" }); // trim appliqué
    const owned = db
      .select()
      .from(collection)
      .where(eq(collection.id, collectionKey(profileId, "legendary:0")))
      .get();
    expect(owned?.nickname).toBe("Flamme");
  });

  // GARDE FORME (effet observable) : un nom invalide est refusé, aucun écrit.
  it("nom invalide ⇒ INVALID_NAME, aucun renommage persisté", () => {
    grant();
    const result = renameCharacter(db, profileId, "legendary:0", "");
    expect(result).toEqual({ ok: false, error: "INVALID_NAME" });
    const owned = db
      .select()
      .from(collection)
      .where(eq(collection.id, collectionKey(profileId, "legendary:0")))
      .get();
    expect(owned?.nickname).toBeNull(); // inchangé
  });

  // GARDE PROPRIÉTÉ (effet observable) : on ne renomme jamais la créature d'un AUTRE profil.
  it("créature non possédée ⇒ NOT_OWNED, aucun renommage", () => {
    // Profil courant NE possède PAS legendary:0 (jamais gagné).
    db.insert(characters)
      .values({
        id: "legendary:0",
        worldIndex: 0,
        speciesKey: "legendary_world_0",
        nameDefault: "Braisille",
        rarity: "legendary",
        inEggPool: false,
        artRef: "placeholder://legendary/0",
      })
      .run();
    const result = renameCharacter(db, profileId, "legendary:0", "Flamme");
    expect(result).toEqual({ ok: false, error: "NOT_OWNED" });
  });

  // GARDE ISOLATION (effet observable) : le renommage d'un profil ne touche PAS la possession
  // d'un autre profil qui a la même créature.
  it("ne renomme QUE la possession du profil demandé (isolation)", () => {
    const other = seedProfile("Noé");
    grant(); // profileId possède legendary:0
    db.transaction((tx) => grantLegendaryInTx(tx, other, 0, NOW)); // other aussi
    renameCharacter(db, profileId, "legendary:0", "Flamme");
    const mine = db
      .select()
      .from(collection)
      .where(eq(collection.id, collectionKey(profileId, "legendary:0")))
      .get();
    const theirs = db
      .select()
      .from(collection)
      .where(eq(collection.id, collectionKey(other, "legendary:0")))
      .get();
    expect(mine?.nickname).toBe("Flamme");
    expect(theirs?.nickname).toBeNull(); // intact
  });
});
