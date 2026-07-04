/**
 * Orchestration serveur de la **fin de niveau** (MAP §1/§4/§6, PRODUCT §1.3, SYNC).
 *
 * Câble la lecture de déblocage (`unlock.ts`) à l'écriture monotone (`recordStars`, 5.1)
 * dans **UNE** transaction synchrone better-sqlite3 → check-then-write **sérialisé**
 * (anti-TOCTOU, LEARNINGS #36) : la garde de déblocage (monde ouvert + niveau jouable) et
 * l'écriture des étoiles ne peuvent pas être entrelacées par une soumission concurrente.
 *
 * **SERVER-ONLY** (importe la couche DB). Le `profileId` vient **toujours** de la session
 * (jamais du client, SYNC §1) ; l'appelant (server action) le résout via
 * `getCurrentChildProfileId`. `now` est injecté (horloge serveur, LEARNINGS #46).
 *
 * **Invariants** :
 * - **Source de vérité serveur** : un client ne peut pas persister la complétion d'un
 *   niveau **verrouillé** (au-delà du nœud courant) — la garde `isLevelPlayable` rejette
 *   (déblocage linéaire MAP §1). Seul le nœud courant (ou un déjà-complété, rejoue) passe.
 * - **Déblocage jamais fondé sur les étoiles** (MAP §1/§8) : compléter le boss (dernier
 *   nœud) ouvre le monde suivant quel que soit le nombre d'étoiles (1★ comme 3★).
 * - **Monotone + idempotent** (MAP §4, SYNC) : `recordStars` applique `max(existant, nouveau)`
 *   côté SQL → une reprise moins réussie ne baisse jamais les étoiles ; rejouer la même fin
 *   de niveau ne crée pas de doublon ni ne débloque deux fois (l'unlock est **dérivé** du
 *   progress, pas incrémenté — pas de double effet possible).
 */

import type { AppDatabase } from "@/lib/db";
import type { MapConfig } from "@/config/server-config";
import type { Stars } from "@/lib/db/schema";
import { recordStars } from "./progress";
import { isLevelPlayable, isWorldUnlocked, loadWorldProgress } from "./unlock";

/**
 * Cible **brute** (non fiable) d'une fin de niveau (endpoint public) — chaque champ est
 * validé au runtime avant usage (#36). `profileId` n'y figure **pas** : il vient de la
 * session (jamais du client, SYNC §1).
 */
export interface FinishLevelInput {
  /** Monde terminé — validé (entier ≥ 0, monde débloqué). */
  readonly worldIndex: unknown;
  /** Niveau terminé — validé (entier dans les bornes du monde, nœud jouable). */
  readonly levelIndex: unknown;
  /** Étoiles obtenues (0..3) — validées ; **jamais** une barrière de déblocage (MAP §1/§8). */
  readonly stars: unknown;
}

/** Motif de refus d'une fin de niveau mal formée / non autorisée (mappé vers une réponse neutre). */
export type FinishLevelError =
  /** Champ mal formé (non-entier, hors 0..3 pour les étoiles, index négatif). */
  | "INVALID_INPUT"
  /** Monde verrouillé (boss du monde précédent non complété) — déblocage linéaire. */
  | "WORLD_LOCKED"
  /** Niveau verrouillé dans le monde (au-delà du nœud courant) — déblocage linéaire. */
  | "LEVEL_LOCKED";

/** Issue d'une fin de niveau. */
export type FinishLevelResult =
  /** Persistée (ou rejouée) : étoiles **stockées** (le max monotone) + si le monde suivant est ouvert. */
  | {
      readonly ok: true;
      /** Étoiles effectivement stockées après l'écriture monotone (`max(existant, nouveau)`). */
      readonly stars: Stars;
      /**
       * `true` si compléter ce niveau était le **boss** (dernier nœud) → monde suivant
       * **débloqué** (dérivé du progress, MAP §6). `false` pour un niveau non-boss (ne
       * débloque **pas** le monde suivant, garde testée à effet observable).
       */
      readonly unlockedNextWorld: boolean;
    }
  /** Refus **propre** (pas un 500) : forme invalide ou niveau/monde verrouillé. */
  | { readonly ok: false; readonly error: FinishLevelError };

