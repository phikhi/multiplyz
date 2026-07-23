import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { hashPin, verifyPin } from "@/lib/auth/pin";
import { isValidName, isValidPin, nameKey, sanitizeName } from "@/lib/auth/validation";

/**
 * **Gestion des profils** de l'espace parent (story 7.5, DETAILS §3 « Gérer les profils »,
 * AUTH.md §5 réinit PIN enfant, §6 suppression = purge RGPD). SERVER-ONLY (importe la couche
 * hash + la DB). Source de vérité serveur : validation + hachage + écriture. Les server actions
 * (`(espace)/profils/actions.ts`) ne sont que des adaptateurs **minces** au-dessus, chacun
 * gardé par une session parent valide.
 *
 * Trois opérations, toutes **décisions verrouillées** (implémentées, jamais re-décidées) :
 * - **renommer** un profil (valide + unique, réutilise `validation.ts` de l'onboarding) ;
 * - **réinitialiser le PIN enfant** (nouveau PIN hashé argon2id via `pin.ts`, jamais en clair) ;
 * - **supprimer** un profil = **purge** : un `DELETE` unique qui **cascade** (FK `ON DELETE
 *   CASCADE` déjà en place, `schema.ts`) sur `sessions` (révocation), `mastery`, `attempts`,
 *   `progress`, `wallet`, `ledger`, `collection`. Garde : le profil **propriétaire** (porteur de
 *   `parent_pin_hash`) est **indestructible** (sinon le foyer perdrait l'accès parent + le code
 *   de secours — AUTH.md §6 : supprimer un profil ≠ supprimer le foyer).
 */

/** Codes d'échec — mappés vers `strings.parent.manage.errors`. */
export type ProfileManagementErrorCode =
  | "NAME_INVALID"
  | "NAME_TAKEN"
  | "PIN_INVALID"
  | "PARENT_PIN_SAME"
  | "PROFILE_NOT_FOUND"
  | "OWNER_UNDELETABLE";

/** Erreur typée : rien n'est modifié (validation serveur, AUTH.md §4). */
export class ProfileManagementError extends Error {
  constructor(readonly code: ProfileManagementErrorCode) {
    super(code);
    this.name = "ProfileManagementError";
  }
}

/**
 * Projection **de gestion** d'un profil pour l'écran « Gérer les profils ». Aucun secret
 * (jamais de hash) : `isOwner` matérialise l'invariant « propriétaire = porteur de
 * `parent_pin_hash` » (schema.ts) SANS exposer le hash lui-même → l'UI sait griser la
 * suppression du propriétaire sans jamais recevoir de secret.
 */
export interface ManagedProfile {
  readonly id: number;
  readonly name: string;
  readonly avatar: string;
  /** `true` si ce profil porte l'accès parent (`parent_pin_hash`) → **indestructible**. */
  readonly isOwner: boolean;
}

/**
 * Liste **de gestion** des profils du foyer (écran parent). Triée par ancienneté
 * (propriétaire en tête, même ordre stable que `listProfiles`). `isOwner` dérivé de la
 * présence de `parent_pin_hash` — sélectionne uniquement le **booléen** de présence
 * (`IS NOT NULL`), jamais le hash (aucun secret ne quitte le serveur).
 */
export function listManagedProfiles(db: AppDatabase): ManagedProfile[] {
  return db
    .select({
      id: profiles.id,
      name: profiles.name,
      avatar: profiles.avatar,
      // Le prédicat `IS NOT NULL` est évalué **par SQLite** (renvoie 0/1) → seul le booléen de
      // propriété quitte la base, jamais le hash parent lui-même (aucun secret exposé).
      isOwner: sql<number>`(${profiles.parentPinHash} IS NOT NULL)`,
    })
    .from(profiles)
    .orderBy(asc(profiles.createdAt), asc(profiles.id))
    .all()
    .map((row) => ({ ...row, isOwner: row.isOwner === 1 }));
}

/** Garde de **forme** : un `profileId` non-entier (endpoint public) ⇒ profil introuvable. */
function assertProfileId(profileId: number): void {
  if (typeof profileId !== "number" || !Number.isInteger(profileId)) {
    throw new ProfileManagementError("PROFILE_NOT_FOUND");
  }
}

/**
 * **Renomme** un profil (DETAILS §3). Validation réutilisée de l'onboarding (`validation.ts`) :
 * forme → sanitisation → bornes de longueur → **unicité insensible à la casse Unicode** (clé
 * dérivée `name_key`, ADR 0005). L'unicité exclut le profil **lui-même** (renommer Léa → « Léa »
 * reste permis) : seul un **autre** profil portant la même clé lève `NAME_TAKEN`.
 *
 * **Atomicité** : entièrement **synchrone** (aucun hash, aucun `await`) → dans le daemon Node
 * mono-process (STACK.md), la lecture d'unicité et l'`UPDATE` s'exécutent dans le **même tick**
 * sans qu'un autre appel puisse s'intercaler → check-then-write déjà atomique, **sans** transaction
 * explicite (une transaction à écriture unique n'aurait aucun état partiel à annuler — rétro #124).
 * L'index UNIQUE sur `name_key` (schema.ts) reste le filet de sécurité **au niveau moteur DB**.
 */
