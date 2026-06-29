import { getConfig } from "@/config/server-config";

/**
 * Hook de démarrage Next.js (runtime Node) : valide la configuration au boot.
 *
 * Fail-fast — si une variable d'environnement requise manque en production,
 * le serveur refuse de démarrer avec un message explicite
 * (cf. `src/config/server-config.ts`).
 */
export function register(): void {
  // Pendant `next build`, on ne valide pas l'environnement runtime.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  getConfig();
}
