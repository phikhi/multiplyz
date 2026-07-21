"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import { AVATARS } from "@/config/avatars";
import { BRAND_NAME } from "@/config/brand";
import { PIN_LENGTH } from "@/lib/auth/validation";
import type { PublicProfile } from "@/lib/auth/login";
import { PinPad } from "@/components/PinPad";
import { AssetImage } from "@/components/media/AssetImage";
import { TEDDY_EXPRESSION_REF } from "@/config/teddy";
import { loginAction } from "@/app/login/actions";
import { loginParentAction } from "@/app/parent/actions";

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
// Glyphes décoratifs (aria-hidden) — react/jsx-no-literals : aucun littéral rendu en JSX.
const BEAR_ICON = "🧸"; // mascotte Teddy dans l'en-tête de marque (WIREFRAMES §1a).
const LOCK_ICON = "🔒"; // cadenas de l'entrée « 🔒 Parent » (WIREFRAMES §1a, coin discret).
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

// En-tête de marque « multiplyz 🧸 » (WIREFRAMES §1a, au-dessus de « Qui joue aujourd'hui ? »).
// Le wordmark consomme `--color-text-primary` sur `--card-bg` (contraste WCAG résolu, testé).
const brandStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-2)",
  margin: 0,
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-2xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
} as const;

const titleStyle = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
  textAlign: "center",
  // Ces titres portent `ref={focusHeading} tabIndex={-1}` : le focus est posé
  // **programmatiquement** à chaque étape (annonce lecteur d'écran), jamais atteint au Tab
  // (hors ordre clavier). On supprime donc l'outline UA (`:focus`/`:focus-visible`) — un
  // anneau parasite full-width autour du titre, sans valeur a11y ici (l'annonce SR vient du
  // déplacement du focus, pas d'un ring). Pas `mz-focusable` : cet utilitaire ne stylise QUE
  // `:focus-visible` (il ajouterait un anneau, ou laisserait l'outline UA si le focus
  // programmatique ne matche pas `:focus-visible`). `outline:none` sûr car tabIndex=-1.
  outline: "none",
} as const;

// Entrée discrète « 🔒 Parent » du sélecteur (WIREFRAMES §1a, coin bas). Registre neutre,
// consomme `--color-text-secondary` sur `--card-bg` (contraste WCAG résolu, testé).
const parentEntryStyle = {
  alignSelf: "flex-end",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-2) var(--space-4)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-full)",
  cursor: "pointer",
} as const;

