"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import { AVATARS } from "@/config/avatars";
import { PIN_LENGTH } from "@/lib/auth/validation";
import type { PublicProfile } from "@/lib/auth/login";
import { PinPad } from "@/components/PinPad";
import { loginAction } from "@/app/login/actions";

/**
 * Sélecteur de connexion (AUTH.md §2, WIREFRAMES §1). Deux temps : choisir son
 * profil dans la liste **servie par le serveur** (prénom + avatar, aucun secret)
 * → saisir le PIN. Le serveur reste la **source de vérité** (l'action vérifie et
 * ouvre la session) ; ce composant n'orchestre que l'UI. No-fail, voix de Teddy,
 * message d'échec **générique** (anti-énumération). Tokens uniquement, ≥ 44 px.
 */
export interface ProfileSelectorProps {
  /** Profils du foyer (projection publique servie par la page serveur). */
  profiles: PublicProfile[];
}

const WARN_ICON = "⚠️";
const NONE = "";

/** Remplace un jeton `{x}` par sa valeur (micro-interpolation des gabarits). */
function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

/** Emoji d'affichage d'un avatar par son id stable (placeholder ART). */
function avatarEmoji(id: string): string {
  return AVATARS.find((option) => option.id === id)?.emoji ?? NONE;
}

const mainStyle = {
  minHeight: "100dvh",
  padding: "var(--space-6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

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

const titleStyle = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
  textAlign: "center",
} as const;

const errorStyle = {
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
  textAlign: "center",
  justifyContent: "center",
} as const;

const profileCardStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--space-2)",
  minWidth: "var(--tap-target-min)",
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-4)",
  cursor: "pointer",
  borderRadius: "var(--border-radius-lg)",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-primary)",
  color: "var(--color-text-primary)",
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)",
} as const;

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

export function ProfileSelector({ profiles }: ProfileSelectorProps) {
  const router = useRouter();
  // Focus a11y : chaque étape monte un nouveau titre ; ce ref-callback y place le
  // focus à son montage → l'utilisateur clavier/lecteur d'écran suit l'étape.
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);
  const [selected, setSelected] = useState<PublicProfile | null>(null);
  const [pin, setPin] = useState(NONE);
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Incrémenté à chaque échec → remonte le pavé pour rejouer le secouage doux.
  const [shakeNonce, setShakeNonce] = useState(0);

  const pickProfile = (profile: PublicProfile) => {
    setSelected(profile);
    setPin(NONE);
    setError(false);
  };

  const backToList = () => {
    setSelected(null);
    setPin(NONE);
    setError(false);
  };

  const submit = async (profile: PublicProfile, value: string) => {
    setSubmitting(true);
    setError(false);
    try {
      const result = await loginAction(profile.id, value);
      if (result.ok) {
        // Session posée : on rejoint le jeu (garde de route validera le cookie).
        router.push("/jouer");
        router.refresh();
        return;
      }
      // Échec générique (mauvais code OU profil inconnu) — no-shame, on efface.
      setPin(NONE);
      setError(true);
      setShakeNonce((nonce) => nonce + 1);
    } catch {
      setPin(NONE);
      setError(true);
      setShakeNonce((nonce) => nonce + 1);
    } finally {
      setSubmitting(false);
    }
  };

  // Saisie : dès le 4ᵉ chiffre, on soumet (pas de bouton — flux enfant fluide).
  const handlePinChange = (next: string) => {
    setPin(next);
    if (selected !== null && next.length === PIN_LENGTH && !submitting) {
      void submit(selected, next);
    }
  };

  return (
    <main style={mainStyle} className="bg-bg text-text">
      <div style={cardStyle}>
        {error && (
          <p role="alert" style={errorStyle}>
            <span aria-hidden="true">{WARN_ICON}</span>
            {strings.login.error}
          </p>
        )}

        {selected === null ? (
          <>
            <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
              {strings.login.title}
            </h1>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-4)",
                justifyContent: "center",
              }}
            >
              {profiles.map((profile) => (
                <li key={profile.id}>
                  <button
                    type="button"
                    aria-label={fill(strings.login.profileOption, "{prénom}", profile.name)}
                    onClick={() => pickProfile(profile)}
                    style={profileCardStyle}
                  >
                    <span aria-hidden="true" style={{ fontSize: "var(--font-size-3xl)" }}>
                      {avatarEmoji(profile.avatar)}
                    </span>
                    <span>{profile.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
              {fill(strings.login.pinTitle, "{prénom}", selected.name)}
            </h1>
            {/* key = nonce d'échec → remonte pour rejouer l'animation de secouage. */}
            <div key={shakeNonce} className={shakeNonce > 0 ? "mz-shake" : undefined}>
              <PinPad value={pin} onChange={handlePinChange} label={strings.login.pinLabel} />
            </div>
            {submitting && (
              <p
                role="status"
                style={{
                  margin: 0,
                  textAlign: "center",
                  color: "var(--color-text-secondary)",
                  fontFamily: "var(--font-family-body)",
                }}
              >
                {strings.login.checking}
              </p>
            )}
            <button type="button" onClick={backToList} style={ghostButtonStyle}>
              {strings.login.back}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
