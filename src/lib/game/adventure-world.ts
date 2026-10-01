import type { AppDatabase } from "@/lib/db";
import { PaletteError } from "@/lib/worldgen/palette";
import { worldScenes } from "@/strings/world-scenes";
import { resolveWorld, SocleUnavailableError } from "@/lib/worldgen/socle";
import type { Adventure } from "./adventure-types";
import { buildWorldTheme } from "./world-theme";

/** Read-only presentation of the checkpoint's world, including a pending boss receipt.
 * This decoration is never written back to adventure_sessions or accepted from the client.
 * resolveWorld keeps active/parent approval/rejection and socle fallback rules intact.
 */
export function presentAdventureWorld(db: AppDatabase, adventure: Adventure): Adventure {
  try {
    return { ...adventure, worldTheme: buildWorldTheme(resolveWorld(db, adventure.worldIndex)) };
  } catch (error) {
    // A missing or malformed visual catalogue must not turn a saved answer into a network error.
    // Database/operational errors still propagate. No repair or catalogue mutation here.
    if (!(error instanceof PaletteError) && !(error instanceof SocleUnavailableError)) throw error;
    return {
      ...adventure,
      worldTheme: {
        slug: "wonder",
        label: worldScenes.wonder.title,
        accent: "#efd28e",
        background: null,
        tiles: null,
        teddy: null,
      },
    };
  }
}
