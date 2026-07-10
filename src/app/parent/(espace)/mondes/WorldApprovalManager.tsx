"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import type { PendingWorld } from "@/lib/parent/world-approval";
import { approveWorldAction, rejectWorldAction } from "./actions";

/**
 * Écran **« Mondes à valider »** (story 7.9, issue #231, WORLDGEN §6). Rendu sous garde de
 * session parent (`(espace)/layout.tsx`) ; le **serveur reste la source de vérité** (les actions
 * re-vérifient la session, transitionnent l'état gardé). Ce composant n'orchestre que l'UI :
 * approuver (action directe) ou rejeter (avec **confirmation**, même patron que la suppression de
 * profil 7.5). Registre **neutre/vouvoiement** (COPY §5, pas Teddy). Tokens uniquement, cibles
 * ≥ 44 px, feedback **doublé d'icône** (daltonisme, ✓ succès / ⚠️ erreur), strings centralisées.
 *
 * **Aucun élément superposé/positionné** (pas de `position:absolute`, pas de z-index) : la carte
 * de monde, l'aperçu accent et les boutons sont des frères en flux normal (`flex`), même
 * discipline que `ParentDashboard.tsx`/`ProfileManager.tsx` — hors du périmètre de la garde
 * d'occlusion #170 par construction (documenté ici, pas une esquive ; capture Playwright ouverte/
 * regardée reste obligatoire, DoD). L'**aperçu accent** peint `theme.accent` (hex **direct**, pas
 * un token `color-mix` dérivé) → aucun risque du piège #182/#184 (dérivation à `:root` figée sous
 * surcharge descendante) : la couleur est posée en `style` inline literal, résolue telle quelle.
 */
export interface WorldApprovalManagerProps {
  /** Mondes `buffered` en attente, projection serveur (lecture seule, aucun secret). */
  pending: PendingWorld[];
}

// Glyphes décoratifs (aria-hidden) — react/jsx-no-literals : aucun littéral rendu en JSX.
const CHECK_ICON = "✓";
const WARN_ICON = "⚠️";

type Mode = "reject" | null;
type FeedbackKind = "success" | "error";
type ErrorCode = "UNAUTHORIZED" | "MODERATION_FAILED" | "GENERIC";

/** Remplace un jeton `{x}` par sa valeur (même micro-interpolation que `ProfileManager`). */
function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
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
// `outline:"none"` **documenté** (STACK-TRAP #222, rétro 7.1/7.5) : le focus est programmatique,
// hors ordre clavier → l'anneau UA natif serait un artefact full-width sans valeur a11y. Pas
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

const worldCardStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-5)",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--border-radius-md)",
} as const;

const worldHeaderStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  flexWrap: "wrap",
} as const;

/** Aperçu accent du monde (décoratif) — carré arrondi peignant `theme.accent` (hex direct). */
function accentSwatchStyle(accent: string) {
  return {
    width: "var(--space-6)",
    height: "var(--space-6)",
    flexShrink: 0,
    borderRadius: "var(--border-radius-sm)",
    backgroundColor: accent,
    border: "1px solid var(--color-border-primary)",
  } as const;
}

const worldNumberStyle = {
  margin: 0,
  fontFamily: "var(--font-family-numeric)",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-secondary)",
} as const;

const worldThemeStyle = {
  fontFamily: "var(--font-family-display)",
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-bold)",
  color: "var(--color-text-primary)",
  margin: 0,
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
// `opacity`** — voir `ProfileManager.tsx` pour l'analyse complète du piège (dilution du texte sous
// 4.5:1 par composite `opacity`). Texte plein-alpha (`--color-text-secondary` sur
// `--color-bg-secondary`, contraste déjà prouvé) ; le signal « désactivé » vient de
// `disabled`/`aria-disabled` + `cursor:not-allowed` + bordure atténuée, jamais d'une opacité.
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

const wa = strings.parent.worldApproval;

