/**
 * Moteur audio client (story 8.4, #257) — SFX + musique. **Framework-agnostic** (aucune
 * dépendance React ici — `SoundProvider.tsx` est la seule couche qui connaît les hooks),
 * testable à 100 % sans DOM réel via une `AudioFactory` injectée (jsdom n'implémente pas la
 * lecture audio, LEARNINGS convention « horloge/dépendance injectée »).
 *
 * **Contrats non négociables (AC #257)** :
 * - `soundEnabled=false` → `playSfx` ne joue **jamais** (garde mutation-prouvée, tests) ;
 * - `musicEnabled=false` → `playMusic` ne joue **jamais** et coupe une piste déjà lancée (garde
 *   mutation-prouvée) ;
 * - `volume` (`[0,100]`) appliqué au gain de l'élément audio (SFX et musique) ;
 * - `reducedMotion=true` → gain **SFX** atténué (`computeSfxGain`, ⚙️ `config.ts`) — la
 *   **musique n'est pas atténuée** (ambiance de fond, pas un « juice » ponctuel) ;
 * - **JAMAIS de throw** : toute défaillance de l'API Audio (construction, décodage, lecture/
 *   autoplay refusé) est avalée en silence (`try/catch` par méthode publique) — le son ne
 *   bloque **jamais** la boucle pédagogique (ENGINE.md, AC #4).
 */

import { MUSIC_MANIFEST, SFX_MANIFEST, type MusicKey, type SfxKey } from "@/lib/sound/manifest";
import { REDUCED_MOTION_SFX_GAIN, SOUND_VOLUME_MAX, SOUND_VOLUME_MIN } from "@/lib/sound/config";

/**
 * Sous-ensemble de `HTMLAudioElement` réellement consommé — permet l'injection en test (jsdom
 * n'implémente pas la lecture audio réelle ; `.play()` y lève « Not implemented »).
 */
export interface AudioLike {
  play(): Promise<void> | void;
  pause(): void;
  volume: number;
  loop: boolean;
  currentTime: number;
}

export type AudioFactory = (src: string) => AudioLike;

/**
 * Fabrique par défaut — `new Audio()` navigateur réel. Protégée : si `Audio` n'existe pas
 * (environnement dégradé/SSR — ne devrait jamais survenir en pratique, ce moteur n'étant
 * instancié que côté client, `SoundProvider.tsx`), renvoie un lecteur NO-OP silencieux plutôt
 * que de jeter (fallback gracieux, AC #4).
 */
export const browserAudioFactory: AudioFactory = (src) => {
  if (typeof Audio === "undefined") return createNoopAudio();
  return new Audio(src);
};

function createNoopAudio(): AudioLike {
  return {
    play: () => undefined,
    pause: () => undefined,
    volume: 1,
    loop: false,
    currentTime: 0,
  };
}

/** Clamp `[SOUND_VOLUME_MIN, SOUND_VOLUME_MAX]` → gain `[0,1]`. Défensif : une valeur non-finie
 *  (hostile/corrompue) retombe à 0 plutôt que de produire un `.volume` DOM invalide (qui lève). */
function clampVolumeGain(volumePercent: number): number {
  if (!Number.isFinite(volumePercent)) return 0;
  const clamped = Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, volumePercent));
  return clamped / SOUND_VOLUME_MAX;
}

/** Gain SFX effectif : `volume` clampé, atténué de `REDUCED_MOTION_SFX_GAIN` si `reducedMotion`
 *  (AC #3 — testé, mutation-prouvé : reducedMotion doit produire un gain STRICTEMENT inférieur
 *  au gain normal pour un même volume > 0). Pure — aucune dépendance DOM. */
export function computeSfxGain(volumePercent: number, reducedMotion: boolean): number {
  const base = clampVolumeGain(volumePercent);
  return reducedMotion ? base * REDUCED_MOTION_SFX_GAIN : base;
}

/** Gain musique effectif : `volume` clampé, **jamais** atténué par reduced-motion (décision
 *  documentée `config.ts` — la musique de fond n'est pas un « juice » ponctuel). Pure. */
