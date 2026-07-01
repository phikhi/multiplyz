"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import { AVATARS } from "@/config/avatars";
import { NAME_MAX_LENGTH, PIN_LENGTH } from "@/lib/auth/validation";
import { PinPad } from "@/components/PinPad";
import { createHouseholdAction } from "./actions";
import type { OnboardingErrorCode } from "@/lib/auth/household";

/**
 * Flow d'onboarding 1er usage (AUTH.md §2, PRODUCT.md §1.1, WIREFRAMES §1).
 * Assistant en étapes : profil → code enfant → code parent → code de secours →
 * prêt. Le **serveur reste la source de vérité** (la server action valide et
 * hache) ; le gating client n'est qu'une affordance. No-fail, voix de Teddy
 * côté enfant, registre neutre côté parent. Tokens uniquement, cibles ≥ 44 px.
 */

type Step = "profile" | "childPin" | "parentPin" | "recovery" | "ready";
/** Code d'erreur affichable : ceux du serveur + un repli réseau. */
type FlowErrorCode = OnboardingErrorCode | "GENERIC";

const WARN_ICON = "⚠️";
const NONE = "";

// Une erreur renvoie l'utilisateur à l'étape où il peut la corriger.
const ERROR_STEP: Record<FlowErrorCode, Step> = {
  NAME_INVALID: "profile",
  AVATAR_INVALID: "profile",
  NAME_TAKEN: "profile",
  PIN_INVALID: "parentPin",
  PARENT_PIN_SAME: "parentPin",
  GENERIC: "parentPin",
};

const cardStyle = {
  maxWidth: "var(--max-width-play)",
  margin: "0 auto",
  padding: "var(--space-6)",
  backgroundColor: "var(--card-bg)",
  borderRadius: "var(--card-radius)",
  boxShadow: "var(--card-shadow)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-5)",
} as const;

const titleStyle = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
  textAlign: "center",
} as const;

const primaryButtonStyle = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3) var(--space-6)",
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-bold)",
  // Texte-sur-accent : token qui suit le thème (accent foncé→blanc / clair→foncé),
  // même pattern que ThemeToggle. Reste lisible dans les 2 thèmes.
  color: "var(--color-text-inverse)",
  backgroundColor: "var(--color-accent-primary)",
  border: "none",
  borderRadius: "var(--border-radius-full)",
  cursor: "pointer",
} as const;

/** Style CTA + affordance désactivée (grisé + curseur), quand `disabled`. */
function primaryStyle(disabled: boolean) {
  return {
    ...primaryButtonStyle,
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const ghostButtonStyle = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3) var(--space-5)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-full)",
  cursor: "pointer",
} as const;

