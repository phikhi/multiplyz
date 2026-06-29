"use client";

import { useEffect, useState } from "react";
import { strings } from "@/strings";

/**
 * Bannière de statut réseau — affiche un message doux si connexion perdue en cours de session.
 *
 * Voix de Teddy (cf. COPY.md §3 «Hors-ligne» / SYNC.md §3 «Perte de réseau en partie»).
 * Pas de crash, pas d'écran blanc.
 *
 * Design : online-first. La bannière ne gère pas le démarrage hors-ligne (écran dédié, hors scope).
 * Elle réagit uniquement aux événements réseau pendant la session.
 *
 * A11y : role="status" + aria-live="polite" (annonce non-interruptive),
 *        aria-label pour lecteurs d'écran, contraste via tokens CSS.
 * Cibles tactiles : padding ≥ --tap-target-min (44 px).
 */
export function OfflineBanner() {
  // Optimiste : en ligne par défaut. La bannière ne gère que la perte de connexion
  // mid-session (événements "offline"/"online") — cf. SYNC.md §3.
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={strings.pwa.offlineRole}
      style={{
        position: "fixed",
        bottom: "var(--space-5)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        backgroundColor: "var(--color-status-warning)",
        color: "var(--color-text-primary)",
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
        maxWidth: "calc(100vw - var(--space-8))",
        whiteSpace: "nowrap",
      }}
    >
      {strings.pwa.offline}
    </div>
  );
}
