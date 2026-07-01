import type { RateLimitConfig } from "@/config/server-config";

/**
 * Courbe de backoff des tentatives de PIN (AUTH.md §4, §7). **Pur** (aucun I/O,
 * `now` injecté) → testable à 100 %, déterministe. Enjeu **faible** (foyer privé,
 * enfant) : **pas** de verrou permanent, juste un ralentissement croissant. Les
 * seuils/fenêtres viennent de la config ⚙️ (`server-config`, posés en #2.1) — rien
 * en dur ici. Générique (seuil paramétré) → réutilisé par profil ET par IP, et par
 * la vérif du code de secours (#2.5).
 */

/** État persisté d'une cible de rate-limit (compteur + dernier échec). */
export interface AttemptState {
  /** Échecs consécutifs. */
  failures: number;
  /** Instant du dernier échec. */
  lastFailureAt: Date;
}

/**
 * Délai de backoff **requis** après `failures` échecs, pour un `threshold` donné.
 *
 * - Sous le seuil (`failures < threshold`) → `0` : `threshold` tentatives sont
 *   tolérées (une enfant se trompe sans être ralentie).
 * - À partir du seuil (`failures >= threshold`, donc dès la tentative suivante) →
 *   croissance géométrique `base * factor^(failures - threshold)` (au seuil =
 *   délai de base), **plafonnée** à `backoffMaxMs` (jamais de verrou permanent).
 */
export function backoffDelayMs(
  failures: number,
  threshold: number,
  config: RateLimitConfig,
): number {
  if (failures < threshold) return 0;
  const raw = config.backoffBaseMs * config.backoffFactor ** (failures - threshold);
  return Math.min(raw, config.backoffMaxMs);
}

/**
 * Temps restant (ms) avant qu'une nouvelle tentative soit autorisée pour cette
 * cible. `0` si aucun état, si sous le seuil, ou si le délai est déjà écoulé
 * depuis le dernier échec.
 */
export function retryAfterMs(
  state: AttemptState | null,
  threshold: number,
  config: RateLimitConfig,
  now: Date,
): number {
  if (state === null) return 0;
  const delay = backoffDelayMs(state.failures, threshold, config);
  if (delay === 0) return 0;
  const elapsed = now.getTime() - state.lastFailureAt.getTime();
  return Math.max(0, delay - elapsed);
}

/** `true` si la cible est actuellement en backoff (tentative à refuser). */
export function isBlocked(
  state: AttemptState | null,
  threshold: number,
  config: RateLimitConfig,
  now: Date,
): boolean {
  return retryAfterMs(state, threshold, config, now) > 0;
}
