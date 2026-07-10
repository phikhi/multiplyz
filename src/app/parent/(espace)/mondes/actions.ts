"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getCurrentParentSession } from "@/lib/auth/current-session";
import { listManagedProfiles } from "@/lib/parent/profiles";
import { approveWorld, rejectWorld, WorldModerationError } from "@/lib/worldgen/worker";

/**
 * Server actions de l'écran **« Mondes à valider »** (story 7.9, issue #231). Adaptateurs
 * **minces** au-dessus des mécanismes de modération posés en 6.5/7.9 (`lib/worldgen/worker.ts`,
 * source de vérité) — surface **disjointe** des profils/réglages (fichier d'actions séparé, même
 * garde). Aucune écriture idempotente n'est nécessaire côté DB : `approveWorld`/`rejectWorld` sont
 * déjà des transitions d'état gardées (statut `buffered` requis) — c'est **la disparition du
 * monde de la liste après `revalidatePath`** qui rend un double-clic UI **inoffensif en pratique**
 * (le bouton n'est plus jamais rendu une fois le monde transitionné) ; un résidu de course
 * multi-onglet retombe sur `MODERATION_FAILED` (erreur gracieuse, jamais un crash).
 *
 * **Anti-abus (SÉCU, AC #231)** : CHAQUE action ré-exige une session **`kind:"parent"` valide**
 * via `getCurrentParentSession` (filtre déjà `kind === "parent"`) — le garde de route
 * `(espace)/layout.tsx` protège le **rendu**, mais une server action est un endpoint POST
 * indépendant → garde **répétée** dans chaque action (même patron que `profils/actions.ts`,
 * `reglages/actions.ts`). Un enfant ne peut **jamais** déclencher une approbation/un rejet.
 */

/** Résultat générique d'une action de modération : succès, ou code d'erreur affichable. */
export type WorldApprovalActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "UNAUTHORIZED" | "MODERATION_FAILED" };

const MONDES_PATH = "/parent/mondes";

/** `true` ssi la requête porte une session **parent** valide (source de vérité serveur). */
async function hasParentSession(): Promise<boolean> {
  return (await getCurrentParentSession()) !== null;
}

/**
 * Identité **parent** affichable (nom du profil de la session), ou `null` sans session parent
 * valide. Même lecture que `loadDashboardProps` (page.tsx) : le profil de session est toujours le
 * **propriétaire** (seul profil à porter `parent_pin_hash`, donc seul à pouvoir ouvrir une session
 * `kind:"parent"`) — indestructible (`OWNER_UNDELETABLE`, 7.5), sa fiche existe donc toujours tant
 * que la session est valide.
 */
async function currentParentName(): Promise<string | null> {
  const session = await getCurrentParentSession();
  if (session === null) return null;
  const name = listManagedProfiles(getDb()).find((p) => p.id === session.profileId)?.name;
  return name ?? null;
}

/**
 * **Approuve** un monde en attente (garde session parent) : `buffered` → `active`, identité
 * parent enregistrée (`approvedBy`, WORLDGEN §6). Sans session parent → `UNAUTHORIZED`, aucune
 * écriture. Un `WorldModerationError` (monde inconnu / déjà traité — course multi-onglet) →
 * `MODERATION_FAILED`, jamais un crash de page.
 */
export async function approveWorldAction(worldId: string): Promise<WorldApprovalActionResult> {
  const name = await currentParentName();
  if (name === null) return { ok: false, code: "UNAUTHORIZED" };
  try {
    approveWorld(getDb(), worldId, name);
  } catch (error) {
    if (error instanceof WorldModerationError) return { ok: false, code: "MODERATION_FAILED" };
    throw error;
  }
  revalidatePath(MONDES_PATH);
  return { ok: true };
}

/**
 * **Rejette** un monde en attente (garde session parent) : `buffered` → `rejected` (ADR 0015,
 * terminal). Sans session parent → `UNAUTHORIZED`, aucune écriture. Même repli `MODERATION_FAILED`
 * qu'`approveWorldAction` sur un monde déjà traité.
 */
export async function rejectWorldAction(worldId: string): Promise<WorldApprovalActionResult> {
  if (!(await hasParentSession())) return { ok: false, code: "UNAUTHORIZED" };
  try {
    rejectWorld(getDb(), worldId);
  } catch (error) {
    if (error instanceof WorldModerationError) return { ok: false, code: "MODERATION_FAILED" };
    throw error;
  }
  revalidatePath(MONDES_PATH);
  return { ok: true };
}
