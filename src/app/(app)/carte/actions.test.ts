import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { loadCurrentWorldMap } from "@/lib/game/current-map";
import type { WorldMap } from "@/lib/game/map";
import { currentMapAction } from "./actions";

/**
 * Adaptateur **mince** (story #125) : on vérifie (a) la garde de session enfant (jamais
 * de profil client), (b) la délégation à `loadCurrentWorldMap` (composition testée
 * isolément sur base réelle, `current-map.test.ts`), (c) l'injection horloge à la
 * frontière — même discipline que `jouer/actions.test.ts` (#64/#124).
 */

const FAKE_ENGINE_CONFIG = { revisionDebtThreshold: 12 };
const FAKE_MAP_CONFIG = { levelsPerWorld: 10, treasureEvery: 4, bossQuestionCount: 13 };

vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => "DB") }));
vi.mock("@/config/server-config", () => ({
  getEngineConfig: vi.fn(() => FAKE_ENGINE_CONFIG),
  getMapConfig: vi.fn(() => FAKE_MAP_CONFIG),
}));
vi.mock("@/lib/game/current-map", () => ({ loadCurrentWorldMap: vi.fn() }));

const profileMock = vi.mocked(getCurrentChildProfileId);
const loadCurrentWorldMapMock = vi.mocked(loadCurrentWorldMap);

const FAKE_MAP: WorldMap = {
  worldIndex: 0,
  nodes: [{ index: 0, position: { x: 0.5, y: 0 }, type: "normal", status: "current", stars: 0 }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("currentMapAction", () => {
  it("non authentifié → { map: null }, aucun appel de composition", async () => {
    profileMock.mockResolvedValue(null);
    await expect(currentMapAction()).resolves.toEqual({ map: null });
    expect(loadCurrentWorldMapMock).not.toHaveBeenCalled();
  });

  it("authentifié → compose la carte du profil de session (horloge injectée)", async () => {
    profileMock.mockResolvedValue(7);
    loadCurrentWorldMapMock.mockReturnValue(FAKE_MAP);
    const before = Date.now();

    await expect(currentMapAction()).resolves.toEqual({ map: FAKE_MAP });

    expect(loadCurrentWorldMapMock).toHaveBeenCalledTimes(1);
    const [db, profileId, mapConfig, engineConfig, now] = loadCurrentWorldMapMock.mock.calls[0];
    expect(db).toBe("DB");
    expect(profileId).toBe(7);
    expect(mapConfig).toBe(FAKE_MAP_CONFIG);
    expect(engineConfig).toBe(FAKE_ENGINE_CONFIG);
    // Horloge serveur injectée à la frontière (epoch ms), pas figée en dur.
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
