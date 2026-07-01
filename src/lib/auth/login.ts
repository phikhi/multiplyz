import { asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { verifyPin } from "./pin";
import { createSession, type CreatedSession } from "./session";

/**
 * Connexion enfant (AUTH.md §2 flow connexion, §4 anti-énumération). SERVER-ONLY.
 * La liste des profils est **servie par le serveur** en projection publique
 * (prénom + avatar), jamais un hash ni le PIN. La vérif du PIN et l'ouverture
 * de session vivent ici (source de vérité), l'action n'est qu'un adaptateur.
 */

/**
 * Projection **publique** d'un profil pour le sélecteur (AUTH.md §2 : « nom +
 * avatar uniquement, aucune donnée sensible »). Aucun champ secret n'est
 * sélectionné → impossible d'exposer un hash par accident.
 */
export interface PublicProfile {
  id: number;
  name: string;
  avatar: string;
}

/**
 * Hash argon2id **factice** (secret jeté) pour égaliser le temps de réponse
 * quand le profil ciblé n'existe pas : on vérifie quand même contre ce hash
 * plutôt que de court-circuiter → un `profileId` inconnu et un mauvais PIN
 * consomment un `verify` similaire (anti-énumération temporelle, AUTH.md §4).
 * Enjeu faible (single-tenant, AUTH.md §7) mais coût nul → défense en profondeur.
 */
const TIMING_EQUALIZER_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$Hov22K1k8b7ai+zZuOGR1Q$4SNuH7ZWmJzo3QCRDll3c7bQATEf1JlTNMwOpgaX7wk";

/**
 * Liste publique des profils du foyer (sélecteur de connexion). Triée par
 * ancienneté (propriétaire en tête) → ordre stable. **Aucun** champ sensible.
 */
export function listProfiles(db: AppDatabase): PublicProfile[] {
  return db
    .select({ id: profiles.id, name: profiles.name, avatar: profiles.avatar })
    .from(profiles)
    .orderBy(asc(profiles.createdAt), asc(profiles.id))
    .all();
}

/**
 * Vérifie le PIN d'un profil puis ouvre une **session enfant** en cas de succès.
 *
 * Anti-énumération (AUTH.md §4) : renvoie `null` de façon **indiscernable** que
 * le profil soit inconnu OU le PIN faux — l'appelant affiche le **même** message
 * générique, aucune session n'est créée. `profileId`/`pin` viennent d'un endpoint
 * public → garde de **forme** (types) avant toute requête (pas de `TypeError` 500).
 *
 * Ordre : garde forme → lookup → `verify` async (hash factice si profil absent,
 * timing constant) → succès ⇒ `createSession`. `now` injecté (échéance déterministe).
 */
export async function authenticateChild(
  db: AppDatabase,
  profileId: number,
  pin: string,
  now: Date,
): Promise<CreatedSession | null> {
  if (typeof profileId !== "number" || !Number.isInteger(profileId) || typeof pin !== "string") {
    return null;
  }

  const profile = db
    .select({ id: profiles.id, pinHash: profiles.pinHash })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1)
    .get();

  // Profil inconnu → on vérifie quand même (hash factice) pour un temps constant,
  // puis on échoue génériquement. `verifyPin` ne throw jamais (hash malformé → false).
  const ok = await verifyPin(profile?.pinHash ?? TIMING_EQUALIZER_HASH, pin);
  if (!ok || profile === undefined) return null;

  return createSession(db, profile.id, "child", now);
}
