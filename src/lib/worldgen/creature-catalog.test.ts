import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { characters, collection, collectionKey, profiles } from "@/lib/db/schema";
import {
  COMMITTED_CREATURE_SPECIES,
  DEMO_CREATURE_SPECIES,
  creatureArtRef,
} from "@/config/creatures";
import { legendaryForWorld } from "@/lib/game/collection";
import { isRenderableAssetRef } from "@/lib/game/world-theme";
import {
  backfillPlaceholderCreatureArt,
  creatureCharacterId,
  creatureSpeciesKey,
  deriveCreatureSplit,
  deriveSocleCreatures,
  seedSocleCreatures,
  socleCreatureSpeciesKeys,
} from "./creature-catalog";
import { SOCLE_WORLD_COUNT } from "./socle";

/**
 * Tests du **catalogue de créatures socle DÉTERMINISTE** (story R3.1, #378, épic R3 #319). Prouvent
 * à effet observable la cohérence **dérivation ↔ art committé ↔ registre de seed** (#180/#189) et le
 * seed idempotent qui compose avec le boss.
 */

let db: AppDatabase;
beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  // Catalogue VIDÉ : `runMigrations` amorce désormais le catalogue socle (`seedSocleCreatures`, câblé
  // en R4.2 #382). Ces tests exercent `seedSocleCreatures` contre un catalogue CONTRÔLÉ (vide, ou une
  // ligne pré-insérée à la main) → on efface le seed de migration ici (le câblage runMigrations est
  // couvert par `db.test.ts`). `db.delete(characters)` cascade sur `collection` (FK, vide de toute façon).
  db.delete(characters).run();
});

describe("deriveSocleCreatures — descripteurs déterministes (art réel committé)", () => {
  it("reconstruit communes+rares+1 légendaire, art réel relatif, clés = boss/tirage", () => {
    const slot = 0;
    const split = deriveCreatureSplit(slot);
    const eggPool = split.commons + split.rares;
    const catalog = deriveSocleCreatures(slot);

    expect(catalog).toHaveLength(eggPool + 1); // œufs + 1 légendaire.
    const eggs = catalog.slice(0, eggPool);
    const legendary = catalog[catalog.length - 1];

    // Œufs : ordre communes puis rares, in_egg_pool, world_index=slot, art réel rendable.
    expect(eggs.slice(0, split.commons).every((c) => c.rarity === "common")).toBe(true);
    expect(eggs.slice(split.commons).every((c) => c.rarity === "rare")).toBe(true);
    for (const [i, c] of eggs.entries()) {
      expect(c.id).toBe(creatureCharacterId(slot, i));
      expect(c.speciesKey).toBe(creatureSpeciesKey(slot, i));
      expect(c.worldIndex).toBe(slot);
      expect(c.inEggPool).toBe(true);
      expect(c.artRef).toBe(creatureArtRef(c.speciesKey)); // socle/creature/<species>.png
      expect(isRenderableAssetRef(c.artRef)).toBe(true); // art réel RENDABLE (#189).
    }
    // Légendaire : MÊME ligne que le boss (legendaryForWorld), hors œufs, art réel.
    expect(legendary).toEqual(legendaryForWorld(slot));
    expect(legendary.rarity).toBe("legendary");
    expect(legendary.inEggPool).toBe(false);
    expect(isRenderableAssetRef(legendary.artRef)).toBe(true);
  });

  it("déterministe : même slot ⇒ même catalogue", () => {
    expect(deriveSocleCreatures(3)).toEqual(deriveSocleCreatures(3));
  });
});

describe("cohérence dérivation ↔ art committé ↔ registre (#180/#189)", () => {
  it("socleCreatureSpeciesKeys couvre les 6 mondes (41 espèces socle)", () => {
    const keys = socleCreatureSpeciesKeys();
    expect(keys).toHaveLength(41); // 35 œufs + 6 légendaires (deriveCreatureSplit des 6 slots).
    expect(new Set(keys).size).toBe(keys.length); // toutes distinctes.
  });

  // ▶▶ Garde de cohérence MUTATION-PROUVÉE (#164/#180) ◀◀ : le registre de seed
  // (`COMMITTED_CREATURE_SPECIES`) DOIT être exactement `[cloudfox, ...espèces socle dérivées]`.
  // Rougit si une espèce socle est oubliée du registre (art committé jamais seedé) OU si une entrée
  // orpheline y traîne (seed d'un PNG absent → copie qui crashe). Verrou dérivation↔registre.
  it("COMMITTED_CREATURE_SPECIES == [cloudfox, ...dérivation socle] (aucun oubli, aucun orphelin)", () => {
    expect([...COMMITTED_CREATURE_SPECIES]).toEqual([
      DEMO_CREATURE_SPECIES,
      ...socleCreatureSpeciesKeys(),
    ]);
  });

  // ▶▶ Garde art-RÉEL committé (#189, chemin format-réel non-null) ◀◀ : chaque espèce socle dérivée
  // a un VRAI PNG committé sous test-fixtures/creature/ ET sa réf est rendable. Rougit si une
  // dérivation pointe une espèce dont l'art n'a pas été committé (chemin réel dormant #189).
  it("chaque espèce socle dérivée a un PNG committé + une réf rendable (art réel, pas dormant)", () => {
    for (const species of socleCreatureSpeciesKeys()) {
      expect(isRenderableAssetRef(creatureArtRef(species))).toBe(true);
      expect(existsSync(`test-fixtures/creature/${species}.png`)).toBe(true);
    }
  });
});

