"use server";

import { getDb } from "@/lib/db";
import { getEngineConfig, getMapConfig } from "@/config/server-config";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { loadCurrentWorldMap } from "@/lib/game/current-map";
import type { CurrentWorldMap } from "@/lib/game/world-theme";
import { SocleUnavailableError } from "@/lib/worldgen/socle";

/**
 * Server action de l'écran carte (story #125/6.7, WIREFRAMES §2, PRODUCT §2.1, MAP §1/§4/§5).
 * Adaptateur **mince** au-dessus de `@/lib/game/current-map` (composition serveur de la
 * carte du monde courant **thématisée** — géométrie + thème per-monde 6.6/6.7) — même
 * discipline que `jouer/actions.ts` (#64/#124) : le `profile_id` vient **toujours** de la
 * session (jamais du client), l'horloge serveur (`Date.now()`) est injectée à la frontière.
 *
 * Runtime **Node** déjà imposé par le groupe `(app)`.
 */

/**
 * Résultat de l'action carte (union discriminée) :
 * - `ready` : carte du monde courant **thématisée** (géométrie + thème per-monde) ;
 * - `unauthenticated` : pas de session enfant valide (générique, cohérent avec l'auth #2.3 — pas de fuite) ;
 * - `unavailable` : socle de secours non amorcé (`SocleUnavailableError`) → l'enfant voit un message
 *   **doux voix de Teddy** (COPY §90/91), **jamais** l'erreur brute.
 */
export type CurrentMapActionResult =
  | { readonly status: "ready"; readonly map: CurrentWorldMap }
  | { readonly status: "unauthenticated" }
  | { readonly status: "unavailable" };

/**
 * Carte du monde courant pour la session enfant courante (déblocage linéaire, MAP §1/§6).
 * Lecture seule. Intercepte `SocleUnavailableError` (socle non amorcé, 6.6) → `unavailable`
 * (message doux Teddy côté client, jamais l'erreur brute à l'enfant, story 6.7). Toute autre
 * erreur (invariant serveur) **propage** (l'écran retombe sur le message générique de repli).
 */
export async function currentMapAction(): Promise<CurrentMapActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { status: "unauthenticated" };
  }
  try {
    const map = loadCurrentWorldMap(
      getDb(),
      profileId,
      getMapConfig(),
      getEngineConfig(),
      Date.now(),
    );
    return { status: "ready", map };
  } catch (error) {
    // Socle non amorcé → message doux (le résolveur lève loud, on ne montre jamais l'erreur
    // brute à l'enfant). Les autres erreurs restent des invariants serveur → propagation.
    if (error instanceof SocleUnavailableError) {
      return { status: "unavailable" };
    }
    throw error;
  }
}
