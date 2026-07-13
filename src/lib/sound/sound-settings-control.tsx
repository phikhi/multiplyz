"use client";

import { createContext, useContext } from "react";

/**
 * Contrôle du réglage son EN SESSION (story 8.6, #282, DETAILS §3, ADR 0017) — distinct de
 * `SoundApi` (`@/lib/sound/SoundProvider`, qui joue des sons) : cette interface expose l'état
 * ACTUEL de `soundEnabled`/`musicEnabled` + des setters optimistes, consommés par
 * `SoundQuickMute` (contrôle enfant no-PIN in-game). Fournie par `PlayScreen`, qui possède le
 * state `SoundSettings` (source de vérité CLIENT le temps de la session — persistée serveur via
 * la server action narrow `setChildSoundEnabledAction`/`setChildMusicEnabledAction`,
 * `@/app/(app)/jouer/actions`) et le fait redescendre à la fois vers `SoundProvider` (moteur) et
 * ce contexte (UI de contrôle) — un SEUL état, deux consommateurs.
 *
 * **Volume ABSENT délibérément** (AC #282, ADR 0017) : le quick-mute enfant no-PIN n'expose QUE
 * on/off — le volume fin reste un réglage **parent** (écran Réglages, PIN, story 8.3). Cette
 * interface ne porte donc aucun setter de volume, par construction (pas un simple choix d'UI —
 * le TYPE lui-même ne peut pas exposer ce qu'il ne déclare pas).
 */
export interface SoundSettingsControl {
  /** Bruitages activés ? (valeur courante, reflète le dernier `setSoundEnabled` optimiste). */
  readonly soundEnabled: boolean;
  /** Musique activée ? (valeur courante, reflète le dernier `setMusicEnabled` optimiste). */
  readonly musicEnabled: boolean;
  /** Bascule les bruitages — met à jour l'état EN SESSION + persiste côté serveur (fire-and-forget, no-fail). */
  readonly setSoundEnabled: (enabled: boolean) => void;
  /** Bascule la musique — met à jour l'état EN SESSION + persiste côté serveur (fire-and-forget, no-fail). */
  readonly setMusicEnabled: (enabled: boolean) => void;
}

/**
 * `null` par défaut (hors `PlayScreen`) : `SoundQuickMute` rend `null` silencieusement dans ce
 * cas (jamais de throw — même contrat « ne bloque jamais » que `SoundProvider`/`NOOP_SOUND_API`).
 * En production, `PlayScreen` fournit TOUJOURS ce contexte (même patron que `SoundProvider`).
 */
const SoundSettingsControlContext = createContext<SoundSettingsControl | null>(null);

export const SoundSettingsControlProvider = SoundSettingsControlContext.Provider;

/** Consommé par `SoundQuickMute`. `null` si rendu hors `PlayScreen` (défensif, jamais atteint en prod). */
export function useSoundSettingsControl(): SoundSettingsControl | null {
  return useContext(SoundSettingsControlContext);
}
