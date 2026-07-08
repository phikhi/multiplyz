import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { loadCurrentWorldMap } from "@/lib/game/current-map";
import type { CurrentWorldMap } from "@/lib/game/world-theme";
import { SocleUnavailableError } from "@/lib/worldgen/socle";
import { currentMapAction } from "./actions";

/**
 * Adaptateur **mince** (story #125/6.7) : on vérifie (a) la garde de session enfant (jamais
 * de profil client), (b) la délégation à `loadCurrentWorldMap` (composition testée isolément
 * sur base réelle, `current-map.test.ts`), (c) l'injection horloge à la frontière, (d)
 * l'**interception `SocleUnavailableError` → `unavailable`** (message doux Teddy côté client,
 * jamais l'erreur brute), (e) la **propagation** de toute autre erreur (invariant serveur).
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

const FAKE_MAP: CurrentWorldMap = {
  worldIndex: 0,
  nodes: [{ index: 0, position: { x: 0.5, y: 0 }, type: "normal", status: "current", stars: 0 }],
  theme: { slug: "ocean", accent: "#2BB7E6", label: "Océan scintillant", background: null },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("currentMapAction", () => {
  it("non authentifié → { status: 'unauthenticated' }, aucun appel de composition", async () => {
    profileMock.mockResolvedValue(null);
    await expect(currentMapAction()).resolves.toEqual({ status: "unauthenticated" });
    expect(loadCurrentWorldMapMock).not.toHaveBeenCalled();
  });

  it("authentifié → compose la carte thématisée du profil de session (horloge injectée)", async () => {
    profileMock.mockResolvedValue(7);
    loadCurrentWorldMapMock.mockReturnValue(FAKE_MAP);
    const before = Date.now();

    await expect(currentMapAction()).resolves.toEqual({ status: "ready", map: FAKE_MAP });

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

  // GARDE (mutation-prouvée) : `SocleUnavailableError` → `unavailable` (message doux Teddy),
  // jamais l'erreur brute à l'enfant. Retirer le `catch instanceof SocleUnavailableError` ferait
  // remonter l'erreur (rejet) au lieu du `{ status: "unavailable" }` → ce test rougit.
  it("socle indispo (SocleUnavailableError) → { status: 'unavailable' }, jamais l'erreur brute", async () => {
    profileMock.mockResolvedValue(7);
    loadCurrentWorldMapMock.mockImplementation(() => {
      throw new SocleUnavailableError("socle vide");
    });
    await expect(currentMapAction()).resolves.toEqual({ status: "unavailable" });
  });

  // GARDE (mutation-prouvée) : une erreur NON-socle (invariant serveur) PROPAGE (jamais silencée
  // en `unavailable`). Remplacer le `throw error` par un `return { unavailable }` avalerait ce cas
  // → ce test rougit.
  it("une erreur non-socle PROPAGE (invariant serveur, pas silencée en unavailable)", async () => {
    profileMock.mockResolvedValue(7);
    loadCurrentWorldMapMock.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(currentMapAction()).rejects.toThrow("boom");
  });
});
