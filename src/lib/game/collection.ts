/**
 * **Collection de créatures** (ECONOMY §3.2/§3.3, MAP §6, PRODUCT §2.3) : amorçage
 * **déterministe** de la légendaire d'un monde + ajout **garanti hors œufs** à la
 * possession d'un profil + lecture du « Pokédex » + renommage enfant.
 *
 * **SERVER-ONLY par transitivité** (importe la couche DB) — jamais dans un composant
 * client. Les fonctions prennent la connexion (`AppDatabase`) ou un handle de
 * transaction en paramètre → testables sur base réelle, et utilisables **dans** une
 * transaction synchrone better-sqlite3 (atomicité multi-écritures de la fin de niveau,
 * cf. `finish-level.ts`).
 *
 * **Déterminisme (MAP §6)** : la légendaire d'un `world_index` est **entièrement dérivée**
 * de l'index (id/species/nom/histoire) — aucun RNG, aucune génération IA ici (l'art réel
 * + les vraies histoires arrivent à l'épic #6 ; ce module pose un **placeholder** stable).
 * Même `world_index` ⇒ même légendaire, à chaque appel, sur n'importe quel appareil.
 *
 * **Hors œufs (ECONOMY §4.2)** : la légendaire du catalogue est amorcée avec
 * `in_egg_pool = false` — le pool d'œufs (5.x) l'**exclut** structurellement (garde
 * `isInEggPool` testée à effet observable). Une légendaire ne s'obtient qu'au boss.
 */

import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { characters, collection, collectionKey, type Rarity } from "@/lib/db/schema";
import { strings } from "@/strings";

/**
 * Handle accepté par les écritures : la connexion applicative **ou** le handle de
 * transaction (`db.transaction((tx) => …)`). Les deux exposent la même API Drizzle →
 * l'ajout de la légendaire peut tourner **dans** la transaction de fin de niveau
 * (atomique avec progression + crédit de pièces, cf. `finish-level.ts`).
 */
export type DbHandle = Pick<AppDatabase, "select" | "insert">;

/** Une créature du catalogue amorcée par le serveur (placeholder art épic #6). */
export interface SeededCharacter {
  readonly id: string;
  readonly worldIndex: number;
  readonly speciesKey: string;
  readonly nameDefault: string;
  readonly rarity: Rarity;
  readonly inEggPool: boolean;
  readonly artRef: string;
  readonly story: string;
}

/**
 * Une entrée de collection **enrichie** du catalogue (pour l'écran Pokédex) : la
 * possession (`nickname`/`stage`/`count`/`unlockedAt`) + les métadonnées de catalogue
 * (`nameDefault`/`rarity`/`story`/`artRef`). Le **nom affiché** = `nickname` si l'enfant
 * a renommé, sinon `nameDefault` (dérivé, jamais persisté en double).
 */
export interface CollectionEntry {
  readonly characterId: string;
  /** Nom affiché : `nickname` si renommé, sinon `nameDefault` (dérivé). */
  readonly displayName: string;
  /** Nom par défaut du catalogue (avant renommage) — pour l'action « renommer ». */
  readonly defaultName: string;
  /** Renommage enfant (ou `null` si jamais renommé). */
  readonly nickname: string | null;
  readonly rarity: Rarity;
  readonly story: string;
  readonly stage: number;
  readonly count: number;
  readonly artRef: string;
}

/**
 * **Clé de catalogue** de la légendaire d'un monde (déterministe, MAP §6). Format
 * `legendary:<world_index>` — stable, permet l'amorçage **idempotent** (upsert par PK)
 * et le seed reproductible. Pure : même index ⇒ même id.
 */
export function legendaryCharacterId(worldIndex: number): string {
  return `legendary:${worldIndex}`;
}

/**
 * **Clé d'espèce** de la légendaire d'un monde (contrat de génération épic #6).
 * Déterministe depuis l'index — l'épic #6 branchera l'art réel sur cette clé.
 */
export function legendarySpeciesKey(worldIndex: number): string {
  return `legendary_world_${worldIndex}`;
}

/**
 * **Réf d'art placeholder** de la légendaire (art réel branché par l'épic #6, WORLDGEN).
 * Le schéma d'URL `placeholder://` signale clairement un asset non encore généré (le
 * front affiche une silhouette/emoji de repli — jamais une image cassée).
 */
export function legendaryArtRef(worldIndex: number): string {
  return `placeholder://legendary/${worldIndex}`;
}

/**
 * Sélectionne un élément d'une liste **non vide** de façon déterministe depuis
 * `world_index` (modulo). Pur, sans RNG (MAP §6 : la légendaire est déterministe). Sert
 * à piocher un **nom par défaut** + une **histoire** placeholder stables dans les banques
 * centralisées (`collection-copy.ts`) — l'épic #6 remplacera par la génération IA réelle.
 */
