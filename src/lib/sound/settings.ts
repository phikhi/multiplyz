/**
 * Réglages son consommés côté CLIENT (story 8.4, #257) — projection minimale de
 * `HouseholdSettings` (`@/lib/parent/settings`, story 8.3) vers les 3 seuls champs pertinents au
 * moteur audio. `PlayPage` (serveur) lit les réglages effectifs du foyer (source de vérité,
 * story 8.3) et les projette via `pickSoundSettings` avant de les passer à `PlayScreen` — jamais
 * le reste de `HouseholdSettings` (thème, temps d'écran…) n'atteint le bundle client du jeu.
 */
export interface SoundSettings {
  /** Bruitages activés ? (DETAILS §3, ADR 0017 — source de vérité parent). */
  readonly soundEnabled: boolean;
  /** Musique activée ? (DETAILS §3). */
  readonly musicEnabled: boolean;
  /** Volume, pourcentage `[0,100]` (DETAILS §3, ADR 0017). */
  readonly volume: number;
}

/**
 * Défaut CLIENT de repli (tests / `PlayScreen` sans prop explicite — dozaines de tests
 * pré-existants montent `<PlayScreen />` sans réglages son, LEARNINGS « wiring minimal »). MIROIR
 * intentionnel de `CONFIG_DEFAULTS.sound` (`config/server-config.ts`, SERVER-ONLY donc jamais
 * importé ici) : `soundEnabled`/`musicEnabled` activés par défaut (opt-out, audio v1 = bruitages
 * + musique), `volume: 70`. En production, `PlayPage` fournit TOUJOURS la valeur réelle du
 * foyer — ce défaut n'est jamais atteint hors tests/dégradation.
 */
export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  soundEnabled: true,
  musicEnabled: true,
  volume: 70,
};

/** Projette un objet plus large (ex. `HouseholdSettings`) vers les 3 champs son. Pure, testée. */
export function pickSoundSettings(settings: {
  readonly soundEnabled: boolean;
  readonly musicEnabled: boolean;
  readonly volume: number;
}): SoundSettings {
  return {
    soundEnabled: settings.soundEnabled,
    musicEnabled: settings.musicEnabled,
    volume: settings.volume,
  };
}
