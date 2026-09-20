"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import { parent as parentCopy } from "@/strings/parent";
import { daily } from "@/strings/daily";
import { AVATARS } from "@/config/avatars";
import { PIN_LENGTH } from "@/lib/auth/validation";
import type { PublicProfile } from "@/lib/auth/login";
import { PinPad } from "./PinPad";
import { loginAction } from "@/app/login/actions";
import { loginParentAction } from "@/app/parent/actions";

export interface ProfileSelectorProps {
  profiles: PublicProfile[];
  startParent?: boolean;
  currentProfile?: PublicProfile | null;
}
const avatar = (id: string) => AVATARS.find((a) => a.id === id)?.emoji ?? "";

/** Server-authorized return shortcut, with unchanged PIN gates for every other profile. */
export function ProfileSelector({
  profiles,
  currentProfile = null,
  startParent = false,
}: ProfileSelectorProps) {
  const { push } = useRouter();
  const [selected, setSelected] = useState<PublicProfile | null>(null);
  const [parentMode, setParentMode] = useState(startParent);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const focus = useCallback((node: HTMLHeadingElement | null) => node?.focus(), []);
  const reset = () => {
    if (inFlight.current) return;
    setSelected(null);
    setParentMode(false);
    setPin("");
    setError(false);
  };
  const openParent = () => {
    reset();
    setParentMode(true);
  };
  const changePin = async (next: string) => {
    if (inFlight.current) return;
    setPin(next);
    if (next.length !== PIN_LENGTH) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const result = parentMode
        ? await loginParentAction(next)
        : await loginAction(selected!.id, next);
      if (result.ok) {
        push(parentMode ? "/parent" : "/reprendre");
        return;
      }
      setError(true);
    } catch {
      setError(true);
    } finally {
      setPin("");
      setBusy(false);
      inFlight.current = false;
    }
  };
  const entering = selected !== null || parentMode;
  return (
    <main className="daily-main">
      <section className="daily-card" aria-busy={busy}>
        {entering ? (
          <>
            <p className="forest-kicker">{parentMode ? strings.parent.entry : selected!.name}</p>
            <h1 ref={focus} tabIndex={-1} key={parentMode ? "parent" : selected!.id}>
              {parentMode
                ? strings.parent.pinTitle
                : strings.login.pinTitle.replace("{prénom}", selected!.name)}
            </h1>
            {parentMode && <p>{startParent ? parentCopy.required : strings.parent.pinHint}</p>}
            {error && (
              <p className="daily-error" role="alert">
                {parentMode ? strings.parent.error : strings.login.error}
              </p>
            )}
            <PinPad
              value={pin}
              onChange={(next) => void changePin(next)}
              disabled={busy}
              label={parentMode ? strings.parent.pinLabel : strings.login.pinLabel}
            />
            <p className="daily-hint">
              {busy ? strings.login.checking : parentMode ? parentCopy.keyboard : daily.keyboard}
            </p>
            {!parentMode && <p className="daily-hint">{daily.forgottenChild}</p>}
            {parentMode && (
              <Link className="daily-link" href="/parent/recuperation">
                {strings.parent.forgot}
              </Link>
            )}
            <button className="forest-secondary" disabled={busy} onClick={reset}>
              {strings.login.back}
            </button>
          </>
        ) : (
          <>
            <h1 ref={focus} tabIndex={-1} key="profiles">
              {currentProfile ? daily.hello(currentProfile.name) : strings.login.title}
            </h1>
            {currentProfile && (
              <div className="daily-return">
                <span className="daily-avatar" aria-hidden="true">
                  {avatar(currentProfile.avatar)}
                </span>
                <p>{daily.resumeHint}</p>
                <Link href="/reprendre" className="forest-primary">
                  {daily.resume}
                </Link>
              </div>
            )}
            {currentProfile && <p className="daily-hint">{daily.other}</p>}
            <ul className="daily-profiles">
              {profiles.map((profile) => (
                <li key={profile.id}>
                  <button
                    className="daily-profile"
                    aria-label={strings.login.profileOption.replace("{prénom}", profile.name)}
                    onClick={() => {
                      setSelected(profile);
                      setPin("");
                      setError(false);
                    }}
                  >
                    <span aria-hidden="true" className="daily-avatar">
                      {avatar(profile.avatar)}
                    </span>
                    <span>{profile.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="daily-link"
              onClick={openParent}
              aria-label={strings.parent.entryLabel}
            >
              {strings.parent.entry}
            </button>
            <button className="daily-link daily-hint" onClick={openParent}>
              {daily.addProfile}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
