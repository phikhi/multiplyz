import { describe, expect, it, vi } from "vitest";
import {
  browserAudioFactory,
  computeMusicGain,
  computeSfxGain,
  createSoundEngine,
  type AudioLike,
} from "./engine";
import type { MusicKey } from "./manifest";

/** Fabrique un `AudioLike` factice — espionne `play`/`pause`, trace `volume`/`loop`/`currentTime`. */
function makeFakeAudio(overrides: Partial<AudioLike> = {}): AudioLike {
  return {
    play: vi.fn(() => undefined),
    pause: vi.fn(),
    volume: 1,
    loop: false,
    currentTime: 0,
    ...overrides,
  };
}

describe("computeSfxGain (AC #2 volume + AC #3 reduced-motion)", () => {
  it("volume 100 sans reduced-motion → gain 1", () => {
    expect(computeSfxGain(100, false)).toBe(1);
  });

  it("volume 40 sans reduced-motion → gain 0.4", () => {
    expect(computeSfxGain(40, false)).toBeCloseTo(0.4);
  });

  it("volume 0 → gain 0 (avec ou sans reduced-motion)", () => {
    expect(computeSfxGain(0, false)).toBe(0);
    expect(computeSfxGain(0, true)).toBe(0);
  });

  it("clampe une valeur hors bornes ([0,100])", () => {
    expect(computeSfxGain(150, false)).toBe(1);
    expect(computeSfxGain(-20, false)).toBe(0);
  });

  it("clampe une valeur non-finie (NaN/Infinity) à 0 — filet défensif", () => {
    expect(computeSfxGain(Number.NaN, false)).toBe(0);
    expect(computeSfxGain(Number.POSITIVE_INFINITY, false)).toBe(0);
  });

  it("MUTATION-PROOF (AC #3) : reduced-motion=true produit un gain STRICTEMENT inférieur au gain normal (volume > 0) — rougit si la branche d'atténuation est retirée/mutée", () => {
    const volume = 80;
    const normalGain = computeSfxGain(volume, false);
    const reducedGain = computeSfxGain(volume, true);
    expect(reducedGain).toBeLessThan(normalGain);
    expect(reducedGain).toBeGreaterThan(0);
  });
});

describe("computeMusicGain (AC #2 volume — jamais atténué par reduced-motion)", () => {
  it("applique le même clamp que le SFX", () => {
    expect(computeMusicGain(70)).toBeCloseTo(0.7);
    expect(computeMusicGain(150)).toBe(1);
    expect(computeMusicGain(-10)).toBe(0);
  });
});

