"use server";

import { headers } from "next/headers";
import { loginChild, logoutChild } from "@/lib/auth/current-session";
import { resolveClientIp } from "@/lib/auth/client-ip";

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
 * posés, `{ ok: true }`. Échec (profil inconnu, PIN faux **ou** backoff actif) ⇒
 * `{ ok: false }`, même message côté client. L'IP (rate-limit par IP, AUTH.md §4)
 * est lue serveur — `X-Real-IP` de confiance (Nginx `$remote_addr`) en priorité,
 * `X-Forwarded-For` en repli — jamais confiée au client (cf. `resolveClientIp`).
 */
export async function loginAction(profileId: number, pin: string): Promise<LoginActionResult> {
  const h = await headers();
  const ip = resolveClientIp(h.get("x-real-ip"), h.get("x-forwarded-for"));
  return { ok: await loginChild(profileId, pin, ip) };
}

/** Déconnecte : révoque la session serveur et efface le cookie. */
export async function logoutAction(): Promise<void> {
  await logoutChild();
}
