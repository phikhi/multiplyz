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
import { guardedAuthenticateParent } from "./parent-login";

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

// ============================================================================
// Espace parent (épic #7, story 7.1, AUTH.md §2/§3) — CLONE du patron enfant
// ci-dessus, filtré sur `kind === "parent"`. Le cookie `mz_session` est **unique**
// et discriminé par `kind` : une session parent (courte, `parentSessionMs`) ne doit
// **jamais** ouvrir le jeu enfant, et une session enfant ne doit **jamais** ouvrir
// `/parent` (séparation stricte, filtres `kind` symétriques aux deux frontières).
// ============================================================================

/**
 * Session **parent** valide de la requête, ou `null` (cookie absent, token inconnu,
 * session expirée — tous indiscernables). **Filtre `kind === "parent"`** : une session
 * enfant (même valide) portée par le **même** cookie `mz_session` **n'ouvre jamais**
 * `/parent` (séparation stricte enfant/parent, symétrique à `getCurrentChildSession`).
 * Consommée par le garde de route `app/parent/(espace)/layout.tsx`.
 */
export async function getCurrentParentSession(): Promise<ActiveSession | null> {
  const token = await readSessionToken();
  if (token === null) return null;
  const session = getValidSession(getDb(), token, new Date());
  return session?.kind === "parent" ? session : null;
}

/**
 * Connexion **parent** : vérif du PIN parent **enveloppée du rate-limit** (par cible parent
 * ET par IP, AUTH.md §4), ouverture de session **parent** (courte) + pose du cookie. Renvoie
 * `true` si connecté, `false` génériquement sinon (PIN faux, foyer absent **ou** backoff —
 * indiscernables). GC opportuniste des sessions expirées au login réussi (#44, même hygiène
 * que `loginChild`). `ip` fournie par l'action (via `headers()`).
 */
export async function loginParent(pin: string, ip: string): Promise<boolean> {
  const db = getDb();
  const now = new Date();
  const created = await guardedAuthenticateParent(db, { pin, ip }, now);
  if (created === null) return false;
  if (getAuthConfig().gcSessionsOnLogin) purgeExpiredSessions(db, now);
  await setSessionCookie(created.token, created.expiresAt);
  return true;
}

/**
 * Déconnexion parent : révoque la session serveur (source de vérité) puis efface le cookie.
 * No-op sûr si aucune session n'est posée. Le cookie `mz_session` étant **unique**, révoquer
 * le token courant suffit (aucune session parent/enfant concurrente dans le même navigateur).
 */
export async function logoutParent(): Promise<void> {
  const token = await readSessionToken();
  if (token !== null) revokeSession(getDb(), token);
  await clearSessionCookie();
}
