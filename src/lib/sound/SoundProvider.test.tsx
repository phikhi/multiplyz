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