const forgotLinkStyle = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-2) var(--space-4)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "none",
  textDecoration: "underline",
  cursor: "pointer",
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
  // Mode **espace parent** (WIREFRAMES §1a) : pavé PIN parent distinct du pavé enfant, voix
  // neutre, message d'échec générique. Vit sur le même sélecteur (pas de route dédiée).
  const [parentMode, setParentMode] = useState(false);
  const [parentPin, setParentPin] = useState(NONE);
  const [parentError, setParentError] = useState(false);
  const [parentSubmitting, setParentSubmitting] = useState(false);
  const [parentShakeNonce, setParentShakeNonce] = useState(0);

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
        // Session posée : on rejoint la carte (hub, WIREFRAMES §2/§10, PRODUCT §1.3, story
        // R1.2 #336) — jamais `/jouer` en direct (garde de route validera le cookie). Avant
        // #336, le login atterrissait sur `/jouer` sans jamais passer par la carte/Teddy/les
        // mondes en flux normal (défaut A, `docs/playthroughs/R0-baseline.md`).
        router.push("/carte");
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

  // ── Espace parent (WIREFRAMES §1a → §7) ──────────────────────────────────
  const openParent = () => {
    setParentMode(true);
    setParentPin(NONE);
    setParentError(false);
  };

  const closeParent = () => {
    setParentMode(false);
    setParentPin(NONE);
    setParentError(false);
  };

  const submitParent = async (value: string) => {
    setParentSubmitting(true);
    setParentError(false);
    try {
      const result = await loginParentAction(value);
      if (result.ok) {
        // Session parent posée : on rejoint l'espace parent (garde de route validera le cookie).
        router.push("/parent");
        router.refresh();
        return;
      }
      // Échec générique (mauvais code OU backoff, indiscernables — anti-énumération).
      setParentPin(NONE);
      setParentError(true);
      setParentShakeNonce((nonce) => nonce + 1);
    } catch {
      setParentPin(NONE);
      setParentError(true);
      setParentShakeNonce((nonce) => nonce + 1);
    } finally {
      setParentSubmitting(false);
    }
  };

  const handleParentPinChange = (next: string) => {
    setParentPin(next);
    if (next.length === PIN_LENGTH && !parentSubmitting) {
      void submitParent(next);
    }
  };

  // Vue **pavé PIN parent** — registre neutre (COPY §5), échec générique, lien récupération.
  if (parentMode) {
    return (
      <main style={mainStyle} className="bg-bg text-text">
        <div style={cardStyle}>
          {parentError && (
            <p role="alert" style={errorStyle}>
              <span aria-hidden="true">{WARN_ICON}</span>
              {strings.parent.error}
            </p>
          )}
          <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
            {strings.parent.pinTitle}
          </h1>
          <p
            style={{
              margin: 0,
              textAlign: "center",
              color: "var(--color-text-secondary)",
              fontFamily: "var(--font-family-body)",
            }}
          >
            {strings.parent.pinHint}
          </p>
          {/* key = nonce d'échec → remonte pour rejouer l'animation de secouage. */}
          <div key={parentShakeNonce} className={parentShakeNonce > 0 ? "mz-shake" : undefined}>
            <PinPad
              value={parentPin}
              onChange={handleParentPinChange}
              label={strings.parent.pinLabel}
            />
          </div>
          {parentSubmitting && (
            <p
              role="status"
              style={{
                margin: 0,
                textAlign: "center",
                color: "var(--color-text-secondary)",
                fontFamily: "var(--font-family-body)",
              }}
            >
              {strings.parent.checking}
            </p>
          )}
          <button
            type="button"
            className="mz-focusable"
            onClick={() => router.push("/parent/recuperation")}
            style={forgotLinkStyle}
          >
            {strings.parent.forgot}
          </button>
          <button
            type="button"
            className="mz-focusable"
            onClick={closeParent}
            style={ghostButtonStyle}
          >
            {strings.parent.back}
          </button>
        </div>
      </main>
    );
  }

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
            {/* Teddy en chair et en os accueille l'enfant (story R2.2, #360, ART §2 « fil rouge
                présent dans tous les mondes ») — sprite `content` (accueil chaleureux). EN FLUX,
                premier enfant de la carte : réserve son espace, ne recouvre rien (#278b). Repli
                no-fail = 🧸 emoji si l'asset n'est pas servi (CI/pré-déploiement). */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <AssetImage
                assetRef={TEDDY_EXPRESSION_REF.content}
                alt={strings.login.teddyAlt}
                width="var(--teddy-hero-size)"
                dataAsset="teddy-home"
                fallback={
                  <span aria-hidden="true" style={{ fontSize: "var(--font-size-4xl)" }}>
                    {BEAR_ICON}
                  </span>
                }
              />
            </div>
            {/* En-tête de marque « multiplyz 🧸 » (WIREFRAMES §1a) — 🧸 décoratif (aria-hidden). */}
            <p style={brandStyle}>
              <span>{BRAND_NAME}</span>
              <span aria-hidden="true">{BEAR_ICON}</span>
            </p>
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
                    className="mz-focusable"
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
            {/* Entrée discrète « 🔒 Parent » (WIREFRAMES §1a, coin bas) — 🔒 décoratif, le nom
                accessible complet est porté par `aria-label` (registre neutre, PAS Teddy). */}
            <button
              type="button"
              className="mz-focusable"
              aria-label={strings.parent.entryLabel}
              onClick={openParent}
              style={parentEntryStyle}
            >
              <span aria-hidden="true">{LOCK_ICON}</span>
              <span>{strings.parent.entry}</span>
            </button>
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
            <button
              type="button"
              className="mz-focusable"
              onClick={backToList}
              style={ghostButtonStyle}
            >
              {strings.login.back}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
