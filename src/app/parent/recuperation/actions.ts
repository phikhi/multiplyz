"use server";

import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { resolveClientIp } from "@/lib/auth/client-ip";
import {
  RecoveryError,
  resetParentPin,
  verifyRecovery,
  type RecoveryErrorCode,
} from "@/lib/auth/recovery";

/**
 * Server actions de la récupération du PIN parent (AUTH.md §5). Adaptateurs
 * **minces** au-dessus de `recovery.ts` : la vérif du code, le rate-limit, la
 * validation et le reset vivent côté serveur. L'IP est lue serveur (X-Real-IP
 * de confiance, XFF repli) — jamais confiée au client.
 */

/** Réponse de vérification du code (étape 1) — générique. */
export interface VerifyRecoveryActionResult {
  ok: boolean;
}

/** Réponse du reset (étape 2) : nouveau code de secours à afficher une fois, ou code d'erreur. */
export type ResetParentPinActionResult =
  { ok: true; recoveryCode: string } | { ok: false; code: RecoveryErrorCode };

/** IP client de confiance (rate-limit par IP). */
async function clientIp(): Promise<string> {
  const h = await headers();
  return resolveClientIp(h.get("x-real-ip"), h.get("x-forwarded-for"));
}

/**
 * Étape 1 : vérifie le code de secours (rate-limité). Réponse **générique**
 * (code faux, foyer absent ou backoff indiscernables).
 */
export async function verifyRecoveryCodeAction(code: string): Promise<VerifyRecoveryActionResult> {
  return { ok: await verifyRecovery(getDb(), code, await clientIp(), new Date()) };
}

/**
 * Étape 2 : re-vérifie le code (autoritative) et pose le nouveau PIN parent.
 * Succès ⇒ nouveau code de secours en clair (à noter). Erreur métier ⇒
 * `{ ok:false, code }` (le client affiche `strings.recovery.errors[code]`).
 */
export async function resetParentPinAction(
  code: string,
  newParentPin: string,
): Promise<ResetParentPinActionResult> {
  try {
    const { recoveryCode } = await resetParentPin(
      getDb(),
      { code, newParentPin, ip: await clientIp() },
      new Date(),
    );
    return { ok: true, recoveryCode };
  } catch (error) {
    if (error instanceof RecoveryError) return { ok: false, code: error.code };
    throw error;
  }
}
