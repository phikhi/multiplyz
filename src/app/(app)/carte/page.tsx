import { MapScreen } from "@/components/game/MapScreen";
import { ForestMap } from "@/components/game/ForestMap";
import { getDb } from "@/lib/db";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { presentAdventureWorld } from "@/lib/game/adventure-world";
import { loadAdventure } from "@/lib/game/adventure";
import { currentMapAction } from "./actions";

// Écran carte du monde (story #125, WIREFRAMES §2, PRODUCT §2.1, MAP §1/§4/§5). Protégé
// par le garde du groupe `(app)` : atteignable uniquement avec une session enfant
// valide. Runtime Node (server action lit la DB via better-sqlite3).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Route `/carte` — délègue tout à `MapScreen` (client) : chemin de nœuds du monde
 * courant, composé côté serveur depuis la géométrie 5.2 + la progression 5.3 + la
 * dette de révision du moteur (3.4). Navigation nœud → niveau (`/jouer`).
 */
export default async function MapPage() {
  const profileId = await getCurrentChildProfileId();
  const result = await currentMapAction();
  if (profileId === null || result.status !== "ready") return <MapScreen />;
  const active = loadAdventure(getDb(), profileId);
  return (
    <ForestMap
      map={result.map}
      adventure={
        active && active.phase !== "closed" ? presentAdventureWorld(getDb(), active) : active
      }
    />
  );
}
