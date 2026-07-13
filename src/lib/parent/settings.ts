import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { HOUSEHOLD_SETTINGS_ID, householdSettings, type ThemePreference } from "@/lib/db/schema";
import {
  getParentControlsConfig,
  getSoundConfig,
  getWorldGenConfig,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
  type ParentControlsConfig,
} from "@/config/server-config";

/**
 * **Réglages du foyer** de l'espace parent (story 7.3, DETAILS §3/§25-32 liste VERROUILLÉE,
 * PRODUCT §1.4). SERVER-ONLY (importe la DB + la config). Source de vérité serveur : lecture /
 * validation / écriture de l'unique ligne `household_settings` (single-tenant, AUTH.md §1). Les
 * server actions (`(espace)/reglages/actions.ts`) sont des adaptateurs **minces** au-dessus, chacun
 * gardé par une session parent valide (AC #3).
 *
 * **Ce qui AGIT (câblé, effet observable runtime)** :
 * - `theme` → appliqué app-wide par `app/layout.tsx` (`<html data-theme>`, cf. `dataThemeAttr`) ;
 * - `parentWorldValidation` → **source de vérité** lue par le worker (`processNextJob` via
 *   `readHouseholdSettings`) : câble le ⚙️ existant `qa.parentValidationEnabled` (6.5) sur le réglage
 *   parent persisté (toggle ON → monde QA-validé reste `buffered` ; OFF → `active`).
 * - `soundEnabled`/`musicEnabled`/`volume` (story 8.4 #257) → lus par `app/(app)/jouer/page.tsx`
 *   (RSC, **même contrat de fraîcheur que `theme`** : pas de live-update, un réglage parent modifié
 *   ne s'applique qu'au **prochain chargement** de la route `/jouer`) et projetés
 *   (`pickSoundSettings`, `@/lib/sound/settings`) vers `PlayScreen` → `SoundProvider`
 *   (`@/lib/sound/SoundProvider`) → moteur (`@/lib/sound/engine`, `createSoundEngine`).
 *   `soundEnabled=false` coupe tout SFX (bonne réponse/combo/résultats/légendaire) ; `musicEnabled`
 *   gate la musique de fond jouée pendant une partie active ; `volume` fixe le gain des deux
 *   (mutation-prouvé, `@/lib/sound/engine.test.ts`).
 *
 * **Ce qui est STOCKÉ seulement (consommé en story 7.8 #229, jamais enforcé ici — #127/#155)** :
 * `screenTimeNudgeMinutes`, `screenTimeHardLockEnabled`, `screenTimeHardLockMinutes` — **posés +
 * validés (bornes ⚙️ `parentControls`) + persistés** ; l'enforcement runtime (nudge de session /
 * verrou dur qui bloque l'app) dépend du **temps-joué persisté** (7.4 #217) et vit dans **7.8**.
 */

/** Préférences de thème valides (source unique pour le parsing / la validation ⚙️). */
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type { ThemePreference };

/**
 * Réglages effectifs du foyer (projection typée, aucun secret). `updatedAt` n'est pas exposé
 * (métadonnée interne). Booléens = vrais booléens (mode boolean drizzle).
 */
export interface HouseholdSettings {
  /** Préférence de thème (`system` | `light` | `dark`) — AGIT app-wide. */
  readonly theme: ThemePreference;
  /** Validation des mondes : `true` = approbation parent (buffered), `false` = auto (active). AGIT (worker). */
  readonly parentWorldValidation: boolean;
  /** Nudge doux (min de session avant « fais une pause ») — STOCKÉ (consommé 7.8 #229). */
  readonly screenTimeNudgeMinutes: number;
  /** Verrou dur optionnel activé ? — STOCKÉ (consommé 7.8 #229). */
  readonly screenTimeHardLockEnabled: boolean;
  /** Seuil du verrou dur (min/jour) — STOCKÉ + validé (borne ⚙️), consommé 7.8 #229. */
  readonly screenTimeHardLockMinutes: number;
  /** Bruitages activés ? (DETAILS §3) — AGIT (gate SFX, story 8.4 #257, `@/lib/sound/engine`). */
  readonly soundEnabled: boolean;
  /** Musique activée ? (DETAILS §3) — AGIT (gate musique de fond, story 8.4 #257). */
  readonly musicEnabled: boolean;
  /** Volume, pourcentage `[0,100]` (DETAILS §3 (volume — côté parent, ADR 0017)) — AGIT (gain SFX+musique, story 8.4 #257). */
  readonly volume: number;
}

/** Patch partiel (auto-save par contrôle) : chaque champ est optionnel. */
export type HouseholdSettingsPatch = Partial<HouseholdSettings>;

