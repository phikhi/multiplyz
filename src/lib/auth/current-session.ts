import { getDb } from "@/lib/db";
import { getAuthConfig } from "@/config/server-config";
import {
  getValidSession,
  purgeExpiredSessions,
  revokeSession,
  type ActiveSession,
} from "./session";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./session-cookie";
import { guardedAuthenticateChild } from "./login";

/**
 * Point d'entrée « session courante » côté runtime Next (glue `next/headers` +
 * DB). Résout / ouvre / ferme la session de la requête. Toute la **logique** de
 * validité (expiration, anti-énumération, durées) vit dans `session.ts` /
 * `login.ts` (pure, 100 % testée) ; ici, uniquement le câblage cookie↔base.
 */

/**
 * Session enfant valide de la requête, ou `null` (cookie absent, token inconnu,
 * ou session expirée — tous indiscernables). Consommée par le garde de route.
 */
export async function getCurrentChildSession(): Promise<ActiveSession | null> {
  const token = await readSessionToken();
  if (token === null) return null;
  const session = getValidSession(getDb(), token, new Date());
  // Le garde du jeu n'accepte QUE des sessions enfant : l'espace parent (#7)
  // partagera le même cookie `mz_session` mais une session parent (courte, 15 min)
  // ne doit pas ouvrir le jeu enfant → on filtre sur `kind` ici, à la frontière.
  return session?.kind === "child" ? session : null;
}

/**
 * Connexion enfant : vérif PIN **enveloppée du rate-limit** (par profil ET par IP,
 * AUTH.md §4), ouverture de session + pose du cookie. Renvoie `true` si connecté,
 * `false` génériquement sinon (PIN faux, profil inconnu **ou** backoff actif — tous
 * indiscernables). `ip` fourni par l'action (via `headers()`).
 *
 * **GC opportuniste** (#44) : à la connexion réussie, si le déclencheur ⚙️
 * `auth.gcSessionsOnLogin` est actif (défaut, pas de cron en v1), purge au passage
 * les sessions expirées (`purgeExpiredSessions`). Point de branchement unique du GC
 * v1 → basculer le flag suffit pour déléguer à une tâche de fond plus tard.
 */
export async function loginChild(profileId: number, pin: string, ip: string): Promise<boolean> {
  const db = getDb();
  const now = new Date();
  const created = await guardedAuthenticateChild(db, { profileId, pin, ip }, now);
  if (created === null) return false;
  if (getAuthConfig().gcSessionsOnLogin) purgeExpiredSessions(db, now);
  await setSessionCookie(created.token, created.expiresAt);
  return true;
}

/**
 * Déconnexion : révoque la session serveur (source de vérité) puis efface le
 * cookie. No-op sûr si aucune session n'est posée.
 */
export async function logoutChild(): Promise<void> {
  const token = await readSessionToken();
  if (token !== null) revokeSession(getDb(), token);
  await clearSessionCookie();
}
