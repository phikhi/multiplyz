"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import { AVATARS } from "@/config/avatars";
import { NAME_MAX_LENGTH, PIN_LENGTH } from "@/lib/auth/validation";
import { PinPad } from "@/components/PinPad";
import type { ManagedProfile, ProfileManagementErrorCode } from "@/lib/parent/profiles";
import { deleteProfileAction, renameProfileAction, resetChildPinAction } from "./actions";

/**
 * Écran **« Gérer les profils »** (story 7.5, DETAILS §3, WIREFRAMES §7 « gérer profils »).
 * Rendu sous garde de session parent (`(espace)/layout.tsx`) ; le **serveur reste la source de
 * vérité** (les actions re-vérifient la session, valident, hachent, purgent). Ce composant
 * n'orchestre que l'UI : renommer, réinitialiser le code enfant, supprimer (avec **confirmation**
 * destructive). Registre **neutre/vouvoiement** (COPY §5, pas Teddy). Tokens uniquement, cibles
 * ≥ 44 px, feedback **doublé d'icône** (daltonisme, ✓ succès / ⚠️ erreur), strings centralisées.
 */
export interface ProfileManagerProps {
  /** Profils du foyer (projection de gestion servie par la page serveur, aucun secret). */
  profiles: ManagedProfile[];
}

// Glyphes décoratifs (aria-hidden) — react/jsx-no-literals : aucun littéral rendu en JSX.
const CHECK_ICON = "✓";
const WARN_ICON = "⚠️";
const NONE = "";

type Mode = "rename" | "resetPin" | "delete";
type FeedbackKind = "success" | "error";
/** Codes affichables : ceux du serveur + `UNAUTHORIZED` + un repli réseau `GENERIC`. */
type ErrorCode = ProfileManagementErrorCode | "UNAUTHORIZED" | "GENERIC";

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

// Titre focus-managé (`ref` + `tabIndex={-1}` + `.focus()` au montage → annonce lecteur d'écran).
// `outline:"none"` **documenté** (STACK-TRAP #222, rétro 7.1) : le focus est programmatique, hors
// ordre clavier → l'anneau UA natif serait un artefact full-width sans valeur a11y. Pas
// `mz-focusable` (ne stylise que `:focus-visible`, non matché par un focus programmatique).
const titleStyle = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-xl)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
  outline: "none",
} as const;

const introStyle = {
  margin: 0,
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
} as const;

const profileCardStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-5)",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-md)",
} as const;

const profileHeaderStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  flexWrap: "wrap",
} as const;

const avatarStyle = {
  fontSize: "var(--font-size-2xl)",
  lineHeight: 1,
} as const;

const nameStyle = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
} as const;

const ownerBadgeStyle = {
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-full)",
  padding: "var(--space-1) var(--space-3)",
} as const;

const ownerHintStyle = {
  margin: 0,
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-sm)",
} as const;

const actionRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-3)",
} as const;

const buttonBase = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3) var(--space-5)",
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)",
  borderRadius: "var(--border-radius-full)",
  cursor: "pointer",
} as const;

const ghostButtonStyle = {
  ...buttonBase,
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-primary)",
} as const;

const primaryButtonStyle = {
  ...buttonBase,
  fontFamily: "var(--font-family-display)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-inverse)",
  backgroundColor: "var(--color-accent-primary)",
  border: "none",
} as const;

// Bouton destructif = registre **amber** (warning), calme (COPY : jamais agressif), texte constant
// `--color-on-warning` sur `--color-status-warning` (theme-safe, contraste résolu testé) + ⚠️ doublé.
const dangerButtonStyle = {
  ...buttonBase,
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  fontFamily: "var(--font-family-display)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-on-warning)",
  backgroundColor: "var(--color-status-warning)",
  border: "none",
} as const;

// État **désactivé / en cours** (rétro Frontend #226) : registre neutre « inactif » **sans
// `opacity`** — un `opacity:0.55` sur le bouton compositerait le TEXTE vers le fond de la carte et
// le ferait tomber **sous 4.5:1** (piège #170/#104 « token résolu ≠ pixel réellement peint », ici
// via l'opacité, pas l'occlusion). On garde donc le **texte à alpha pleine** (`--color-text-secondary`
// sur `--color-bg-secondary` = contraste résolu ≥ 4.5:1 déjà prouvé) ; le signal « désactivé » vient
// de `disabled`/`aria-disabled` + `cursor:not-allowed` + une bordure atténuée (`--color-border-secondary`),
// jamais d'une dilution du texte. Priorité : owner-« Supprimer » (désactivé EN PERMANENCE) reste lisible.
const disabledButtonStyle = {
  ...buttonBase,
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border-secondary)",
  cursor: "not-allowed",
} as const;

