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
 * Ordre : valider → court-circuit idempotent → unicité prénom → hash → insert.
 * Les PIN et le code de secours ne sont persistés que **hachés** (argon2id) ;
 * le code de secours est renvoyé **en clair une seule fois** (AUTH.md §5).
 */
export async function createHousehold(
  db: AppDatabase,
  input: CreateHouseholdInput,
): Promise<CreateHouseholdResult> {
  const name = sanitizeName(input.name);
  assertValidInput(name, input);

  // Rejeu : foyer déjà configuré → no-op idempotent (pas de doublon, AUTH.md §2).
  if (householdExists(db)) return { created: false };
  if (nameTaken(db, name)) throw new OnboardingError("NAME_TAKEN");

  const recoveryCode = generateRecoveryCode();
  const [pinHash, parentPinHash, recoveryCodeHash] = await Promise.all([
    hashPin(input.childPin),
    hashSecret(input.parentPin),
    hashRecoveryCode(recoveryCode),
  ]);

  db.insert(profiles)
    .values({ name, avatar: input.avatar, pinHash, parentPinHash, recoveryCodeHash })
    .run();

  return { created: true, recoveryCode };
}
