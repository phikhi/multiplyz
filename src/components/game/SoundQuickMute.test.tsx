import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoundQuickMute } from "./SoundQuickMute";
import { strings } from "@/strings";
import {
  useSoundSettingsControl,
  type SoundSettingsControl,
} from "@/lib/sound/sound-settings-control";
import {
  contrastRatio,
  resolveTokenColor,
  type Theme,
} from "@/components/game/scaffolds/test-support/tokens-css";

const THEMES: Theme[] = ["light", "dark"];
const s = strings.play.soundQuickMute;

vi.mock("@/lib/sound/sound-settings-control", () => ({ useSoundSettingsControl: vi.fn() }));

const useSoundSettingsControlMock = vi.mocked(useSoundSettingsControl);

function fakeControl(overrides: Partial<SoundSettingsControl> = {}): SoundSettingsControl {
  return {
    soundEnabled: true,
    musicEnabled: true,
    setSoundEnabled: vi.fn(),
    setMusicEnabled: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SoundQuickMute — hors PlayScreen (contexte absent)", () => {
  it("control === null → rend null silencieusement (jamais de throw, même contrat que SoundApi/NOOP)", () => {
    useSoundSettingsControlMock.mockReturnValue(null);
    const { container } = render(<SoundQuickMute />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SoundQuickMute — rendu (story 8.6, #282)", () => {
  it("affiche 2 contrôles role=switch (son + musique), groupés, nom accessible du groupe", () => {
    useSoundSettingsControlMock.mockReturnValue(fakeControl());
    render(<SoundQuickMute />);
    expect(screen.getByRole("group", { name: s.legend })).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("aria-checked reflète l'état COURANT (ON) — pas seulement le texte visible", () => {
    useSoundSettingsControlMock.mockReturnValue(
      fakeControl({ soundEnabled: true, musicEnabled: true }),
    );
    render(<SoundQuickMute />);
    expect(screen.getByRole("switch", { name: s.soundOn })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: s.musicOn })).toHaveAttribute("aria-checked", "true");
  });

  it("aria-checked reflète l'état COURANT (OFF) — icône DOUBLÉE d'un texte distinct (pas la seule couleur, #125/#239)", () => {
    useSoundSettingsControlMock.mockReturnValue(
      fakeControl({ soundEnabled: false, musicEnabled: false }),
    );
    render(<SoundQuickMute />);
    const soundSwitch = screen.getByRole("switch", { name: s.soundOff });
    const musicSwitch = screen.getByRole("switch", { name: s.musicOff });
    expect(soundSwitch).toHaveAttribute("aria-checked", "false");
    expect(musicSwitch).toHaveAttribute("aria-checked", "false");
    // Le libellé ON et le libellé OFF sont des chaînes DISTINCTES (jamais le même texte avec
    // seulement une couleur qui change) — daltonisme, #125/#239.
    expect(s.soundOn).not.toBe(s.soundOff);
    expect(s.musicOn).not.toBe(s.musicOff);
  });

  it("cible tactile ≥44px (--tap-target-min) sur les 2 switches", () => {
    useSoundSettingsControlMock.mockReturnValue(fakeControl());
    render(<SoundQuickMute />);
    for (const el of screen.getAllByRole("switch")) {
      expect((el as HTMLElement).style.minHeight).toBe("var(--tap-target-min)");
    }
  });

  it("AUCUNE opacity posée (rétro #226) — jamais de dilution du texte du switch", () => {
    useSoundSettingsControlMock.mockReturnValue(fakeControl());
    render(<SoundQuickMute />);
    for (const el of screen.getAllByRole("switch")) {
      expect(["", "1"]).toContain((el as HTMLElement).style.opacity);
    }
  });
});

describe("SoundQuickMute — interaction (mutation-prouvé)", () => {
  it("clique Son → setSoundEnabled(!soundEnabled), négation de l'état COURANT (pas une valeur figée)", () => {
    const setSoundEnabled = vi.fn();
    useSoundSettingsControlMock.mockReturnValue(
      fakeControl({ soundEnabled: true, setSoundEnabled }),
    );
    render(<SoundQuickMute />);
    fireEvent.click(screen.getByRole("switch", { name: s.soundOn }));
    expect(setSoundEnabled).toHaveBeenCalledWith(false);
    expect(setSoundEnabled).toHaveBeenCalledTimes(1);
  });

  it("clique Son quand OFF → setSoundEnabled(true) (bascule dans les 2 sens, pas seulement ON→OFF)", () => {
    const setSoundEnabled = vi.fn();
    useSoundSettingsControlMock.mockReturnValue(
      fakeControl({ soundEnabled: false, setSoundEnabled }),
    );
    render(<SoundQuickMute />);
    fireEvent.click(screen.getByRole("switch", { name: s.soundOff }));
    expect(setSoundEnabled).toHaveBeenCalledWith(true);
  });

  it("clique Musique → setMusicEnabled(!musicEnabled), INDÉPENDANT du contrôle Son (jamais couplés)", () => {
    const setSoundEnabled = vi.fn();
    const setMusicEnabled = vi.fn();
    useSoundSettingsControlMock.mockReturnValue(
      fakeControl({ soundEnabled: true, musicEnabled: true, setSoundEnabled, setMusicEnabled }),
    );
    render(<SoundQuickMute />);
    fireEvent.click(screen.getByRole("switch", { name: s.musicOn }));
    expect(setMusicEnabled).toHaveBeenCalledWith(false);
    // GARDE anti-couplage : cliquer Musique ne doit JAMAIS appeler le setter Son.
    expect(setSoundEnabled).not.toHaveBeenCalled();
  });
});

describe("SoundQuickMute — contraste WCAG résolu (CLAUDE.md, chaque glyphe/état rendu distinct)", () => {
  it("état ON (fond accent plein) : --color-text-inverse sur --color-accent-primary ≥4.5:1 (light+dark)", () => {
    useSoundSettingsControlMock.mockReturnValue(fakeControl({ soundEnabled: true }));
    render(<SoundQuickMute />);
    const el = screen.getByRole("switch", { name: s.soundOn }) as HTMLElement;
    expect(el.style.backgroundColor).toBe("var(--color-accent-primary)");
    expect(el.style.color).toBe("var(--color-text-inverse)");
    for (const theme of THEMES) {
      const text = resolveTokenColor(theme, "color-text-inverse");
      const bg = resolveTokenColor(theme, "color-accent-primary");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("état OFF (registre fantôme, fond hôte --color-bg réel du <main> in-game) : --color-text-secondary ≥4.5:1 (light+dark)", () => {
    useSoundSettingsControlMock.mockReturnValue(fakeControl({ soundEnabled: false }));
    render(<SoundQuickMute />);
    const el = screen.getByRole("switch", { name: s.soundOff }) as HTMLElement;
    expect(el.style.backgroundColor).toBe("transparent");
    expect(el.style.color).toBe("var(--color-text-secondary)");
    for (const theme of THEMES) {
      const text = resolveTokenColor(theme, "color-text-secondary");
      // Fond DOM RÉELLEMENT empilé derrière ce glyphe (rétro #125) : `SoundQuickMute` est monté
      // dans `<main className="bg-bg text-text">` (PlayScreen.tsx, `PlayingGame`) → `--color-bg`
      // (alias `--color-bg-primary`, `app/globals.css`), jamais un fond de carte/card arbitraire.
      const bg = resolveTokenColor(theme, "color-bg-primary");
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("état ON musique (même paire de tokens, glyphe DISTINCT — testé séparément, rétro #125 : deux glyphes = deux tests)", () => {
    useSoundSettingsControlMock.mockReturnValue(fakeControl({ musicEnabled: true }));
    render(<SoundQuickMute />);
    const el = screen.getByRole("switch", { name: s.musicOn }) as HTMLElement;
    expect(el.style.backgroundColor).toBe("var(--color-accent-primary)");
    expect(el.style.color).toBe("var(--color-text-inverse)");
  });

  it("état OFF musique (glyphe DISTINCT du son OFF — testé séparément, rétro #125)", () => {
    useSoundSettingsControlMock.mockReturnValue(fakeControl({ musicEnabled: false }));
    render(<SoundQuickMute />);
    const el = screen.getByRole("switch", { name: s.musicOff }) as HTMLElement;
    expect(el.style.backgroundColor).toBe("transparent");
    expect(el.style.color).toBe("var(--color-text-secondary)");
  });
});
