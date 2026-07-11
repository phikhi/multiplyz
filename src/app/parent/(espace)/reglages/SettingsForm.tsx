"use client";

import { useCallback, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import type {
  HouseholdSettings,
  HouseholdSettingsPatch,
  ThemePreference,
} from "@/lib/parent/settings";
import { requestRecalibrationAction, saveSettingsAction } from "./actions";

/**
 * Écran **« Réglages »** (story 7.3, DETAILS §3/§25-32 liste VERROUILLÉE, WIREFRAMES §7 ; son/
 * musique/volume ajoutés story 8.3, DETAILS §22). Rendu sous garde de session parent
 * (`(espace)/layout.tsx`) ; le **serveur reste la source de vérité** (`saveSettingsAction`
 * re-vérifie la session + valide + upsert). Registre **neutre/vouvoiement** (COPY §5, pas Teddy).
 * Auto-save par contrôle. Tokens uniquement, cibles ≥ 44 px, feedback **doublé d'icône**
 * (daltonisme), strings centralisées.
 *
 * **Ce qui AGIT** : le thème s'applique **immédiatement** (`data-theme` sur `<html>`, cohérent avec
 * `app/layout.tsx` côté serveur) ; la validation des mondes persiste et pilote le worker (6.5).
 * **Ce qui est STOCKÉ seulement (7.8 #229)** : le temps d'écran (nudge + verrou dur) — persisté ici,
 * **jamais enforcé** en 7.3. **Ce qui est STOCKÉ seulement (8.4, #155)** : son/musique/volume —
 * **contrat déclaré + validé + persisté ici**, le moteur audio réel (lecture/coupure effective) est
 * consommé en **story 8.4**, jamais « agit » avant ce câblage.
 */
export interface SettingsFormProps {
  /** Réglages effectifs du foyer (servis par la page serveur). */
  settings: HouseholdSettings;
  /** Options (min) du nudge doux, calculées serveur depuis les bornes ⚙️ + la valeur courante. */
  nudgeOptions: number[];
  /** Options (min/jour) du verrou dur, calculées serveur depuis les bornes ⚙️ + la valeur courante. */
  hardLockOptions: number[];
  /** Options (%) du volume, calculées serveur depuis les bornes fixes `[0,100]` + la valeur courante. */
  volumeOptions: number[];
}

// Glyphes décoratifs (aria-hidden) — react/jsx-no-literals : aucun littéral rendu en JSX.
const CHECK_ICON = "✓";
const WARN_ICON = "⚠️";
const SWITCH_ON = "◉";
const SWITCH_OFF = "○";
const RECAL_ICON = "🔄";

type FeedbackKind = "success" | "error";
/** Codes affichables : validation serveur + session + repli réseau. */
type ErrorCode = keyof typeof strings.parent.settings.errors;

const s = strings.parent.settings;

/**
 * Applique la préférence de thème **immédiatement** côté client (`data-theme` sur `<html>`) : même
 * **mécanisme** (`data-theme` + `tokens.css`) que `app/layout.tsx` côté serveur, mais **composant
 * distinct** de `ThemeToggle` (toggle binaire dev-only de `/styleguide`, inadapté aux 3 états
 * système/clair/sombre → réécrit ici sans l'importer). `system` → retire l'attribut (le média-query
 * `prefers-color-scheme` de `tokens.css` décide) ; `light`/`dark` → pose l'attribut (force le thème).
 * Le serveur re-stampe la même valeur au prochain rendu (persisté).
 */
function applyThemePreference(theme: ThemePreference): void {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

const mainStyle: CSSProperties = {
  minHeight: "100dvh",
  padding: "var(--space-6)",
};

const cardStyle: CSSProperties = {
  maxWidth: "var(--max-width-play)",
  width: "100%",
  margin: "0 auto",
  padding: "var(--space-6)",
  backgroundColor: "var(--card-bg)",
  borderRadius: "var(--card-radius)",
  boxShadow: "var(--card-shadow)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-6)",
};

// Titre focus-managé (`ref` + `tabIndex={-1}` + `.focus()` au montage → annonce lecteur d'écran).
// `outline:"none"` **documenté** (STACK-TRAP #222, rétro 7.1) : focus programmatique hors ordre
// clavier → l'anneau UA natif serait un artefact full-width sans valeur a11y. Pas `mz-focusable`.
const titleStyle: CSSProperties = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
  outline: "none",
};

const introStyle: CSSProperties = {
  margin: 0,
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
};

const fieldsetStyle: CSSProperties = {
  border: "none",
  margin: 0,
  padding: 0,
  minInlineSize: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
};

const legendStyle: CSSProperties = {
  padding: 0,
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
};

const hintStyle: CSSProperties = {
  margin: 0,
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-sm)",
};

const segmentRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-3)",
};

const segmentBase: CSSProperties = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3) var(--space-5)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)",
  borderRadius: "var(--border-radius-full)",
  cursor: "pointer",
};

// Segment **non sélectionné** = registre neutre « fantôme » : texte plein-alpha `--color-text-secondary`
// sur `--card-bg` (≥ 4.5:1 résolu, testé) + bordure. Aucune `opacity` (rétro #226).
const segmentStyle: CSSProperties = {
  ...segmentBase,
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-primary)",
};

// Segment **sélectionné** = accent plein + texte inverse (contraste résolu testé), même patron que
// les boutons primaires (ProfileManager). L'état est doublé par `aria-pressed` (a11y non-couleur).
const segmentSelectedStyle: CSSProperties = {
  ...segmentBase,
  fontFamily: "var(--font-family-display)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-inverse)",
  backgroundColor: "var(--color-accent-primary)",
  border: "1px solid var(--color-accent-primary)",
};

const switchBase: CSSProperties = {
  ...segmentBase,
  alignSelf: "flex-start",
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

const switchOnStyle: CSSProperties = {
  ...switchBase,
  fontFamily: "var(--font-family-display)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-inverse)",
  backgroundColor: "var(--color-accent-primary)",
  border: "1px solid var(--color-accent-primary)",
};

const switchOffStyle: CSSProperties = {
  ...switchBase,
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-primary)",
};

const selectLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const selectLabelTextStyle: CSSProperties = {
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-primary)",
};

const selectStyle: CSSProperties = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3) var(--space-4)",
  fontSize: "var(--font-size-md)",
  fontFamily: "var(--font-family-body)",
  color: "var(--color-text-primary)",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-md)",
};

// Valeur de langue grisée (FR seule) : texte plein-alpha `--color-text-secondary` (≥ 4.5:1, testé),
// jamais une `opacity` (rétro #226) — le « grisé » vient de la couleur token + de la consigne.
const languageValueStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-secondary)",
};

const warningBoxStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  margin: 0,
  padding: "var(--space-3) var(--space-4)",
  backgroundColor: "var(--color-status-warning)",
  color: "var(--color-on-warning)",
  borderRadius: "var(--border-radius-md)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)",
};

const successBoxStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  margin: 0,
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-primary)",
};

const backLinkStyle: CSSProperties = {
  ...segmentBase,
  alignSelf: "flex-start",
  display: "inline-flex",
  alignItems: "center",
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-primary)",
  textDecoration: "none",
};

// Rangée des boutons de la confirmation de recalibrage.
const recalibrateButtonsStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-3)",
  flexWrap: "wrap",
};

// Bouton d'ouverture « Recalibrer » (registre neutre « fantôme » : texte plein-alpha
// `--color-text-secondary` sur `--card-bg`, ≥ 4.5:1 résolu, aucune `opacity` — rétro #226).
const recalibrateActionStyle: CSSProperties = {
  ...segmentBase,
  alignSelf: "flex-start",
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-primary)",
};

// Bouton de CONFIRMATION = registre **amber** (warning), calme (COPY : jamais agressif) : texte
// constant `--color-on-warning` sur `--color-status-warning` (theme-safe, contraste résolu testé)
// + 🔄 doublé. Même patron que le bouton destructif de ProfileManager (registre warning apaisé).
const recalibrateConfirmStyle: CSSProperties = {
  ...segmentBase,
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  fontFamily: "var(--font-family-display)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-on-warning)",
  backgroundColor: "var(--color-status-warning)",
  border: "none",
};

// Bouton **Annuler** = ghost neutre (texte plein-alpha, aucune `opacity`).
const recalibrateCancelStyle: CSSProperties = {
  ...segmentBase,
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-primary)",
};