describe("createSoundEngine — playSfx", () => {
  it("MUTATION-PROOF GARDE #1 (AC #2) : soundEnabled=false → aucun SFX construit ni joué", () => {
    const audioFactory = vi.fn(() => makeFakeAudio());
    const engine = createSoundEngine(audioFactory);
    engine.playSfx("correct", { soundEnabled: false, volume: 70, reducedMotion: false });
    expect(audioFactory).not.toHaveBeenCalled();
  });

  it("soundEnabled=true → construit puis joue le SFX", () => {
    const fake = makeFakeAudio();
    const audioFactory = vi.fn(() => fake);
    const engine = createSoundEngine(audioFactory);
    engine.playSfx("correct", { soundEnabled: true, volume: 70, reducedMotion: false });
    expect(audioFactory).toHaveBeenCalledTimes(1);
    expect(fake.play).toHaveBeenCalledTimes(1);
  });

  it("applique le gain calculé (volume) au `.volume` de l'élément audio (mutation-prouvé : forcer .volume=1 en dur ferait rougir ce test)", () => {
    const fake = makeFakeAudio();
    const engine = createSoundEngine(() => fake);
    engine.playSfx("correct", { soundEnabled: true, volume: 40, reducedMotion: false });
    expect(fake.volume).toBeCloseTo(0.4);
  });

  it("atténue le gain sous reduced-motion (distinct du gain normal, même volume)", () => {
    const fakeNormal = makeFakeAudio();
    createSoundEngine(() => fakeNormal).playSfx("correct", {
      soundEnabled: true,
      volume: 80,
      reducedMotion: false,
    });
    const fakeReduced = makeFakeAudio();
    createSoundEngine(() => fakeReduced).playSfx("correct", {
      soundEnabled: true,
      volume: 80,
      reducedMotion: true,
    });
    expect(fakeReduced.volume).toBeLessThan(fakeNormal.volume);
  });

  it("réutilise le MÊME élément audio pour 2 lectures de la même clé (cache, un seul appel factory)", () => {
    const fake = makeFakeAudio();
    const audioFactory = vi.fn(() => fake);
    const engine = createSoundEngine(audioFactory);
    engine.playSfx("correct", { soundEnabled: true, volume: 70, reducedMotion: false });
    engine.playSfx("correct", { soundEnabled: true, volume: 70, reducedMotion: false });
    expect(audioFactory).toHaveBeenCalledTimes(1);
    expect(fake.play).toHaveBeenCalledTimes(2);
  });

  it("remet `currentTime` à 0 avant chaque lecture (replay immédiat possible, ex. combo rapide)", () => {
    const fake = makeFakeAudio({ currentTime: 2.5 });
    const engine = createSoundEngine(() => fake);
    engine.playSfx("combo", { soundEnabled: true, volume: 70, reducedMotion: false });
    expect(fake.currentTime).toBe(0);
  });

  it("des clés SFX différentes fabriquent des éléments audio distincts", () => {
    const audioFactory = vi.fn(() => makeFakeAudio());
    const engine = createSoundEngine(audioFactory);
    engine.playSfx("correct", { soundEnabled: true, volume: 70, reducedMotion: false });
    engine.playSfx("combo", { soundEnabled: true, volume: 70, reducedMotion: false });
    expect(audioFactory).toHaveBeenCalledTimes(2);
    expect(audioFactory).toHaveBeenNthCalledWith(1, expect.stringContaining("correct"));
    expect(audioFactory).toHaveBeenNthCalledWith(2, expect.stringContaining("combo"));
  });

  it("FALLBACK SILENCIEUX (AC #4) : la fabrique lève (construction/décodage impossible) → ne jette jamais, engine réutilisable au prochain appel", () => {
    let calls = 0;
    const fake = makeFakeAudio();
    const audioFactory = vi.fn(() => {
      calls += 1;
      if (calls === 1) throw new Error("decode failed");
      return fake;
    });
    const engine = createSoundEngine(audioFactory);
    expect(() =>
      engine.playSfx("correct", { soundEnabled: true, volume: 70, reducedMotion: false }),
    ).not.toThrow();
    expect(fake.play).not.toHaveBeenCalled();
    // Échec transitoire non mémorisé dans le cache → nouvelle tentative fraîche au prochain appel.
    engine.playSfx("correct", { soundEnabled: true, volume: 70, reducedMotion: false });
    expect(fake.play).toHaveBeenCalledTimes(1);
  });

  it("FALLBACK SILENCIEUX (AC #4) : `.play()` lève SYNCHRONEMENT → ne jette jamais", () => {
    const fake = makeFakeAudio({
      play: vi.fn(() => {
        throw new Error("autoplay refused");
      }),
    });
    const engine = createSoundEngine(() => fake);
    expect(() =>
      engine.playSfx("correct", { soundEnabled: true, volume: 70, reducedMotion: false }),
    ).not.toThrow();
  });

  it("FALLBACK SILENCIEUX (AC #4) : `.play()` renvoie une Promise REJETÉE → jamais de rejet non-géré (le `.catch` du moteur est invoqué)", () => {
    const catchSpy = vi.fn();
    const fake = makeFakeAudio({
      play: vi.fn(() => ({ catch: catchSpy }) as unknown as Promise<void>),
    });
    const engine = createSoundEngine(() => fake);
    expect(() =>
      engine.playSfx("correct", { soundEnabled: true, volume: 70, reducedMotion: false }),
    ).not.toThrow();
    expect(catchSpy).toHaveBeenCalledTimes(1);
    expect(catchSpy).toHaveBeenCalledWith(expect.any(Function));
  });
});