export function computeMusicGain(volumePercent: number): number {
  return clampVolumeGain(volumePercent);
}

export interface PlaySfxOptions {
  readonly soundEnabled: boolean;
  readonly volume: number;
  readonly reducedMotion: boolean;
}

export interface PlayMusicOptions {
  readonly musicEnabled: boolean;
  readonly volume: number;
}

export interface SoundEngine {
  playSfx(key: SfxKey, opts: PlaySfxOptions): void;
  playMusic(key: MusicKey, opts: PlayMusicOptions): void;
  stopMusic(): void;
}

/**
 * Avale toute exception synchrone (délégué au `try/catch` de l'appelant) ET tout rejet de
 * Promise (`.play()` peut renvoyer une Promise rejetée — autoplay refusé/décodage impossible,
 * cf. spec `HTMLMediaElement.play()`) — jamais de rejet non-géré, jamais de throw remontant à
 * l'appelant (AC #4).
 */
function safePlay(audio: AudioLike): void {
  const result = audio.play();
  if (result !== undefined && typeof (result as Promise<void>).catch === "function") {
    (result as Promise<void>).catch(() => undefined);
  }
}

/**
 * Fabrique un moteur son. `audioFactory` injectable (tests) — défaut `browserAudioFactory`
 * (navigateur réel). Un seul moteur par `SoundProvider` (état interne : cache SFX par clé + slot
 * musique courant).
 */
export function createSoundEngine(audioFactory: AudioFactory = browserAudioFactory): SoundEngine {
  const sfxCache = new Map<SfxKey, AudioLike>();
  let music: { key: MusicKey; audio: AudioLike } | null = null;

  return {
    playSfx(key, opts) {
      // GARDE #1 (AC #2, mutation-prouvée) : réglage OFF ⇒ aucun SFX, jamais construit ni joué.
      if (!opts.soundEnabled) return;
      try {
        let audio = sfxCache.get(key);
        if (audio === undefined) {
          audio = audioFactory(SFX_MANIFEST[key]);
          sfxCache.set(key, audio);
        }
        // Rejoue depuis le début même si le SFX précédent est encore en cours (replays rapides,
        // ex. combo successif) — jamais de file d'attente, l'enfant ne doit jamais attendre.
        audio.currentTime = 0;
        audio.volume = computeSfxGain(opts.volume, opts.reducedMotion);
        safePlay(audio);
      } catch {
        // Fallback silencieux gracieux (AC #4) : construction/décodage/lecture — jamais de throw
        // remontant dans la boucle pédagogique. Le cache n'a rien mémorisé sur un échec de
        // construction (le prochain appel retentera une fabrication fraîche).
      }
    },

    playMusic(key, opts) {
      try {
        if (!opts.musicEnabled) {
          // GARDE #2 (AC #2, mutation-prouvée) : réglage OFF ⇒ coupe une piste déjà lancée
          // (le réglage peut avoir changé entre 2 chargements de page) et ne relance rien.
          if (music !== null) {
            music.audio.pause();
            music = null;
          }
          return;
        }
        if (music !== null && music.key === key) {
          // Déjà en cours sur la MÊME piste : pas de redémarrage (évite un accroc audible à
          // chaque re-rendu) — seul le gain est réappliqué (le volume a pu changer).
          music.audio.volume = computeMusicGain(opts.volume);
          return;
        }
        if (music !== null) {
          music.audio.pause();
        }
        const audio = audioFactory(MUSIC_MANIFEST[key]);
        audio.loop = true;
        audio.volume = computeMusicGain(opts.volume);
        music = { key, audio };
        safePlay(audio);
      } catch {
        // Fallback silencieux gracieux (AC #4) — état sûr : pas de piste « fantôme » si la
        // construction/lecture a échoué en cours de route.
        music = null;
      }
    },

    stopMusic() {
      try {
        if (music !== null) {
          music.audio.pause();
        }
      } catch {
        // Fallback silencieux gracieux (AC #4).
      } finally {
        music = null;
      }
    },
  };
}