// État **en cours** (rétro Frontend #226) : registre neutre « inactif » **sans `opacity`** — un
// `opacity` sur le bouton compositerait le TEXTE vers le fond et le ferait tomber sous 4.5:1 (piège
// #170/#226 « token résolu ≠ pixel réellement peint »). On garde le texte **plein-alpha**
// (`--color-text-secondary` sur `--color-bg-tertiary`, contraste résolu ≥ 4.5:1 déjà prouvé
// ProfileManager) ; le signal « en cours » vient de `disabled`/`cursor:not-allowed` + fond atténué.
const recalibrateDisabledStyle: CSSProperties = {
  ...segmentBase,
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  color: "var(--color-text-secondary)",
  backgroundColor: "var(--color-bg-tertiary)",
  border: "1px solid var(--color-border-primary)",
  cursor: "not-allowed",
};

interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** Groupe de sélection unique (thème, validation des mondes) : boutons `aria-pressed`, légende native. */
function SegmentedField<T extends string>({
  legend,
  hint,
  options,
  value,
  pending,
  onSelect,
}: {
  legend: string;
  hint: string;
  options: SegmentOption<T>[];
  value: T;
  pending: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>{legend}</legend>
      <p style={hintStyle}>{hint}</p>
      <div style={segmentRowStyle}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              className="mz-focusable"
              aria-pressed={selected}
              disabled={pending}
              onClick={() => onSelect(option.value)}
              style={selected ? segmentSelectedStyle : segmentStyle}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Libellé d'une durée en minutes (gabarit `{min}`). */
function minutesLabel(minutes: number): string {
  return s.screenTime.minutesOption.replace("{min}", String(minutes));
}

/** Libellé d'un volume en pourcentage (gabarit `{volume}`, story 8.3). */
function volumeLabel(volume: number): string {
  return s.sound.volumeOption.replace("{volume}", String(volume));
}

export function SettingsForm({
  settings,
  nudgeOptions,
  hardLockOptions,
  volumeOptions,
}: SettingsFormProps) {
  const router = useRouter();
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);
  // Focus **au montage** du panneau de confirmation de recalibrage (rendu conditionnel) : le bouton
  // « Recalibrer » cliqué démonte → le focus retombe sur `<body>` (clavier/SR perdus). On déplace le
  // focus sur **Annuler** (choix sûr par défaut, comme ProfileManager). Ref stable `useCallback` →
  // invoqué une seule fois par ouverture. Bouton nativement focusable → pas d'artefact d'outline #222.
  const recalibrateAnchorRef = useCallback((node: HTMLButtonElement | null) => {
    node?.focus();
  }, []);
  const [theme, setTheme] = useState<ThemePreference>(settings.theme);
  const [worldValidation, setWorldValidation] = useState(settings.parentWorldValidation);
  const [nudgeMinutes, setNudgeMinutes] = useState(settings.screenTimeNudgeMinutes);
  const [hardLockEnabled, setHardLockEnabled] = useState(settings.screenTimeHardLockEnabled);
  const [hardLockMinutes, setHardLockMinutes] = useState(settings.screenTimeHardLockMinutes);
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled);
  const [musicEnabled, setMusicEnabled] = useState(settings.musicEnabled);
  const [volume, setVolume] = useState(settings.volume);
  const [recalibrateConfirming, setRecalibrateConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; text: string } | null>(null);

  // Chaque `ErrorCode` est une clé de `s.errors` (contrat vérifié par `strings.test.ts`) → indexation
  // toujours définie, pas de repli `?? GENERIC` (branche morte non-testable, rétro #124/#143).
  const errorText = (code: ErrorCode) => s.errors[code];

  const runSave = async (patch: HouseholdSettingsPatch) => {
    setPending(true);
    setFeedback(null);
    try {
      const result = await saveSettingsAction(patch);
      if (result.ok) {
        setFeedback({ kind: "success", text: s.saved });
        router.refresh(); // le serveur re-lit les réglages (thème re-stampé app-wide)
      } else {
        setFeedback({ kind: "error", text: errorText(result.code) });
      }
    } catch {
      setFeedback({ kind: "error", text: errorText("GENERIC") });
    } finally {
      setPending(false);
    }
  };

  const onThemeSelect = (next: ThemePreference) => {
    setTheme(next);
    applyThemePreference(next); // effet IMMÉDIAT app-wide (data-theme)
    void runSave({ theme: next });
  };

  const onWorldValidationSelect = (next: boolean) => {
    setWorldValidation(next);
    void runSave({ parentWorldValidation: next });
  };

  const onNudgeChange = (minutes: number) => {
    setNudgeMinutes(minutes);
    void runSave({ screenTimeNudgeMinutes: minutes });
  };

  const onHardLockToggle = () => {
    const next = !hardLockEnabled;
    setHardLockEnabled(next);
    void runSave({ screenTimeHardLockEnabled: next });
  };

  const onHardLockChange = (minutes: number) => {
    setHardLockMinutes(minutes);
    void runSave({ screenTimeHardLockMinutes: minutes });
  };

  // Son/musique/volume (story 8.3) : STOCKÉ + validé seulement — même auto-save par contrôle que
  // le reste de l'écran, mais AUCUN effet audio immédiat (contrairement au thème) tant que le
  // moteur sonore (8.4) n'existe pas.
  const onSoundToggle = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    void runSave({ soundEnabled: next });
  };

  const onMusicToggle = () => {
    const next = !musicEnabled;
    setMusicEnabled(next);
    void runSave({ musicEnabled: next });
  };

  const onVolumeChange = (next: number) => {
    setVolume(next);
    void runSave({ volume: next });
  };

  // **Recalibrer** (story 7.6, ADR 0016) : action à CONFIRMER (destructive-douce). L'ouverture
  // n'arme rien — seul « Oui, recalibrer » appelle la server action (re-gardée session parent).
  const openRecalibrate = () => {
    setFeedback(null);
    setRecalibrateConfirming(true);
  };
  const cancelRecalibrate = () => {
    setRecalibrateConfirming(false);
  };
  const submitRecalibrate = async () => {
    setPending(true);
    setFeedback(null);
    try {
      const result = await requestRecalibrationAction();
      if (result.ok) {
        setRecalibrateConfirming(false);
        setFeedback({ kind: "success", text: s.recalibrate.success });
        router.refresh();
      } else {
        setFeedback({ kind: "error", text: errorText(result.code) });
      }
    } catch {
      setFeedback({ kind: "error", text: errorText("GENERIC") });
    } finally {
      setPending(false);
    }
  };

  const st = s.screenTime;
  const snd = s.sound;
  const rc = s.recalibrate;

  return (
    <main className="bg-bg text-text" style={mainStyle}>
      <div style={cardStyle}>
        <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
          {s.title}
        </h1>
        <p style={introStyle}>{s.intro}</p>

        {feedback !== null &&
          (feedback.kind === "success" ? (
            <p role="status" style={successBoxStyle}>
              <span aria-hidden="true">{CHECK_ICON}</span>
              {feedback.text}
            </p>
          ) : (
            <p role="alert" style={warningBoxStyle}>
              <span aria-hidden="true">{WARN_ICON}</span>
              {feedback.text}
            </p>
          ))}

        <SegmentedField<ThemePreference>
          legend={s.theme.legend}
          hint={s.theme.hint}
          value={theme}
          pending={pending}
          onSelect={onThemeSelect}
          options={[
            { value: "system", label: s.theme.system },
            { value: "light", label: s.theme.light },
            { value: "dark", label: s.theme.dark },
          ]}
        />

        <SegmentedField<"auto" | "parent">
          legend={s.worlds.legend}
          hint={s.worlds.hint}
          value={worldValidation ? "parent" : "auto"}
          pending={pending}
          onSelect={(v) => onWorldValidationSelect(v === "parent")}
          options={[
            { value: "auto", label: s.worlds.auto },
            { value: "parent", label: s.worlds.parent },
          ]}
        />

        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>{st.legend}</legend>
          <label style={selectLabelStyle}>
            <span style={selectLabelTextStyle}>{st.nudgeLabel}</span>
            <select
              value={nudgeMinutes}
              disabled={pending}
              onChange={(event) => onNudgeChange(Number(event.target.value))}
              style={selectStyle}
            >
              {nudgeOptions.map((option) => (
                <option key={option} value={option}>
                  {minutesLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <p style={hintStyle}>{st.nudgeHint}</p>

          <button
            type="button"
            role="switch"
            aria-checked={hardLockEnabled}
            className="mz-focusable"
            disabled={pending}
            onClick={onHardLockToggle}
            style={hardLockEnabled ? switchOnStyle : switchOffStyle}
          >
            <span aria-hidden="true">{hardLockEnabled ? SWITCH_ON : SWITCH_OFF}</span>
            {st.hardLockToggle}
          </button>
          <p style={hintStyle}>{st.hardLockHint}</p>

          {hardLockEnabled && (
            <label style={selectLabelStyle}>
              <span style={selectLabelTextStyle}>{st.hardLockLabel}</span>
              <select
                value={hardLockMinutes}
                disabled={pending}
                onChange={(event) => onHardLockChange(Number(event.target.value))}
                style={selectStyle}
              >
                {hardLockOptions.map((option) => (
                  <option key={option} value={option}>
                    {minutesLabel(option)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>

        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>{snd.legend}</legend>

          <button
            type="button"
            role="switch"
            aria-checked={soundEnabled}
            className="mz-focusable"
            disabled={pending}
            onClick={onSoundToggle}
            style={soundEnabled ? switchOnStyle : switchOffStyle}
          >
            <span aria-hidden="true">{soundEnabled ? SWITCH_ON : SWITCH_OFF}</span>
            {snd.soundToggle}
          </button>
          <p style={hintStyle}>{snd.soundHint}</p>

          <button
            type="button"
            role="switch"
            aria-checked={musicEnabled}
            className="mz-focusable"
            disabled={pending}
            onClick={onMusicToggle}
            style={musicEnabled ? switchOnStyle : switchOffStyle}
          >
            <span aria-hidden="true">{musicEnabled ? SWITCH_ON : SWITCH_OFF}</span>
            {snd.musicToggle}
          </button>
          <p style={hintStyle}>{snd.musicHint}</p>

          <label style={selectLabelStyle}>
            <span style={selectLabelTextStyle}>{snd.volumeLabel}</span>
            <select
              value={volume}
              disabled={pending}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
              style={selectStyle}
            >
              {volumeOptions.map((option) => (
                <option key={option} value={option}>
                  {volumeLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <p style={hintStyle}>{snd.volumeHint}</p>
        </fieldset>

        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>{rc.legend}</legend>
          <p style={hintStyle}>{rc.hint}</p>
          {recalibrateConfirming ? (
            <>
              {/* Corps de confirmation : styling warning + 🔄 doublé, mais PAS `role="alert"` (ce
                  n'est pas une erreur live-annoncée ; le vrai `role="alert"` est réservé au bandeau
                  de feedback en tête → évite deux régions alert concurrentes, cf. ProfileManager). */}
              <p style={warningBoxStyle}>
                <span aria-hidden="true">{WARN_ICON}</span>
                {rc.confirmBody}
              </p>
              <div style={recalibrateButtonsStyle}>
                <button
                  ref={recalibrateAnchorRef}
                  type="button"
                  className="mz-focusable"
                  onClick={cancelRecalibrate}
                  style={recalibrateCancelStyle}
                >
                  {rc.cancel}
                </button>
                <button
                  type="button"
                  className="mz-focusable"
                  disabled={pending}
                  onClick={() => void submitRecalibrate()}
                  style={pending ? recalibrateDisabledStyle : recalibrateConfirmStyle}
                >
                  <span aria-hidden="true">{RECAL_ICON}</span>
                  {rc.confirm}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="mz-focusable"
              disabled={pending}
              onClick={openRecalibrate}
              style={pending ? recalibrateDisabledStyle : recalibrateActionStyle}
            >
              <span aria-hidden="true">{RECAL_ICON}</span>
              {rc.action}
            </button>
          )}
        </fieldset>

        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>{s.language.legend}</legend>
          <p style={languageValueStyle}>{s.language.value}</p>
          <p style={hintStyle}>{s.language.hint}</p>
        </fieldset>

        <Link href="/parent" style={backLinkStyle} className="mz-focusable">
          {s.back}
        </Link>
      </div>
    </main>
  );
}
