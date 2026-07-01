import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { householdExists } from "@/lib/auth/household";
import { ParentRecoveryFlow } from "./ParentRecoveryFlow";

// Lecture DB à chaque requête (source de vérité serveur) : jamais prérendu au
// build. Runtime Node explicite (better-sqlite3, pas edge).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Récupération du PIN parent via code de secours (AUTH.md §5). Accessible sans
 * session (le parent a perdu son PIN) mais **seulement si le foyer existe** —
 * sinon rien à récupérer → redirection vers l'accueil. Le point d'entrée depuis
 * l'écran PIN parent (lien « oublié ? ») relève de l'espace parent (#7).
 */
export default function ParentRecoveryPage() {
  if (!householdExists(getDb())) redirect("/");
  return <ParentRecoveryFlow />;
}
