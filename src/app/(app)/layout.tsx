import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentChildSession } from "@/lib/auth/current-session";

// Garde des routes de jeu (AUTH.md §2, PLAN.md). Lit la session à chaque requête
// (source de vérité serveur) → runtime Node (better-sqlite3, pas edge) + jamais
// prérendu au build. Toutes les routes sous ce groupe `(app)` héritent du garde.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Garde de route : sans session enfant **valide** (cookie absent, token inconnu
 * ou session expirée — indiscernables), on redirige vers le sélecteur de profil
 * (`/`). Le contrôle est **serveur** (le cookie httpOnly n'est pas fiable côté
 * client) ; la logique de validité vit dans `session.ts` (100 % testée), ici
 * uniquement le branchement redirect / rendu.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentChildSession();
  if (session === null) redirect("/");
  return <>{children}</>;
}
