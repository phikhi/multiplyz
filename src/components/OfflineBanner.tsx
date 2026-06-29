"use client";

import { useSyncExternalStore, useState } from "react";
import { strings } from "@/strings";

/**
 * Souscrit aux événements "online"/"offline" de window.
 * Stable : défini au niveau module (pas de recréation à chaque rendu).
 */
function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** Snapshot client : état réseau en temps réel. */
const getSnapshot = (): boolean => navigator.onLine;

/**
 * Snapshot SSR : assume en ligne (pas de navigator côté serveur).
 * Évite la ReferenceError et le mismatch d'hydratation.
 */
/* c8 ignore next — SSR uniquement, non émulable par jsdom */
const getServerSnapshot = (): boolean => true;

/**
 * Bannière de statut réseau — message doux si coupure réseau.
 *
 * Distingue deux cas (cf. SYNC.md §3) :
 *  - Cold-start offline : app ouverte déjà hors ligne → "Connecte-toi à internet"
 *  - Perte mid-session : connexion coupée pendant la session → voix Teddy
 *
 * Implémentation :
 *  - `useSyncExternalStore` pour l'état réseau en temps réel (pattern React idéal
 *    pour les stores externes, SSR-safe, pas de setState dans useEffect).
 *  - Région live TOUJOURS montée (role=status / aria-live=polite) → les AT
 *    détectent les changements de contenu même quand la bannière est invisible.
 *  - Bannière visuelle (aria-hidden) séparée → pas d'annonce dupliquée.
 *
 * A11y : contraste via --color-on-warning (toujours sombre), cible ≥ 44px.
 * cf. COPY.md §3, DESIGN_TOKENS.md §a11y.
 */
export function OfflineBanner() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /**
   * Capture l'état réseau au premier rendu côté client.
   * Distingue cold-start (offline depuis le début) de mid-session (perte en cours).
   * Valeur par défaut SSR = true (évite le mismatch — le client corrige à l'hydratation).
   */
  const [startedOnline] = useState<boolean>(() => {
    /* c8 ignore next 2 — branche SSR (`window` indéfini) non émulable par jsdom */
    if (typeof window === "undefined") return true;
    return navigator.onLine;
  });

  const message = isOnline
    ? ""
    : startedOnline
      ? strings.pwa.offline // mid-session : réseau coupé pendant la session
      : strings.pwa.coldStart; // cold-start : démarré sans réseau

  return (
    <>
      {/*
       * Région live TOUJOURS dans le DOM.
       * Ne pas démonter : unmount casse le suivi AT de la live region.
       * Visuellement masquée via clip-path (accessible aux lecteurs d'écran).
       * Pas d'aria-label : écraserait le texte annoncé par l'AT.
       */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          overflow: "hidden",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
        }}
      >
        {message}
      </div>

      {/* Bannière visuelle — seulement quand hors-ligne, aria-hidden (live region annonce) */}
      {!isOnline && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            bottom: "var(--space-5)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            backgroundColor: "var(--color-status-warning)",
            /* Contraste AA : fond ambre (clair dans les 2 thèmes) + texte sombre fixe */
            color: "var(--color-on-warning)",
            padding: "var(--space-3) var(--space-6)",
            borderRadius: "var(--border-radius-lg)",
            boxShadow: "var(--shadow-md)",
            fontSize: "var(--font-size-sm)",
            fontFamily: "var(--font-family-body)",
            fontWeight: "var(--font-weight-semibold)",
            minHeight: "var(--tap-target-min)",
            display: "flex",
            alignItems: "center",
            textAlign: "center",
            /* Pas de nowrap : autorise 2 lignes sur mobile (≥ 375 px) */
            maxWidth: "calc(100vw - var(--space-8))",
          }}
        >
          {message}
        </div>
      )}
    </>
  );
}