export function OnboardingFlow() {
  const router = useRouter();
  // Gestion du focus a11y : chaque étape monte un nouveau titre ; ce ref-callback
  // y place le focus à son montage → l'utilisateur clavier/lecteur d'écran suit
  // le changement d'étape (et n'atterrit pas sur <body>). Au démontage `node=null`.
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);
  const [step, setStep] = useState<Step>("profile");
  const [name, setName] = useState(NONE);
  const [avatar, setAvatar] = useState(NONE);
  const [childPin, setChildPin] = useState(NONE);
  const [parentPin, setParentPin] = useState(NONE);
  const [error, setError] = useState<FlowErrorCode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState(NONE);

  const goto = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const canContinueProfile = name.trim().length > 0 && avatar !== NONE;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await createHouseholdAction({ name, avatar, childPin, parentPin });
      if (!result.ok) {
        setError(result.code);
        setStep(ERROR_STEP[result.code]);
        return;
      }
      if ("recoveryCode" in result) {
        setRecoveryCode(result.recoveryCode);
        setStep("recovery");
        return;
      }
      // Foyer déjà configuré (rejeu idempotent) : rien à noter, on termine.
      setStep("ready");
    } catch {
      setError("GENERIC");
      setStep("parentPin");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main style={{ minHeight: "100dvh", padding: "var(--space-6)" }} className="bg-bg text-text">
      <div style={cardStyle}>
        {error !== null && (
          <p
            role="alert"
            style={{
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
            }}
          >
            <span aria-hidden="true">{WARN_ICON}</span>
            {strings.onboarding.errors[error]}
          </p>
        )}

        {step === "profile" && (
          <>
            <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
              {strings.onboarding.profile.title}
            </h1>
            <p style={{ textAlign: "center", margin: 0, color: "var(--color-text-secondary)" }}>
              {strings.onboarding.profile.intro}
            </p>

            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <span style={{ fontWeight: "var(--font-weight-semibold)" }}>
                {strings.onboarding.profile.nameLabel}
              </span>
              <input
                type="text"
                value={name}
                maxLength={NAME_MAX_LENGTH}
                placeholder={strings.onboarding.profile.namePlaceholder}
                onChange={(event) => setName(event.target.value)}
                style={{
                  minHeight: "var(--tap-target-min)",
                  padding: "var(--space-3) var(--space-4)",
                  fontSize: "var(--font-size-md)",
                  fontFamily: "var(--font-family-body)",
                  color: "var(--color-text-primary)",
                  backgroundColor: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--border-radius-md)",
                }}
              />
            </label>

            <div
              role="group"
              aria-label={strings.onboarding.profile.avatarLabel}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-3)",
                justifyContent: "center",
              }}
            >
              {AVATARS.map((option) => {
                const selected = option.id === avatar;
                // Chaque id d'AVATARS a un libellé (invariant vérifié en test).
                const avatarName =
                  strings.onboarding.profile.avatarNames[
                    option.id as keyof typeof strings.onboarding.profile.avatarNames
                  ];
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    aria-label={strings.onboarding.profile.avatarOption.replace(
                      "{nom}",
                      avatarName,
                    )}
                    onClick={() => setAvatar(option.id)}
                    style={{
                      minWidth: "var(--tap-target-min)",
                      minHeight: "var(--tap-target-min)",
                      fontSize: "var(--font-size-2xl)",
                      cursor: "pointer",
                      borderRadius: "var(--border-radius-md)",
                      backgroundColor: "var(--color-bg-secondary)",
                      border: selected
                        ? "3px solid var(--color-accent-primary)"
                        : "1px solid var(--color-border-primary)",
                    }}
                  >
                    {option.emoji}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={!canContinueProfile}
              onClick={() => goto("childPin")}
              style={primaryStyle(!canContinueProfile)}
            >
              {strings.onboarding.nav.next}
            </button>
          </>
        )}

        {step === "childPin" && (
          <>
            <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
              {strings.onboarding.childPin.title}
            </h1>
            <p style={{ textAlign: "center", margin: 0, color: "var(--color-text-secondary)" }}>
              {strings.onboarding.childPin.hint}
            </p>
            <PinPad
              value={childPin}
              onChange={setChildPin}
              label={strings.onboarding.childPin.title}
            />
            <div
              style={{ display: "flex", gap: "var(--space-3)", justifyContent: "space-between" }}
            >
              <button type="button" onClick={() => goto("profile")} style={ghostButtonStyle}>
                {strings.onboarding.nav.back}
              </button>
              <button
                type="button"
                disabled={childPin.length !== PIN_LENGTH}
                onClick={() => goto("parentPin")}
                style={primaryStyle(childPin.length !== PIN_LENGTH)}
              >
                {strings.onboarding.nav.next}
              </button>
            </div>
          </>
        )}

        {step === "parentPin" && (
          <>
            <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
              {strings.onboarding.parentPin.title}
            </h1>
            <p style={{ textAlign: "center", margin: 0, color: "var(--color-text-secondary)" }}>
              {strings.onboarding.parentPin.hint}
            </p>
            <p
              style={{
                margin: 0,
                color: "var(--color-text-secondary)",
                fontSize: "var(--font-size-sm)",
              }}
            >
              {strings.onboarding.parentPin.method.replace("{prénom}", name)}
            </p>
            <PinPad
              value={parentPin}
              onChange={setParentPin}
              label={strings.onboarding.parentPin.title}
            />
            <div
              style={{ display: "flex", gap: "var(--space-3)", justifyContent: "space-between" }}
            >
              <button type="button" onClick={() => goto("childPin")} style={ghostButtonStyle}>
                {strings.onboarding.nav.back}
              </button>
              <button
                type="button"
                disabled={parentPin.length !== PIN_LENGTH || submitting}
                onClick={submit}
                style={primaryStyle(parentPin.length !== PIN_LENGTH || submitting)}
              >
                {submitting ? strings.onboarding.nav.creating : strings.onboarding.nav.create}
              </button>
            </div>
          </>
        )}

        {step === "recovery" && (
          <>
            <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
              {strings.onboarding.recovery.title}
            </h1>
            <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
              {strings.onboarding.recovery.intro}
            </p>
            {/* role=status : le code à usage unique est annoncé aux lecteurs
                d'écran dès l'affichage (ne pas le rater). */}
            <p
              role="status"
              style={{
                textAlign: "center",
                fontFamily: "var(--font-family-display)",
                fontSize: "var(--font-size-3xl)",
                fontWeight: "var(--font-weight-bold)",
                letterSpacing: "var(--letter-spacing-wide)",
                color: "var(--color-accent-primary)",
                margin: 0,
              }}
            >
              {recoveryCode}
            </p>
            <button type="button" onClick={() => goto("ready")} style={primaryButtonStyle}>
              {strings.onboarding.recovery.done}
            </button>
          </>
        )}

        {step === "ready" && (
          <>
            <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
              {strings.onboarding.ready.title}
            </h1>
            <button type="button" onClick={() => router.refresh()} style={primaryButtonStyle}>
              {strings.onboarding.ready.cta}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