/** Codes d'échec de validation — mappés vers `strings.parent.settings.errors`. */
export type SettingsValidationErrorCode =
  "THEME_INVALID" | "NUDGE_OUT_OF_RANGE" | "HARD_LOCK_OUT_OF_RANGE" | "VOLUME_OUT_OF_RANGE";

/** Erreur typée de validation : **aucune écriture** (garde de forme serveur, AUTH §4 / LEARNINGS #99). */
export class SettingsValidationError extends Error {
  constructor(readonly code: SettingsValidationErrorCode) {
    super(code);
    this.name = "SettingsValidationError";
  }
}

/**
 * Réglages **par défaut** d'un foyer neuf (aucune ligne écrite). Composés depuis la config ⚙️ pour
 * rester **calibrables** (jamais de constante magique en dur — CLAUDE.md) :
 * - `theme` = `system` (aucune surcharge → le média-query système décide, `tokens.css`) ;
 * - `parentWorldValidation` = **défaut de bascule** `worldgen.qa.parentValidationEnabled` : l'env
 *   `WORLDGEN_QA_PARENT_VALIDATION` reste le **défaut d'amorçage** d'un foyer qui n'a pas encore
 *   touché le réglage ; dès que le parent l'enregistre, la **ligne DB fait autorité** (source de
 *   vérité, cf. `readHouseholdSettings`) ;
 * - `screenTime*` = défauts ⚙️ `parentControls` (nudge / verrou dur), `enabled` = `false` (opt-in) ;
 * - `soundEnabled`/`musicEnabled`/`volume` = défauts ⚙️ `sound` (story 8.3, DETAILS §3).
 */
export function resolveSettingsDefaults(): HouseholdSettings {
  const controls = getParentControlsConfig();
  const sound = getSoundConfig();
  return {
    theme: "system",
    parentWorldValidation: getWorldGenConfig().qa.parentValidationEnabled,
    screenTimeNudgeMinutes: controls.screenTimeNudgeDefaultMinutes,
    screenTimeHardLockEnabled: false,
    screenTimeHardLockMinutes: controls.screenTimeHardLockDefaultMinutes,
    soundEnabled: sound.soundEnabledDefault,
    musicEnabled: sound.musicEnabledDefault,
    volume: sound.volumeDefault,
  };
}

/**
 * **Lit** les réglages effectifs du foyer (source de vérité serveur). Ligne présente → ses valeurs ;
 * **absente** (foyer neuf, jamais réglé) → `defaults` (composés de la config ⚙️). Points de lecture
 * consommés par `app/layout.tsx` (thème), le worker (`parentWorldValidation`), la page de réglages
 * ET `app/(app)/jouer/page.tsx` (son/musique/volume, story 8.4 #257, `pickSoundSettings`).
 * `defaults` injectable pour les tests (mêmes conventions que `resolveWorkerDeps`).
 */
export function readHouseholdSettings(
  db: AppDatabase,
  defaults: HouseholdSettings = resolveSettingsDefaults(),
): HouseholdSettings {
  const row = db
    .select()
    .from(householdSettings)
    .where(eq(householdSettings.id, HOUSEHOLD_SETTINGS_ID))
    .get();
  if (row === undefined) return defaults;
  return {
    theme: row.theme,
    parentWorldValidation: row.parentWorldValidation,
    screenTimeNudgeMinutes: row.screenTimeNudgeMinutes,
    screenTimeHardLockEnabled: row.screenTimeHardLockEnabled,
    screenTimeHardLockMinutes: row.screenTimeHardLockMinutes,
    soundEnabled: row.soundEnabled,
    musicEnabled: row.musicEnabled,
    volume: row.volume,
  };
}

/**
 * Lève `SettingsValidationError(code)` si `value` n'est pas un entier dans `[min, max]`. Générique
 * (renommée depuis `assertMinutesInRange`, story 8.3) : sert les bornes ⚙️ calibrables (nudge/verrou
 * dur, `parentControls`) ET les bornes fixes (volume `[SOUND_VOLUME_MIN, SOUND_VOLUME_MAX]`) — même
 * garde, source de bornes différente.
 */
function assertIntInRange(
  value: number,
  min: number,
  max: number,
  code: SettingsValidationErrorCode,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new SettingsValidationError(code);
  }
}

/**
 * **Écrit** un patch de réglages (upsert de l'unique ligne). Merge le patch sur les réglages
 * courants, **valide** (garde de forme serveur, endpoint public #99), puis upsert (`onConflictDoUpdate`
 * par PK singleton `HOUSEHOLD_SETTINGS_ID` — idempotent). Renvoie les réglages **effectifs** écrits.
 *
 * Validation (jamais d'écriture si invalide) : `theme ∈ THEME_PREFERENCES`, nudge / verrou dur =
 * **entiers dans les bornes ⚙️** `parentControls`, `volume` = **entier dans les bornes fixes**
 * `[SOUND_VOLUME_MIN, SOUND_VOLUME_MAX]` (story 8.3, non-⚙️ — cf. `SoundConfig`). Les booléens sont
 * **coercés** (`=== true`) → une valeur non-booléenne hostile ne peut pas s'écrire (`??` préserve
 * `false`). `controls` injectable (tests).
 */
