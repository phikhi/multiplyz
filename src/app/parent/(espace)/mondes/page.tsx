import { getDb } from "@/lib/db";
import { listPendingWorlds } from "@/lib/parent/world-approval";
import { WorldApprovalManager } from "./WorldApprovalManager";

// Rendu dynamique — route sous le groupe `(espace)`, gardée par `(espace)/layout.tsx` (session
// parent lue à chaque requête). Jamais prérendue au build. Runtime Node explicite (better-sqlite3).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Écran **« Mondes à valider »** (story 7.9, issue #231, WORLDGEN §6). Charge les mondes
 * `buffered` en attente d'approbation côté serveur et les passe au composant client. Toutes les
 * mutations passent par des server actions **re-gardées** par la session parent (`mondes/actions.ts`)
 * — le rendu est protégé par le garde de groupe, mais la garde est répétée dans chaque action
 * (endpoint indépendant, AC #231).
 */
export default function WorldApprovalPage() {
  const pending = listPendingWorlds(getDb());
  return <WorldApprovalManager pending={pending} />;
}
