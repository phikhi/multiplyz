import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SoundProvider, useSound } from "./SoundProvider";
import { createSoundEngine } from "./engine";
import type { SoundSettings } from "./settings";

vi.mock("./engine", () => ({
  createSoundEngine: vi.fn(),
}));

const createSoundEngineMock = vi.mocked(createSoundEngine);

const SETTINGS: SoundSettings = { soundEnabled: true, musicEnabled: false, volume: 55 };

function makeFakeEngine() {
  return {
    playSfx: vi.fn(),
    playMusic: vi.fn(),
    stopMusic: vi.fn(),
  };
}

/** Composant consommateur minimal — expose les 3 méthodes via des boutons cliquables (évite
 *  d'appeler les callbacks hors rendu React, plus proche de l'usage réel). */
function Consumer() {
  const { playSfx, playMusic, stopMusic } = useSound();
  return (
    <div>
      <button onClick={() => playSfx("correct")}>sfx</button>
      <button onClick={() => playMusic("play")}>music</button>
      <button onClick={() => stopMusic()}>stop</button>
    </div>
  );
}

describe("useSound — hors SoundProvider", () => {
  it("renvoie une API no-op sûre (jamais de throw) quand aucun SoundProvider n'englobe le consommateur", () => {
    render(<Consumer />);
    expect(() => screen.getByText("sfx").click()).not.toThrow();
    expect(() => screen.getByText("music").click()).not.toThrow();
    expect(() => screen.getByText("stop").click()).not.toThrow();
  });
});

describe("SoundProvider — câblage settings/reducedMotion vers le moteur", () => {
  it("playSfx transmet soundEnabled/volume/reducedMotion(false par défaut) au moteur", () => {
    const engine = makeFakeEngine();
    createSoundEngineMock.mockReturnValue(engine);
    render(
      <SoundProvider settings={SETTINGS}>
        <Consumer />
      </SoundProvider>,
    );
    screen.getByText("sfx").click();
    expect(engine.playSfx).toHaveBeenCalledWith("correct", {
      soundEnabled: true,
      volume: 55,
      reducedMotion: false,
    });
  });

  it("playSfx transmet reducedMotion=true quand prefers-reduced-motion matche", () => {
    const engine = makeFakeEngine();
    createSoundEngineMock.mockReturnValue(engine);
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      render(
        <SoundProvider settings={SETTINGS}>
          <Consumer />
        </SoundProvider>,
      );
      screen.getByText("sfx").click();
      expect(engine.playSfx).toHaveBeenCalledWith(
        "correct",
        expect.objectContaining({ reducedMotion: true }),
      );
    } finally {
      window.matchMedia = original;
    }
  });

  it("playMusic transmet musicEnabled/volume au moteur (PAS de champ reducedMotion — contrat musique distinct du SFX)", () => {
    const engine = makeFakeEngine();
    createSoundEngineMock.mockReturnValue(engine);
    render(
      <SoundProvider settings={SETTINGS}>
        <Consumer />
      </SoundProvider>,
    );
    screen.getByText("music").click();
    expect(engine.playMusic).toHaveBeenCalledWith("play", { musicEnabled: false, volume: 55 });
  });

  it("stopMusic délègue au moteur", () => {
    const engine = makeFakeEngine();
    createSoundEngineMock.mockReturnValue(engine);
    render(
      <SoundProvider settings={SETTINGS}>
        <Consumer />
      </SoundProvider>,
    );
    screen.getByText("stop").click();
    expect(engine.stopMusic).toHaveBeenCalledTimes(1);
  });

  it("un SEUL moteur est créé pour tout le sous-arbre (mount unique, jamais recréé par re-rendu)", () => {
    const engine = makeFakeEngine();
    createSoundEngineMock.mockReturnValue(engine);
    const { rerender } = render(
      <SoundProvider settings={SETTINGS}>
        <Consumer />
      </SoundProvider>,
    );
    rerender(
      <SoundProvider settings={{ ...SETTINGS, volume: 10 }}>
        <Consumer />
      </SoundProvider>,
    );
    expect(createSoundEngineMock).toHaveBeenCalledTimes(1);
    // Re-rendu avec un NOUVEAU volume → playSfx doit lire la valeur FRAÎCHE (ref), pas figée
    // dans une closure périmée au 1er rendu.
    screen.getByText("sfx").click();
    expect(engine.playSfx).toHaveBeenCalledWith("correct", expect.objectContaining({ volume: 10 }));
  });
});