export function WorldApprovalManager({ pending }: WorldApprovalManagerProps) {
  const router = useRouter();
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);
  // Focus dans le panneau de confirmation à l'ouverture (rétro Frontend #226, même patron que
  // `ProfileManager` — le bouton cliqué démonte au rendu conditionnel, sinon le focus retombe sur
  // `<body>`). Ancre = le bouton **Annuler** (choix sûr par défaut sur une action destructive).
  const panelAnchorRef = useCallback((node: HTMLElement | null) => {
    node?.focus();
  }, []);
  const [active, setActive] = useState<{ id: string; mode: Mode } | null>(null);
  const [pendingApprove, setPendingApprove] = useState<string | null>(null);
  const [pendingReject, setPendingReject] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; text: string } | null>(null);

  const errorText = (code: ErrorCode) => wa.errors[code];

  const succeed = (text: string) => {
    setActive(null);
    setFeedback({ kind: "success", text });
    router.refresh(); // recharge la liste servie par le serveur (le monde traité disparaît)
  };

  const submitApprove = async (id: string) => {
    setPendingApprove(id);
    setFeedback(null);
    try {
      const result = await approveWorldAction(id);
      if (result.ok) succeed(wa.approve.success);
      else setFeedback({ kind: "error", text: errorText(result.code) });
    } catch {
      setFeedback({ kind: "error", text: errorText("GENERIC") });
    } finally {
      setPendingApprove(null);
    }
  };

  const openReject = (id: string) => {
    setFeedback(null);
    setActive({ id, mode: "reject" });
  };
  const cancelReject = () => {
    setFeedback(null);
    setActive(null);
  };

  const submitReject = async (id: string) => {
    setPendingReject(true);
    setFeedback(null);
    try {
      const result = await rejectWorldAction(id);
      if (result.ok) succeed(wa.reject.success);
      else setFeedback({ kind: "error", text: errorText(result.code) });
    } catch {
      setFeedback({ kind: "error", text: errorText("GENERIC") });
    } finally {
      setPendingReject(false);
    }
  };

  return (
    <main className="bg-bg text-text" style={mainStyle}>
      <div style={cardStyle}>
        <h1 ref={focusHeading} tabIndex={-1} style={titleStyle}>
          {wa.title}
        </h1>
        <p style={introStyle}>{wa.intro}</p>

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

        {pending.length === 0 ? (
          <p style={introStyle}>{wa.empty}</p>
        ) : (
          pending.map((world) => {
            const worldNumber = String(world.index + 1); // affichage 1-based (MAP §1, cohérent carte)
            const isRejectPanelOpen = active?.id === world.id && active.mode === "reject";
            return (
              <section
                key={world.id}
                aria-label={fill(
                  fill(wa.worldLabel, "{n}", worldNumber),
                  "{thème}",
                  world.theme.label,
                )}
                style={worldCardStyle}
              >
                <div style={worldHeaderStyle}>
                  <span aria-hidden="true" style={accentSwatchStyle(world.theme.accent)} />
                  <div>
                    <p style={worldNumberStyle}>{fill(wa.worldNumber, "{n}", worldNumber)}</p>
                    <p style={worldThemeStyle}>{world.theme.label}</p>
                  </div>
                </div>

                {isRejectPanelOpen ? (
                  <div style={panelStyle}>
                    {/* PAS `role="alert"` ici (réservé au bandeau de feedback live ci-dessus). */}
                    <p style={warningBoxStyle}>
                      <span aria-hidden="true">{WARN_ICON}</span>
                      {fill(wa.reject.confirmBody, "{thème}", world.theme.label)}
                    </p>
                    <div style={panelButtonsStyle}>
                      <button
                        ref={panelAnchorRef}
                        type="button"
                        className="mz-focusable"
                        onClick={cancelReject}
                        style={ghostButtonStyle}
                      >
                        {wa.reject.cancel}
                      </button>
                      <button
                        type="button"
                        className="mz-focusable"
                        disabled={pendingReject}
                        onClick={() => submitReject(world.id)}
                        style={pendingReject ? disabledButtonStyle : dangerButtonStyle}
                      >
                        <span aria-hidden="true">{WARN_ICON}</span>
                        {wa.reject.confirm}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={actionRowStyle}>
                    <button
                      type="button"
                      className="mz-focusable"
                      disabled={pendingApprove === world.id}
                      onClick={() => submitApprove(world.id)}
                      style={pendingApprove === world.id ? disabledButtonStyle : primaryButtonStyle}
                    >
                      {wa.approve.action}
                    </button>
                    <button
                      type="button"
                      className="mz-focusable"
                      onClick={() => openReject(world.id)}
                      style={ghostButtonStyle}
                    >
                      {wa.reject.action}
                    </button>
                  </div>
                )}
              </section>
            );
          })
        )}

        <Link href="/parent" style={backLinkStyle} className="mz-focusable">
          {wa.back}
        </Link>
      </div>
    </main>
  );
}
