/**
 * **Déblocage linéaire** des mondes + lecture de la progression d'un monde (MAP §1/§4/§6,
 * PRODUCT §1.3, SYNC monotone/idempotence). Dérive TOUT du `progress` (5.1) — **aucune
 * table d'unlock séparée** : un monde N est débloqué **ssi le boss du monde N-1 est
 * complété** (MAP §6). Les **étoiles ne sont JAMAIS une barrière** (MAP §1/§8) : un boss
 * complété avec 1★ débloque exactement comme avec 3★ — seul le *fait d'avoir terminé* le
 * boss ouvre le monde suivant.
 *
 * **SERVER-ONLY par transitivité** (importe la couche DB) — jamais dans un composant
 * client. Fonctions prenant la connexion (`DbHandle`) + `profileId` **de la session**
 * (jamais un profil client) → testables sur base réelle, déterministes. Lecture seule
 * (aucune écriture ici : la fin de niveau est persistée par `recordStars`, 5.1, appelé
 * depuis la server action).
 *
 * **Boss = dernier nœud** (MAP §6) : la géométrie d'un monde a `levelsPerWorld + 1` nœuds
 * (0-based), donc le boss est à `level_index === levelsPerWorld` (le dernier). La géométrie
 * est **invariante** (MAP §4, cf. `map.ts`) : la dette de révision est un overlay de type
 * qui ne change **jamais** le nombre de nœuds ni les `level_index` → `level_index` est une
 * **clé de position fiable** pour la persistance et le déblocage.
 */

import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { progress, type Stars } from "@/lib/db/schema";
import type { WorldProgress } from "./map";

/**
 * Handle accepté par les lectures : la connexion applicative **ou** le handle de
 * transaction (`db.transaction((tx) => …)`). Les deux exposent la même API Drizzle de
 * lecture → une lecture d'unlock peut tourner indifféremment hors ou dans une transaction
 * (utile pour la garde de la server action qui vérifie l'unlock avant d'écrire).
 */
export type DbHandle = Pick<AppDatabase, "select">;

/**
 * `level_index` du **boss** d'un monde (MAP §6) = le **dernier** nœud. La géométrie a
 * `levelsPerWorld + 1` nœuds (0-based) → le boss est à l'index `levelsPerWorld`. Fonction
 * pure (aucune I/O) : la position du boss ne dépend que de la structure ⚙️ (`levelsPerWorld`),
 * pas du profil.
 */
export function bossLevelIndex(levelsPerWorld: number): number {
  return levelsPerWorld;
}

/**
 * `true` si le **niveau `(profil, monde, niveau)` est complété** — c.-à-d. qu'il a une
 * ligne `progress` (joué au moins une fois, MAP §4). **Indépendant du nombre d'étoiles**
 * (0..3) : une ligne à 1★ compte autant qu'une ligne à 3★ (étoiles ≠ barrière, MAP §1/§8).
 * Lookup direct par PK encodée (aucun scan). À appeler **dans** la transaction de la server
 * action (avant l'écriture) pour sérialiser check-then-write (anti-TOCTOU, LEARNINGS #36).
 */
