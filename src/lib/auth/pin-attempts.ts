import { eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { pinAttempts } from "@/lib/db/schema";
import type { AttemptState } from "./rate-limit";

/**
 * Persistance des compteurs de tentatives de PIN (rate-limit, AUTH.md §4).
 * SERVER-ONLY. Source de vérité serveur en base (SQLite, cohérent single-tenant,
 * survit au redémarrage du daemon — contrairement à un compteur en mémoire). Une
 * ligne par cible, clé composite encodée (`"<scope>:<clé>"`). Réinitialisation =
 * suppression de la ligne (au succès).
 */

/** Portée d'un compteur : par profil, par IP, ou par récupération (AUTH.md §4, §5). */
export type AttemptScope = "profile" | "ip" | "recovery";

/** Clé de ligne d'un compteur — `"<scope>:<clé>"` (cf. schéma `pin_attempts`). */
export function attemptKey(scope: AttemptScope, key: string): string {
  return `${scope}:${key}`;
}

/** État courant d'une cible, ou `null` si aucun échec enregistré. */
export function getAttemptState(db: AppDatabase, id: string): AttemptState | null {
  const row = db
    .select({ failures: pinAttempts.failures, lastFailureAt: pinAttempts.lastFailureAt })
    .from(pinAttempts)
    .where(eq(pinAttempts.id, id))
    .limit(1)
    .get();
  return row ?? null;
}

/**
 * Enregistre un échec pour une cible : crée la ligne (`failures = 1`) ou
 * **incrémente** atomiquement (upsert, un seul statement → pas de TOCTOU) et
 * met à jour l'instant du dernier échec.
 */
export function recordFailure(db: AppDatabase, id: string, now: Date): void {
  db.insert(pinAttempts)
    .values({ id, failures: 1, lastFailureAt: now })
    .onConflictDoUpdate({
      target: pinAttempts.id,
      set: { failures: sql`${pinAttempts.failures} + 1`, lastFailureAt: now },
    })
    .run();
}

/** Réinitialise le compteur d'une cible (succès) — no-op si absent. */
export function resetAttempts(db: AppDatabase, id: string): void {
  db.delete(pinAttempts).where(eq(pinAttempts.id, id)).run();
}