export function pickDeterministic<T>(pool: readonly T[], worldIndex: number): T {
  return pool[worldIndex % pool.length];
}

/**
 * **Descripteur déterministe** de la légendaire d'un monde (MAP §6). Entièrement dérivé
 * de `world_index` : id, species, nom par défaut, histoire (placeholder), art placeholder.
 * `in_egg_pool = false` (boss only, ECONOMY §4.2). `rarity = "legendary"`. Pure.
 */
export function legendaryForWorld(worldIndex: number): SeededCharacter {
  return {
    id: legendaryCharacterId(worldIndex),
    worldIndex,
    speciesKey: legendarySpeciesKey(worldIndex),
    nameDefault: pickDeterministic(strings.collection.legendaryNames, worldIndex),
    rarity: "legendary",
    inEggPool: false,
    artRef: legendaryArtRef(worldIndex),
    story: pickDeterministic(strings.collection.legendaryStories, worldIndex),
  };
}

/**
 * **Amorce (idempotent) la ligne catalogue** d'une créature si absente (upsert par PK).
 * Ne réécrit **jamais** une ligne existante (`onConflictDoNothing`) → le catalogue reste
 * stable (l'art réel de l'épic #6 ne sera pas écrasé par le placeholder au rejeu). À
 * appeler **dans** la transaction de l'appelant (aucune transaction imbriquée).
 */
export function ensureCharacterInTx(db: DbHandle, character: SeededCharacter): void {
  db.insert(characters)
    .values({
      id: character.id,
      worldIndex: character.worldIndex,
      speciesKey: character.speciesKey,
      nameDefault: character.nameDefault,
      rarity: character.rarity,
      inEggPool: character.inEggPool,
      artRef: character.artRef,
      story: character.story,
    })
    .onConflictDoNothing({ target: characters.id })
    .run();
}

/** Résultat d'un ajout à la collection : `true` si nouvelle possession, `false` si déjà possédée. */
export interface GrantResult {
  /** `true` = 1ʳᵉ obtention (ligne créée) ; `false` = déjà possédée (aucune 2ᵉ ligne, rejeu). */
  readonly added: boolean;
}

/**
 * **Ajoute la légendaire d'un monde à la collection d'un profil** (MAP §6), de façon
 * **idempotente** et **hors œufs** (déterministe). Amorce d'abord la ligne catalogue si
 * absente (`ensureCharacterInTx`), puis insère la possession — `onConflictDoNothing` par
 * PK encodée (`collectionKey`) : re-gagner le boss n'ajoute **jamais** une 2ᵉ ligne ni
 * n'incrémente `count` (pas de doublon parasite — la légendaire est garantie une fois).
 *
 * À appeler **dans** la transaction de fin de niveau (atomique avec progression + crédit,
 * cf. `finish-level.ts`) — better-sqlite3 ne supporte pas les transactions imbriquées.
 *
 * `now` = instant serveur injecté (jamais un `Date.now()` interne, LEARNINGS #46).
 *
 * @returns `{ added: true }` si la légendaire vient d'être ajoutée, `{ added: false }` au rejeu.
 */
export function grantLegendaryInTx(
  db: DbHandle,
  profileId: number,
  worldIndex: number,
  now: Date,
): GrantResult {
  const legendary = legendaryForWorld(worldIndex);
  // 1. Catalogue : amorce la ligne si absente (l'art placeholder ne réécrit jamais l'existant).
  ensureCharacterInTx(db, legendary);

  // 2. Possession : déjà possédée ? (garde d'idempotence — la légendaire est GARANTIE une fois,
  //    jamais convertie en doublon/éclats puisqu'elle est hors œufs et déterministe).
  const key = collectionKey(profileId, legendary.id);
  const existing = db
    .select({ id: collection.id })
    .from(collection)
    .where(eq(collection.id, key))
    .limit(1)
    .get();
  if (existing !== undefined) {
    return { added: false };
  }

  db.insert(collection)
    .values({
      id: key,
      profileId,
      characterId: legendary.id,
      count: 1,
      stage: 1,
      unlockedAt: now,
    })
    .onConflictDoNothing({ target: collection.id })
    .run();
  return { added: true };
}

/**
 * `true` si la créature `characterId` est **dans le pool d'œufs** (ECONOMY §4.2). Les
 * légendaires (`in_egg_pool = false`) sont **exclues** (boss only) → cette garde est
 * consommée par le tirage d'œuf (5.x) pour **ne jamais** proposer une légendaire. Testée
 * à effet observable : une légendaire amorcée retourne `false`, une commune `true`.
 * `false` aussi pour une créature inconnue du catalogue (garde de forme).
 */
export function isInEggPool(db: DbHandle, characterId: string): boolean {
  const row = db
    .select({ inEggPool: characters.inEggPool })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1)
    .get();
  return row?.inEggPool === true;
}

