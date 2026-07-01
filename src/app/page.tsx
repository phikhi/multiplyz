import { getDb } from "@/lib/db";
import { householdExists } from "@/lib/auth/household";
import { strings } from "@/strings";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";

// Lecture DB à chaque requête (source de vérité serveur) : jamais prérendu au
// build (sinon ouverture SQLite au build). Runtime Node explicite — better-sqlite3
// exige Node (pas edge), cf. CLAUDE.md + next.config serverExternalPackages.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Entrée de l'app. Gating 1er usage (AUTH.md §2, PRODUCT.md §1.1) :
 * - **Aucun foyer** → écran d'onboarding (création profil + PIN parent).
 * - **Foyer configuré** → placeholder (la sélection de profil arrive en #2.3).
 *
 * Le styleguide vivant des design tokens a migré vers `/styleguide`.
 */
export default function HomePage() {
  if (!householdExists(getDb())) {
    return <OnboardingFlow />;
  }

  return (
    <main
      className="bg-bg text-text"
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-family-body)",
          fontSize: "var(--font-size-md)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--color-text-primary)",
          margin: 0,
        }}
      >
        {strings.home.ready}
      </h1>
    </main>
  );
}
