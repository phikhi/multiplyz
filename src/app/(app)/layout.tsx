import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentChildSession } from "@/lib/auth/current-session";
import { getDb } from "@/lib/db";
import { loadWallet } from "@/lib/game/wallet";
import { AppShell } from "@/components/AppShell";

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
 *
 * **Shell applicatif persistant** (story R1.1 #337, WIREFRAMES §2) : une fois la session
 * validée, le **solde pièces/éclats** du profil courant est lu **serveur** (`loadWallet`,
 * source de vérité, ECONOMY §3.1 — aucune logique de barème ici, lecture seule) et projeté
 * à `AppShell`, monté **UNE SEULE FOIS** ici pour TOUTES les routes du groupe `(app)`
 * (`/carte`, `/collection`, `/jouer`) — remplace les `LogoutButton` dupliqués par écran.
 * `<AppShell>` est le **premier enfant EN FLUX** (non-occlusion structurelle, cf. son JSDoc) ;
 * `{children}` (le `<main>` de chaque écran) suit en flux normal, jamais superposé.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentChildSession();
  if (session === null) {
    redirect("/");
    return null; // inatteignable en prod (`redirect` lève, patron `parent/(espace)/page.tsx`) ; garde le contrôle de flux testable
  }

  const wallet = loadWallet(getDb(), session.profileId);
  return (
    <>
      <AppShell coins={wallet.coins} shards={wallet.shards} />
      {children}
    </>
  );
}
