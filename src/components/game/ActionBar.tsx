"use client";

import { useIsPhone } from "@/lib/responsive/use-is-phone";

/**
 * Barre d'action bas de zone pouce (WIREFRAMES §8, story 8.1 #254) — enveloppe l'action
 * principale courante de l'écran de jeu (« Je ne sais pas » en question, « Continuer »/« Je
 * réessaie » en feedback, `QuestionCard`/`FeedbackPanel`).
 *
 * **Téléphone uniquement** (`useIsPhone`, `--bp-phone`) : la barre passe en `position:fixed`
 * bas de viewport (zone pouce, WIREFRAMES §8 « boutons d'action en bas »). **Tablette/desktop :
 * disposition actuelle préservée** — `display:contents` n'ajoute AUCUNE boîte, l'enfant se
 * comporte exactement comme s'il était directement l'enfant du parent existant (zéro
 * régression visuelle, AC story 8.1).
 *
 * Ne déplace **jamais** le nœud DOM hors de son arbre existant (le wrapper reste exactement là
 * où le bouton était déjà monté) : `position:fixed` se positionne relatif au VIEWPORT quel que
 * soit l'ancêtre (aucun ancêtre de l'écran de jeu ne pose de `transform`/`filter`/`contain`
 * créant un containing block différent) — zéro restructuration DOM, zéro risque de casser l'a11y
 * existante (régions de statut/focus déjà en place, `FeedbackPanel`).
 *
 * Non-occlusion (#170/#190) : le contenu jouable au-dessus RÉSERVE l'espace de la barre via
 * `--play-action-bar-height` (padding-bottom du conteneur scrollable, `PlayScreen.tsx`) — jamais
 * raisonné seul, prouvé par la garde E2E `boundingClientRect` (`e2e/auth.spec.ts`).
 */
export function ActionBar({ children }: { readonly children: React.ReactNode }) {
  const isPhone = useIsPhone();

  if (!isPhone) {
    return <div style={{ display: "contents" }}>{children}</div>;
  }

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "var(--play-action-bar-height)",
        padding: "var(--space-4) var(--space-6)",
        backgroundColor: "var(--color-bg-secondary)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      {children}
    </div>
  );
}