const inputStyle = {
  minHeight: "var(--tap-target-min)",
  padding: "var(--space-3) var(--space-4)",
  fontSize: "var(--font-size-md)",
  fontFamily: "var(--font-family-body)",
  color: "var(--color-text-primary)",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-md)",
} as const;

const panelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
} as const;

const panelButtonsStyle = {
  display: "flex",
  gap: "var(--space-3)",
  flexWrap: "wrap",
} as const;

// Bandeau de confirmation destructive + erreurs = amber warning (texte constant, ⚠️ doublé).
const warningBoxStyle = {
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
} as const;

// Succès = registre neutre + ✓ doublé (couleur texte-primary constante, jamais un token inversant).
const successBoxStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  margin: 0,
  fontFamily: "var(--font-family-body)",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-primary)",
} as const;

const backLinkStyle = {
  ...ghostButtonStyle,
  alignSelf: "flex-start",
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
} as const;

const m = strings.parent.manage;

export function ProfileManager({ profiles }: ProfileManagerProps) {
  const router = useRouter();
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);
  // **Gestion du focus à l'ouverture d'un panneau** (rétro Frontend #226) : un panneau (renommer /
  // réinit / supprimer) apparaît par rendu conditionnel → le bouton cliqué démonte et le focus
  // retombe sur `<body>` (clavier/SR perdus). On déplace donc le focus dans le panneau ouvert via ce
  // ref (invoqué au MONTAGE de l'ancre, ref stable `useCallback` → une seule fois par ouverture, pas
  // à chaque frappe). Ancre = le champ pour renommer (naturel), le bouton **Annuler** pour réinit et
  // **surtout la suppression destructive** (choix sûr par défaut). L'annonce SR vient du déplacement
  // de focus — pas de 2ᵉ région alert. Boutons/inputs nativement focusables → pas d'artefact #222.
  const panelAnchorRef = useCallback((node: HTMLElement | null) => {
    node?.focus();
  }, []);
  const [active, setActive] = useState<{ id: number; mode: Mode } | null>(null);
  const [renameValue, setRenameValue] = useState(NONE);
  const [pinValue, setPinValue] = useState(NONE);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; text: string } | null>(null);

  const isActive = (id: number, mode: Mode) => active?.id === id && active.mode === mode;

  const reset = () => {
    setActive(null);
    setPinValue(NONE);
    setRenameValue(NONE);
  };

  const openRename = (p: ManagedProfile) => {
    setFeedback(null);
    setRenameValue(p.name);
    setActive({ id: p.id, mode: "rename" });
  };
  const openResetPin = (p: ManagedProfile) => {
    setFeedback(null);
    setPinValue(NONE);
    setActive({ id: p.id, mode: "resetPin" });
  };
  const openDelete = (p: ManagedProfile) => {
    setFeedback(null);
    setActive({ id: p.id, mode: "delete" });
  };
  const cancel = () => {
    setFeedback(null);
    reset();
  };

  // Chaque `ErrorCode` est une clé de `m.errors` (contrat vérifié par `strings.test.ts` : le jeu
  // de clés = ProfileManagementErrorCode ∪ {UNAUTHORIZED, GENERIC}) → indexation toujours définie,
  // pas de repli `?? GENERIC` (branche morte non-testable, rétro #124/#143).
  const errorText = (code: ErrorCode) => m.errors[code];

  const succeed = (text: string) => {
    reset();
    setFeedback({ kind: "success", text });
    router.refresh(); // recharge la liste servie par le serveur
  };

  const submitRename = async (id: number) => {
    setPending(true);
    setFeedback(null);
    try {
      const result = await renameProfileAction(id, renameValue);
      if (result.ok) succeed(m.rename.success);
      else setFeedback({ kind: "error", text: errorText(result.code) });
    } catch {
      setFeedback({ kind: "error", text: errorText("GENERIC") });
    } finally {
      setPending(false);
    }
  };

  const submitResetPin = async (id: number) => {
    setPending(true);
    setFeedback(null);
    try {
      const result = await resetChildPinAction(id, pinValue);
      if (result.ok) succeed(m.resetPin.success);
      else setFeedback({ kind: "error", text: errorText(result.code) });
    } catch {
      setFeedback({ kind: "error", text: errorText("GENERIC") });
    } finally {
      setPending(false);
    }
  };

  const submitDelete = async (id: number) => {
    setPending(true);
    setFeedback(null);
    try {
      const result = await deleteProfileAction(id);
      if (result.ok) succeed(m.delete.success);
      else setFeedback({ kind: "error", text: errorText(result.code) });
    } catch {
      setFeedback({ kind: "error", text: errorText("GENERIC") });
    } finally {
      setPending(false);
    }
  };

  const canRename = renameValue.trim().length > 0;
  const canSubmitPin = pinValue.length === PIN_LENGTH;

  return (
    <main className="bg-bg text-text" style={mainStyle}>
      <div style={cardStyle}>
        <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
          {m.title}
        </h1>
        <p style={introStyle}>{m.intro}</p>

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

        {profiles.map((p) => (
          <section
            key={p.id}
            aria-label={fill(m.profileLabel, "{prénom}", p.name)}
            style={profileCardStyle}
          >
            <div style={profileHeaderStyle}>
              <span aria-hidden="true" style={avatarStyle}>
                {avatarEmoji(p.avatar)}
              </span>
              <p style={nameStyle}>{p.name}</p>
              {p.isOwner && <span style={ownerBadgeStyle}>{m.ownerBadge}</span>}
            </div>

            {isActive(p.id, "rename") ? (
              <div style={panelStyle}>
                <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  <span style={{ fontWeight: "var(--font-weight-semibold)" }}>
                    {fill(m.rename.label, "{prénom}", p.name)}
                  </span>
                  <input
                    ref={panelAnchorRef}
                    type="text"
                    autoComplete="off"
                    value={renameValue}
                    maxLength={NAME_MAX_LENGTH}
                    placeholder={m.rename.placeholder}
                    onChange={(event) => setRenameValue(event.target.value)}
                    style={inputStyle}
                  />
                </label>
                <div style={panelButtonsStyle}>
                  <button
                    type="button"
                    className="mz-focusable"
                    onClick={cancel}
                    style={ghostButtonStyle}
                  >
                    {m.rename.cancel}
                  </button>
                  <button
                    type="button"
                    className="mz-focusable"
                    disabled={!canRename || pending}
                    onClick={() => submitRename(p.id)}
                    style={!canRename || pending ? disabledButtonStyle : primaryButtonStyle}
                  >
                    {m.rename.save}
                  </button>
                </div>
              </div>
            ) : isActive(p.id, "resetPin") ? (
              <div style={panelStyle}>
                <p style={introStyle}>{fill(m.resetPin.hint, "{prénom}", p.name)}</p>
                <PinPad value={pinValue} onChange={setPinValue} label={m.resetPin.label} />
                <div style={panelButtonsStyle}>
                  <button
                    ref={panelAnchorRef}
                    type="button"
                    className="mz-focusable"
                    onClick={cancel}
                    style={ghostButtonStyle}
                  >
                    {m.resetPin.cancel}
                  </button>
                  <button
                    type="button"
                    className="mz-focusable"
                    disabled={!canSubmitPin || pending}
                    onClick={() => submitResetPin(p.id)}
                    style={!canSubmitPin || pending ? disabledButtonStyle : primaryButtonStyle}
                  >
                    {m.resetPin.save}
                  </button>
                </div>
              </div>
            ) : isActive(p.id, "delete") ? (
              <div style={panelStyle}>
                {/* Corps de confirmation : styling warning + ⚠️ doublé, mais PAS `role="alert"`
                    (ce n'est pas une erreur live-annoncée ; le vrai `role="alert"` est réservé au
                    bandeau de feedback ci-dessus → évite deux régions alert concurrentes). */}
                <p style={warningBoxStyle}>
                  <span aria-hidden="true">{WARN_ICON}</span>
                  {fill(m.delete.confirmBody, "{prénom}", p.name)}
                </p>
                <div style={panelButtonsStyle}>
                  <button
                    ref={panelAnchorRef}
                    type="button"
                    className="mz-focusable"
                    onClick={cancel}
                    style={ghostButtonStyle}
                  >
                    {m.delete.cancel}
                  </button>
                  <button
                    type="button"
                    className="mz-focusable"
                    disabled={pending}
                    onClick={() => submitDelete(p.id)}
                    style={pending ? disabledButtonStyle : dangerButtonStyle}
                  >
                    <span aria-hidden="true">{WARN_ICON}</span>
                    {m.delete.confirm}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={actionRowStyle}>
                  <button
                    type="button"
                    className="mz-focusable"
                    onClick={() => openRename(p)}
                    style={ghostButtonStyle}
                  >
                    {m.rename.action}
                  </button>
                  <button
                    type="button"
                    className="mz-focusable"
                    onClick={() => openResetPin(p)}
                    style={ghostButtonStyle}
                  >
                    {m.resetPin.action}
                  </button>
                  <button
                    type="button"
                    className="mz-focusable"
                    disabled={p.isOwner}
                    aria-disabled={p.isOwner}
                    onClick={() => openDelete(p)}
                    style={p.isOwner ? disabledButtonStyle : ghostButtonStyle}
                  >
                    {m.delete.action}
                  </button>
                </div>
                {p.isOwner && <p style={ownerHintStyle}>{m.ownerHint}</p>}
              </>
            )}
          </section>
        ))}

        <Link href="/parent" style={backLinkStyle} className="mz-focusable">
          {m.back}
        </Link>
      </div>
    </main>
  );
}
