import { getCurrentChildSession } from "@/lib/auth/current-session";

/**
 * Résolution du **profil de la session enfant courante** pour la frontière du moteur
 * (SYNC §1, AUTH §3). Toute écriture du moteur (`attempts`/`mastery`) est liée à **ce**
 * `profile_id` — **jamais** un profil arbitraire fourni par le client (note review
 * sécurité PR #68 sur #63, LEARNINGS #42 : filtre `kind` à la frontière).
 *
 * Glue mince au-dessus de `getCurrentChildSession` (qui lit le cookie + filtre déjà
 * `kind === "child"`). SERVER-ONLY par transitivité.
 */

/**
 * `profile_id` de la session enfant valide de la requête, ou `null` (cookie absent,
 * token inconnu/expiré, ou session non-enfant). L'appelant (server action) refuse
 * l'opération sur `null` → aucune écriture sans session enfant authentifiée.
 */
export async function getCurrentChildProfileId(): Promise<number | null> {
  const session = await getCurrentChildSession();
  return session === null ? null : session.profileId;
}
