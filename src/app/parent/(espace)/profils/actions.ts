"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getCurrentParentSession } from "@/lib/auth/current-session";
import {
  deleteProfile,
  renameProfile,
  resetChildPin,
  ProfileManagementError,
  type ProfileManagementErrorCode,
} from "@/lib/parent/profiles";

/**
 * Server actions de l'écran **« Gérer les profils »** (story 7.5, DETAILS §3). Adaptateurs
 * **minces** au-dessus de `lib/parent/profiles.ts` : validation, hachage, cascade de purge vivent
 * côté serveur (source de vérité). Surface **disjointe** des stats (7.2) et des réglages — fichier
 * d'actions séparé, **même garde**.
 *
 * **Anti-abus (SÉCU, AC #4)** : CHAQUE action ré-exige une session **`kind:"parent"` valide** via
 * `getCurrentParentSession` (qui filtre déjà `kind === "parent"` → une session enfant, ou aucune
 * session, renvoie `null`). Le garde de route `(espace)/layout.tsx` protège le **rendu** ; mais une
 * server action est un **endpoint POST indépendant** appelable hors de ce rendu → la garde est
 * **répétée dans chaque action** (jamais un helper mutualisé unique dont la mutation casserait tout
 * d'un coup — chaque call-site de garde est indépendamment mutation-prouvé, rétro #206). Un enfant
 * ne peut **jamais** déclencher une écriture parent (test nommé par action).
 */

/** Résultat générique d'une action de gestion : succès, ou code d'erreur (dont `UNAUTHORIZED`). */
export type ProfileActionResult =
  { ok: true } | { ok: false; code: ProfileManagementErrorCode | "UNAUTHORIZED" };

const PROFILS_PATH = "/parent/profils";

/** `true` ssi la requête porte une session **parent** valide (source de vérité serveur). */
async function hasParentSession(): Promise<boolean> {
  return (await getCurrentParentSession()) !== null;
}

/** Mappe une erreur métier vers un résultat générique ; re-lève tout le reste (bug réel). */
function toResult(run: () => void): ProfileActionResult {
  try {
    run();
    return { ok: true };
  } catch (error) {
    if (error instanceof ProfileManagementError) return { ok: false, code: error.code };
    throw error;
  }
}

/**
 * **Renomme** un profil (garde session parent). Sans session parent (ou avec une session enfant) →
 * `UNAUTHORIZED`, **aucune écriture**. Sinon délègue à `renameProfile` et revalide l'écran.
 */
export async function renameProfileAction(
  profileId: number,
  name: string,
): Promise<ProfileActionResult> {
  if (!(await hasParentSession())) return { ok: false, code: "UNAUTHORIZED" };
  const result = toResult(() => renameProfile(getDb(), profileId, name));
  if (result.ok) revalidatePath(PROFILS_PATH);
  return result;
}

/**
 * **Réinitialise le PIN enfant** d'un profil (garde session parent). Le PIN reste **côté serveur**
 * (hashé argon2id) — le client n'envoie que le nouveau PIN à poser, jamais un hash. Sans session
 * parent → `UNAUTHORIZED`, aucune écriture.
 */
export async function resetChildPinAction(
  profileId: number,
  newPin: string,
): Promise<ProfileActionResult> {
  if (!(await hasParentSession())) return { ok: false, code: "UNAUTHORIZED" };
  try {
    await resetChildPin(getDb(), profileId, newPin);
    return { ok: true };
  } catch (error) {
    if (error instanceof ProfileManagementError) return { ok: false, code: error.code };
    throw error;
  }
}

/**
 * **Supprime** un profil = purge RGPD (garde session parent). Le propriétaire est indestructible
 * (`OWNER_UNDELETABLE`, garde dans `deleteProfile`). Sans session parent → `UNAUTHORIZED`, aucune
 * suppression. Succès ⇒ revalide l'écran (le profil disparaît de la liste).
 */
export async function deleteProfileAction(profileId: number): Promise<ProfileActionResult> {
  if (!(await hasParentSession())) return { ok: false, code: "UNAUTHORIZED" };
  const result = toResult(() => deleteProfile(getDb(), profileId));
  if (result.ok) revalidatePath(PROFILS_PATH);
  return result;
}
