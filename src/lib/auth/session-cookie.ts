import { cookies } from "next/headers";
import { getConfig } from "@/config/server-config";

/**
 * Pont cookie ↔ session (AUTH.md §3). Le cookie ne porte que le **token opaque**
 * (source de vérité = base). Attributs durcis : `httpOnly` (jamais lu en JS
 * client), `SameSite=Lax` (anti-CSRF sur navigation cross-site), `Secure` en
 * production (HTTPS obligatoire). SERVER-ONLY (glue `next/headers`).
 */

/** Nom du cookie de session (constant, référencé par la pose/lecture/effacement). */
export const SESSION_COOKIE_NAME = "mz_session";

/** Options du cookie de session — pur & testable (`secure` piloté par le mode). */
export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  expires: Date;
}

/**
 * Construit les attributs du cookie. `Secure` seulement en production : en dev /
 * E2E sur `http://localhost`, un cookie `Secure` serait rejeté par le navigateur
 * (HTTPS requis) → la session ne tiendrait pas. `expires` = échéance serveur de
 * la session (cookie et session expirent ensemble).
 */
export function sessionCookieOptions(expiresAt: Date, secure: boolean): SessionCookieOptions {
  return { httpOnly: true, secure, sameSite: "lax", path: "/", expires: expiresAt };
}

/** Pose le cookie de session (token opaque) avec les attributs durcis. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  const secure = getConfig().mode === "production";
  store.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt, secure));
}

/** Efface le cookie de session (déconnexion). */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

/** Lit le token de session depuis le cookie (ou `null` si absent). */
export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}
