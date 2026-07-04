/**
 * Composition serveur de la **carte du monde courant** (story #125, WIREFRAMES §2,
 * PRODUCT §2.1, MAP §1/§4/§5/§6). Câble ensemble, pour le **profil de la session** :
 * - la géométrie procédurale (`buildMap`, 5.2, `game/map.ts`) — pure, déterministe ;
 * - la progression persistée du monde courant (`loadWorldProgress`, `getUnlockedWorldCount`,
 *   5.3, `game/unlock.ts`) ;
 * - la **dette de révision** du profil (`computeRevisionDebt`, moteur 3.4/3.6,
 *   `engine/level.ts`), réutilisée **telle quelle** — cette couche ne réinvente aucune
 *   notion de maîtrise (CLAUDE.md).
 *
 * **Monde affiché = le dernier monde débloqué** (PRODUCT §2.1 « le dernier nœud ouvre
 * le monde suivant ») : `getUnlockedWorldCount() - 1`. Le déblocage est **linéaire**
 * (MAP §1/§6) donc ce monde est toujours le **seul** pertinent à afficher — les mondes
 * précédents sont entièrement complétés (leur carte n'a plus d'intérêt de navigation),
 * les mondes suivants restent verrouillés.
 *
 * **SERVER-ONLY par transitivité** (importe la couche DB + le moteur). Le `profileId`
 * vient **toujours** de la session (jamais du client) — résolu par l'appelant (server
 * action), jamais ici (ce module reste un pont pur de composition, testable avec un
 * `profileId` arbitraire sur base réelle).
 */

import type { AppDatabase } from "@/lib/db";
import type { EngineConfig, MapConfig } from "@/config/server-config";
import { loadScope } from "@/lib/engine/persistence";
import { computeRevisionDebt } from "@/lib/engine/level";
import { buildMap, type MapBuildConfig, type WorldMap } from "./map";
import { getUnlockedWorldCount, loadWorldProgress } from "./unlock";

/**
 * `⚙️` combinés requis par `buildMap` : la structure de carte (`MapConfig`) + le seuil
 * pédagogique de dette de révision (`EngineConfig.revisionDebtThreshold`). Même
 * composition que documentée par `MapBuildConfig` (`game/map.ts`) — assemblée ici pour
 * l'appelant serveur, jamais réimportée dans un composant client.
 */
export function toMapBuildConfig(map: MapConfig, engine: EngineConfig): MapBuildConfig {
  return { ...map, revisionDebtThreshold: engine.revisionDebtThreshold };
}

/**
 * **Carte du monde courant** du profil (déblocage linéaire, MAP §1/§6) : compose la
 * géométrie (5.2), la progression du monde (5.3) et la dette de révision (moteur 3.4)
 * en une `WorldMap` prête pour l'écran carte. Lecture seule (aucune écriture).
 *
 * @param db connexion applicative (source de vérité serveur).
 * @param profileId profil **de la session** (jamais un profil client).
 * @param mapConfig `⚙️` carte (`MapConfig`, structure).
 * @param engineConfig `⚙️` moteur (`EngineConfig`, fournit `revisionDebtThreshold` et
 *   les seuils DUE consommés par `computeRevisionDebt`).
 * @param now instant serveur injecté (epoch ms, jamais un `Date.now()` interne).
 */
export function loadCurrentWorldMap(
  db: AppDatabase,
  profileId: number,
  mapConfig: MapConfig,
  engineConfig: EngineConfig,
  now: number,
): WorldMap {
  // Déblocage linéaire (MAP §1/§6) : le monde affiché est le dernier débloqué — le
  // seul qui ait encore des nœuds non terminés (les précédents sont 100 % complétés,
  // le boss ayant ouvert celui-ci). `getUnlockedWorldCount` renvoie toujours ≥ 1.
  const worldIndex = getUnlockedWorldCount(db, profileId, mapConfig.levelsPerWorld) - 1;
  const progress = loadWorldProgress(db, profileId, worldIndex);

  // Dette de révision (MAP §5) — réutilise le prédicat DUE exact du moteur (aucune
  // seconde notion de dette, CLAUDE.md : la logique pédagogique ne se réinvente pas
  // dans la couche jeu). Le périmètre est TOUT le profil (pas juste ce monde) : la
  // dette de révision est une propriété du profil, pas d'un monde particulier.
  const scope = loadScope(db, profileId);
  const debt = computeRevisionDebt(scope, engineConfig, now);

  const config = toMapBuildConfig(mapConfig, engineConfig);
  return buildMap(worldIndex, { progress, debt }, config);
}