describe("seedSocleCreatures — seed idempotent qui compose avec le boss", () => {
  it("seede les 41 créatures socle (art réel) dans characters", () => {
    seedSocleCreatures(db);
    const rows = db.select().from(characters).all();
    expect(rows).toHaveLength(41);
    // Toutes portent un art réel rendable (jamais un placeholder).
    expect(rows.every((r) => isRenderableAssetRef(r.artRef))).toBe(true);
    // La légendaire du monde 0 est présente avec l'art réel + hors œufs.
    const leg = db.select().from(characters).where(eq(characters.id, "legendary:0")).get();
    expect(leg?.artRef).toBe("socle/creature/legendary_world_0.png");
    expect(leg?.inEggPool).toBe(false);
  });

  it("idempotent : re-run n'ajoute aucune ligne (onConflictDoNothing)", () => {
    seedSocleCreatures(db);
    const count1 = db.select().from(characters).all().length;
    seedSocleCreatures(db);
    expect(db.select().from(characters).all()).toHaveLength(count1);
  });

  // ▶▶ Garde onConflictDoNothing MUTATION-PROUVÉE ◀◀ : le seed ne RÉÉCRIT jamais une ligne existante
  // (ex. un art réel déjà posé, ou une légendaire déjà gagnée) — rougit si onConflictDoNothing→DoUpdate.
  it("ne réécrit JAMAIS une ligne existante (art préservé — compose avec un grant antérieur)", () => {
    const id = legendaryForWorld(0).id;
    db.insert(characters)
      .values({
        id,
        worldIndex: 0,
        speciesKey: "legendary_world_0",
        nameDefault: "DéjàLà",
        rarity: "legendary",
        inEggPool: false,
        artRef: "world/custom/already.png",
        story: "posée avant le seed",
      })
      .run();
    seedSocleCreatures(db);
    const row = db.select().from(characters).where(eq(characters.id, id)).get();
    expect(row?.artRef).toBe("world/custom/already.png"); // préservé, jamais écrasé.
    expect(row?.nameDefault).toBe("DéjàLà");
  });

  it("le socle n'a que SOCLE_WORLD_COUNT mondes (invariant de dérivation)", () => {
    expect(SOCLE_WORLD_COUNT).toBe(6);
  });
});