/** `true` si `value` est un entier fini ≥ 0 (garde de forme d'un index de monde/niveau). */
function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** `true` si `value` est un nombre d'étoiles valide (entier 0..3, MAP §4). */
function isStars(value: unknown): value is Stars {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3;
}

/**
 * **Persiste la fin d'un niveau** (MAP §1/§4/§6, SYNC) de façon **atomique**, avec garde de
 * déblocage linéaire côté serveur. Étapes :
 * 1. **gardes de forme** (payload public non fiable, #36) : `worldIndex`/`levelIndex` entiers
 *    ≥ 0, `stars` entier 0..3 → refus propre sinon ;
 * 2. **transaction SYNCHRONE** (callback sans `await`, anti-TOCTOU #36) : garde de déblocage
 *    (monde débloqué `isWorldUnlocked` + niveau jouable `isLevelPlayable` d'après le progress
 *    **lu dans la même transaction**) → refus si verrouillé ; sinon `recordStars` (monotone,
 *    idempotent) ;
 * 3. `unlockedNextWorld` = le niveau complété **était le boss** (dernier nœud, index
 *    `levelsPerWorld`) → le monde suivant est désormais débloqué (dérivé, MAP §6), **jamais**
 *    conditionné aux étoiles (MAP §1/§8).
 *
 * @param db connexion applicative (source de vérité serveur).
 * @param profileId profil **de la session** (jamais un profil client).
 * @param input cible brute (monde/niveau/étoiles) — validée ici.
 * @param config ⚙️ carte (`MapConfig`) — `levelsPerWorld` fixe la géométrie (boss = dernier).
 * @param now instant serveur injecté (jamais un `Date.now()` interne, LEARNINGS #46).
 */
export function finishLevel(
  db: AppDatabase,
  profileId: number,
  input: FinishLevelInput,
  config: MapConfig,
  now: Date,
): FinishLevelResult {
  // 1. Gardes de forme (avant toute lecture/écriture, #36).
  if (!isNonNegativeInt(input.worldIndex) || !isNonNegativeInt(input.levelIndex)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (!isStars(input.stars)) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const worldIndex = input.worldIndex;
  const levelIndex = input.levelIndex;
  const stars = input.stars;
  const { levelsPerWorld } = config;
  // Géométrie invariante (MAP §4) : `levelsPerWorld + 1` nœuds ; le boss est le dernier.
  const nodeCount = levelsPerWorld + 1;
  const bossIndex = levelsPerWorld;

  // 2. Écriture atomique : garde de déblocage + persistance dans une transaction SYNCHRONE
  //    (callback sans await → sérialisation, anti-TOCTOU #36). La lecture de garde et
  //    l'écriture partagent le même snapshot transactionnel.
  return db.transaction((tx): FinishLevelResult => {
    // Déblocage linéaire inter-mondes : le monde doit être ouvert (boss des mondes
    // précédents complété). Jamais fondé sur les étoiles (MAP §1/§8).
    if (!isWorldUnlocked(tx, profileId, worldIndex, levelsPerWorld)) {
      return { ok: false, error: "WORLD_LOCKED" };
    }
    // Déblocage linéaire intra-monde : seul le nœud courant (ou un déjà-complété = rejoue
    // monotone) est complétable — un nœud sauté est verrouillé.
    const { starsByLevel } = loadWorldProgress(tx, profileId, worldIndex);
    const completed = new Set(starsByLevel.keys());
    if (!isLevelPlayable(levelIndex, completed, nodeCount)) {
      return { ok: false, error: "LEVEL_LOCKED" };
    }

    // Persistance monotone + idempotente (5.1) : `max(existant, nouveau)` côté SQL.
    const storedStars = recordStars(tx, { profileId, worldIndex, levelIndex }, stars, now);

    // Déblocage du monde suivant = ce niveau était le boss (dernier nœud). Dérivé du progress
    // (la ligne boss vient d'être écrite) — jamais un incrément séparé (pas de double effet
    // au rejeu). Indépendant des étoiles (MAP §1/§8).
    const unlockedNextWorld = levelIndex === bossIndex;
    return { ok: true, stars: storedStars, unlockedNextWorld };
  });
}
