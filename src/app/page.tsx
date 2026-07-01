import { getDb } from "@/lib/db";
import { householdExists } from "@/lib/auth/household";
import { listProfiles } from "@/lib/auth/login";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import { ProfileSelector } from "@/components/ProfileSelector";

// Lecture DB à chaque requête (source de vérité serveur) : jamais prérendu au
// build (sinon ouverture SQLite au build). Runtime Node explicite — better-sqlite3
// exige Node (pas edge), cf. CLAUDE.md + next.config serverExternalPackages.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Entrée de l'app. Gating 1er usage (AUTH.md §2, PRODUCT.md §1.1) :
 * - **Aucun foyer** → écran d'onboarding (création profil + PIN parent).
 * - **Foyer configuré** → sélecteur de profil (connexion #2.3), liste **servie
 *   par le serveur** (prénom + avatar uniquement, aucun secret).
 *
 * Le styleguide vivant des design tokens a migré vers `/styleguide`.
 */
export default function HomePage() {
  const db = getDb();
  if (!householdExists(db)) {
    return <OnboardingFlow />;
  }
  return <ProfileSelector profiles={listProfiles(db)} />;
}
