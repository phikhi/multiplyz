/**
 * Extraction de l'IP client pour le rate-limit par IP (AUTH.md §4). **Pur**
 * (chaînes → chaîne) → testable. SERVER-ONLY (les en-têtes sont lus via
 * `headers()` côté serveur, jamais fournis par le client applicatif).
 *
 * **Source de confiance** : `X-Real-IP`, que Nginx/Forge positionne à
 * `$remote_addr` (l'IP TCP réelle) — un client **ne peut pas** l'écraser. On la
 * préfère à `X-Forwarded-For` : le template Nginx par défaut **ajoute**
 * (`$proxy_add_x_forwarded_for`) le `remote_addr` APRÈS la valeur envoyée par le
 * client → le 1er maillon de XFF est **contrôlable par le client** (spoofing /
 * empoisonnement du bucket IP). XFF n'est donc qu'un **repli** (proxys divers),
 * et l'absence des deux (dev / appel direct) retombe sur une clé constante.
 *
 * ⚠️ Déploiement : l'efficacité du rate-limit **par IP** suppose que Nginx pose
 * `X-Real-IP $remote_addr` (cf. issue de déploiement). Le rate-limit **par profil**
 * reste efficace indépendamment de l'IP.
 */

/** Clé de repli quand aucune IP fiable n'est disponible (dev / en-têtes absents). */
export const UNKNOWN_IP = "unknown";

/** Première IP non vide de `x-forwarded-for`, ou `UNKNOWN_IP` si absent/vide. */
export function parseForwardedFor(forwardedFor: string | null): string {
  if (forwardedFor === null) return UNKNOWN_IP;
  const first = forwardedFor.split(",")[0].trim();
  return first === "" ? UNKNOWN_IP : first;
}

/**
 * IP client de confiance : `X-Real-IP` (posé par Nginx = `$remote_addr`,
 * non-spoofable) en priorité, sinon 1er maillon de `X-Forwarded-For` (repli),
 * sinon `UNKNOWN_IP`.
 */
export function resolveClientIp(realIp: string | null, forwardedFor: string | null): string {
  if (realIp !== null) {
    const trimmed = realIp.trim();
    if (trimmed !== "") return trimmed;
  }
  return parseForwardedFor(forwardedFor);
}
