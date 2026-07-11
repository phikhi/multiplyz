"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import { PIN_LENGTH, RECOVERY_CODE_LENGTH, isValidRecoveryCodeFormat } from "@/lib/auth/validation";
import { PinPad } from "@/components/PinPad";
import { resetParentPinAction, verifyRecoveryCodeAction } from "./actions";
import type { RecoveryErrorCode } from "@/lib/auth/recovery";

/**
 * Flow de récupération du PIN parent (AUTH.md §5). Assistant parent : code de
 * secours → nouveau PIN parent → nouveau code de secours (affiché une fois).
 * Le **serveur reste la source de vérité** (les actions vérifient, rate-limitent,
 * valident, régénèrent) ; le gating client n'est qu'une affordance. Registre
 * **neutre** (parent, pas la voix de Teddy). Tokens uniquement, cibles ≥ 44 px.
 */
type Step = "code" | "newPin" | "done";
/** Code d'erreur affichable : ceux du serveur + un repli réseau. */
type FlowErrorCode = RecoveryErrorCode | "GENERIC";

const WARN_ICON = "⚠️";
const NONE = "";

const cardStyle = {
  maxWidth: "var(--max-width-play)",
  width: "100%",
  margin: "0 auto",
  padding: "var(--space-6)",
  backgroundColor: "var(--card-bg)",
  borderRadius: "var(--card-radius)",
  boxShadow: "var(--card-shadow)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-5)",
} as const;

// Titre focus-managé (`ref` + `tabIndex={-1}` + `.focus()` au montage → annonce lecteur d'écran,
// chaque étape). `outline:"none"` **documenté** (STACK-TRAP #222, rétro 7.1/7.5/7.9) : le focus
// est programmatique, hors ordre clavier → l'anneau UA natif serait un artefact full-width sans
// valeur a11y. Pas `mz-focusable` (ne stylise que `:focus-visible`, non matché par un focus
// programmatique).
const titleStyle = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
  textAlign: "center",
  outline: "none",
} as const;

const introStyle = {
  margin: 0,
  textAlign: "center",
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-family-body)",
} as const;

const primaryButtonStyle = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3) var(--space-6)",
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-inverse)",
  backgroundColor: "var(--color-accent-primary)",
  border: "none",
  borderRadius: "var(--border-radius-full)",
  cursor: "pointer",
} as const;

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

const errorStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-2)",
  margin: 0,
  padding: "var(--space-3) var(--space-4)",
  backgroundColor: "var(--color-status-warning)",
  color: "var(--color-on-warning)",
  borderRadius: "var(--border-radius-md)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)",
} as const;

export function ParentRecoveryFlow() {
  const router = useRouter();
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState(NONE);
  const [newPin, setNewPin] = useState(NONE);
  const [error, setError] = useState<FlowErrorCode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [newRecoveryCode, setNewRecoveryCode] = useState(NONE);

  const canVerify = isValidRecoveryCodeFormat(code);
  const canSubmitPin = newPin.length === PIN_LENGTH;

  const verifyCode = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await verifyRecoveryCodeAction(code);
      if (result.ok) {
        setNewPin(NONE);
        setStep("newPin");
        return;
      }
      setError("CODE_INVALID");
    } catch {
      setError("GENERIC");
    } finally {
      setSubmitting(false);
    }
  };

  const submitNewPin = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await resetParentPinAction(code, newPin);
      if (result.ok) {
        setNewRecoveryCode(result.recoveryCode);
        setStep("done");
        return;
      }
      // Code invalidé entre-temps (rate-limit) → retour à l'étape code.
      setError(result.code);
      if (result.code === "CODE_INVALID") setStep("code");
    } catch {
      setError("GENERIC");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="bg-bg text-text" style={{ minHeight: "100dvh", padding: "var(--space-6)" }}>
      <div style={cardStyle}>
        {error !== null && (
          <p role="alert" style={errorStyle}>
            <span aria-hidden="true">{WARN_ICON}</span>
            {strings.recovery.errors[error]}
          </p>
        )}

        {step === "code" && (
          <>
            <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
              {strings.recovery.title}
            </h1>
            <p style={introStyle}>{strings.recovery.intro}</p>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <span style={{ fontWeight: "var(--font-weight-semibold)" }}>
                {strings.recovery.codeLabel}
              </span>
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                value={code}
                maxLength={RECOVERY_CODE_LENGTH}
                placeholder={strings.recovery.codePlaceholder}
                onChange={(event) => {
                  setError(null); // efface le bandeau d'erreur dès que le parent réédite
                  setCode(event.target.value);
                }}
                style={{
                  minHeight: "var(--tap-target-min)",
                  padding: "var(--space-3) var(--space-4)",
                  fontSize: "var(--font-size-md)",
                  fontFamily: "var(--font-family-mono)",
                  letterSpacing: "var(--letter-spacing-wide)",
                  textTransform: "uppercase",
                  color: "var(--color-text-primary)",
                  backgroundColor: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "var(--border-radius-md)",
                }}
              />
            </label>
            <button
              type="button"
              className="mz-focusable"
              disabled={!canVerify || submitting}
              onClick={verifyCode}
              style={primaryStyle(!canVerify || submitting)}
            >
              {submitting ? strings.recovery.verifying : strings.recovery.verify}
            </button>
          </>
        )}

        {step === "newPin" && (
          <>
            <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
              {strings.recovery.newPinTitle}
            </h1>
            <p style={introStyle}>{strings.recovery.newPinHint}</p>
            <PinPad value={newPin} onChange={setNewPin} label={strings.recovery.pinLabel} />
            <div
              style={{ display: "flex", gap: "var(--space-3)", justifyContent: "space-between" }}
            >
              <button
                type="button"
                className="mz-focusable"
                onClick={() => {
                  setError(null);
                  setStep("code");
                }}
                style={ghostButtonStyle}
              >
                {strings.recovery.back}
              </button>
              <button
                type="button"
                className="mz-focusable"
                disabled={!canSubmitPin || submitting}
                onClick={submitNewPin}
                style={primaryStyle(!canSubmitPin || submitting)}
              >
                {submitting ? strings.recovery.submitting : strings.recovery.submit}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
              {strings.recovery.done.title}
            </h1>
            <p style={introStyle}>{strings.recovery.done.intro}</p>
            <p
              role="status"
              style={{
                margin: 0,
                textAlign: "center",
                fontFamily: "var(--font-family-mono)",
                fontSize: "var(--font-size-2xl)",
                fontWeight: "var(--font-weight-bold)",
                letterSpacing: "var(--letter-spacing-wide)",
                color: "var(--color-text-primary)",
              }}
            >
              {newRecoveryCode}
            </p>
            <button
              type="button"
              className="mz-focusable"
              onClick={() => router.push("/")}
              style={primaryButtonStyle}
            >
              {strings.recovery.done.cta}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
