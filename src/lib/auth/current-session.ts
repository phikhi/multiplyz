import { getDb } from "@/lib/db";
import { getValidSession, revokeSession, type ActiveSession } from "./session";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./session-cookie";
import { authenticateChild } from "./login";

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
 * Connexion enfant : vérifie le PIN, ouvre la session et pose le cookie. Renvoie
 * `true` si connecté, `false` génériquement sinon (anti-énumération, AUTH.md §4).
 */
export async function loginChild(profileId: number, pin: string): Promise<boolean> {
  const created = await authenticateChild(getDb(), profileId, pin, new Date());
  if (created === null) return false;
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
