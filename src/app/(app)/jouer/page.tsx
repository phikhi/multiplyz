import { getDb } from "@/lib/db";
import { readHouseholdSettings } from "@/lib/parent/settings";
import { pickSoundSettings } from "@/lib/sound/settings";
import { PlayScreen } from "@/components/game/PlayScreen";

// Écran de jeu nu (#64, ENGINE §3/§4/§5/§9, PRODUCT §2.2). Protégé par le garde du
// groupe `(app)` : atteignable uniquement avec une session enfant valide. Runtime Node
// (server actions 3.7 utilisent better-sqlite3, transaction synchrone).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Route `/jouer` — délègue tout à `PlayScreen` (client) : diagnostic de départ (1ʳᵉ
 * session, ENGINE §3) puis niveaux (~10 questions, ENGINE §4), QCM/pavé (§6), feedback
 * no-fail (§9), étoiles de fin de niveau (§5). Aucun habillage visuel (étayages,
 * animations, récompenses éco = épic #4/#5).
 *
 * **Réglages son (story 8.4, #257)** : lit les réglages effectifs du foyer (source de vérité
 * serveur, story 8.3) à CHAQUE requête et projette les 3 champs son (`pickSoundSettings`, jamais
 * le reste de `HouseholdSettings` — thème, temps d'écran…) vers `PlayScreen`. Même contrat que le
 * thème (`app/layout.tsx`) : pas de live-update, un réglage parent modifié ne s'applique qu'au
 * prochain chargement de cette route.
 */
export default function PlayPage() {
  const settings = readHouseholdSettings(getDb());
  return <PlayScreen sound={pickSoundSettings(settings)} />;
}
