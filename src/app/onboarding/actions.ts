"use server";

import { getDb } from "@/lib/db";
import {
  createHousehold,
  OnboardingError,
  type CreateHouseholdInput,
  type OnboardingErrorCode,
} from "@/lib/auth/household";

/**
 * Server action de l'onboarding 1er usage (AUTH.md §2). Adaptateur **mince**
 * au-dessus de `createHousehold` : branche la DB applicative, mappe le résultat
 * / les erreurs métier vers une forme **sérialisable** pour le client. Toute la
 * logique (validation, hash, idempotence) vit côté serveur dans `household.ts`.
 */

/** Réponse renvoyée au client (sérialisable). */
export type CreateHouseholdActionResult =
  | { ok: true; recoveryCode: string }
  | { ok: true; alreadyConfigured: true }
  | { ok: false; code: OnboardingErrorCode };

/**
 * Crée le foyer. En cas d'entrée invalide, renvoie `{ ok:false, code }` (le
 * client affiche `strings.onboarding.errors[code]`, posture croissance) — rien
 * n'est créé. Un rejeu sur foyer existant renvoie `alreadyConfigured` (no-op).
 */
export async function createHouseholdAction(
  input: CreateHouseholdInput,
): Promise<CreateHouseholdActionResult> {
  try {
    const result = await createHousehold(getDb(), input);
    if (result.created) return { ok: true, recoveryCode: result.recoveryCode };
    return { ok: true, alreadyConfigured: true };
  } catch (error) {
    if (error instanceof OnboardingError) return { ok: false, code: error.code };
    throw error;
  }
}
