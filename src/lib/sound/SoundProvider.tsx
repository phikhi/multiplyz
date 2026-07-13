"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { createSoundEngine, type SoundEngine } from "@/lib/sound/engine";
import type { MusicKey, SfxKey } from "@/lib/sound/manifest";
import type { SoundSettings } from "@/lib/sound/settings";
import { usePrefersReducedMotion } from "@/lib/sound/use-prefers-reduced-motion";

/** API exposée aux composants de jeu (story 8.4, #257) — jamais le moteur brut. */
export interface SoundApi {
  readonly playSfx: (key: SfxKey) => void;
  readonly playMusic: (key: MusicKey) => void;
  readonly stopMusic: () => void;
}

/**
 * Filet de sécurité hors `<SoundProvider>` : no-op silencieux, jamais un throw (même contrat
 * « le son ne bloque jamais la boucle pédagogique », AC #4). Aucun composant de prod n'est censé
 * l'atteindre — `PlayScreen` monte TOUJOURS `SoundProvider` autour de tout son arbre — mais un
 * défaut sûr coûte une ligne et évite une classe de bug si un composant futur oublie le wrapper.
 */
const NOOP_SOUND_API: SoundApi = {
  playSfx: () => undefined,
  playMusic: () => undefined,
  stopMusic: () => undefined,
};

const SoundContext = createContext<SoundApi>(NOOP_SOUND_API);

/** Consommé par tout composant sous `<SoundProvider>` (`PlayingGame`, `ResultsScreen`). */
export function useSound(): SoundApi {
  return useContext(SoundContext);
}

/**
 * Fournit le moteur son (story 8.4, #257) à tout `PlayScreen` (mount unique — englobe TOUTES les
 * branches d'écran, cf. commentaire de `PlayScreen.tsx`, pas seulement celles qui jouent un son
 * aujourd'hui, pour que la musique survive aux transitions entre branches sans redémarrage
 * parasite).
 *
 * `settings`/`reducedMotion` sont lus via des **refs toujours fraîches** (`settingsRef`,
 * `reducedMotionRef`) plutôt qu'inclus dans les deps de `useCallback` : `playSfx`/`playMusic`/
 * `stopMusic` restent des références STABLES (deps vides) — sûres à mettre dans un tableau de
 * deps d'effet consommateur (`PlayingGame`) sans provoquer de ré-exécutions parasites, tout en
 * lisant toujours l'état COURANT (jamais une closure périmée). `settings` ne change pas en
 * pratique pendant la vie de la page (pas de live-sync parent→enfant, contrat identique au
 * thème, `app/layout.tsx`) mais ce patron reste correct si ça change un jour.
 */
export function SoundProvider({
  settings,
  children,
}: {
  readonly settings: SoundSettings;
  readonly children: React.ReactNode;
}) {
  const engineRef = useRef<SoundEngine | null>(null);
  engineRef.current ??= createSoundEngine();

  // Synchronisées via `useEffect` (jamais une écriture directe en corps de composant) : la
  // règle `react-hooks/refs` interdit `ref.current = x` inconditionnel PENDANT le rendu (rendu
  // impur) — seule l'initialisation paresseuse idempotente (`engineRef` ci-dessus, `??=`) y
  // échappe. L'effet s'exécute juste après le commit, avant tout événement/`useEffect` enfant
  // qui pourrait appeler `playSfx`/`playMusic` — aucune closure périmée observable en pratique.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const reducedMotion = usePrefersReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const playSfx = useCallback((key: SfxKey) => {
    engineRef.current?.playSfx(key, {
      soundEnabled: settingsRef.current.soundEnabled,
      volume: settingsRef.current.volume,
      reducedMotion: reducedMotionRef.current,
    });
  }, []);

  const playMusic = useCallback((key: MusicKey) => {
    engineRef.current?.playMusic(key, {
      musicEnabled: settingsRef.current.musicEnabled,
      volume: settingsRef.current.volume,
    });
  }, []);

  const stopMusic = useCallback(() => {
    engineRef.current?.stopMusic();
  }, []);

  const api = useMemo<SoundApi>(
    () => ({ playSfx, playMusic, stopMusic }),
    [playSfx, playMusic, stopMusic],
  );

  return <SoundContext.Provider value={api}>{children}</SoundContext.Provider>;
}
