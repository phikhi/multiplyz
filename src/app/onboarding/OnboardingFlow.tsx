"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import { daily } from "@/strings/daily";
import { AVATARS } from "@/config/avatars";
import { NAME_MAX_LENGTH, PIN_LENGTH } from "@/lib/auth/validation";
import { PinPad } from "@/components/PinPad";
import { createHouseholdAction } from "./actions";
import type { OnboardingErrorCode } from "@/lib/auth/household";

type Step =
  "profile" | "childPin" | "confirmChild" | "parentPin" | "confirmParent" | "recovery" | "ready";
const ordinal: Record<Step, number> = {
  profile: 1,
  childPin: 2,
  confirmChild: 2,
  parentPin: 3,
  confirmParent: 3,
  recovery: 4,
  ready: 4,
};
const errorStep: Record<OnboardingErrorCode, Step> = {
  NAME_INVALID: "profile",
  AVATAR_INVALID: "profile",
  NAME_TAKEN: "profile",
  PIN_INVALID: "parentPin",
  PARENT_PIN_SAME: "parentPin",
};

/** First household setup; existing validation, hashing and ownership rules stay on the server. */
export function OnboardingFlow() {
  const { refresh } = useRouter();
  const [step, setStep] = useState<Step>("profile");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [childPin, setChildPin] = useState("");
  const [parentPin, setParentPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [kept, setKept] = useState(false);
  const [already, setAlready] = useState(false);
  const inFlight = useRef(false);
  const focus = useCallback((node: HTMLHeadingElement | null) => node?.focus(), []);
  const go = (next: Step) => {
    if (inFlight.current) return;
    setError(null);
    setConfirmation("");
    setStep(next);
  };
  const submit = async () => {
    if (inFlight.current) return;
    if (confirmation !== parentPin) {
      setError(daily.mismatch);
      setConfirmation("");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await createHouseholdAction({ name, avatar, childPin, parentPin });
      if (!result.ok) {
        setError(strings.onboarding.errors[result.code]);
        setStep(errorStep[result.code]);
        setConfirmation("");
        return;
      }
      setChildPin("");
      setParentPin("");
      setConfirmation("");
      if ("recoveryCode" in result) {
        setRecovery(result.recoveryCode);
        setStep("recovery");
      } else {
        setAlready(true);
        setStep("ready");
      }
    } catch {
      setError(strings.onboarding.errors.GENERIC);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const titles: Record<Step, string> = {
    profile: strings.onboarding.profile.title,
    childPin: strings.onboarding.childPin.title,
    confirmChild: daily.confirmChild,
    parentPin: strings.onboarding.parentPin.title,
    confirmParent: daily.confirmParent,
    recovery: strings.onboarding.recovery.title,
    ready: strings.onboarding.ready.title,
  };
  return (
    <main className="daily-main">
      <section className="daily-card" aria-busy={busy}>
        <p className="forest-kicker">{daily.setupStep(ordinal[step])}</p>
        <h1 ref={focus} tabIndex={-1} key={step}>
          {titles[step]}
        </h1>
        {error && (
          <p className="daily-error" role="alert">
            {error}
          </p>
        )}
        {step === "profile" && (
          <>
            <p>{strings.onboarding.profile.intro}</p>
            <label className="daily-field">
              <span>{strings.onboarding.profile.nameLabel}</span>
              <input
                autoComplete="given-name"
                value={name}
                maxLength={NAME_MAX_LENGTH}
                onChange={(event) => setName(event.target.value)}
                placeholder={strings.onboarding.profile.namePlaceholder}
              />
            </label>
            <p id="avatar-label">{strings.onboarding.profile.avatarLabel}</p>
            <div className="daily-avatars" role="group" aria-labelledby="avatar-label">
              {AVATARS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={option.id === avatar}
                  className="daily-profile"
                  aria-label={strings.onboarding.profile.avatarOption.replace(
                    "{nom}",
                    strings.onboarding.profile.avatarNames[
                      option.id as keyof typeof strings.onboarding.profile.avatarNames
                    ],
                  )}
                  onClick={() => setAvatar(option.id)}
                >
                  {option.emoji}
                </button>
              ))}
            </div>
            <button
              className="forest-primary"
              disabled={!name.trim() || !avatar}
              onClick={() => go("childPin")}
            >
              {strings.onboarding.nav.next}
            </button>
          </>
        )}
        {(step === "childPin" || step === "parentPin") && (
          <>
            <p>
              {step === "childPin"
                ? strings.onboarding.childPin.hint
                : strings.onboarding.parentPin.hint}
            </p>
            {step === "parentPin" && (
              <p className="daily-hint">
                {strings.onboarding.parentPin.method.replace("{prénom}", name)}
              </p>
            )}
            <PinPad
              label={titles[step]}
              value={step === "childPin" ? childPin : parentPin}
              onChange={step === "childPin" ? setChildPin : setParentPin}
            />
            <div className="daily-actions">
              <button
                className="forest-secondary"
                onClick={() => go(step === "childPin" ? "profile" : "childPin")}
              >
                {strings.onboarding.nav.back}
              </button>
              <button
                className="forest-primary"
                disabled={(step === "childPin" ? childPin : parentPin).length !== PIN_LENGTH}
                onClick={() => go(step === "childPin" ? "confirmChild" : "confirmParent")}
              >
                {strings.onboarding.nav.next}
              </button>
            </div>
          </>
        )}
        {(step === "confirmChild" || step === "confirmParent") && (
          <>
            <p>{daily.confirmHint}</p>
            <PinPad
              label={titles[step]}
              value={confirmation}
              onChange={setConfirmation}
              disabled={busy}
            />
            <div className="daily-actions">
              <button
                className="forest-secondary"
                disabled={busy}
                onClick={() => go(step === "confirmChild" ? "childPin" : "parentPin")}
              >
                {strings.onboarding.nav.back}
              </button>
              <button
                className="forest-primary"
                disabled={busy || confirmation.length !== PIN_LENGTH}
                onClick={() => {
                  if (step === "confirmParent") {
                    void submit();
                    return;
                  }
                  if (confirmation !== childPin) {
                    setError(daily.mismatch);
                    setConfirmation("");
                    return;
                  }
                  go("parentPin");
                }}
              >
                {busy
                  ? strings.onboarding.nav.creating
                  : step === "confirmParent"
                    ? strings.onboarding.nav.create
                    : strings.onboarding.nav.next}
              </button>
            </div>
          </>
        )}
        {step === "recovery" && (
          <>
            <p>{strings.onboarding.recovery.intro}</p>
            <p role="status" className="daily-recovery">
              {recovery}
            </p>
            <label className="daily-check">
              <input
                type="checkbox"
                checked={kept}
                onChange={(event) => setKept(event.target.checked)}
              />
              {daily.recoveryChecked}
            </label>
            <button
              className="forest-primary"
              disabled={!kept}
              onClick={() => {
                setRecovery("");
                go("ready");
              }}
            >
              {strings.onboarding.recovery.done}
            </button>
          </>
        )}
        {step === "ready" && (
          <>
            <p>{already ? daily.configured : daily.readyHint}</p>
            <button className="forest-primary" onClick={refresh}>
              {strings.onboarding.ready.cta}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
