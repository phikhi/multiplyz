import { getDb } from "@/lib/db";
import {
  getParentControlsConfig,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
} from "@/config/server-config";
import {
  presetOptionsInRange,
  readHouseholdSettings,
  SCREEN_TIME_HARD_LOCK_PRESETS,
  SCREEN_TIME_NUDGE_PRESETS,
  SOUND_VOLUME_PRESETS,
} from "@/lib/parent/settings";
import { SettingsForm } from "./SettingsForm";

// Rendu dynamique — route sous le groupe `(espace)`, gardée par `(espace)/layout.tsx` (session
// parent lue à chaque requête). Jamais prérendue au build. Runtime Node explicite (better-sqlite3).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Écran **« Réglages »** (story 7.3, DETAILS §3 (Espace parent) liste VERROUILLÉE, WIREFRAMES §7 ; son/musique/
 * volume ajoutés story 8.3, DETAILS §3). Charge les réglages effectifs du foyer (source de vérité
 * serveur) + calcule les options offertes (présets filtrés aux **bornes** — ⚙️ `parentControls` pour
 * les minutes, **fixes** `[SOUND_VOLUME_MIN, SOUND_VOLUME_MAX]` pour le volume — + la valeur courante)
 * côté serveur, puis les passe au composant client. Toutes les mutations passent par des server
 * actions **re-gardées** par la session parent (`reglages/actions.ts`).
 */
export default function ParentSettingsPage() {
  const settings = readHouseholdSettings(getDb());
  const controls = getParentControlsConfig();
  const nudgeOptions = presetOptionsInRange(
    SCREEN_TIME_NUDGE_PRESETS,
    settings.screenTimeNudgeMinutes,
    controls.screenTimeNudgeMinMinutes,
    controls.screenTimeNudgeMaxMinutes,
  );
  const hardLockOptions = presetOptionsInRange(
    SCREEN_TIME_HARD_LOCK_PRESETS,
    settings.screenTimeHardLockMinutes,
    controls.screenTimeHardLockMinMinutes,
    controls.screenTimeHardLockMaxMinutes,
  );
  const volumeOptions = presetOptionsInRange(
    SOUND_VOLUME_PRESETS,
    settings.volume,
    SOUND_VOLUME_MIN,
    SOUND_VOLUME_MAX,
  );
  return (
    <SettingsForm
      settings={settings}
      nudgeOptions={nudgeOptions}
      hardLockOptions={hardLockOptions}
      volumeOptions={volumeOptions}
    />
  );
}