export function isLevelCompleted(
  db: DbHandle,
  profileId: number,
  worldIndex: number,
  levelIndex: number,
): boolean {
  const row = db
    .select({ profileId: progress.profileId })
    .from(progress)
    .where(
      and(
        eq(progress.profileId, profileId),
        eq(progress.worldIndex, worldIndex),
        eq(progress.levelIndex, levelIndex),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

/**
 * `true` si le **boss du monde `worldIndex` est complété** (MAP §6) — la condition
 * **unique** d'ouverture du monde suivant. Dérivée du `progress` : le boss est le dernier
 * nœud (`bossLevelIndex`). **Jamais** conditionné aux étoiles (MAP §1/§8) : seul le fait
 * d'avoir *terminé* le boss compte, pas le score obtenu.
 */
export function isBossCompleted(
  db: DbHandle,
  profileId: number,
  worldIndex: number,
  levelsPerWorld: number,
): boolean {
  return isLevelCompleted(db, profileId, worldIndex, bossLevelIndex(levelsPerWorld));
}

/**
 * **Nombre de mondes débloqués** pour un profil (déblocage linéaire, MAP §1/§6). Le monde 0
 * est **toujours** débloqué (1ᵉʳ monde offert, PRODUCT §1.1) ; chaque monde suivant N s'ouvre
 * **ssi le boss du monde N-1 est complété**. On avance tant que le boss du dernier monde
 * ouvert est complété — un boss non terminé **arrête** la chaîne (les mondes au-delà restent
 * verrouillés). Retour **≥ 1**.
 *
 * **Étoiles ≠ barrière** (MAP §1/§8) : la condition d'avance est `isBossCompleted` (présence
 * de la ligne boss), **jamais** un seuil d'étoiles — 1★ au boss débloque comme 3★.
 *
 * Balayage borné : au plus `mondes_complétés + 1` lectures (chaque monde ouvert vérifie son
 * boss une fois). Pas de table d'unlock persistée (dérivable, MAP §6 / issue #124).
 */
export function getUnlockedWorldCount(
  db: DbHandle,
  profileId: number,
  levelsPerWorld: number,
): number {
  // Le monde 0 est toujours ouvert. Tant que le boss du monde ouvert le plus haut est
  // complété, le monde suivant s'ouvre → on continue. `world` = index du monde dont on
  // teste le boss ; `count` = nombre de mondes ouverts (≥ 1).
  let count = 1;
  for (let world = 0; isBossCompleted(db, profileId, world, levelsPerWorld); world += 1) {
    count += 1;
  }
  return count;
}

/**
 * `true` si le **monde `worldIndex` est débloqué** pour le profil (déblocage linéaire,
 * MAP §1/§6). Monde 0 toujours ouvert ; monde N ouvert ssi le boss du monde N-1 est complété.
 * Équivaut à `worldIndex < getUnlockedWorldCount(...)` mais borné à `worldIndex` (s'arrête
 * dès qu'un boss manquant verrouille le monde visé — pas de balayage au-delà). Un `worldIndex`
 * négatif n'est jamais débloqué (garde de forme : aucun monde d'index < 0).
 */
export function isWorldUnlocked(
  db: DbHandle,
  profileId: number,
  worldIndex: number,
  levelsPerWorld: number,
): boolean {
  if (worldIndex < 0) {
    return false;
  }
  // Monde N ouvert ssi le boss de chaque monde 0..N-1 est complété (chaîne linéaire).
  for (let w = 0; w < worldIndex; w += 1) {
    if (!isBossCompleted(db, profileId, w, levelsPerWorld)) {
      return false;
    }
  }
  return true;
}

/**
 * **Progression d'un monde** (`WorldProgress`) prête pour `buildMap` (5.2) : les étoiles
 * **par `level_index`** de ce monde. Une entrée présente ⇒ le nœud est **terminé** (une
 * absence ⇒ pas encore joué, no-fail — MAP §4). Scan filtré par `(profil, monde)`
 * (single-tenant, index différé). Ne lit **pas** l'unlock : la disponibilité intra-monde des
 * nœuds est dérivée par `buildMap`/`statusForNode` (5.2) à partir de ce `starsByLevel`.
 */
export function loadWorldProgress(
  db: DbHandle,
  profileId: number,
  worldIndex: number,
): WorldProgress {
  const rows = db
    .select({ levelIndex: progress.levelIndex, stars: progress.stars })
    .from(progress)
    .where(and(eq(progress.profileId, profileId), eq(progress.worldIndex, worldIndex)))
    .all();
  const starsByLevel = new Map<number, Stars>();
  for (const row of rows) {
    starsByLevel.set(row.levelIndex, row.stars);
  }
  return { starsByLevel };
}

/**
 * Index du **nœud courant** (1ᵉʳ non terminé, déblocage linéaire MAP §1) dans un monde, à
 * partir des `level_index` complétés — miroir serveur de `firstUnfinishedIndex` de `map.ts`.
 * Renvoie `nodeCount` (au-delà du dernier index) si **tout** est terminé (monde bouclé). Sert
 * de **garde d'écriture** : la server action n'autorise à compléter que le nœud courant (ou un
 * nœud déjà complété = rejoue monotone), jamais un nœud verrouillé (au-delà du courant).
 *
 * @param completedLevels ensemble des `level_index` déjà complétés (du `WorldProgress`).
 * @param nodeCount nombre de nœuds du monde (`levelsPerWorld + 1`).
 */
export function currentNodeIndex(completedLevels: ReadonlySet<number>, nodeCount: number): number {
  for (let i = 0; i < nodeCount; i += 1) {
    if (!completedLevels.has(i)) {
      return i;
    }
  }
  return nodeCount;
}

/**
 * `true` si le niveau `levelIndex` d'un monde est **jouable/complétable** compte tenu des
 * niveaux déjà complétés (déblocage linéaire intra-monde, MAP §1). Autorisé pour :
 * - un nœud **déjà complété** (rejoue → progression monotone, PRODUCT §1.3) ;
 * - le nœud **courant** (le 1ᵉʳ non terminé).
 * Refusé pour un nœud **verrouillé** (au-delà du courant) ou **hors bornes** (index < 0 ou
 * ≥ nodeCount). Cette garde empêche un client d'écrire la complétion d'un niveau sauté
 * (source de vérité serveur, jamais fondée sur les étoiles — MAP §1/§8).
 *
 * @param levelIndex nœud dont on teste la complétabilité.
 * @param completedLevels `level_index` déjà complétés dans ce monde.
 * @param nodeCount nombre de nœuds du monde (`levelsPerWorld + 1`).
 */
export function isLevelPlayable(
  levelIndex: number,
  completedLevels: ReadonlySet<number>,
  nodeCount: number,
): boolean {
  // Borne de forme : hors de la géométrie du monde → jamais jouable.
  if (levelIndex < 0 || levelIndex >= nodeCount) {
    return false;
  }
  // Déjà complété (rejoue monotone) OU nœud courant (1ᵉʳ non terminé). Un index strictement
  // au-delà du courant est verrouillé (déblocage linéaire).
  return levelIndex <= currentNodeIndex(completedLevels, nodeCount);
}

/** Cible **serveur** d'une fin de niveau : le `(monde, niveau)` que l'enfant joue **maintenant**. */
export interface CurrentLevelTarget {
  /** Dernier monde débloqué (le seul avec des nœuds non terminés, MAP §1/§6). */
  readonly worldIndex: number;
  /** Nœud courant du monde = 1ᵉʳ non terminé (ou le boss si tout le reste est fait). */
  readonly levelIndex: number;
}

/**
 * **Résout, côté serveur, le niveau que l'enfant joue actuellement** — la cible d'une fin
 * de niveau **sans faire confiance au client** (source de vérité serveur, SYNC §1 : le
 * client ne transmet **jamais** de `world_index`/`level_index`, il envoie seulement ses
 * étoiles). Dérive tout du `progress` :
 * - **monde** = le dernier débloqué (`getUnlockedWorldCount − 1`, déblocage linéaire MAP §1/§6) ;
 * - **niveau** = le nœud **courant** (1ᵉʳ non terminé, `currentNodeIndex`).
 *
 * **Invariant** : le dernier monde débloqué a **toujours** un nœud courant (`< nodeCount`).
 * Par définition de `getUnlockedWorldCount`, le monde `count − 1` est le dernier ouvert **parce
 * que son boss n'est pas complété** (sinon le monde suivant serait ouvert et `count` plus grand)
 * — donc au moins le boss y est non terminé → `currentNodeIndex` renvoie un index `< nodeCount`,
 * jamais `nodeCount` (« monde 100 % bouclé »). Un monde 100 % terminé n'est **jamais** le dernier
 * débloqué (son boss aurait ouvert le suivant). La cible est donc toujours dans la géométrie.
 *
 * Lecture seule (dérivée du `progress`). À appeler par la server action de fin de niveau
 * pour obtenir `(worldIndex, levelIndex)` avant `finishLevel` (qui re-garde le déblocage
 * dans sa propre transaction — cohérence de snapshot).
 *
 * @param db handle de lecture (connexion ou transaction).
 * @param profileId profil **de la session** (jamais un profil client).
 * @param levelsPerWorld ⚙️ nombre de niveaux/monde (fixe `nodeCount = levelsPerWorld + 1`).
 */
export function resolveCurrentLevelTarget(
  db: DbHandle,
  profileId: number,
  levelsPerWorld: number,
): CurrentLevelTarget {
  const worldIndex = getUnlockedWorldCount(db, profileId, levelsPerWorld) - 1;
  const nodeCount = levelsPerWorld + 1;
  const { starsByLevel } = loadWorldProgress(db, profileId, worldIndex);
  // Nœud courant (1ᵉʳ non terminé). Toujours `< nodeCount` pour le dernier monde débloqué
  // (invariant ci-dessus : son boss est non complété), donc jamais la valeur « monde bouclé ».
  const levelIndex = currentNodeIndex(new Set(starsByLevel.keys()), nodeCount);
  return { worldIndex, levelIndex };
}
