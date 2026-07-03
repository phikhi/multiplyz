"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import { logoutAction } from "@/app/login/actions";

/**
 * Bouton de déconnexion (AUTH.md §2). Révoque la session serveur (l'action
 * efface la source de vérité + le cookie) puis renvoie au sélecteur de profil.
 * Tokens uniquement, cible ≥ 44 px. Voix de Teddy (« changer de joueur »).
 *
 * **Fiabilisation issue #88** (flaky e2e `auth.spec.ts` : la redirection post-
 * déconnexion pouvait dépasser le timeout d'assertion par défaut sous charge CI).
 * Cause-racine : `router.push` **retourne dès que la navigation est mise en file**,
 * pas quand la nouvelle route a fini de charger/rendre — le bouton se croyait donc
 * "prêt" (`pending=false`) avant que `/` soit réellement affiché, une pure course de
 * timing (jamais un état serveur incohérent : le cookie est déjà purgé et la session
 * déjà révoquée AVANT ce point, cf. `logoutChild`). Fix (LEARNINGS #42 : attendre
 * l'état RÉEL, pas un timeout fixe) : `router.push`/`router.refresh` sont englobés
 * dans `startTransition` (`useTransition`) — React couple alors `isPending` à la
 * navigation elle-même (reste `true` tant que la route cible n'a pas COMMIT), pas
 * seulement à l'appel réseau de l'action serveur. Le bouton reste donc désactivé
 * jusqu'à la navigation réelle → l'E2E peut attendre un état observable (le bouton
 * disparaît avec l'ancienne page) plutôt qu'un délai arbitraire.
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [navPending, startTransition] = useTransition();

  const onClick = async () => {
    setPending(true);
    try {
      await logoutAction();
      // `startTransition` : `navPending` reste `true` jusqu'à ce que la navigation
      // VERS `/` ait réellement commit (pas seulement mise en file) — état observable,
      // pas un timeout fixe.
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
      {strings.play.logout}
    </button>
  );
}
