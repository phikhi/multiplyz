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
 *
 * État désactivé (#240/#226, corrigé PR #250) : registre neutre « inactif » **sans `opacity`**
 * — un `opacity:0.55` composite le TEXTE (bouton avec libellé) vers le fond et le fait tomber
 * sous 4.5:1 peint (piège #170/#226 « token résolu ≠ pixel peint » ; ~2.20:1 light / ~3.39:1 dark
 * avant correction). Ce bouton est rendu sur l'écran `locked`/jeu (`StatusMessage`) ET l'écran de
 * jeu. Texte **plein-alpha** (`--color-text-secondary`, ≥4.5:1 peint sur `--color-bg-tertiary`) ;
 * le signal « désactivé » vient de `disabled`/`aria-disabled` + `cursor:not-allowed` + fond atténué
 * (`--color-bg-tertiary`, même token que le clavier PIN), jamais d'une dilution du texte.
 *
 * **Monté UNE SEULE FOIS dans le shell persistant** (story R1.1 #337, `AppShell.tsx`,
 * WIREFRAMES §2 « 👤 ») — remplace les 3 montages dupliqués par écran (`MapScreen`,
 * `PlayScreen` ×2, rétro #337). Le glyphe 👤 (décoratif, `aria-hidden`) préfixe le texte
 * visible existant (jamais icône SEULE **par défaut** — a11y, cohérent avec `🔒 Parent`/
 * `🔊 Son activé` ailleurs dans l'app) ; le nom accessible reste EXACTEMENT
 * `strings.play.logout` (le glyphe `aria-hidden` est exclu du calcul du nom accessible,
 * `LogoutButton.test.tsx` inchangé par cet ajout — `compact` par défaut `false`).
 *
 * **`compact` (story R1.1 #337, `AppShell.tsx` sur téléphone)** : masque le libellé VISIBLE
 * (jamais une dilution `opacity`, #226 — le texte est simplement ABSENT du DOM, remplacé par
 * un `aria-label` équivalent, nom accessible strictement identique) et resserre le padding en
 * pastille carrée. Nécessaire pour que le bandeau persistant reste RÉELLEMENT sur une seule
 * ligne à `--app-shell-height` sur les viewports étroits (375px, WIREFRAMES §8) — un bandeau qui
 * passerait à la ligne rendrait ce token FAUX et rognerait la marge sous la barre d'action fixe
 * de `PlayScreen` (story 8.1 #254, régression mesurée puis corrigée à la source).
 */
const PROFILE_ICON = "👤"; // décoratif (aria-hidden) — react/jsx-no-literals, même patron que ProfileSelector.

export function LogoutButton({ compact = false }: { readonly compact?: boolean } = {}) {
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
      aria-disabled={disabled}
      aria-label={compact ? strings.play.logout : undefined}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-2)",
        minHeight: "var(--tap-target-min)",
        minWidth: compact ? "var(--tap-target-min)" : undefined,
        padding: compact ? "var(--space-2)" : "var(--space-3) var(--space-6)",
        fontFamily: "var(--font-family-body)",
        fontSize: "var(--font-size-base)",
        fontWeight: "var(--font-weight-semibold)",
        color: "var(--color-text-secondary)",
        backgroundColor: disabled ? "var(--color-bg-tertiary)" : "transparent",
        border: "1px solid var(--color-border-primary)",
        borderRadius: "var(--border-radius-full)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span aria-hidden="true">{PROFILE_ICON}</span>
      {!compact && strings.play.logout}
    </button>
  );
}
