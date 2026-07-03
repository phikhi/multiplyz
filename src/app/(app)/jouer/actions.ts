"use server";

import { getDb } from "@/lib/db";
import { getEngineConfig } from "@/config/server-config";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import {
  needsDiagnostic,
  seedDiagnostic,
  startLevel,
  submitAttempt,
  type Level,
  type RawDiagnosticResponse,
  type SubmitAttemptInput,
} from "@/lib/engine/service";
import { selectDiagnostic, type DiagnosticItem } from "@/lib/engine/diagnostic";

/**
 * Server actions du jeu (ENGINE §3/§4/§10, SYNC §1/§2). Adaptateurs **minces** au-dessus
 * de `@/lib/engine/service` : la logique (sélection/maîtrise/transaction/idempotence) vit
 * côté serveur (source de vérité). Le client ne fournit **jamais** le `profile_id` — il
 * vient toujours de la session enfant (`getCurrentChildProfileId`, filtre `kind`, #63/#42).
 *
 * Runtime **Node** (transaction better-sqlite3), pas edge. `runtime = "nodejs"` est déjà
 * imposé par la page du groupe `(app)`.
 *
 * Non authentifié (pas de session enfant valide) → `null`/`{ ok: false }` **générique**
 * (jamais de fuite, cohérent avec l'auth #2.3). L'horloge serveur (`Date.now()`) et le RNG
 * (`Math.random`) sont injectés **ici** (la frontière) → le cœur du service reste
 * déterministe/testable (LEARNINGS #46/aléa).
 */

/** Réponse de démarrage de niveau : le niveau, ou `null` si non authentifié. */
export interface StartLevelActionResult {
  readonly level: Level | null;
}

/**
 * Démarre un niveau pour la session enfant courante. Lecture seule (aucune écriture au
 * démarrage). `null` si pas de session enfant valide.
 */
export async function startLevelAction(): Promise<StartLevelActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { level: null };
  }
  const level = startLevel(getDb(), profileId, getEngineConfig(), Date.now(), Math.random);
  return { level };
}

/** Réponse de soumission — neutre : succès/échec + maîtrise à jour du fait (ou `null`). */
export interface SubmitAttemptActionResult {
  readonly ok: boolean;
  /** Nouvelle maîtrise du fait (box), ou `null` (re-essai / non authentifié / invalide). */
  readonly box: number | null;
}

/**
 * Soumet une réponse pour la session enfant courante. Le `profile_id` vient de la session
 * (jamais du client). Payload validé côté service (forme + domaine, #36). `{ ok: false }`
 * si non authentifié ou payload invalide (pas de 500). L'idempotence (rejeu via
 * `clientAttemptId`, SYNC §2) et l'atomicité (transaction sync) sont portées par le service.
 */
export async function submitAttemptAction(
  input: SubmitAttemptInput,
): Promise<SubmitAttemptActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { ok: false, box: null };
  }
  const result = submitAttempt(getDb(), profileId, input, getEngineConfig(), Date.now());
  if (!result.ok) {
    return { ok: false, box: null };
  }
  return { ok: true, box: result.state === null ? null : result.state.box };
}

/** Réponse de sélection du diagnostic : les items à poser (ou `null` si non authentifié). */
export interface DiagnosticPlanActionResult {
  readonly items: readonly DiagnosticItem[] | null;
}

/**
 * Renvoie le plan de diagnostic (~18 faits, ENGINE §3) à poser en 1ʳᵉ session, **ou une
 * liste vide** si le profil est déjà amorcé (le diagnostic ne se joue qu'une fois, §3).
 * Lecture seule (aucune écriture) — l'amorçage se fait ensuite via `seedDiagnosticAction`.
 * `null` si pas de session enfant valide.
 */
export async function diagnosticPlanAction(): Promise<DiagnosticPlanActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { items: null };
  }
  // Ne proposer le diagnostic qu'à un profil vierge (1ʳᵉ session) : un profil déjà amorcé
  // n'en rejoue pas (cohérent avec l'idempotence de `seedDiagnostic`).
  if (!needsDiagnostic(getDb(), profileId)) {
    return { items: [] };
  }
  return { items: selectDiagnostic(getEngineConfig()) };
}

/** Réponse d'amorçage du diagnostic : nb de faits amorcés (0 si déjà fait / non auth). */
export interface SeedDiagnosticActionResult {
  readonly ok: boolean;
  readonly seededCount: number;
}

/**
 * Amorce la maîtrise du profil de session à partir des réponses du diagnostic (ENGINE §3).
 * Idempotent (n'écrit que sur un profil vierge, SYNC §5). `{ ok: false }` si non
 * authentifié ; `seededCount` = 0 si le profil est déjà amorcé (rejeu) ou aucune réponse
 * valide. Écriture atomique (transaction sync) portée par le service.
 */
export async function seedDiagnosticAction(
  responses: readonly RawDiagnosticResponse[],
): Promise<SeedDiagnosticActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { ok: false, seededCount: 0 };
  }
  const seeded = seedDiagnostic(getDb(), profileId, responses, getEngineConfig(), Date.now());
  return { ok: true, seededCount: seeded.length };
}
