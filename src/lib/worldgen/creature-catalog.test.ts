import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { characters } from "@/lib/db/schema";
import {
  COMMITTED_CREATURE_SPECIES,
  DEMO_CREATURE_SPECIES,
  creatureArtRef,
} from "@/config/creatures";
import { legendaryForWorld } from "@/lib/game/collection";
import { isRenderableAssetRef } from "@/lib/game/world-theme";
import {
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
  runMigrations(db); // migre (socle_worlds amorcé) — characters VIDE (le catalogue n'est PAS seedé à la migration).
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