export function writeHouseholdSettings(
  db: AppDatabase,
  patch: HouseholdSettingsPatch,
  controls: ParentControlsConfig = getParentControlsConfig(),
): HouseholdSettings {
  const current = readHouseholdSettings(db);
  const next: HouseholdSettings = {
    theme: patch.theme ?? current.theme,
    parentWorldValidation:
      patch.parentWorldValidation === undefined
        ? current.parentWorldValidation
        : patch.parentWorldValidation === true,
    screenTimeNudgeMinutes: patch.screenTimeNudgeMinutes ?? current.screenTimeNudgeMinutes,
    screenTimeHardLockEnabled:
      patch.screenTimeHardLockEnabled === undefined
        ? current.screenTimeHardLockEnabled
        : patch.screenTimeHardLockEnabled === true,
    screenTimeHardLockMinutes: patch.screenTimeHardLockMinutes ?? current.screenTimeHardLockMinutes,
    soundEnabled:
      patch.soundEnabled === undefined ? current.soundEnabled : patch.soundEnabled === true,
    musicEnabled:
      patch.musicEnabled === undefined ? current.musicEnabled : patch.musicEnabled === true,
    volume: patch.volume ?? current.volume,
  };

  if (!THEME_PREFERENCES.includes(next.theme)) {
    throw new SettingsValidationError("THEME_INVALID");
  }
  assertIntInRange(
    next.screenTimeNudgeMinutes,
    controls.screenTimeNudgeMinMinutes,
    controls.screenTimeNudgeMaxMinutes,
    "NUDGE_OUT_OF_RANGE",
  );
  assertIntInRange(
    next.screenTimeHardLockMinutes,
    controls.screenTimeHardLockMinMinutes,
    controls.screenTimeHardLockMaxMinutes,
    "HARD_LOCK_OUT_OF_RANGE",
  );
  assertIntInRange(next.volume, SOUND_VOLUME_MIN, SOUND_VOLUME_MAX, "VOLUME_OUT_OF_RANGE");

  const now = new Date();
  db.insert(householdSettings)
    .values({ id: HOUSEHOLD_SETTINGS_ID, ...next, updatedAt: now })
    .onConflictDoUpdate({ target: householdSettings.id, set: { ...next, updatedAt: now } })
    .run();
  return next;
}

/**
 * Attribut `data-theme` à poser sur `<html>` pour une préférence de thème (consommé par
 * `app/layout.tsx`). `system` → `undefined` (**aucun** attribut → le média-query
 * `prefers-color-scheme` de `tokens.css` décide) ; `light`/`dark` → l'attribut correspondant
 * (force le thème, `light` bloquant aussi l'auto-sombre système via `:root:not([data-theme="light"])`).
 * Fonction **pure** (testée 100 %) — la logique n'est PAS dans `layout.tsx` (exclu du coverage).
 */
export function dataThemeAttr(theme: ThemePreference): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

/** Présets d'affichage (min) du nudge doux — offerts au `<select>`, filtrés aux bornes ⚙️. */
export const SCREEN_TIME_NUDGE_PRESETS = [15, 20, 30, 45, 60] as const;
/** Présets d'affichage (min/jour) du verrou dur — offerts au `<select>`, filtrés aux bornes ⚙️. */
export const SCREEN_TIME_HARD_LOCK_PRESETS = [30, 45, 60, 90, 120] as const;
/** Présets d'affichage (%) du volume (DETAILS §3, story 8.3) — offerts au `<select>`, filtrés `[0,100]`. */
export const SOUND_VOLUME_PRESETS = [0, 25, 50, 75, 100] as const;

/**
 * Options entières offertes par un `<select>` : les `presets` **dans les bornes** `[min, max]`,
 * **plus** la valeur `current` si elle-même dans les bornes (garantit qu'une valeur persistée
 * hors-préset, ex. un défaut ⚙️ modifié par env, reste **sélectionnable**). Dédupliqué + trié
 * croissant. Pure (testée) → la génération d'options du formulaire reste hors composant. Générique
 * (renommée depuis `minuteOptions`, story 8.3) : sert les minutes (nudge/verrou dur) ET le volume
 * (pourcentage) — même forme d'options, unité différente selon l'appelant.
 */
export function presetOptionsInRange(
  presets: readonly number[],
  current: number,
  min: number,
  max: number,
): number[] {
  const inRange = presets.filter((p) => p >= min && p <= max);
  const withCurrent = current >= min && current <= max ? [...inRange, current] : inRange;
  return [...new Set(withCurrent)].sort((a, b) => a - b);
}
