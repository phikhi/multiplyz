import { isNotNull, sql } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { isValidAvatarId } from "@/config/avatars";
import { hashPin, hashSecret } from "./pin";
import { generateRecoveryCode, hashRecoveryCode } from "./tokens";
import { isValidName, isValidPin, parentPinDiffersFromChild, sanitizeName } from "./validation";

/**
 * Logique métier de l'onboarding 1er usage (AUTH.md §2, PRODUCT.md §1.1).
 * SERVER-ONLY (importe la couche hash + la DB). Source de vérité serveur :
 * validation + hachage + écriture **idempotente**. La server action (`actions.ts`)
 * n'est qu'un adaptateur mince au-dessus.
 */

/** Codes d'échec de l'onboarding — mappés vers `strings.onboarding.errors`. */
export type OnboardingErrorCode =
  "NAME_INVALID" | "AVATAR_INVALID" | "PIN_INVALID" | "PARENT_PIN_SAME" | "NAME_TAKEN";

/** Erreur typée : rien n'est créé (AUTH.md §4, validation serveur). */
export class OnboardingError extends Error {
  constructor(readonly code: OnboardingErrorCode) {
    super(code);
    this.name = "OnboardingError";
  }
}

/** Entrée brute de création du foyer (le PIN reste en clair jusqu'au hash). */
export interface CreateHouseholdInput {
  name: string;
  avatar: string;
  childPin: string;
  parentPin: string;
}

/**
 * Résultat de `createHousehold`.
 * - `created: true` → foyer posé, `recoveryCode` en clair **à afficher une fois**.
 * - `created: false` → foyer déjà configuré (rejeu idempotent), aucun secret.
 */
export type CreateHouseholdResult = { created: true; recoveryCode: string } | { created: false };

/**
 * `true` si le foyer est déjà configuré : l'unique profil **propriétaire**
 * existe (celui qui porte `parent_pin_hash`, cf. invariant schéma). Sert de
 * garde d'idempotence (rejeu de la création = no-op) et de gating du 1er écran.
 */
export function householdExists(db: AppDatabase): boolean {
  const owner = db
    .select({ id: profiles.id })
    .from(profiles)
    .where(isNotNull(profiles.parentPinHash))
    .limit(1)
    .get();
  return owner !== undefined;
}

/**
 * `true` si un profil porte déjà ce prénom (comparaison **insensible à la
 * casse** — une enfant tape sa casse au hasard ; l'index UNIQUE en base est
 * BINARY, on renforce ici au niveau requête, cf. schema.ts + LEARNINGS #34).
 */
function nameTaken(db: AppDatabase, name: string): boolean {
  const existing = db
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`lower(${profiles.name}) = ${name.toLowerCase()}`)
    .limit(1)
    .get();
  return existing !== undefined;
}

/**
 * Garde-fou de **forme** sur une entrée non fiable (la server action est un
 * endpoint public : `CreateHouseholdInput` n'est pas garanti au runtime). Refuse
 * tout champ non-string AVANT sanitisation → erreur de validation propre plutôt
 * qu'un `TypeError` 500 sur input forgé (AUTH.md §4).
 */
function assertStringFields(input: CreateHouseholdInput): void {
  if (typeof input.name !== "string") throw new OnboardingError("NAME_INVALID");
  if (typeof input.avatar !== "string") throw new OnboardingError("AVATAR_INVALID");
  if (typeof input.childPin !== "string" || typeof input.parentPin !== "string") {
    throw new OnboardingError("PIN_INVALID");
  }
}

/** Valide l'entrée ; lève `OnboardingError` au 1er problème (rien créé). */
function assertValidInput(name: string, input: CreateHouseholdInput): void {
  if (!isValidName(name)) throw new OnboardingError("NAME_INVALID");
  if (!isValidAvatarId(input.avatar)) throw new OnboardingError("AVATAR_INVALID");
  if (!isValidPin(input.childPin) || !isValidPin(input.parentPin)) {
    throw new OnboardingError("PIN_INVALID");
  }
  if (!parentPinDiffersFromChild(input.childPin, input.parentPin)) {
    throw new OnboardingError("PARENT_PIN_SAME");
  }
}

/**
 * Crée le foyer au 1er usage : profil propriétaire (prénom, avatar, PIN enfant)
 * + PIN parent + code de secours. **Idempotente** : si le foyer existe déjà,
 * ne crée rien et ne renvoie aucun secret.
 *
 * Ordre : forme → valider → hash (async) → re-vérif + insert **atomiques**.
 * Les PIN et le code de secours ne sont persistés que **hachés** (argon2id) ;
 * le code de secours est renvoyé **en clair une seule fois** (AUTH.md §5).
 *
 * **Atomicité (anti-TOCTOU)** : le hash est async (rend la main à l'event loop),
 * donc la garde d'idempotence/unicité + l'`insert` vivent dans une transaction
 * **synchrone** better-sqlite3 — aucun autre tour d'event loop ne peut s'y
 * intercaler → deux soumissions concurrentes ne peuvent pas créer 2 propriétaires
 * ni lever une violation `UNIQUE` non gérée (l'invariant « owner unique » tient).
 */
export async function createHousehold(
  db: AppDatabase,
  input: CreateHouseholdInput,
): Promise<CreateHouseholdResult> {
  assertStringFields(input);
  const name = sanitizeName(input.name);
  assertValidInput(name, input);

  // Hash AVANT la transaction (argon2 est async ; un callback de transaction
  // better-sqlite3 doit rester synchrone).
  const recoveryCode = generateRecoveryCode();
  const [pinHash, parentPinHash, recoveryCodeHash] = await Promise.all([
    hashPin(input.childPin),
    hashSecret(input.parentPin),
    hashRecoveryCode(recoveryCode),
  ]);

  const created = db.transaction((tx) => {
    // Rejeu : foyer déjà configuré → no-op idempotent (pas de doublon, AUTH.md §2).
    if (householdExists(db)) return false;
    if (nameTaken(db, name)) throw new OnboardingError("NAME_TAKEN");
    tx.insert(profiles)
      .values({ name, avatar: input.avatar, pinHash, parentPinHash, recoveryCodeHash })
      .run();
    return true;
  });

  return created ? { created: true, recoveryCode } : { created: false };
}
