"use server";

import { loginChild, logoutChild } from "@/lib/auth/current-session";

/**
 * Server actions de la connexion (AUTH.md §2). Adaptateurs **minces** au-dessus
 * de `current-session.ts` : la vérif PIN, l'ouverture/révocation de session et
 * la pose du cookie vivent côté serveur. Le client ne reçoit qu'un booléen
 * générique (anti-énumération, AUTH.md §4) — jamais « profil inexistant » vs
 * « PIN faux ».
 */

/** Réponse de connexion — volontairement **générique** (aucune fuite). */
export interface LoginActionResult {
  ok: boolean;
}

/**
 * Tente de connecter le profil `profileId` avec `pin`. Succès ⇒ session + cookie
 * posés, `{ ok: true }`. Échec (profil inconnu **ou** PIN faux) ⇒ `{ ok: false }`,
 * même message côté client.
 */
export async function loginAction(profileId: number, pin: string): Promise<LoginActionResult> {
  return { ok: await loginChild(profileId, pin) };
}

/** Déconnecte : révoque la session serveur et efface le cookie. */
export async function logoutAction(): Promise<void> {
  await logoutChild();
}
