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
import { resolveWorld } from "@/lib/worldgen/socle";
import { buildMap, type MapBuildConfig } from "./map";
import { buildWorldTheme, type CurrentWorldMap } from "./world-theme";
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
 * géométrie (5.2), la progression du monde (5.3), la dette de révision (moteur 3.4) et
 * le **thème per-monde** (résolu via `resolveWorld`, 6.6 — WORLDGEN §7) en une
 * `CurrentWorldMap` prête pour l'écran carte. Lecture seule (aucune écriture).
 *
 * **Câblage carte↔monde (story 6.7)** : c'est ici que le thème du monde (généré `active`
 * SINON socle de secours) **atteint la carte** — `resolveWorld(worldIndex)` donne palette +
 * refs d'assets, `buildWorldTheme` les **valide** en un `WorldTheme` (accent hex, fond Nginx
 * validé) que le front pose en `--world-accent` (DESIGN_TOKENS §per-monde). Le thème est un
 * attribut **non-clé** : il ne change NI le nombre de nœuds NI leurs positions (invariance de
 * géométrie à l'état runtime, rétro #123 — la géométrie reste dérivée du seul `worldIndex`).
 *
 * @param db connexion applicative (source de vérité serveur).
 * @param profileId profil **de la session** (jamais un profil client).
 * @param mapConfig `⚙️` carte (`MapConfig`, structure).
 * @param engineConfig `⚙️` moteur (`EngineConfig`, fournit `revisionDebtThreshold` et
 *   les seuils DUE consommés par `computeRevisionDebt`).
 * @param now instant serveur injecté (epoch ms, jamais un `Date.now()` interne).
 * @throws {SocleUnavailableError} si le socle de secours n'est pas amorcé (résolveur 6.6).
 */
export function loadCurrentWorldMap(
  db: AppDatabase,
  profileId: number,
  mapConfig: MapConfig,
  engineConfig: EngineConfig,
  now: number,
): CurrentWorldMap {
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
  const map = buildMap(worldIndex, { progress, debt }, config);

  // Thème per-monde (6.6/6.7) : monde généré `active` s'il existe à cet index, SINON socle de
  // secours (WORLDGEN §7). Validé (accent hex, fond Nginx) avant d'atteindre le front. Le thème
  // n'entre JAMAIS dans le calcul de la géométrie (map ci-dessus déjà figée) → invariance #123.
  const resolved = resolveWorld(db, worldIndex);
  const theme = buildWorldTheme(resolved);
  return { ...map, theme };
}
