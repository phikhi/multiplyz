import { eq } from "drizzle-orm";
import { creatureArtRef } from "@/config/creatures";
import type { AppDatabase } from "@/lib/db";
import { characters, type Rarity } from "@/lib/db/schema";
import { legendaryForWorld, type SeededCharacter } from "@/lib/game/collection";
import { isRenderableAssetRef } from "@/lib/game/world-theme";
import { strings } from "@/strings";
import { SOCLE_WORLD_COUNT } from "./socle";

/**
 * **Dérivation déterministe du CATALOGUE de créatures** (story R3.1, #378, épic R3 #319) — module
 * **PUR** (aucun `server-only`, aucun client image) : c'est la source unique de la répartition
 * rareté/monde/nom/histoire des créatures d'un monde (ECONOMY §5, WORLDGEN §4.3). Extrait de
 * `generate-world.ts` (server-only) pour être **importable HORS du chemin server-only** (migration,
 * seeds `tsx`, R4) — même patron pur/server-only que `socle.ts` (pur) ↔ `socle-assets.ts` (I/O).
 *
 * **Pourquoi pur** : seuls les **octets d'art** d'une créature sont non-déterministes (produits par
 * le run payant Gemini, désormais committés en `test-fixtures/creature/<species>.png`). **TOUT le
 * reste** — id/species/rareté/nom/histoire/`in_egg_pool` + la **réf d'art relative**
 * `creatureArtRef(speciesKey)` — se **dérive** du `world_index`. Donc le catalogue peut être seedé
 * **sans aucune génération** : `deriveSocleCreatures` reconstruit les MÊMES descripteurs que
 * `generateSocleCreatures`, avec l'art réel déjà committé.
 */

/** Rareté d'une créature générée (hors légendaire, qui est fixée par MAP §6). */
export type GeneratedRarity = Extract<Rarity, "common" | "rare">;

/** ⚙️ Répartition des créatures d'un monde (ECONOMY §5 : « plusieurs communes + 1-2 rares + 1 légendaire »). */
export interface CreatureSplit {
  /** Nombre de créatures **communes** (œufs, `in_egg_pool = true`). */
  readonly commons: number;
  /** Nombre de créatures **rares** (œufs, `in_egg_pool = true`). */
  readonly rares: number;
}

/**
 * ⚙️ **Bornes de répartition** (ECONOMY §5, WORLDGEN §4.3) : 6-8 créatures/monde = plusieurs
 * communes + 1-2 rares + **exactement 1 légendaire** (boss only). Centralisées ici (source unique) ;
 * la légendaire n'est pas comptée (fixée par MAP §6, `legendaryForWorld`).
 */
export const CREATURE_TOTALS = {
  /** Total de créatures/monde, bornes incluses (ECONOMY §5 « ~6-8 »). */
  minTotal: 6,
  maxTotal: 8,
  /** Rares/monde, bornes incluses (ECONOMY §5 « 1-2 rares »). */
  minRares: 1,
  maxRares: 2,
  /** La légendaire (boss only) — toujours exactement 1 (MAP §6). */
  legendaries: 1,
} as const;

/**
 * PRNG **déterministe** seedé (mulberry32, même famille que `game/map.ts`) — aucune dépendance à
 * `Math.random`. Même `world_index` ⇒ même suite ⇒ même monde (WORLDGEN §7 reproductibilité :
 * la répartition + la sélection de concepts/noms/histoires sont dérivées, jamais RNG cru).
 */
