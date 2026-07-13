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
 * lisant toujours l'état COURANT (jamais une closure périmée).
 *
 * **Live-sync EN SESSION (story 8.6, #282, DETAILS §3 « muter vite »)** : contrairement au
 * contrat initial 8.4 (`settings` figé pour la vie de la page, même fraîcheur que le thème), le
 * QUICK-MUTE enfant (`SoundQuickMute`, câblé par `PlayScreen`) fait désormais VARIER `settings`
 * en session (state React, pas juste une prop serveur figée) — CE composant doit donc réagir
 * activement à une TRANSITION de `musicEnabled`, pas seulement rafraîchir sa ref pour le PROCHAIN
 * appel explicite : OFF coupe IMMÉDIATEMENT une piste déjà lancée (`engine.stopMusic()`, sans
 * attendre un nouveau `playMusic`) ; ON relance la DERNIÈRE piste **demandée** par un consommateur
 * (`desiredMusicKeyRef`, jamais une piste arbitraire — `null` si aucun `playMusic` n'a encore été
 * appelé cette session, auquel cas on ne relance rien). `soundEnabled` n'a **pas** besoin d'un
 * traitement symétrique : les SFX sont des tirs ponctuels (jamais de boucle DÉJÀ en cours à
 * interrompre) — la garde `settingsRef` existante au CALL SITE de `playSfx` suffit à silencer
 * tout futur SFX dès le prochain appel, sans mécanisme actif supplémentaire.
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
  // Dernière piste musicale DEMANDÉE par un consommateur (`playMusic`), survit à un mute/unmute —
  // permet à la transition `musicEnabled` OFF→ON (story 8.6) de reprendre EXACTEMENT le morceau en
  // cours plutôt qu'une piste arbitraire. `null` = aucun `playMusic` appelé cette session (mount
  // initial, ou après `stopMusic` explicite) → la transition ON ne relance rien.
  const desiredMusicKeyRef = useRef<MusicKey | null>(null);
  useEffect(() => {
    // TRANSITION (valeur précédente vs nouvelle), pas juste la valeur courante — évite de piloter
    // le moteur à chaque changement de `settings` non pertinent (ex. un `volume` qui bougerait un
    // jour) ; seul un franchissement RÉEL de `musicEnabled` déclenche un appel moteur actif.
    const previousMusicEnabled = settingsRef.current.musicEnabled;
    settingsRef.current = settings;
    if (previousMusicEnabled !== settings.musicEnabled) {
      if (!settings.musicEnabled) {
        engineRef.current?.stopMusic();
      } else if (desiredMusicKeyRef.current !== null) {
        engineRef.current?.playMusic(desiredMusicKeyRef.current, {
          musicEnabled: true,
          volume: settings.volume,
        });
      }
    }
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
    desiredMusicKeyRef.current = key;
    engineRef.current?.playMusic(key, {
      musicEnabled: settingsRef.current.musicEnabled,
      volume: settingsRef.current.volume,
    });
  }, []);

  const stopMusic = useCallback(() => {
    desiredMusicKeyRef.current = null;
    engineRef.current?.stopMusic();
  }, []);

  const api = useMemo<SoundApi>(
    () => ({ playSfx, playMusic, stopMusic }),
    [playSfx, playMusic, stopMusic],
  );

  return <SoundContext.Provider value={api}>{children}</SoundContext.Provider>;
}
