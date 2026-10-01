import { getDb } from "@/lib/db";
import { readHouseholdSettings } from "@/lib/parent/settings";
import { pickSoundSettings } from "@/lib/sound/settings";
import { AdventureScreen } from "@/components/game/AdventureScreen";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { getMapConfig } from "@/config/server-config";

// Le garde du groupe `(app)` exige une session enfant. La persistance de l'aventure
// utilise SQLite : runtime Node, jamais edge.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Diagnostic and adventure share the durable journey; an active run always resumes first. */
export default async function PlayPage() {
  const db = getDb();
  const settings = readHouseholdSettings(db);
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) return null;
  return (
    <AdventureScreen
      profileId={profileId}
      sound={pickSoundSettings(settings)}
      guardianLevelIndex={getMapConfig().levelsPerWorld}
    />
  );
}
