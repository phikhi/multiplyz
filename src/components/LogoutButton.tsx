"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import { logoutAction } from "@/app/login/actions";

/**
 * Bouton de déconnexion (AUTH.md §2). Révoque la session serveur (l'action
 * efface la source de vérité + le cookie) puis renvoie au sélecteur de profil.
 * Tokens uniquement, cible ≥ 44 px. Voix de Teddy (« changer de joueur »).
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onClick = async () => {
    setPending(true);
    try {
      await logoutAction();
      router.push("/");
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      disabled={pending}
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
        cursor: pending ? "not-allowed" : "pointer",
        opacity: pending ? 0.55 : 1,
      }}
    >
      {strings.play.logout}
    </button>
  );
}
