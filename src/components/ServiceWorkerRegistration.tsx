"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker custom (public/sw.js) côté client.
 *
 * Rend null — composant de pur effet de bord, sans DOM.
 * Online-first : le SW ne cache jamais /api/* (données de jeu).
 * Dégradation douce : si le SW n'est pas supporté ou échoue, l'app fonctionne
 * normalement sans précache.
 *
 * cf. public/sw.js, SYNC.md §4, STACK.md §Frontend PWA.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
      // Enregistrement silencieux — la PWA se dégrade sans SW (dégradation douce).
      console.error("[SW] Échec d'enregistrement :", err);
    });
  }, []);

  return null;
}
