/**
 * Persistance de la **progression par niveau** (MAP §4, SYNC §1/§2) — pont DB pour
 * la table `progress`. Source de vérité **serveur** (online-first) : les étoiles
 * gagnées sont écrites côté serveur, jamais confiées au client.
 *
 * **SERVER-ONLY par transitivité** (importe la couche DB) — jamais dans un composant
 * client. Les fonctions prennent la connexion (`AppDatabase`) ou un handle de
 * transaction en paramètre → testables sur une base réelle, et utilisables **dans**
 * une transaction synchrone better-sqlite3 (anti-TOCTOU, LEARNINGS #36).
 *
 * Ce module ne porte **aucune** logique de calcul d'étoiles (ça vit dans
 * `engine/stars.ts`, pur) — uniquement l'écriture idempotente + monotone et la
 * lecture du total.
 */

import { eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { progress, progressKey, type Stars } from "@/lib/db/schema";

/**
 * Handle accepté par les écritures : la connexion applicative **ou** le handle de
 * transaction passé par `db.transaction((tx) => …)`. Les deux exposent la même API
 * Drizzle (`select`/`insert`/`update`) → une écriture peut tourner indifféremment
 * hors ou dans une transaction. `AppDatabase` porte en plus `.transaction(...)`.
 */
export type DbHandle = Pick<AppDatabase, "select" | "insert" | "update">;

/** Cible d'une écriture de progression : le niveau `(profil, monde, niveau)`. */
export interface LevelKey {
  readonly profileId: number;
  readonly worldIndex: number;
  readonly levelIndex: number;
}

/**
 * Enregistre les étoiles d'un niveau — **idempotent + monotone** (MAP §4, SYNC).
 *
 * - **Idempotent** : ciblé par la **PK encodée** (`progressKey`) via
 *   `onConflictDoUpdate` → une ligne unique par niveau, rejouer la même écriture ne
 *   crée pas de doublon.
 * - **Monotone** : `stars = MAX(existant, nouveau)` (appliqué **côté SQL** dans le
 *   `set` du conflit) → une reprise moins réussie ne **baisse jamais** les étoiles
 *   déjà acquises (progression jamais régressive). Une première écriture pose la
 *   valeur telle quelle.
 *
 * `updatedAt` est l'instant serveur injecté (`now`) — jamais un `Date.now()` interne
 * (horloge injectée, LEARNINGS #46). À appeler **dans** une transaction si couplé à
 * d'autres écritures (ex. crédit portefeuille de fin de niveau).
 *
 * Renvoie le nombre d'étoiles **effectivement stocké** après l'opération (le max),
 * pour que l'appelant sache si l'écriture a fait progresser la valeur.
 */
export function recordStars(db: DbHandle, key: LevelKey, stars: Stars, now: Date): Stars {
  const id = progressKey(key.profileId, key.worldIndex, key.levelIndex);
  db.insert(progress)
    .values({
      id,
      profileId: key.profileId,
      worldIndex: key.worldIndex,
      levelIndex: key.levelIndex,
      stars,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: progress.id,
      set: {
        // Monotone : ne descend jamais sous la valeur déjà acquise.
        stars: sql`max(${progress.stars}, ${stars})`,
        updatedAt: now,
      },
    })
    .run();
  return loadStars(db, key);
}

/**
 * Étoiles actuellement stockées pour un niveau, ou `0` si le niveau n'a jamais été
 * joué (aucune ligne = « pas encore fait », no-fail : 0 est un état normal, pas un
 * échec). Ciblé par la PK encodée → lookup direct, pas de scan.
 */
export function loadStars(db: DbHandle, key: LevelKey): Stars {
  const row = db
    .select({ stars: progress.stars })
    .from(progress)
    .where(eq(progress.id, progressKey(key.profileId, key.worldIndex, key.levelIndex)))
    .limit(1)
    .get();
  return row === undefined ? 0 : row.stars;
}

/**
 * **Total d'étoiles** d'un profil (somme sur tous ses niveaux) — sert à
 * l'**affichage / collection**, **jamais** au déblocage (MAP §4). `0` si le profil
 * n'a encore aucune progression. Somme calculée côté SQL (`SUM`), scan filtré par
 * profil (single-tenant, index différé).
 */
export function totalStars(db: DbHandle, profileId: number): number {
  const row = db
    .select({ total: sql<number | null>`sum(${progress.stars})` })
    .from(progress)
    .where(eq(progress.profileId, profileId))
    .get();
  // `SUM` renvoie NULL sur zéro ligne → normaliser en 0.
  return row?.total ?? 0;
}