export function makeSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d_2b_79_f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Entier déterministe dans `[min, max]` (bornes incluses) depuis un tirage `[0,1)`. */
function intInRange(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/**
 * **Répartition déterministe** des créatures d'un monde (ECONOMY §5, WORLDGEN §4.3). Tire un
 * total dans `[minTotal, maxTotal]` et un nombre de rares dans `[minRares, maxRares]`, le reste
 * en communes (**exactement 1 légendaire** en plus, boss only — non compté ici). Garantit
 * `commons ≥ 1` (une répartition sans commune n'a pas de sens pour un pool d'œufs). Pure.
 */
export function deriveCreatureSplit(worldIndex: number): CreatureSplit {
  const rand = makeSeededRandom(worldIndex ^ 0x5f_3a_c1_00);
  const total = intInRange(rand, CREATURE_TOTALS.minTotal, CREATURE_TOTALS.maxTotal);
  const rares = intInRange(rand, CREATURE_TOTALS.minRares, CREATURE_TOTALS.maxRares);
  // Total inclut la légendaire (MAP §6) → les œufs (communes+rares) = total − 1 légendaire.
  const eggPool = total - CREATURE_TOTALS.legendaries;
  const commons = eggPool - rares;
  return { commons, rares };
}

/** Clé de catalogue stable d'une créature non légendaire d'un monde (déterministe). */
export function creatureCharacterId(worldIndex: number, slot: number): string {
  return `creature:${worldIndex}:${slot}`;
}

/** Clé d'espèce stable d'une créature non légendaire (contrat de génération). */
export function creatureSpeciesKey(worldIndex: number, slot: number): string {
  return `creature_world_${worldIndex}_${slot}`;
}

/** Pioche un élément d'une banque **sans réutilisation** dans le monde (index dérivé + offset slot). */
export function pickFromBank<T>(bank: readonly T[], seedBase: number, slot: number): T {
  return bank[(seedBase + slot) % bank.length];
}

/**
 * **Dérive le CATALOGUE complet** (communes + rares + **1 légendaire**) d'un monde du socle
 * (`slot`) — descripteurs `characters` déterministes, art réel `creatureArtRef(speciesKey)` déjà
 * committé (aucune génération). Ordre stable : les `commons` premières communes, puis les rares,
 * puis la légendaire (dernière). C'est la MÊME dérivation que `generateSocleCreatures` (id/species/
 * rareté/nom/histoire), avec la réf d'art **relative** au lieu de l'octet généré. Pure.
 *
 * La légendaire réutilise `legendaryForWorld(slot)` (MÊME id/species/nom que le boss câble) — son
 * `artRef` est déjà la réf réelle `socle/creature/legendary_world_<slot>.png` (cf. `collection.ts`).
 */
export function deriveSocleCreatures(slot: number): SeededCharacter[] {
  const split = deriveCreatureSplit(slot);
  const nameBase = slot % strings.worldgen.creatureNames.length;
  const storyBase = slot % strings.worldgen.creatureStories.length;
  const eggPoolCount = split.commons + split.rares;

  const eggs: SeededCharacter[] = [];
  for (let i = 0; i < eggPoolCount; i += 1) {
    const speciesKey = creatureSpeciesKey(slot, i);
    eggs.push({
      id: creatureCharacterId(slot, i),
      worldIndex: slot,
      speciesKey,
      nameDefault: pickFromBank(strings.worldgen.creatureNames, nameBase, i),
      rarity: i < split.commons ? "common" : "rare",
      inEggPool: true, // communes + rares = pool d'œufs (ECONOMY §4.2).
      artRef: creatureArtRef(speciesKey), // socle/creature/<species>.png (réel committé).
      story: pickFromBank(strings.worldgen.creatureStories, storyBase, i),
    });
  }
  // Légendaire (boss only, hors œufs) : legendaryForWorld porte déjà l'art réel (collection.ts).
  return [...eggs, legendaryForWorld(slot)];
}

/**
 * Toutes les `speciesKey` des créatures socle (6 mondes) — enumération DÉRIVÉE (jamais en dur) qui
 * sert de **garde de cohérence** : `COMMITTED_CREATURE_SPECIES` (registre de seed) doit correspondre
 * exactement à cette liste + la démo `cloudfox` (test `socle == registre` → rougit si une espèce n'a
 * pas de PNG committé, ou si un PNG est orphelin). Pure.
 */
export function socleCreatureSpeciesKeys(): string[] {
  const out: string[] = [];
  for (let slot = 0; slot < SOCLE_WORLD_COUNT; slot += 1) {
    for (const c of deriveSocleCreatures(slot)) {
      out.push(c.speciesKey);
    }
  }
  return out;
}

/**
 * **Seed déterministe du catalogue de créatures socle** dans `characters` (communes + rares +
 * légendaire des 6 mondes), art réel committé. **Idempotent** : `onConflictDoNothing` par PK — ne
 * réécrit JAMAIS une ligne existante (l'art réel d'une légendaire déjà gagnée au boss est préservé,
 * même garde que `seedSocleWorlds`/`ensureCharacterInTx`). **Composé avec le boss** : mêmes clés
 * (`creatureCharacterId`/`legendaryForWorld`) → un grant ultérieur ne duplique rien.
 *
 * **Statut R4.2 (#393, résout #382) — CÂBLÉ** : ce seed, posé en R3.1 (#378), est **désormais invoqué
 * au runtime par `runMigrations`** (`src/lib/db/migrate.ts`) — le catalogue de communes/rares EXISTE en
 * base après migration, ce qui le rend **tirable au tirage d'œuf** (R4.2, `game/egg-draw.ts`). Avant R4,
 * le peupler aurait été INVISIBLE : le Pokédex (`loadCollection`) lit `collection` (possessions), pas le
 * catalogue → une commune/rare non possédée ne s'affiche pas, et elle ne s'obtient qu'au tirage d'œuf.
 * En R3, seules les **légendaires** étaient vécues (art réel via `legendaryForWorld` + boss, **sans** ce
 * seed) ; R4.2 câble l'amorçage **avec** le draw (#155/#127 : fondation R3.1, consommateur R4.2).
 * Transaction = amorçage atomique.
 */
export function seedSocleCreatures(db: AppDatabase): void {
  db.transaction((tx) => {
    for (let slot = 0; slot < SOCLE_WORLD_COUNT; slot += 1) {
      for (const c of deriveSocleCreatures(slot)) {
        tx.insert(characters)
          .values({
            id: c.id,
            worldIndex: c.worldIndex,
            speciesKey: c.speciesKey,
            nameDefault: c.nameDefault,
            rarity: c.rarity,
            maxStage: 1, // évolution différée (ECONOMY §2).
            inEggPool: c.inEggPool,
            artRef: c.artRef,
            story: c.story,
          })
          .onConflictDoNothing({ target: characters.id })
          .run();
      }
    }
  });
}

/**
 * **Backfill applicatif idempotent** de l'art réel des créatures socle (bug #401, épic R4 #320,
 * garde #180 « déclaré = vécu »). Répare les lignes `characters` **déjà peuplées** dont l'`art_ref`
 * est resté **non-rendable** (`placeholder://…`) parce qu'elles ont été créées AVANT que R3.1 (#378)
 * committe le vrai art.
 *
 * **Pourquoi un backfill dédié et NON `seedSocleCreatures` en `onConflictDoUpdate`** : une légendaire
 * gagnée au boss avant R3.1 (`grantLegendaryInTx`→`ensureCharacterInTx`, `onConflictDoNothing`) a une
 * ligne `characters` avec `art_ref = placeholder://legendary/N` ; le seed d'art réel arrivé plus tard
 * (`seedSocleCreatures`, `onConflictDoNothing`) ne la **réécrit jamais** — c'est exactement la garde
 * R3.1 « ne réécrit JAMAIS » (préserve un renommage/champ existant). On ne peut donc pas la relâcher
 * en `DoUpdate` (elle clobbererait des champs + casserait le test mutation-prouvé de R3.1). Ce backfill
 * est **chirurgical** : il ne touche QUE `art_ref` (+ `story` s'il est vide) et SEULEMENT les lignes
 * dont l'`art_ref` est non-rendable — le placeholder→réel, jamais l'inverse.
 *
 * **Idempotent** (#91/#105, patron `backfillNameKeys`) : la garde `!isRenderableAssetRef(art_ref)` ne
 * sélectionne QUE les lignes encore placeholder → après un 1ᵉʳ passage elles sont rendables → un 2ᵉ
 * `runMigrations` est un **no-op** (`updates` vide, aucune écriture). L'art réel dérivé
 * (`creatureArtRef`, invariant `isRenderableAssetRef` **prouvé** par le test `#189` du catalogue socle)
 * remplace le placeholder ; on n'écrit donc jamais une réf non-rendable (pas de branche runtime
 * redondante avec cet invariant — règle #143).
 *
 * **Non-destructif** : ne touche QUE le **catalogue** `characters` (`art_ref` + `story` si vide), JAMAIS
 * `collection` (possession/`count`/`nickname` intacts) ni `characters.name_default` (les renommages
 * vivent dans `collection.nickname`). Couvre légendaires ET communes/rares (toute créature socle dérivée).
 *
 * Lecture des lignes candidates hors transaction (comme `backfillNameKeys`), puis application des
 * `UPDATE` dans **une seule** `db.transaction` → amorçage **atomique** (#122 ; tout-ou-rien, pas de
 * catalogue à demi-réparé si le process meurt). À appeler dans `runMigrations` **après**
 * `seedSocleCreatures` (les lignes manquantes sont d'abord insérées, celles-ci sont réparées ensuite).
 */
export function backfillPlaceholderCreatureArt(db: AppDatabase): void {
  // 1ʳᵉ passe (lectures seules) : lignes socle DÉJÀ présentes dont l'art_ref est encore placeholder.
  const updates: { id: string; artRef: string; story: string }[] = [];
  for (let slot = 0; slot < SOCLE_WORLD_COUNT; slot += 1) {
    for (const c of deriveSocleCreatures(slot)) {
      const row = db
        .select({ artRef: characters.artRef, story: characters.story })
        .from(characters)
        .where(eq(characters.id, c.id))
        .limit(1)
        .get();
      // Ligne absente → rien à backfiller (le seed insère les manquantes ; ce backfill RÉPARE
      // seulement les lignes pré-existantes, il n'en crée aucune).
      if (row === undefined) continue;
      // Art déjà réel (rendable) → JAMAIS réécrit : garde d'idempotence ET de non-clobber (préserve un
      // art posé par un grant/seed). C'est LA garde mutation-prouvée (#60/#173) : la retirer clobbe les
      // lignes déjà réelles → le test nommé rougit.
      if (isRenderableAssetRef(row.artRef)) continue;
      // `story` réel préservé ; seulement (re)posé s'il est vide/absent (pré-R3.1 pouvait le laisser vide).
      const story = row.story === null || row.story === "" ? c.story : row.story;
      updates.push({ id: c.id, artRef: c.artRef, story });
    }
  }
  if (updates.length === 0) return; // no-op : 2ᵉ run, ou aucune ligne placeholder (idempotence).

  db.transaction((tx) => {
    for (const u of updates) {
      tx.update(characters)
        .set({ artRef: u.artRef, story: u.story })
        .where(eq(characters.id, u.id))
        .run();
    }
  });
}
