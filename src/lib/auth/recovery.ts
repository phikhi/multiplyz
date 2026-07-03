import { and, eq, isNotNull } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { getAuthConfig } from "@/config/server-config";
import { hashSecret, verifyPin } from "./pin";
import { generateRecoveryCode, hashRecoveryCode, verifyRecoveryCode } from "./tokens";
import { isValidPin, sanitizeRecoveryCode } from "./validation";
import { TIMING_EQUALIZER_HASH } from "./login";
import { isBlocked } from "./rate-limit";
import { attemptKey, getAttemptState, recordFailure, resetAttempts } from "./pin-attempts";

/**
 * Récupération du PIN parent via le **code de secours** (AUTH.md §5). SERVER-ONLY.
 * Le parent oublieux saisit le code (noté au 1er usage, #2.2) → s'il correspond au
 * **hash** stocké, il pose un nouveau PIN parent. Le path de vérif est **rate-limité**
 * (réutilise #2.4). Après reset, un **nouveau** code de secours est régénéré (l'ancien
 * est consommé) et affiché une seule fois. Aucun email ; filet ultime = accès base.
 */

/** Cible unique du rate-limit de récupération (foyer single-tenant). */
const RECOVERY_TARGET = "owner";

/** Codes d'échec de la récupération — mappés vers `strings.recovery.errors`. */
export type RecoveryErrorCode = "CODE_INVALID" | "PIN_INVALID" | "PARENT_PIN_SAME";

/** Erreur typée : rien n'est réinitialisé. `CODE_INVALID` = **générique** (code faux OU backoff). */
export class RecoveryError extends Error {
  constructor(readonly code: RecoveryErrorCode) {
    super(code);
    this.name = "RecoveryError";
  }
}

/** Profil propriétaire tel que **lu** en base (le code de secours est nullable). */
interface OwnerRow {
  id: number;
  /** Hash du PIN **enfant** — sert à interdire un PIN parent identique. */
  pinHash: string;
  /** Hash du code de secours courant (nullable en base, présent sur l'owner). */
  recoveryCodeHash: string | null;
}

/**
 * Propriétaire **vérifié** renvoyé après succès de `guardedVerifyRecovery` : le
 * `recoveryCodeHash` est le hash **effectivement** confronté au code (jamais null
 * — un owner sans hash de secours aurait échoué contre `TIMING_EQUALIZER_HASH`).
 * Ce hash est réutilisé tel quel comme prédicat du CAS anti-TOCTOU (#50).
 */
interface Owner {
  id: number;
  pinHash: string;
  /** Hash du code de secours qui a validé (non-null par construction). */
  recoveryCodeHash: string;
}

/** Entrée de réinitialisation (code + nouveau PIN restent en clair jusqu'au hash). */
export interface ResetParentPinInput {
  code: string;
  newParentPin: string;
  /** IP client (rate-limit par IP, AUTH.md §4) — cf. `resolveClientIp`. */
  ip: string;
}

/** Le profil propriétaire lu en base, ou `undefined` si le foyer n'est pas configuré. */
function getOwner(db: AppDatabase): OwnerRow | undefined {
  return db
    .select({
      id: profiles.id,
      pinHash: profiles.pinHash,
      recoveryCodeHash: profiles.recoveryCodeHash,
    })
    .from(profiles)
    .where(isNotNull(profiles.parentPinHash))
    .limit(1)
    .get();
}

/**
 * Vérifie le code de secours **enveloppé du rate-limit** (par récupération ET par
 * IP, AUTH.md §4/§5). Renvoie le propriétaire en cas de succès (pour enchaîner le
 * reset sans re-lecture), sinon `null` — **générique** (code faux, foyer absent ou
 * backoff tous indiscernables). `now` injecté → déterministe.
 *
 * - Cible bloquée → `null` immédiat, **sans** vérifier (le but du ralentissement).
 * - Succès → réinitialise les deux compteurs.
 * - Échec → incrémente les deux compteurs. Foyer absent → `verify` factice à temps
 *   constant (pas de court-circuit observable), échec générique.
 */
