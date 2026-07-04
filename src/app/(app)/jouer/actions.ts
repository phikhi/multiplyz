"use server";

import { getDb } from "@/lib/db";
import {
  getEconomyConfig,
  getEngineConfig,
  getMapConfig,
  type EngineConfig,
} from "@/config/server-config";
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
import { finishLevel, type FinishLevelError, type GrantedLegendary } from "@/lib/game/finish-level";
import type { RewardBreakdown } from "@/lib/game/reward";
import { getUnlockedWorldCount, resolveCurrentLevelTarget } from "@/lib/game/unlock";

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

/**
 * Réponse de démarrage de niveau : le niveau, ou `null` si non authentifié.
 *
 * `starThresholds` (ENGINE §5/§11, ⚙️) est renvoyé **avec** le niveau — le client
 * (#64) calcule les étoiles de fin de niveau **localement** (justesse de la 1ʳᵉ
 * réponse déjà connue côté client, ENGINE §5) sans aller-retour réseau bloquant ni
 * réimplémenter le seuil ; `getEngineConfig()` (server-only, lit l'env + des
 * secrets potentiels) ne doit **jamais** être importée côté client — seule cette
 * valeur ⚙️, déjà publique par nature (affichée à l'écran résultats), traverse la
 * frontière server action.
 */
export interface StartLevelActionResult {
  readonly level: Level | null;
  readonly starThresholds: EngineConfig["starThresholds"];
}

/**
 * Démarre un niveau pour la session enfant courante. Lecture seule (aucune écriture au
 * démarrage). `level: null` si pas de session enfant valide (`starThresholds` renvoyé
 * quand même — valeur ⚙️ publique, pas liée à l'auth — pour un contrat de retour stable).
 */
export async function startLevelAction(): Promise<StartLevelActionResult> {
  const config = getEngineConfig();
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { level: null, starThresholds: config.starThresholds };
  }
  const level = startLevel(getDb(), profileId, config, Date.now(), Math.random);
  return { level, starThresholds: config.starThresholds };
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

// ============================================================================
// Fin de niveau : progression + gains de pièces + déblocage linéaire
// (MAP §1/§4/§6, ECONOMY §4.1, story #126, ferme #136)
// ============================================================================

/**
 * Réponse de fin de niveau — **discriminée par `ok`** (contrat de forme fixe côté client) :
 * - **succès** (`ok: true`) ⇒ `error: null`, `stars` = étoiles **effectivement stockées**
 *   (le max monotone), `unlockedNextWorld` = ce niveau était le **boss**, `reward` = la
 *   décomposition du gain de pièces (base + étoiles + trésor), `coins`/`shards` = **solde**
 *   après crédit, `coinsApplied` = `false` si c'était un rejeu (aucun 2ᵉ crédit) ;
 * - **refus** (`ok: false`) ⇒ tous les champs de gain à `null`/`false`, `error` = motif
 *   **neutre** (non authentifié, ou — cas résiduel improbable puisque le serveur résout
 *   lui-même la cible — verrouillé/invalide).
 *
 * Contrat volontairement « plat » (mêmes champs dans les deux cas, `null` en refus) pour
 * rester trivial à consommer côté client sans narrowing — les corrélations sont **garanties
 * par les sites de retour** (ci-dessous).
 */
export interface FinishLevelActionResult {
  /** `true` = fin persistée ; `false` = refus (voir `error`). Discriminant du contrat. */
  readonly ok: boolean;
  /** Étoiles stockées après l'écriture monotone (`number` si `ok`, `null` en refus). */
  readonly stars: number | null;
  /** Monde suivant débloqué (boss complété) ? `false` en refus ou sur un niveau non-boss. */
  readonly unlockedNextWorld: boolean;
  /** Décomposition du gain de pièces (base + étoiles + trésor), `null` en refus. */
  readonly reward: RewardBreakdown | null;
  /** Solde de **pièces** après la fin de niveau (`number` si `ok`, `null` en refus). */
  readonly coins: number | null;
  /** `false` si le crédit était un **rejeu** déjà journalisé (aucun 2ᵉ crédit). */
  readonly coinsApplied: boolean;
  /**
   * **Légendaire garantie** du boss (MAP §6, story 5.6), ou `null` (niveau non-boss / refus).
   * Toujours présente sur un boss (même au rejeu — décrit ce que le monde donne).
   */
  readonly legendary: GrantedLegendary | null;
  /**
   * `true` si la légendaire vient d'être **ajoutée** (1ʳᵉ victoire du boss) ; `false` sinon
   * (niveau non-boss, rejeu d'un boss déjà battu — aucun doublon parasite).
   */
  readonly legendaryAdded: boolean;
  /** Motif de refus **neutre** si `!ok`, `null` si `ok`. */
  readonly error: FinishLevelError | "UNAUTHENTICATED" | null;
}

