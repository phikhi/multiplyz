"use server";

import { getDb } from "@/lib/db";
import { getEngineConfig, getMapConfig } from "@/config/server-config";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { loadCurrentWorldMap } from "@/lib/game/current-map";
import type { WorldMap } from "@/lib/game/map";

/**
 * Server action de l'écran carte (story #125, WIREFRAMES §2, PRODUCT §2.1, MAP §1/§4/§5).
 * Adaptateur **mince** au-dessus de `@/lib/game/current-map` (composition serveur de la
 * carte du monde courant) — même discipline que `jouer/actions.ts` (#64/#124) : le
 * `profile_id` vient **toujours** de la session (jamais du client), l'horloge serveur
 * (`Date.now()`) est injectée à la frontière.
 *
 * Runtime **Node** déjà imposé par le groupe `(app)`.
 */

/** Réponse de la carte : la carte du monde courant, ou `null` si non authentifié. */
export interface CurrentMapActionResult {
  readonly map: WorldMap | null;
}

/**
 * Carte du monde courant pour la session enfant courante (déblocage linéaire, MAP
 * §1/§6). Lecture seule. `null` si pas de session enfant valide (générique, cohérent
 * avec l'auth #2.3 — pas de fuite).
 */
export async function currentMapAction(): Promise<CurrentMapActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { map: null };
  }
  const map = loadCurrentWorldMap(
    getDb(),
    profileId,
    getMapConfig(),
    getEngineConfig(),
    Date.now(),
  );
  return { map };
}