export function renameProfile(db: AppDatabase, profileId: number, rawName: string): void {
  assertProfileId(profileId);
  if (typeof rawName !== "string") throw new ProfileManagementError("NAME_INVALID");
  const name = sanitizeName(rawName);
  if (!isValidName(name)) throw new ProfileManagementError("NAME_INVALID");

  const exists = db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1)
    .get();
  if (exists === undefined) throw new ProfileManagementError("PROFILE_NOT_FOUND");

  // Unicité : un AUTRE profil (`id != profileId`) portant la même clé → `NAME_TAKEN`.
  // Se renommer avec sa propre valeur reste permis (la ligne exclue est la sienne).
  const clash = db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.nameKey, nameKey(name)), ne(profiles.id, profileId)))
    .limit(1)
    .get();
  if (clash !== undefined) throw new ProfileManagementError("NAME_TAKEN");

  db.update(profiles)
    .set({ name, nameKey: nameKey(name) })
    .where(eq(profiles.id, profileId))
    .run();
}

/**
 * **Réinitialise le PIN enfant** d'un profil depuis l'espace parent (AUTH.md §5 « PIN enfant
 * oublié → réinitialisable depuis l'espace parent »). Le nouveau PIN est **hashé argon2id**
 * (`pin.ts:hashPin`) — **jamais** persisté ni transmis en clair, jamais côté client (CLAUDE.md).
 *
 * Ordre : forme → validité (4 chiffres, `isValidPin`) → lecture du profil → **garde PIN parent
 * ≠ PIN enfant** (AUTH.md §4) *uniquement si le profil est le propriétaire* (il porte le
 * `parent_pin_hash` : on refuse un nouveau PIN enfant **identique** au PIN parent, vérifié contre
 * le hash parent — même règle que l'onboarding, qui ne l'applique qu'au propriétaire) → hash
 * (async) → `UPDATE pin_hash`.
 *
 * Écriture **unique** (`UPDATE pin_hash`) : aucun état partiel à annuler → pas de transaction /
 * pas de test de rollback (serait vacuous, rétro #124). Lève `ProfileManagementError`.
 */
export async function resetChildPin(
  db: AppDatabase,
  profileId: number,
  newPin: string,
): Promise<void> {
  assertProfileId(profileId);
  if (typeof newPin !== "string" || !isValidPin(newPin)) {
    throw new ProfileManagementError("PIN_INVALID");
  }

  const profile = db
    .select({ id: profiles.id, parentPinHash: profiles.parentPinHash })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1)
    .get();
  if (profile === undefined) throw new ProfileManagementError("PROFILE_NOT_FOUND");

  // AUTH.md §4 « PIN parent ≠ PIN enfant » : seul le propriétaire porte un PIN parent → on
  // interdit un PIN enfant égal au PIN parent **pour lui** (comparé contre le hash parent, comme
  // `recovery.ts` interdit un PIN parent égal au PIN enfant). Les autres profils n'ont pas de PIN
  // parent → aucune comparaison possible ni requise (parité avec l'onboarding).
  if (profile.parentPinHash !== null && (await verifyPin(profile.parentPinHash, newPin))) {
    throw new ProfileManagementError("PARENT_PIN_SAME");
  }

  const pinHash = await hashPin(newPin);
  db.update(profiles).set({ pinHash }).where(eq(profiles.id, profileId)).run();
}

/**
 * **Supprime** un profil = **purge RGPD** (AUTH.md §6). Un `DELETE` **unique** sur `profiles`
 * qui déclenche la **cascade FK** (`ON DELETE CASCADE`, schema.ts) → efface d'un seul geste
 * **atomique** (sémantique d'un statement SQLite) **TOUTES les tables enfant** liées au profil par
 * FK cascade — la liste suit le schéma et n'est PAS à maintenir à la main ici (toute table portant
 * `profile_id … references(profiles.id, onDelete: "cascade")` est purgée) : à ce jour `sessions`
 * (**révocation** — un token encore en circulation cesse d'ouvrir quoi que ce soit), `mastery`,
 * `attempts`, `progress`, `wallet`, `ledger`, `collection`, ainsi que les tables de dépense enfant
 * `cosmetics_owned` / `inventory_items` / `daily` (R4.1) et `egg_pity` (pitié d'œuf, R4.2). Aucune
 * donnée d'un **autre** profil n'est touchée.
 *
 * **Garde propriétaire (mutation-prouvée)** : le profil porteur de `parent_pin_hash` est
 * **indestructible** — le supprimer casserait l'accès parent **et** le code de secours du foyer
 * (AUTH.md §6 : supprimer *un profil* ≠ supprimer *le foyer*). Pré-condition lue puis
 * `OWNER_UNDELETABLE` : garde **unique et testable** (mutée → le propriétaire serait purgé). Pas
 * de second `WHERE parent_pin_hash IS NULL` sur le `DELETE` (recouvrirait cette garde sans être
 * distinctement testable — rétro #143/#206).
 *
 * Écriture **unique** (le `DELETE` + sa cascade forment un seul statement atomique) → aucun état
 * partiel, donc **aucune transaction ni test de rollback** (serait vacuous, rétro #124) ; le test
 * observe que **toutes** les tables liées sont vidées pour l'id supprimé (effet observable).
 */
export function deleteProfile(db: AppDatabase, profileId: number): void {
  assertProfileId(profileId);
  const profile = db
    .select({ id: profiles.id, parentPinHash: profiles.parentPinHash })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1)
    .get();
  if (profile === undefined) throw new ProfileManagementError("PROFILE_NOT_FOUND");
  if (profile.parentPinHash !== null) throw new ProfileManagementError("OWNER_UNDELETABLE");

  // DELETE unique → cascade FK (sessions révoquées + toutes les données de jeu purgées).
  db.delete(profiles).where(eq(profiles.id, profileId)).run();
}
