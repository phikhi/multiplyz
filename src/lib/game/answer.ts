/**
 * Résolution **côté client** de la bonne réponse d'une question (story #64).
 *
 * `LevelQuestion` (3.7) n'expose **jamais** la réponse séparément (anti-triche : en
 * QCM elle est noyée dans `choices`, en pavé elle n'y figure pas du tout). Pour juger
 * une réponse **pavé** localement (feedback no-fail immédiat, sans aller-retour
 * réseau bloquant, ENGINE §9) et pour révéler la bonne réponse en re-essai
 * (WIREFRAMES §3d), le client reconstruit le `Fact` depuis sa `factKey` via
 * `parseFactKey` — un module **pur et client-safe** (aucun `server-only`/DB, cf.
 * `facts.ts`), donc légitime à consommer ici. `submitAttemptAction` reste la seule
 * source de vérité de la **maîtrise** (SYNC §1) ; ceci ne sert qu'à l'**affichage**.
 */

import { parseFactKey } from "@/lib/engine/facts";

/**
 * Réponse correcte du fait désigné par `factKey`. `factKey` provient toujours d'une
 * `LevelQuestion` servie par le serveur (3.7, domaine déjà validé) → `parseFactKey`
 * ne peut renvoyer `null` que dans un cas de corruption impossible en usage normal ;
 * on retombe alors sur `NaN` (aucune réponse client ne peut jamais l'égaler, donc le
 * jugement reste sûr — jamais un faux positif silencieux).
 */
export function resolveAnswer(factKey: string): number {
  const fact = parseFactKey(factKey);
  return fact === null ? Number.NaN : fact.answer;
}
