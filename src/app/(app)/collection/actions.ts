"use server";

import { getDb } from "@/lib/db";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import {
  loadCollection,
  renameCharacter,
  type CollectionEntry,
  type RenameError,
} from "@/lib/game/collection";

/**
 * Server actions de l'écran **Collection (Pokédex)** (story 5.6, WIREFRAMES §5, PRODUCT
 * §2.3, ECONOMY §3.2/§3.3). Adaptateurs **minces** au-dessus de `@/lib/game/collection` :
 * la lecture + le renommage vivent côté serveur (source de vérité). Le `profile_id` vient
 * **toujours** de la session enfant (`getCurrentChildProfileId`, jamais du client, #63/#42).
 *
 * Runtime **Node** (better-sqlite3) — déjà imposé par la page du groupe `(app)`. Non
 * authentifié → `null`/`{ ok: false }` **générique** (pas de fuite, cohérent avec l'auth #2.3).
 */

/** Réponse de lecture de la collection : les créatures possédées, ou `null` si non authentifié. */
export interface CollectionActionResult {
  readonly entries: readonly CollectionEntry[] | null;
}

/**
 * **Collection (Pokédex)** de la session enfant courante (créatures possédées, enrichies du
 * catalogue). Lecture seule. `null` si pas de session enfant valide (générique, pas de fuite).
 */
export async function collectionAction(): Promise<CollectionActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { entries: null };
  }
  return { entries: loadCollection(getDb(), profileId) };
}

/** Réponse d'un renommage : succès (nouveau nom) ou refus neutre. */
export interface RenameActionResult {
  readonly ok: boolean;
  /** Nouveau nom (trimé) si `ok`, `null` sinon. */
  readonly nickname: string | null;
  /** Motif de refus **neutre** si `!ok` (invalide / non possédé / non authentifié). */
  readonly error: RenameError | "UNAUTHENTICATED" | null;
}

/**
 * **Renomme** une créature possédée par la session enfant (persisté serveur, PRODUCT §2.3).
 * Le `profile_id` vient de la session (jamais du client) → un enfant ne peut renommer que
 * **ses** créatures (garde de propriété dans `renameCharacter`). Le nom est validé serveur
 * (forme + longueur). `{ ok: false }` **neutre** si non authentifié / invalide / non possédé.
 *
 * @param characterId créature à renommer (clé catalogue).
 * @param nickname nouveau nom saisi par l'enfant — validé serveur (jamais confié au client).
 */
export async function renameCharacterAction(
  characterId: string,
  nickname: unknown,
): Promise<RenameActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { ok: false, nickname: null, error: "UNAUTHENTICATED" };
  }
  const result = renameCharacter(getDb(), profileId, characterId, nickname);
  if (!result.ok) {
    return { ok: false, nickname: null, error: result.error };
  }
  return { ok: true, nickname: result.nickname, error: null };
}