/**
 * **Collection (Pokédex) d'un profil** — les créatures possédées, enrichies du catalogue
 * (nom affiché, rareté, histoire, stade), triées par `unlocked_at` (ordre d'obtention).
 * Lecture seule (jointure applicative : scan filtré par profil + lookup catalogue par id,
 * table single-tenant → index différé). Le **nom affiché** = `nickname` si renommé, sinon
 * `nameDefault` (dérivé — jamais persisté en double). Une possession dont le catalogue a
 * disparu (impossible via FK cascade, mais garde de forme) est **omise**.
 */
export function loadCollection(db: DbHandle, profileId: number): CollectionEntry[] {
  const owned = db
    .select({
      characterId: collection.characterId,
      nickname: collection.nickname,
      stage: collection.stage,
      count: collection.count,
      unlockedAt: collection.unlockedAt,
    })
    .from(collection)
    .where(eq(collection.profileId, profileId))
    .all();

  // On garde `unlockedAt` **en interne** pour trier par ordre d'obtention, mais il ne fait pas
  // partie du contrat d'affichage `CollectionEntry` (l'UI n'affiche pas la date brute).
  const sortable: { readonly entry: CollectionEntry; readonly unlockedAt: Date }[] = [];
  for (const row of owned) {
    const cat = db
      .select({
        nameDefault: characters.nameDefault,
        rarity: characters.rarity,
        story: characters.story,
        artRef: characters.artRef,
      })
      .from(characters)
      .where(eq(characters.id, row.characterId))
      .limit(1)
      .get();
    // Garde de forme : possession sans catalogue (impossible via FK cascade) → omise.
    /* v8 ignore next — inatteignable via FK cascade (le catalogue existe toujours) ; garde de forme */
    if (cat === undefined) continue;
    sortable.push({
      unlockedAt: row.unlockedAt,
      entry: {
        characterId: row.characterId,
        displayName: row.nickname ?? cat.nameDefault,
        defaultName: cat.nameDefault,
        nickname: row.nickname,
        rarity: cat.rarity,
        story: cat.story ?? "",
        stage: row.stage,
        count: row.count,
        artRef: cat.artRef,
      },
    });
  }
  // Tri par ordre d'obtention (unlocked_at croissant), puis characterId pour un ordre stable
  // si deux obtentions partagent l'instant (même seconde — unixepoch).
  sortable.sort(
    (a, b) =>
      a.unlockedAt.getTime() - b.unlockedAt.getTime() ||
      a.entry.characterId.localeCompare(b.entry.characterId),
  );
  return sortable.map((item) => item.entry);
}

/** Motif de refus d'un renommage (mappé vers une réponse neutre côté action). */
export type RenameError =
  /** Nom vide / trop long / non-string (garde de forme, PRODUCT §2.3). */
  | "INVALID_NAME"
  /** La créature n'est pas possédée par ce profil (garde de propriété). */
  | "NOT_OWNED";

/** Longueur max ⚙️ d'un surnom (aligné sur la borne prénom profil, PRODUCT §2.3). */
export const NICKNAME_MAX_LENGTH = 20;

/**
 * Normalise + valide un surnom saisi par l'enfant (PRODUCT §2.3). Trim des espaces de
 * bord ; refuse le vide et > `NICKNAME_MAX_LENGTH`. Retourne le nom normalisé ou `null`
 * (invalide). Pure (aucune I/O) → testable, réutilisable par l'action et la garde.
 */
export function normalizeNickname(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > NICKNAME_MAX_LENGTH) return null;
  return trimmed;
}

/**
 * **Renomme une créature possédée** (persisté serveur, PRODUCT §2.3). Valide le nom
 * (`normalizeNickname`) et la **propriété** (la créature doit être dans la collection du
 * profil — jamais renommer la créature d'un autre profil). Écriture unique (UPDATE ciblé
 * par PK encodée) — aucune transaction (pas d'état partiel à annuler : une seule écriture,
 * cf. règle #124 : une garde de transaction sur écriture unique n'a pas de test de rollback
 * non-vacuous, donc on ne la sur-revendique pas).
 *
 * @returns `{ ok: true, nickname }` si renommé, `{ ok: false, error }` sinon (neutre).
 */
export function renameCharacter(
  db: Pick<AppDatabase, "select" | "update">,
  profileId: number,
  characterId: string,
  rawNickname: unknown,
): { ok: true; nickname: string } | { ok: false; error: RenameError } {
  const nickname = normalizeNickname(rawNickname);
  if (nickname === null) {
    return { ok: false, error: "INVALID_NAME" };
  }
  const key = collectionKey(profileId, characterId);
  const owned = db
    .select({ id: collection.id })
    .from(collection)
    .where(and(eq(collection.id, key), eq(collection.profileId, profileId)))
    .limit(1)
    .get();
  if (owned === undefined) {
    return { ok: false, error: "NOT_OWNED" };
  }
  db.update(collection).set({ nickname }).where(eq(collection.id, key)).run();
  return { ok: true, nickname };
}