export async function guardedVerifyRecovery(
  db: AppDatabase,
  code: string,
  ip: string,
  now: Date,
): Promise<Owner | null> {
  const { rateLimit } = getAuthConfig();
  const recoveryKey = attemptKey("recovery", RECOVERY_TARGET);
  const ipKey = attemptKey("ip", ip);

  const recoveryBlocked = isBlocked(
    getAttemptState(db, recoveryKey),
    rateLimit.maxAttemptsPerProfile,
    rateLimit,
    now,
  );
  const ipBlocked = isBlocked(
    getAttemptState(db, ipKey),
    rateLimit.maxAttemptsPerIp,
    rateLimit,
    now,
  );
  if (recoveryBlocked || ipBlocked) return null;

  const owner = getOwner(db);
  // Hash **effectivement** confronté au code : le hash de secours de l'owner, ou le
  // hash factice (foyer absent → `verify` à temps constant, anti-énumération §4).
  const verifiedHash = owner?.recoveryCodeHash ?? TIMING_EQUALIZER_HASH;
  const ok = await verifyRecoveryCode(verifiedHash, code);
  // Ordre `owner !== undefined && ok` : foyer absent court-circuite AVANT `ok`
  // (branches toutes atteignables ; le `verify` factice garde un temps constant).
  if (owner !== undefined && ok) {
    resetAttempts(db, recoveryKey);
    resetAttempts(db, ipKey);
    // On propage le hash confronté (jamais null : c'est celui qui a validé) → il
    // sert de prédicat au CAS anti-TOCTOU du reset (#50), sans re-lire la base.
    return { id: owner.id, pinHash: owner.pinHash, recoveryCodeHash: verifiedHash };
  }

  recordFailure(db, recoveryKey, now);
  recordFailure(db, ipKey, now);
  return null;
}

/**
 * Vérifie **seulement** le code de secours (étape 1 de l'UI, rate-limitée) →
 * `true`/`false` générique. Le code est normalisé (majuscules, espaces retirés).
 */
export async function verifyRecovery(
  db: AppDatabase,
  code: string,
  ip: string,
  now: Date,
): Promise<boolean> {
  if (typeof code !== "string") return false;
  return (await guardedVerifyRecovery(db, sanitizeRecoveryCode(code), ip, now)) !== null;
}

/**
 * Réinitialise le PIN parent après vérification du code de secours (AUTH.md §5).
 * Ordre : garde forme → **re-vérif du code** (rate-limitée, autoritative — ne fait
 * jamais confiance à l'étape 1 client) → validation du nouveau PIN (4 chiffres,
 * **≠ PIN enfant** via `verifyPin` sur le hash enfant) → hash + `UPDATE` du
 * propriétaire (nouveau PIN parent + **nouveau** code de secours régénéré). L'ancien
 * PIN parent et l'ancien code de secours ne fonctionnent plus.
 *
 * Lève `RecoveryError` : `CODE_INVALID` (générique : code faux/backoff), `PIN_INVALID`,
 * `PARENT_PIN_SAME`. Renvoie le **nouveau** code de secours en clair, à afficher une fois.
 */
export async function resetParentPin(
  db: AppDatabase,
  input: ResetParentPinInput,
  now: Date,
): Promise<{ recoveryCode: string }> {
  if (typeof input.code !== "string" || typeof input.newParentPin !== "string") {
    throw new RecoveryError("CODE_INVALID");
  }

  const owner = await guardedVerifyRecovery(db, sanitizeRecoveryCode(input.code), input.ip, now);
  if (owner === null) throw new RecoveryError("CODE_INVALID");

  if (!isValidPin(input.newParentPin)) throw new RecoveryError("PIN_INVALID");
  // PIN parent ≠ PIN enfant (AUTH.md §1/§4) : comparé contre le hash enfant stocké.
  if (await verifyPin(owner.pinHash, input.newParentPin)) {
    throw new RecoveryError("PARENT_PIN_SAME");
  }

  // Régénère le code de secours (l'ancien est consommé). Hash AVANT l'écriture.
  const recoveryCode = generateRecoveryCode();
  const [parentPinHash, recoveryCodeHash] = await Promise.all([
    hashSecret(input.newParentPin),
    hashRecoveryCode(recoveryCode),
  ]);

  // **CAS anti-TOCTOU (#50)** : entre la vérif du code (`guardedVerifyRecovery`,
  // qui a lu `owner.recoveryCodeHash`) et cet `UPDATE`, plusieurs `await` argon2
  // ont rendu la main à l'event loop → un second reset concurrent avec le même
  // code valide pourrait s'intercaler (endpoint public ; `disabled={submitting}`
  // client n'est PAS une garantie serveur). Sans garde, on aurait un
  // **last-write-wins** : un appelant recevrait un code de secours qui n'est PAS
  // celui persisté. On borne donc l'écriture au hash **exactement** lu/vérifié
  // (`WHERE id = ? AND recovery_code_hash = ?`) : le 1er reset consomme le hash,
  // le 2ᵉ ne matche plus (0 ligne) → `CODE_INVALID` propre plutôt qu'un écrasement
  // silencieux. Une transaction sync ne suffit PAS ici (le hash est déjà calculé
  // hors event-loop) : c'est le **prédicat sur l'ancien hash** qui sérialise, à la
  // manière du pattern transaction-sync de `createHousehold` (LEARNINGS #36), sans
  // casser « callback argon2 async hors transaction ».
  const changed = db
    .update(profiles)
    .set({ parentPinHash, recoveryCodeHash })
    .where(and(eq(profiles.id, owner.id), eq(profiles.recoveryCodeHash, owner.recoveryCodeHash)))
    .run().changes;
  if (changed !== 1) throw new RecoveryError("CODE_INVALID");

  return { recoveryCode };
}
