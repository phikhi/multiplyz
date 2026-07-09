import { isNotNull } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { getAuthConfig } from "@/config/server-config";
import { verifyPin } from "./pin";
import { createSession, type CreatedSession } from "./session";
import { isBlocked } from "./rate-limit";
import { attemptKey, getAttemptState, recordFailure, resetAttempts } from "./pin-attempts";
import { TIMING_EQUALIZER_HASH } from "./login";

/**
 * Connexion **parent** (AUTH.md §2 «espace parent» → PIN parent distinct, §3 session
 * parent courte, §4 anti-abus). SERVER-ONLY. **Clone du patron enfant** (`login.ts`)
 * mais sur le **PIN parent** porté par le profil **propriétaire** (`profiles.parentPinHash`,
 * cf. invariant schéma : l'owner = l'unique ligne où `parent_pin_hash IS NOT NULL`).
 *
 * Réutilise les briques génériques de l'épic #2 (crypto `pin.ts`, session `session.ts`,
 * rate-limit `rate-limit.ts`/`pin-attempts.ts`, égaliseur temporel `TIMING_EQUALIZER_HASH`)
 * — **aucune** logique dupliquée. Décisions **VERROUILLÉES** (AUTH.md) : cookie unique
 * `mz_session` discriminé par `kind` (`createSession(..., "parent", ...)` applique
 * `parentSessionMs`), jamais de verrou permanent, message générique.
 */

/**
 * Cible **fixe** du rate-limit parent (single-tenant : un seul propriétaire, AUTH.md §1).
 * Clé de compteur `profile:parent` — distincte des clés enfant `profile:<id>` (id numérique,
 * jamais `"parent"`) et de la clé récupération `recovery:owner`. Fixe (pas l'id de l'owner)
 * pour rester **stable même quand le foyer n'existe pas** → le chemin bloqué ne révèle jamais
 * l'existence/l'id de l'owner (anti-énumération §4).
 */
const PARENT_ATTEMPT_TARGET = "parent";

/** Owner tel que **lu** en base pour la vérif du PIN parent (le hash est non-null par filtre). */
interface OwnerParentPinRow {
  id: number;
  /** Hash du PIN parent — non-null car sélectionné via `isNotNull(parent_pin_hash)`. */
  parentPinHash: string | null;
}

/**
 * Lit le profil **propriétaire** (l'unique porteur d'un `parent_pin_hash`, invariant schéma).
 * `undefined` si le foyer n'est pas encore configuré.
 */
function getOwnerWithParentPin(db: AppDatabase): OwnerParentPinRow | undefined {
  return db
    .select({ id: profiles.id, parentPinHash: profiles.parentPinHash })
    .from(profiles)
    .where(isNotNull(profiles.parentPinHash))
    .limit(1)
    .get();
}

/**
 * Vérifie le **PIN parent** puis ouvre une **session parent** (courte, `parentSessionMs`) en
 * cas de succès. Anti-énumération (AUTH.md §4) : renvoie `null` de façon **indiscernable** que
 * le foyer soit absent OU le PIN faux — hash factice `TIMING_EQUALIZER_HASH` quand l'owner est
 * absent (temps constant, pas de court-circuit observable). `pin` vient d'un endpoint public →
 * garde de **forme** (type) avant toute requête. `now` injecté → échéance déterministe.
 */
export async function authenticateParent(
  db: AppDatabase,
  pin: string,
  now: Date,
): Promise<CreatedSession | null> {
  if (typeof pin !== "string") return null;

  const owner = getOwnerWithParentPin(db);
  // Foyer absent → on vérifie quand même (hash factice) pour un temps constant, puis échec
  // générique. `verifyPin` ne throw jamais (hash malformé → false).
  const ok = await verifyPin(owner?.parentPinHash ?? TIMING_EQUALIZER_HASH, pin);
  if (!ok || owner === undefined) return null;

  return createSession(db, owner.id, "parent", now);
}

/** Entrée d'une tentative de connexion parent enveloppée par le rate-limit. */
export interface ParentLoginInput {
  pin: string;
  /** IP client (rate-limit par IP, AUTH.md §4) — cf. `resolveClientIp`. */
  ip: string;
}

/**
 * `authenticateParent` **enveloppé du rate-limit + backoff** (AUTH.md §4), scope **profile**
 * (cible fixe `parent`) **et** IP — même garde-fou proportionné que la connexion enfant :
 * après ~5 échecs, backoff croissant, **jamais** de verrou permanent.
 *
 * - **Cible bloquée** (parent OU IP en backoff) → `null` immédiat, **sans** vérifier le PIN.
 * - **Succès** → réinitialise les deux compteurs puis renvoie la session parent.
 * - **Échec** → incrémente les deux compteurs.
 *
 * Renvoie `null` de façon **générique** (blocage vs PIN faux vs foyer absent indiscernables,
 * anti-énumération §4). `now` injecté → déterministe.
 */
export async function guardedAuthenticateParent(
  db: AppDatabase,
  input: ParentLoginInput,
  now: Date,
): Promise<CreatedSession | null> {
  const { rateLimit } = getAuthConfig();
  const profileKey = attemptKey("profile", PARENT_ATTEMPT_TARGET);
  const ipKey = attemptKey("ip", input.ip);

  const profileBlocked = isBlocked(
    getAttemptState(db, profileKey),
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
  if (profileBlocked || ipBlocked) return null;

  const created = await authenticateParent(db, input.pin, now);
  if (created !== null) {
    resetAttempts(db, profileKey);
    resetAttempts(db, ipKey);
    return created;
  }

  recordFailure(db, profileKey, now);
  recordFailure(db, ipKey, now);
  return null;
}
