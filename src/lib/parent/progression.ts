/**
 * **Progression** de l'espace parent (PLAN §Espace parent :84 « monde/niveau atteint, créatures
 * débloquées », story 7.7, WIREFRAMES §7 bandeau « 3 niveaux » du jour). Compose des lectures
 * **déjà établies** — jamais une seconde notion de progression :
 * - le monde/les niveaux du monde courant via `loadCurrentWorldMap` (5.4/6.7, `game/current-map.ts`) ;
 * - les créatures débloquées via `loadCollection` (5.6, `game/collection.ts`) ;
 * - les niveaux **touchés aujourd'hui** via une lecture directe de `progress.updated_at`, day-ordinal
 *   par le **même** helper que la régularité (`makeDayOrdinal`, `regularity.ts`, story 7.4) — jamais
 *   un second découpage de « jour ».
 *
 * **Read-only** : aucune écriture. **SERVER-ONLY par transitivité** (importe la couche DB + le
 * moteur/jeu). `profileId` vient **toujours** de la session parent (résolu par l'appelant, la page
 * serveur de l'écran 7.7), jamais ici.
 */

import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { progress } from "@/lib/db/schema";
import type { EngineConfig, MapConfig, RegularityConfig } from "@/config/server-config";
import { loadCollection } from "../game/collection";
import { loadCurrentWorldMap } from "../game/current-map";
import { makeDayOrdinal } from "./regularity";

/** Résumé de progression affiché au tableau de bord parent (WIREFRAMES §7, PLAN §Espace parent). */
export interface ProgressionSummary {
  /** Monde courant, **1-based** pour l'affichage (`worldIndex + 1`, MAP §1 « Monde N »). */
  readonly worldNumber: number;
  /** Niveaux **terminés** du monde courant (nœuds `status === "completed"`, MAP §1/§4). */
  readonly levelsCompleted: number;
  /** Total de niveaux du monde courant (`levelsPerWorld + 1`, boss inclus). */
  readonly totalLevels: number;
  /** Créatures **débloquées** (collection, ECONOMY §3.2/§3.3). */
  readonly creaturesCount: number;
  /** Niveaux dont la progression a été **mise à jour aujourd'hui** (jour calendaire ⚙️,
   * `regularity.dayTimeZone` — même fuseau que la régularité, WIREFRAMES §7 « 3 niveaux »). */
  readonly levelsToday: number;
}

/**
 * Compte les niveaux `progress` du profil dont `updated_at` tombe dans le jour calendaire de
 * `now` (⚙️ `regularity.dayTimeZone`). Un niveau terminé un jour PRÉCÉDENT et jamais rejoué
 * depuis n'a pas son `updated_at` mis à jour → il ne compte pas (« touché aujourd'hui », pas
 * « terminé un jour quelconque »). Lecture seule (`select` uniquement).
 */
function countLevelsToday(
  db: Pick<AppDatabase, "select">,
  profileId: number,
  regularityConfig: RegularityConfig,
  now: number,
): number {
  const toDayOrdinal = makeDayOrdinal(regularityConfig.dayTimeZone);
  const todayOrdinal = toDayOrdinal(now);
  const rows = db
    .select({ updatedAt: progress.updatedAt })
    .from(progress)
    .where(eq(progress.profileId, profileId))
    .all();
  return rows.filter((row) => toDayOrdinal(row.updatedAt.getTime()) === todayOrdinal).length;
}

/**
 * **Résumé de progression** d'un profil (monde/niveaux du monde courant + créatures débloquées +
 * niveaux touchés aujourd'hui). Lecture seule, compose des fonctions déjà établies (jamais une
 * seconde notion de carte/collection/jour).
 *
 * @throws {SocleUnavailableError} si le socle de secours n'est pas amorcé (propage tel quel,
 *   même contrat que `loadCurrentWorldMap` — l'appelant (page 7.7) intercepte pour afficher un
 *   repli neutre plutôt que de faire échouer tout le tableau de bord, même patron que l'écran
 *   carte, story 6.7 `carte/actions.ts`).
 */
export function loadProgressionSummary(
  db: AppDatabase,
  profileId: number,
  mapConfig: MapConfig,
  engineConfig: EngineConfig,
  regularityConfig: RegularityConfig,
  now: number,
): ProgressionSummary {
  const map = loadCurrentWorldMap(db, profileId, mapConfig, engineConfig, now);
  const collection = loadCollection(db, profileId);
  const levelsCompleted = map.nodes.filter((node) => node.status === "completed").length;
  return {
    worldNumber: map.worldIndex + 1,
    levelsCompleted,
    totalLevels: map.nodes.length,
    creaturesCount: collection.length,
    levelsToday: countLevelsToday(db, profileId, regularityConfig, now),
  };
}
