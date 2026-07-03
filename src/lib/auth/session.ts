import { and, eq, gt, lte } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { sessions, type SessionKind } from "@/lib/db/schema";
import { getAuthConfig } from "@/config/server-config";
import { generateOpaqueToken } from "./tokens";

/**
 * Cycle de vie des sessions serveur (AUTH.md §3). Le serveur est la **source de
 * vérité** : le cookie ne porte qu'un token opaque (aléa CSPRNG, rien de signé
 * côté client) ; validité et expiration se lisent en base. Pur (DB + `now`
 * injectable) → testable à 100 %, déterministe.
 *
 * SERVER-ONLY (importe la config auth + la DB). La pose/lecture du cookie vit
 * dans `session-cookie.ts` (glue `next/headers`) ; ici, uniquement la logique.
 */

/** Session valide renvoyée par une lecture (jamais le token brut au client). */
export interface ActiveSession {
  token: string;
  profileId: number;
  kind: SessionKind;
  expiresAt: Date;
}

/** Résultat d'une création : le token à poser en cookie + son échéance. */
export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

/** Durée (ms) d'une session selon sa nature — ⚙️ centralisées (AUTH.md §3). */
function sessionDurationMs(kind: SessionKind): number {
  const { childSessionMs, parentSessionMs } = getAuthConfig();
  return kind === "parent" ? parentSessionMs : childSessionMs;
}

/**
 * Ouvre une session : token opaque (256 bits) + échéance dérivée de la config
 * (enfant longue / parent courte). `now` injecté → expiration déterministe.
 * Un seul `insert` (le token CSPRNG est unique par construction, pas de garde
 * check-then-write ni de TOCTOU à sérialiser).
 */
export function createSession(
  db: AppDatabase,
  profileId: number,
  kind: SessionKind,
  now: Date,
): CreatedSession {
  const token = generateOpaqueToken();
  const expiresAt = new Date(now.getTime() + sessionDurationMs(kind));
  db.insert(sessions).values({ token, profileId, kind, createdAt: now, expiresAt }).run();
  return { token, expiresAt };
}

/**
 * Lit une session **encore valide** (non expirée à `now`) par son token. Le
 * filtre d'expiration vit dans la requête (`expires_at > now`) → une session
 * périmée est indiscernable d'un token inexistant : `null` dans les deux cas
 * (le garde de route redirige pareil, pas de fuite).
 */
export function getValidSession(db: AppDatabase, token: string, now: Date): ActiveSession | null {
  const row = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)))
    .limit(1)
    .get();
  return row ?? null;
}

/**
 * Révoque une session (déconnexion). Idempotent : supprimer un token absent
 * (déjà révoqué / inexistant) est un no-op silencieux.
 */
export function revokeSession(db: AppDatabase, token: string): void {
  db.delete(sessions).where(eq(sessions.token, token)).run();
}

/**
 * **GC des sessions expirées** (#44) : purge `DELETE FROM sessions WHERE
 * expires_at <= now`. La lecture (`getValidSession`) filtre déjà l'expiration
 * (`expires_at > now`) → une ligne périmée n'ouvre jamais rien, mais sans purge
 * elle **s'accumule**. Ce GC est purement d'**hygiène** (jamais un enjeu de
 * sécurité). Bornage `<= now` (inclusif) cohérent avec la lecture stricte
 * `> now` : une session pile à échéance est **expirée** des deux côtés, sans
 * chevauchement ni trou. `now` injecté → déterministe. Idempotent (relancer sur
 * une table déjà propre = 0 suppression). Renvoie le nombre de lignes purgées.
 *
 * Déclencheur ⚙️ `auth.gcSessionsOnLogin` (opportuniste au login, cf.
 * `server-config.ts`) — appelé par `loginChild` (`current-session.ts`).
 */
export function purgeExpiredSessions(db: AppDatabase, now: Date): number {
  return db.delete(sessions).where(lte(sessions.expiresAt, now)).run().changes;
}
