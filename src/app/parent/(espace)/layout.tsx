import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentParentSession } from "@/lib/auth/current-session";

// Garde de l'**espace parent** (AUTH.md §2, story 7.1). Lit la session à chaque requête
// (source de vérité serveur) → runtime Node (better-sqlite3, pas edge) + jamais prérendu
// au build. Route group `(espace)` : le garde ne couvre QUE le tableau de bord (`/parent`),
// **pas** `/parent/recuperation` (le parent y accède SANS session, il a perdu son PIN — la
// récupération vit hors de ce groupe, donc reste ungated).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Garde de route : sans session **parent** valide (cookie absent, token inconnu,
 * session expirée — ou une session **enfant** portée par le même cookie `mz_session`,
 * qui n'ouvre jamais `/parent`), on redirige vers le sélecteur (`/`), où le parent
 * peut ressaisir son PIN via l'entrée « 🔒 Parent ». Le contrôle est **serveur** (le
 * cookie httpOnly n'est pas fiable côté client) ; la logique de validité + le filtre
 * `kind === "parent"` vivent dans `current-session.ts` (100 % testés), ici uniquement
 * le branchement redirect / rendu.
 */
export default async function ParentLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentParentSession();
  if (session === null) redirect("/");
  return <>{children}</>;
}
