import { getDb } from "@/lib/db";
import { getParentControlsConfig } from "@/config/server-config";
import {
  minuteOptions,
  readHouseholdSettings,
  SCREEN_TIME_HARD_LOCK_PRESETS,
  SCREEN_TIME_NUDGE_PRESETS,
} from "@/lib/parent/settings";
import { SettingsForm } from "./SettingsForm";

// Rendu dynamique — route sous le groupe `(espace)`, gardée par `(espace)/layout.tsx` (session
// parent lue à chaque requête). Jamais prérendue au build. Runtime Node explicite (better-sqlite3).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Écran **« Réglages »** (story 7.3, DETAILS §3/§25-32 liste VERROUILLÉE, WIREFRAMES §7). Charge les
 * réglages effectifs du foyer (source de vérité serveur) + calcule les options de minutes offertes
 * (présets filtrés aux **bornes ⚙️** `parentControls` + la valeur courante) côté serveur, puis les
 * passe au composant client. Toutes les mutations passent par des server actions **re-gardées** par
 * la session parent (`reglages/actions.ts`).
 */
export default function ParentSettingsPage() {
  const settings = readHouseholdSettings(getDb());
  const controls = getParentControlsConfig();
  const nudgeOptions = minuteOptions(
    SCREEN_TIME_NUDGE_PRESETS,
    settings.screenTimeNudgeMinutes,
    controls.screenTimeNudgeMinMinutes,
    controls.screenTimeNudgeMaxMinutes,
  );
  const hardLockOptions = minuteOptions(
    SCREEN_TIME_HARD_LOCK_PRESETS,
    settings.screenTimeHardLockMinutes,
    controls.screenTimeHardLockMinMinutes,
    controls.screenTimeHardLockMaxMinutes,
  );
  return (
    <SettingsForm
      settings={settings}
      nudgeOptions={nudgeOptions}
      hardLockOptions={hardLockOptions}
    />
  );
}
