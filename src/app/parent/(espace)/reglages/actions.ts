"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getCurrentParentSession } from "@/lib/auth/current-session";
import {
  writeHouseholdSettings,
  SettingsValidationError,
  type HouseholdSettingsPatch,
  type SettingsValidationErrorCode,
} from "@/lib/parent/settings";

/**
 * Server actions de l'écran **« Réglages »** (story 7.3, DETAILS §3). Adaptateur **mince** au-dessus
 * de `lib/parent/settings.ts` : la validation (thème, bornes ⚙️) + l'upsert vivent côté serveur
 * (source de vérité). Surface **disjointe** des stats (7.2) et de la gestion de profils (7.5) —
 * fichier d'actions séparé, **même garde**.
 *
 * **Anti-abus (SÉCU, AC #3)** : l'action ré-exige une session **`kind:"parent"` valide** via
 * `getCurrentParentSession` (qui filtre déjà `kind === "parent"` → une session enfant, ou aucune
 * session, renvoie `null`). Le garde de route `(espace)/layout.tsx` protège le **rendu** ; mais une
 * server action est un **endpoint POST indépendant** → la garde est **répétée ici**. Un enfant ne
 * peut **jamais** modifier un réglage du foyer.
 */

/** Résultat générique : succès, ou code d'erreur (validation `SettingsValidationError` + session). */
export type SettingsActionResult =
  { ok: true } | { ok: false; code: SettingsValidationErrorCode | "UNAUTHORIZED" };

const REGLAGES_PATH = "/parent/reglages";

/** `true` ssi la requête porte une session **parent** valide (source de vérité serveur). */
async function hasParentSession(): Promise<boolean> {
  return (await getCurrentParentSession()) !== null;
}

/**
 * **Enregistre** un patch de réglages du foyer (auto-save par contrôle). Sans session parent (ou
 * avec une session enfant) → `UNAUTHORIZED`, **aucune écriture**. Sinon délègue à
 * `writeHouseholdSettings` (valide + upsert) et revalide l'écran. Une valeur invalide (thème
 * inconnu, durée hors bornes ⚙️) → code d'erreur générique, jamais d'écriture partielle.
 */
export async function saveSettingsAction(
  patch: HouseholdSettingsPatch,
): Promise<SettingsActionResult> {
  if (!(await hasParentSession())) return { ok: false, code: "UNAUTHORIZED" };
  try {
    writeHouseholdSettings(getDb(), patch);
    revalidatePath(REGLAGES_PATH);
    return { ok: true };
  } catch (error) {
    if (error instanceof SettingsValidationError) return { ok: false, code: error.code };
    throw error;
  }
}
