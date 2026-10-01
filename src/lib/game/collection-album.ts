import { asc, lte } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { characters, type Rarity } from "@/lib/db/schema";
import { getUnlockedWorldCount } from "./unlock";
import { loadCollection, type CollectionEntry } from "./collection";

export interface AlbumSlot {
  characterId: string;
  artRef: string;
  rarity: Rarity;
  entry: CollectionEntry | null;
}

export interface CollectionFamily {
  worldIndex: number;
  slots: AlbumSlot[];
}

/** Read only: actual catalogue, reachable worlds, and this profile's possessions.
 * A partial catalogue never invents missing species or a completion percentage.
 */
export function loadCollectionAlbum(db: AppDatabase, profileId: number, levelsPerWorld: number) {
  const entries = loadCollection(db, profileId);
  const owned = new Map(entries.map((entry) => [entry.characterId, entry]));
  const lastWorld = getUnlockedWorldCount(db, profileId, levelsPerWorld) - 1;
  const catalogue = db
    .select()
    .from(characters)
    .where(lte(characters.worldIndex, lastWorld))
    .orderBy(asc(characters.worldIndex), asc(characters.id))
    .all();
  const families: CollectionFamily[] = [];
  for (const character of catalogue) {
    let family = families.find((item) => item.worldIndex === character.worldIndex);
    if (!family) {
      family = { worldIndex: character.worldIndex, slots: [] };
      families.push(family);
    }
    family.slots.push({
      characterId: character.id,
      artRef: character.artRef,
      rarity: character.rarity,
      entry: owned.get(character.id) ?? null,
    });
  }
  for (const family of families) {
    family.slots.sort((a, b) => Number(b.entry !== null) - Number(a.entry !== null));
  }
  return { entries, families };
}
