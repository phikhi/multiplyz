"use client";

import type { CSSProperties } from "react";
import { strings } from "@/strings";
import { useSoundSettingsControl } from "@/lib/sound/sound-settings-control";

// Glyphes décoratifs (aria-hidden) — react/jsx-no-literals : aucun littéral rendu en JSX. Mêmes
// glyphes que `SettingsForm.tsx` (écran parent, story 7.3/8.3) : cohérence visuelle inter-écrans,
// forme DISTINCTE par état (pas la seule couleur, a11y daltonisme #125/#239).
const SWITCH_ON = "◉";
const SWITCH_OFF = "○";

const s = strings.play.soundQuickMute;

const groupStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2)",
};

// Tap-target ≥44px (`--tap-target-min`), tokens only — AUCUNE animation/transition posée (rien à
// dégrader sous `prefers-reduced-motion` : le contrôle ne bouge jamais, seul son état visuel
// change instantanément au clic, cf. AC #282).
const switchBase: CSSProperties = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-2) var(--space-4)",
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)",
  borderRadius: "var(--border-radius-full)",
  cursor: "pointer",
};

// État ON : fond accent PLEIN → `--color-text-inverse` est correctement posé sur un fond accent
// plein (jamais un fond neutre, piège récidivant #94→#102/#104 documenté CLAUDE.md). Même patron
// que `SettingsForm.tsx` `switchOnStyle` / `ResultsScreen` bouton « Continuer ».
const switchOnStyle: CSSProperties = {
  ...switchBase,
  color: "var(--color-text-inverse)",
  backgroundColor: "var(--color-accent-primary)",
  border: "1px solid var(--color-accent-primary)",
};

// État OFF : registre neutre « fantôme », AUCUNE `opacity` (rétro #226) — texte plein-alpha
// `--color-text-secondary` sur fond transparent (résout au fond DOM réel empilé derrière, ici
// `--color-bg` du `<main>` hôte, cf. `SoundQuickMute.test.tsx`). Même patron que `LogoutButton`,
// rendu dans le MÊME `<main className="bg-bg text-text">` (rétro #125 : le fond de référence est
// celui réellement empilé, pas celui d'un composant frère).
const switchOffStyle: CSSProperties = {
  ...switchBase,
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-primary)",
};

/**
 * **Quick-mute enfant NO-PIN** (story 8.6, #282, DETAILS §3 « accès enfant, rapide, sans PIN :
 * son on/off, musique on/off », ADR 0017). Contrôle **calme, non intrusif**, rendu EN FLUX (aucun
 * `position`) dans le flex column existant de `PlayingGame` (à côté de `LogoutButton`, même
 * patron) — non-occlusion **structurelle** (CLAUDE.md, extension #170/#190/#278 : préférée à une
 * non-occlusion gardée par overlay + `boundingClientRect`, un élément en flux ne peut PAS occulter
 * ni relocaliser un bug par construction).
 *
 * **Volume ABSENT** (délibéré, ADR 0017) : seulement 2 boutons on/off, jamais un curseur de
 * volume — le réglage fin reste **parent** (écran Réglages, PIN).
 *
 * **EN SESSION (story 8.6)** : consomme `useSoundSettingsControl()` (fourni par `PlayScreen`, qui
 * détient l'état `SoundSettings` CLIENT). Le clic met à jour cet état OPTIMISTE immédiatement
 * (`setSoundEnabled`/`setMusicEnabled`) — répercuté SANS reload à `SoundProvider` (prop `settings`
 * qui redescend), qui coupe/relance le moteur EN SESSION (cf. JSDoc `SoundProvider.tsx`) — PUIS
 * persiste côté serveur (fire-and-forget, no-fail : une erreur réseau ne bloque jamais l'enfant,
 * cohérent avec `submitAttemptAction`/`jouer/actions.ts`).
 *
 * `control === null` (hors `PlayScreen`, jamais atteint en prod — `PlayScreen` fournit TOUJOURS ce
 * contexte, même patron que `SoundProvider`/`NOOP_SOUND_API`) → rend `null` silencieusement,
 * jamais de throw.
 */
export function SoundQuickMute() {
  const control = useSoundSettingsControl();
  if (control === null) return null;

  const { soundEnabled, musicEnabled, setSoundEnabled, setMusicEnabled } = control;

  return (
    <div role="group" aria-label={s.legend} style={groupStyle}>
      <button
        type="button"
        role="switch"
        aria-checked={soundEnabled}
        className="mz-focusable"
        onClick={() => setSoundEnabled(!soundEnabled)}
        style={soundEnabled ? switchOnStyle : switchOffStyle}
      >
        <span aria-hidden="true">{soundEnabled ? SWITCH_ON : SWITCH_OFF}</span>
        {soundEnabled ? s.soundOn : s.soundOff}
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={musicEnabled}
        className="mz-focusable"
        onClick={() => setMusicEnabled(!musicEnabled)}
        style={musicEnabled ? switchOnStyle : switchOffStyle}
      >
        <span aria-hidden="true">{musicEnabled ? SWITCH_ON : SWITCH_OFF}</span>
        {musicEnabled ? s.musicOn : s.musicOff}
      </button>
    </div>
  );
}
