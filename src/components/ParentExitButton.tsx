"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import { logoutParentAction } from "@/app/parent/actions";

/**
 * Bouton de sortie de l'**espace parent** (✕ du wireframe §7, story 7.1). Révoque la
 * session parent (l'action efface la source de vérité + le cookie) puis renvoie au
 * sélecteur de profil. Registre **neutre** (parent, pas la voix de Teddy). Tokens
 * uniquement, cible ≥ 44 px.
 *
 * Même fiabilisation que `LogoutButton` (issue #88) : `router.push`/`refresh` englobés
 * dans `startTransition` → `navPending` reste `true` jusqu'au COMMIT de la navigation
 * (état observable, pas un timeout fixe) ; le bouton reste désactivé jusqu'à l'affichage
 * réel du sélecteur.
 */
export function ParentExitButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [navPending, startTransition] = useTransition();

  const onClick = async () => {
    setPending(true);
    try {
      await logoutParentAction();
      startTransition(() => {
        router.push("/");
        router.refresh();
      });
    } finally {
      setPending(false);
    }
  };

  const disabled = pending || navPending;

  return (
    <button
      type="button"
      className="mz-focusable"
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: "var(--tap-target-min)",
        padding: "var(--space-3) var(--space-6)",
        fontFamily: "var(--font-family-body)",
        fontSize: "var(--font-size-base)",
        fontWeight: "var(--font-weight-semibold)",
        color: "var(--color-text-secondary)",
        backgroundColor: "transparent",
        border: "1px solid var(--color-border-primary)",
        borderRadius: "var(--border-radius-full)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {strings.parent.dashboard.exit}
    </button>
  );
}
