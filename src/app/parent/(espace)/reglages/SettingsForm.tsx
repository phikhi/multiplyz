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
import { saveSettingsAction } from "./actions";

/**
 * Écran **« Réglages »** (story 7.3, DETAILS §3/§25-32 liste VERROUILLÉE, WIREFRAMES §7). Rendu sous
 * garde de session parent (`(espace)/layout.tsx`) ; le **serveur reste la source de vérité**
 * (`saveSettingsAction` re-vérifie la session + valide + upsert). Registre **neutre/vouvoiement**
 * (COPY §5, pas Teddy). Auto-save par contrôle. Tokens uniquement, cibles ≥ 44 px, feedback
 * **doublé d'icône** (daltonisme), strings centralisées.
 *
 * **Ce qui AGIT** : le thème s'applique **immédiatement** (`data-theme` sur `<html>`, cohérent avec
 * `app/layout.tsx` côté serveur) ; la validation des mondes persiste et pilote le worker (6.5).
 * **Ce qui est STOCKÉ seulement (7.8 #229)** : le temps d'écran (nudge + verrou dur) — persisté ici,
 * **jamais enforcé** en 7.3.
 */
export interface SettingsFormProps {
  /** Réglages effectifs du foyer (servis par la page serveur). */
  settings: HouseholdSettings;
  /** Options (min) du nudge doux, calculées serveur depuis les bornes ⚙️ + la valeur courante. */
  nudgeOptions: number[];
  /** Options (min/jour) du verrou dur, calculées serveur depuis les bornes ⚙️ + la valeur courante. */
  hardLockOptions: number[];
}

// Glyphes décoratifs (aria-hidden) — react/jsx-no-literals : aucun littéral rendu en JSX.
const CHECK_ICON = "✓";
const WARN_ICON = "⚠️";
const SWITCH_ON = "◉";
const SWITCH_OFF = "○";

type FeedbackKind = "success" | "error";
/** Codes affichables : validation serveur + session + repli réseau. */
type ErrorCode = keyof typeof strings.parent.settings.errors;

const s = strings.parent.settings;

/**
 * Applique la préférence de thème **immédiatement** côté client (`data-theme` sur `<html>`, même
 * mécanisme que `app/layout.tsx` côté serveur + l'ancien `ThemeToggle`). `system` → retire
 * l'attribut (le média-query `prefers-color-scheme` de `tokens.css` décide) ; `light`/`dark` →
 * pose l'attribut (force le thème). Le serveur re-stampe la même valeur au prochain rendu (persisté).
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

export function SettingsForm({ settings, nudgeOptions, hardLockOptions }: SettingsFormProps) {
  const router = useRouter();
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);
  const [theme, setTheme] = useState<ThemePreference>(settings.theme);
  const [worldValidation, setWorldValidation] = useState(settings.parentWorldValidation);
  const [nudgeMinutes, setNudgeMinutes] = useState(settings.screenTimeNudgeMinutes);
  const [hardLockEnabled, setHardLockEnabled] = useState(settings.screenTimeHardLockEnabled);
  const [hardLockMinutes, setHardLockMinutes] = useState(settings.screenTimeHardLockMinutes);
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

  const st = s.screenTime;

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
