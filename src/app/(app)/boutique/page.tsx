import { BoutiqueScreen } from "@/components/game/BoutiqueScreen";

// Écran Boutique / Œufs (story R4.2 #393, WIREFRAMES §6, ECONOMY §4.2/§6/§7). Protégé par le garde
// du groupe `(app)` : atteignable uniquement avec une session enfant valide. Runtime Node (les
// server actions débitent/tirent via better-sqlite3 dans une transaction synchrone).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Route `/boutique` — délègue tout à `BoutiqueScreen` (client) : achat d'un œuf en pièces → tirage
 * server-authoritative → **ouverture d'œuf** (créature révélée EN GRAND). C'est la boucle de DÉPENSE
 * cœur (les communes/rares deviennent atteignables par l'enfant).
 */
export default function BoutiquePage() {
  return <BoutiqueScreen />;
}