/** Refus **neutre** (contrat plat) : tous les champs de gain à `null`/`false` (pas de fuite). */
function finishLevelRefusal(error: FinishLevelError | "UNAUTHENTICATED"): FinishLevelActionResult {
  return {
    ok: false,
    stars: null,
    unlockedNextWorld: false,
    reward: null,
    coins: null,
    coinsApplied: false,
    legendary: null,
    legendaryAdded: false,
    error,
  };
}

/**
 * Persiste la **fin du niveau courant** pour la session enfant + **crédite les pièces**
 * (MAP §1/§4/§6, ECONOMY §4.1, PRODUCT §2.2/§2.3, ferme #136).
 *
 * **Source de vérité serveur (SYNC §1)** : le client n'envoie **que ses étoiles** (calculées
 * localement, ENGINE §5) — **jamais** de `world_index`/`level_index`. Le serveur **résout
 * lui-même** la cible (`resolveCurrentLevelTarget` : dernier monde débloqué + nœud courant),
 * dérive le **type de nœud** (bonus trésor) de la géométrie, et écrit progression + crédit +
 * ledger dans **une transaction atomique** (`finishLevel`). Rejeu (retry réseau) ⇒ **aucun
 * double effet** : progression monotone + crédit idempotent (`ref_id = level:<world>:<level>`).
 *
 * Le **déblocage** (monde suivant) est **dérivé du progress** — jamais conditionné aux étoiles
 * (MAP §1/§8). Barème = **config versionnée** (`EconomyConfig`), jamais en dur. `{ ok: false }`
 * **neutre** si non authentifié (pas de 500). Horloge serveur injectée (`new Date()`).
 *
 * @param stars étoiles obtenues (0..3) — **seule** entrée client, validée par `finishLevel`.
 */
export async function finishLevelAction(stars: unknown): Promise<FinishLevelActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return finishLevelRefusal("UNAUTHENTICATED");
  }
  const db = getDb();
  const mapConfig = getMapConfig();
  // Cible résolue **serveur** (jamais transmise par le client) : dernier monde débloqué +
  // nœud courant. `finishLevel` re-garde le déblocage dans sa propre transaction.
  const target = resolveCurrentLevelTarget(db, profileId, mapConfig.levelsPerWorld);
  const result = finishLevel(
    db,
    profileId,
    { worldIndex: target.worldIndex, levelIndex: target.levelIndex, stars },
    mapConfig,
    getEconomyConfig(),
    new Date(),
  );
  if (!result.ok) {
    return finishLevelRefusal(result.error);
  }
  return {
    ok: true,
    stars: result.stars,
    unlockedNextWorld: result.unlockedNextWorld,
    reward: result.reward,
    coins: result.balance.coins,
    coinsApplied: result.coinsApplied,
    legendary: result.legendary,
    legendaryAdded: result.legendaryAdded,
    error: null,
  };
}

/** Réponse de lecture du nombre de mondes débloqués (`null` si non authentifié). */
export interface UnlockedWorldCountActionResult {
  /** Nombre de mondes débloqués (≥ 1), ou `null` si pas de session enfant valide. */
  readonly count: number | null;
}

/**
 * Nombre de **mondes débloqués** pour la session enfant courante (déblocage linéaire dérivé du
 * progress, MAP §1/§6). Lecture seule. Le monde 0 est toujours ouvert ; chaque monde suivant
 * est ouvert **ssi le boss du monde précédent est complété** — **jamais** un seuil d'étoiles.
 * `null` si pas de session enfant valide (générique, pas de fuite).
 */
export async function unlockedWorldCountAction(): Promise<UnlockedWorldCountActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { count: null };
  }
  const count = getUnlockedWorldCount(getDb(), profileId, getMapConfig().levelsPerWorld);
  return { count };
}