describe("SoundProvider — live-sync EN SESSION du quick-mute (story 8.6, #282, DETAILS §3 « muter vite »)", () => {
  it("MUTATION-PROOF : transition musicEnabled true→false coupe le moteur IMMÉDIATEMENT (stopMusic), SANS nouvel appel explicite playMusic/stopMusic", () => {
    const engine = makeFakeEngine();
    createSoundEngineMock.mockReturnValue(engine);
    const { rerender } = render(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: true }}>
        <Consumer />
      </SoundProvider>,
    );
    // Démarre la musique (patron réel : `PlayingGame` appelle `playMusic("play")` au montage).
    screen.getByText("music").click();
    expect(engine.playMusic).toHaveBeenCalledTimes(1);
    engine.stopMusic.mockClear();

    // Le quick-mute enfant fait varier `settings` EN SESSION (state React de `PlayScreen`, pas un
    // reload de page) — AUCUN clic sur "stop" ci-dessous : seule la TRANSITION de prop doit couper
    // le moteur. Si le bloc `if (previousMusicEnabled !== settings.musicEnabled)` est retiré/muté,
    // ce test ROUGIT (stopMusic jamais appelé automatiquement).
    rerender(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: false }}>
        <Consumer />
      </SoundProvider>,
    );
    expect(engine.stopMusic).toHaveBeenCalledTimes(1);
  });

  it("MUTATION-PROOF : transition musicEnabled false→true relance AUTOMATIQUEMENT la DERNIÈRE piste demandée (playMusic), sans clic", () => {
    const engine = makeFakeEngine();
    createSoundEngineMock.mockReturnValue(engine);
    const { rerender } = render(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: true }}>
        <Consumer />
      </SoundProvider>,
    );
    screen.getByText("music").click(); // enregistre "play" comme piste DEMANDÉE
    expect(engine.playMusic).toHaveBeenCalledTimes(1);

    rerender(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: false }}>
        <Consumer />
      </SoundProvider>,
    );
    engine.playMusic.mockClear();

    // Re-mute → doit relancer "play" (jamais une piste arbitraire) SANS re-cliquer "music".
    rerender(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: true, volume: 42 }}>
        <Consumer />
      </SoundProvider>,
    );
    expect(engine.playMusic).toHaveBeenCalledTimes(1);
    expect(engine.playMusic).toHaveBeenCalledWith("play", { musicEnabled: true, volume: 42 });
  });

  it("transition musicEnabled false→true SANS `playMusic` préalable cette session → ne relance RIEN (aucune piste désirée connue, garde anti-piste-arbitraire)", () => {
    const engine = makeFakeEngine();
    createSoundEngineMock.mockReturnValue(engine);
    const { rerender } = render(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: false }}>
        <Consumer />
      </SoundProvider>,
    );
    // Aucun clic sur "music" — `desiredMusicKeyRef` reste `null`.
    rerender(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: true }}>
        <Consumer />
      </SoundProvider>,
    );
    expect(engine.playMusic).not.toHaveBeenCalled();
  });

  it("changement de `volume` SEUL (musicEnabled INCHANGÉ) → AUCUN appel automatique moteur (garde à la TRANSITION, pas à la valeur courante)", () => {
    const engine = makeFakeEngine();
    createSoundEngineMock.mockReturnValue(engine);
    const { rerender } = render(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: false, volume: 10 }}>
        <Consumer />
      </SoundProvider>,
    );
    rerender(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: false, volume: 90 }}>
        <Consumer />
      </SoundProvider>,
    );
    expect(engine.stopMusic).not.toHaveBeenCalled();
    expect(engine.playMusic).not.toHaveBeenCalled();
  });

  it("`stopMusic` explicite oublie la piste désirée : un re-mute ultérieur ne relance RIEN (cohérent avec l'intention explicite d'arrêt)", () => {
    const engine = makeFakeEngine();
    createSoundEngineMock.mockReturnValue(engine);
    const { rerender } = render(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: true }}>
        <Consumer />
      </SoundProvider>,
    );
    screen.getByText("music").click();
    screen.getByText("stop").click(); // arrêt EXPLICITE (ex. sortie d'écran) → oublie la piste
    engine.playMusic.mockClear();

    rerender(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: false }}>
        <Consumer />
      </SoundProvider>,
    );
    rerender(
      <SoundProvider settings={{ ...SETTINGS, musicEnabled: true }}>
        <Consumer />
      </SoundProvider>,
    );
    expect(engine.playMusic).not.toHaveBeenCalled();
  });

  it("`soundEnabled` (SFX) n'a besoin d'AUCUN mécanisme actif symétrique : un futur playSfx lit directement la valeur fraîche (aucune boucle à interrompre)", () => {
    const engine = makeFakeEngine();
    createSoundEngineMock.mockReturnValue(engine);
    const { rerender } = render(
      <SoundProvider settings={{ ...SETTINGS, soundEnabled: true }}>
        <Consumer />
      </SoundProvider>,
    );
    rerender(
      <SoundProvider settings={{ ...SETTINGS, soundEnabled: false }}>
        <Consumer />
      </SoundProvider>,
    );
    // Aucun appel moteur déclenché par la seule transition de `soundEnabled` (pas de piste SFX à
    // couper) — mais le PROCHAIN `playSfx` respecte immédiatement la valeur fraîche.
    expect(engine.playSfx).not.toHaveBeenCalled();
    screen.getByText("sfx").click();
    expect(engine.playSfx).toHaveBeenCalledWith(
      "correct",
      expect.objectContaining({ soundEnabled: false }),
    );
  });
});
