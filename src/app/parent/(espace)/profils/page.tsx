import { getDb } from "@/lib/db";
import { listManagedProfiles } from "@/lib/parent/profiles";
import { ProfileManager } from "./ProfileManager";

// Rendu dynamique — route sous le groupe `(espace)`, gardée par `(espace)/layout.tsx` (session
// parent lue à chaque requête). Jamais prérendue au build. Runtime Node explicite (better-sqlite3).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Écran **« Gérer les profils »** (story 7.5, DETAILS §3). Charge la liste **de gestion** des
 * profils du foyer (projection sans secret : id/nom/avatar/`isOwner`) côté serveur et la passe au
 * composant client. Toutes les mutations passent par des server actions **re-gardées** par la
 * session parent (`profils/actions.ts`) — le rendu est protégé par le garde de groupe, mais la
 * garde est répétée dans chaque action (endpoint indépendant, AC #4).
 */
export default function ProfilesManagementPage() {
  const profiles = listManagedProfiles(getDb());
  return <ProfileManager profiles={profiles} />;
}