describe("backfillPlaceholderCreatureArt — répare l'art placeholder d'une collection existante (#401/#180)", () => {
  function insertCharacter(overrides: {
    id: string;
    worldIndex: number;
    speciesKey: string;
    nameDefault: string;
    rarity: "common" | "rare" | "legendary";
    inEggPool: boolean;
    artRef: string;
    story: string | null;
  }): void {
    db.insert(characters).values(overrides).run();
  }

  // ▶▶ Garde MUTATION-PROUVÉE (#60/#173) ◀◀ — un SEUL test nommé pinne les DEUX mutations du brief :
  //   (a) retirer le backfill → la ligne placeholder reste placeholder → « art réel posé » ROUGIT ;
  //   (b) retirer la garde `if (isRenderableAssetRef(art_ref)) continue` (clobbe les lignes déjà
  //       réelles) → la ligne `world/custom/deja.png` devient `socle/creature/...` → « inchangée » ROUGIT.
  // Prouve aussi le NON-destructif : possession `collection` (count/nickname) JAMAIS touchée.
  it("placeholder→réel posé, ligne déjà-réelle + possession collection INTACTES (art_ref/story ciblés)", () => {
    const profileId = db
      .insert(profiles)
      .values({ name: "Zoé", nameKey: "zoé", avatar: "fox", pinHash: "x" })
      .returning({ id: profiles.id })
      .get().id;

    const derived = deriveSocleCreatures(0);
    const legendary = derived[derived.length - 1]; // legendary:0 — art réel dérivé.
    const common = derived[0]; // creature:0:0 — art réel dérivé.
    const alreadyReal = derived[1]; // creature:0:1 — on lui pose un art réel CUSTOM distinct.

    // (1) Légendaire gagnée au boss AVANT R3.1 : art placeholder, story VIDE (null).
    insertCharacter({
      id: legendary.id,
      worldIndex: 0,
      speciesKey: legendary.speciesKey,
      nameDefault: legendary.nameDefault,
      rarity: "legendary",
      inEggPool: false,
      artRef: "placeholder://legendary/0",
      story: null,
    });
    // (2) Commune pré-R3.1 : art placeholder mais story DÉJÀ écrite (doit être préservée).
    insertCharacter({
      id: common.id,
      worldIndex: 0,
      speciesKey: common.speciesKey,
      nameDefault: common.nameDefault,
      rarity: "common",
      inEggPool: true,
      artRef: "placeholder://common/0",
      story: "Une histoire déjà écrite.",
    });
    // (3) Ligne DÉJÀ RÉELLE (art rendable custom, distinct du dérivé) : ne doit JAMAIS être réécrite.
    insertCharacter({
      id: alreadyReal.id,
      worldIndex: 0,
      speciesKey: alreadyReal.speciesKey,
      nameDefault: alreadyReal.nameDefault,
      rarity: "common",
      inEggPool: true,
      artRef: "world/custom/deja.png",
      story: "Réel préservé.",
    });
    // Possession enfant de la légendaire placeholder (renommée + doublon) — doit rester INTACTE.
    db.insert(collection)
      .values({
        id: collectionKey(profileId, legendary.id),
        profileId,
        characterId: legendary.id,
        count: 3,
        stage: 1,
        nickname: "Mon dragon",
      })
      .run();

    backfillPlaceholderCreatureArt(db);

    // (1) légendaire : art réel dérivé posé + rendable, story backfillée (était vide).
    const legRow = db.select().from(characters).where(eq(characters.id, legendary.id)).get();
    expect(legRow?.artRef).toBe("socle/creature/legendary_world_0.png");
    expect(legRow?.artRef).toBe(legendary.artRef);
    expect(isRenderableAssetRef(legRow?.artRef ?? "")).toBe(true);
    expect(legRow?.story).toBe(legendary.story); // vide → dérivée.

    // (2) commune : art réel dérivé posé, story existante PRÉSERVÉE.
    const commonRow = db.select().from(characters).where(eq(characters.id, common.id)).get();
    expect(commonRow?.artRef).toBe(common.artRef);
    expect(isRenderableAssetRef(commonRow?.artRef ?? "")).toBe(true);
    expect(commonRow?.story).toBe("Une histoire déjà écrite."); // JAMAIS écrasée.

    // (3) ligne déjà réelle : art_ref + story INCHANGÉS (jamais clobbés — garde !isRenderableAssetRef).
    const realRow = db.select().from(characters).where(eq(characters.id, alreadyReal.id)).get();
    expect(realRow?.artRef).toBe("world/custom/deja.png");
    expect(realRow?.story).toBe("Réel préservé.");

    // NON-destructif : possession `collection` (count/nickname/characterId) JAMAIS touchée.
    const owned = db
      .select()
      .from(collection)
      .where(eq(collection.id, collectionKey(profileId, legendary.id)))
      .get();
    expect(owned?.count).toBe(3);
    expect(owned?.nickname).toBe("Mon dragon");
    expect(owned?.characterId).toBe("legendary:0");
  });

  it("catalogue vide → no-op (aucune ligne à réparer ; branche `ligne absente` + early-return)", () => {
    // beforeEach a vidé `characters` → toutes les lectures socle retombent `undefined`.
    expect(() => backfillPlaceholderCreatureArt(db)).not.toThrow();
    expect(db.select().from(characters).all()).toHaveLength(0);
  });

  it("idempotent : un 2ᵉ passage ne réécrit rien (art déjà réel préservé, #91/#105)", () => {
    const legendary = legendaryForWorld(0);
    insertCharacter({
      id: legendary.id,
      worldIndex: 0,
      speciesKey: legendary.speciesKey,
      nameDefault: legendary.nameDefault,
      rarity: "legendary",
      inEggPool: false,
      artRef: "placeholder://legendary/0",
      story: legendary.story,
    });

    backfillPlaceholderCreatureArt(db);
    const after1 = db.select().from(characters).where(eq(characters.id, legendary.id)).get();
    expect(after1?.artRef).toBe(legendary.artRef); // placeholder → réel.

    // 2ᵉ passage : la garde `!isRenderableAssetRef` écarte la ligne (déjà réelle) → 0 écriture, stable.
    expect(() => backfillPlaceholderCreatureArt(db)).not.toThrow();
    const after2 = db.select().from(characters).where(eq(characters.id, legendary.id)).get();
    expect(after2?.artRef).toBe(legendary.artRef);
  });
});
