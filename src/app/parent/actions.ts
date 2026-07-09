"use server";

import { headers } from "next/headers";
import { loginParent, logoutParent } from "@/lib/auth/current-session";
import { resolveClientIp } from "@/lib/auth/client-ip";

/**
 * Server actions de l'espace parent (AUTH.md §2, story 7.1). Adaptateurs **minces**
 * au-dessus de `current-session.ts` : la vérif du PIN parent, le rate-limit,
 * l'ouverture/révocation de session et la pose du cookie vivent côté serveur. Le
 * client ne reçoit qu'un booléen **générique** (anti-énumération, AUTH.md §4) —
 * jamais « foyer inexistant » vs « PIN faux ».
 */

/** Réponse de connexion parent — volontairement **générique** (aucune fuite). */
export interface ParentLoginActionResult {
  ok: boolean;
}

/**
 * Tente d'ouvrir l'espace parent avec `pin` (PIN parent). Succès ⇒ session parent
 * (courte) + cookie posés, `{ ok: true }`. Échec (foyer inconnu, PIN faux **ou**
 * backoff actif) ⇒ `{ ok: false }`, même message côté client. L'IP (rate-limit par
 * IP, AUTH.md §4) est lue serveur — `X-Real-IP` de confiance (Nginx) en priorité,
 * `X-Forwarded-For` en repli — jamais confiée au client (cf. `resolveClientIp`).
 */
export async function loginParentAction(pin: string): Promise<ParentLoginActionResult> {
  const h = await headers();
  const ip = resolveClientIp(h.get("x-real-ip"), h.get("x-forwarded-for"));
  return { ok: await loginParent(pin, ip) };
}

/** Quitte l'espace parent : révoque la session serveur et efface le cookie. */
export async function logoutParentAction(): Promise<void> {
  await logoutParent();
}
