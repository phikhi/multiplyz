import { CollectionScreen } from "@/components/game/CollectionScreen";

// Écran collection (Pokédex) (story 5.6, WIREFRAMES §5, PRODUCT §2.3, ECONOMY §3.2/§3.3).
// Protégé par le garde du groupe `(app)` : atteignable uniquement avec une session enfant
// valide. Runtime Node (server action lit la DB via better-sqlite3).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Route `/collection` — délègue tout à `CollectionScreen` (client) : grille des créatures
 * possédées (nom + histoire + rareté) composée côté serveur, avec renommage persisté.
 */
export default function CollectionPage() {
  return <CollectionScreen />;
}
