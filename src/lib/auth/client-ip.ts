/**
 * Extraction de l'IP client pour le rate-limit par IP (AUTH.md §4). **Pur**
 * (chaîne → chaîne) → testable. Derrière Nginx/Forge (STACK.md), la vraie IP est
 * le **premier** maillon de `x-forwarded-for` (`client, proxy1, proxy2`). En
 * l'absence d'en-tête (dev / appel direct), on retombe sur une clé constante : le
 * rate-limit reste fonctionnel (bucket partagé) sans jamais throw.
 */

/** Clé de repli quand aucune IP n'est disponible (dev / en-tête absent). */
export const UNKNOWN_IP = "unknown";

/** Première IP de `x-forwarded-for`, ou `UNKNOWN_IP` si absent/vide. */
export function parseClientIp(forwardedFor: string | null): string {
  if (forwardedFor === null) return UNKNOWN_IP;
  const first = forwardedFor.split(",")[0].trim();
  return first === "" ? UNKNOWN_IP : first;
}
