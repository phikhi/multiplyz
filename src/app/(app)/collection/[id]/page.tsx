import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { loadCollectionEntry } from "@/lib/game/collection";
import { CreatureDetailScreen } from "@/components/game/CreatureDetailScreen";

// Route dynamique — sous le groupe `(app)`, déjà gardée par `(app)/layout.tsx` (session enfant
// lue à chaque requête). Jamais prérendue au build. Runtime Node explicite (better-sqlite3).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Route `/collection/[id]` — **fiche créature** (détail + histoire, story R3.2 #379, WIREFRAMES
 * §5b), accessible depuis une carte de la Collection (tap → fiche). **Garde répétée** (défense
 * en profondeur, même patron que `parent/(espace)/page.tsx`) : le groupe `(app)/layout.tsx`
 * redirige déjà sans session enfant valide, mais cette page relit la session pour obtenir le
 * `profileId` — une session révoquée entre le layout et la page (course rarissime) redirige à
 * nouveau plutôt que de planter.
 *
 * Une créature **non possédée** par ce profil (id inconnu, faute de frappe dans l'URL, ou
 * possédée par un AUTRE profil — `loadCollectionEntry` porte déjà la garde de propriété,
 * PRODUCT §2.3) redirige vers la grille : posture **no-fail**, jamais une page d'erreur brute.
 *
 * Fetch **côté serveur** (comme `parent/(espace)/profils/page.tsx`) : pas de flash de
 * chargement client, l'écran monte directement avec la créature déjà résolue + gardée.
 */
export default async function CreatureDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  // `id` arrive ENCORE encodé (`%3A` non décodé automatiquement par le routeur App Router pour
  // un segment dynamique, vérifié empiriquement en vrai serveur #190 : `characterId` contient
  // `:` → l'URL construite par `CollectionScreen` l'encode via `encodeURIComponent` — jamais
  // décodé ici aurait fait chercher un id littéralement `"e2e%3Acollection%3A5"`, introuvable →
  // faux-négatif silencieux (redirect vers la grille, jamais un plantage, donc invisible sans
  // test E2E réel). `decodeURIComponent` restaure le `characterId` réel avant la lecture.
  const characterId = decodeURIComponent(id);
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    redirect("/");
    return null; // inatteignable en prod (`redirect` lève) ; garde le contrôle de flux testable
  }

  const entry = loadCollectionEntry(getDb(), profileId, characterId);
  if (entry === null) {
    redirect("/collection");
    return null; // inatteignable en prod (`redirect` lève) ; garde le contrôle de flux testable
  }

  return <CreatureDetailScreen entry={entry} />;
}