describe("createSoundEngine — playMusic", () => {
  it("MUTATION-PROOF GARDE #2 (AC #2) : musicEnabled=false → aucune musique construite ni jouée", () => {
    const audioFactory = vi.fn(() => makeFakeAudio());
    const engine = createSoundEngine(audioFactory);
    engine.playMusic("play", { musicEnabled: false, volume: 70 });
    expect(audioFactory).not.toHaveBeenCalled();
  });

  it("musicEnabled=false alors qu'une piste jouait déjà → la coupe (pause), sans throw", () => {
    const fake = makeFakeAudio();
    const engine = createSoundEngine(() => fake);
    engine.playMusic("play", { musicEnabled: true, volume: 70 });
    engine.playMusic("play", { musicEnabled: false, volume: 70 });
    expect(fake.pause).toHaveBeenCalledTimes(1);
  });

  it("musicEnabled=true → construit, active `loop`, joue", () => {
    const fake = makeFakeAudio();
    const audioFactory = vi.fn(() => fake);
    const engine = createSoundEngine(audioFactory);
    engine.playMusic("play", { musicEnabled: true, volume: 70 });
    expect(audioFactory).toHaveBeenCalledTimes(1);
    expect(fake.loop).toBe(true);
    expect(fake.play).toHaveBeenCalledTimes(1);
  });

  it("gain musique JAMAIS atténué par reduced-motion (aucune option reducedMotion dans le contrat playMusic — le volume appliqué est le gain plein)", () => {
    const fake = makeFakeAudio();
    const engine = createSoundEngine(() => fake);
    engine.playMusic("play", { musicEnabled: true, volume: 80 });
    expect(fake.volume).toBeCloseTo(0.8);
  });

  it("rappeler playMusic avec la MÊME clé déjà en cours ne redémarre pas la piste (pas de 2e appel factory/play), mais réapplique le gain", () => {
    const fake = makeFakeAudio();
    const audioFactory = vi.fn(() => fake);
    const engine = createSoundEngine(audioFactory);
    engine.playMusic("play", { musicEnabled: true, volume: 50 });
    engine.playMusic("play", { musicEnabled: true, volume: 90 });
    expect(audioFactory).toHaveBeenCalledTimes(1);
    expect(fake.play).toHaveBeenCalledTimes(1);
    expect(fake.volume).toBeCloseTo(0.9);
  });

  it("changer de PISTE musicale (clé DIFFÉRENTE déjà en cours) coupe l'ancienne avant de démarrer la nouvelle", () => {
    // `MUSIC_MANIFEST` n'expose qu'UNE clé légitime (`"play"`) aujourd'hui — le moteur reste
    // générique par conception (`Map`-like, symétrique au SFX : « des clés différentes
    // fabriquent des éléments distincts », ci-dessus). Clé manufacturée (cast) pour exercer la
    // branche « piste DIFFÉRENTE déjà en cours » sans attendre un 2ᵉ vrai point d'usage.
    const fakeA = makeFakeAudio();
    const fakeB = makeFakeAudio();
    let calls = 0;
    const audioFactory = vi.fn(() => (calls++ === 0 ? fakeA : fakeB));
    const engine = createSoundEngine(audioFactory);
    engine.playMusic("play", { musicEnabled: true, volume: 70 });
    engine.playMusic("play-alt" as MusicKey, { musicEnabled: true, volume: 70 });
    expect(fakeA.pause).toHaveBeenCalledTimes(1);
    expect(fakeB.play).toHaveBeenCalledTimes(1);
    expect(audioFactory).toHaveBeenCalledTimes(2);
  });

  it("FALLBACK SILENCIEUX (AC #4) : la fabrique lève → ne jette jamais, état interne sûr (pas de piste fantôme)", () => {
    const audioFactory = vi.fn(() => {
      throw new Error("decode failed");
    });
    const engine = createSoundEngine(audioFactory);
    expect(() => engine.playMusic("play", { musicEnabled: true, volume: 70 })).not.toThrow();
    // État sûr : un appel `stopMusic` derrière ne jette pas non plus (rien à couper).
    expect(() => engine.stopMusic()).not.toThrow();
  });

  it("FALLBACK SILENCIEUX (AC #4) : `.play()` renvoie une Promise rejetée → catch invoqué, jamais de throw", () => {
    const catchSpy = vi.fn();
    const fake = makeFakeAudio({
      play: vi.fn(() => ({ catch: catchSpy }) as unknown as Promise<void>),
    });
    const engine = createSoundEngine(() => fake);
    expect(() => engine.playMusic("play", { musicEnabled: true, volume: 70 })).not.toThrow();
    expect(catchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createSoundEngine — stopMusic", () => {
  it("aucune musique en cours → no-op sûr, ne jette pas", () => {
    const engine = createSoundEngine(() => makeFakeAudio());
    expect(() => engine.stopMusic()).not.toThrow();
  });

  it("musique en cours → pause, puis un 2e stopMusic reste un no-op sûr", () => {
    const fake = makeFakeAudio();
    const engine = createSoundEngine(() => fake);
    engine.playMusic("play", { musicEnabled: true, volume: 70 });
    engine.stopMusic();
    expect(fake.pause).toHaveBeenCalledTimes(1);
    expect(() => engine.stopMusic()).not.toThrow();
    expect(fake.pause).toHaveBeenCalledTimes(1); // pas de 2e pause (déjà remis à null en interne)
  });

  it("FALLBACK SILENCIEUX (AC #4) : `.pause()` lève → ne jette jamais, état remis à sûr", () => {
    const fake = makeFakeAudio({
      pause: vi.fn(() => {
        throw new Error("pause failed");
      }),
    });
    const engine = createSoundEngine(() => fake);
    engine.playMusic("play", { musicEnabled: true, volume: 70 });
    expect(() => engine.stopMusic()).not.toThrow();
  });
});

describe("browserAudioFactory (repli SSR/environnement dégradé, AC #4)", () => {
  it("`Audio` disponible (navigateur/jsdom réel) → construit un VRAI élément audio (pas le NO-OP)", () => {
    const audio = browserAudioFactory("/sounds/sfx/correct.wav");
    expect(audio).toBeInstanceOf(Audio);
  });

  it("`Audio` indisponible → renvoie un lecteur NO-OP silencieux (jamais de throw)", () => {
    const originalAudio = (globalThis as { Audio?: unknown }).Audio;
    delete (globalThis as { Audio?: unknown }).Audio;
    try {
      const audio = browserAudioFactory("/sounds/sfx/correct.wav");
      expect(() => audio.play()).not.toThrow();
      expect(() => audio.pause()).not.toThrow();
      expect(() => {
        audio.volume = 0.5;
        audio.loop = true;
        audio.currentTime = 0;
      }).not.toThrow();
    } finally {
      (globalThis as { Audio?: unknown }).Audio = originalAudio;
    }
  });
});
