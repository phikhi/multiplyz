import { beforeEach, expect, it, vi } from "vitest";
import { collectionAlbumAction } from "./actions";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { loadCollectionAlbum } from "@/lib/game/collection-album";
vi.mock("@/lib/db", () => ({ getDb: () => "DB" }));
vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: vi.fn() }));
vi.mock("@/config/server-config", () => ({ getMapConfig: () => ({ levelsPerWorld: 6 }) }));
vi.mock("@/lib/game/collection-album", () => ({ loadCollectionAlbum: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
it("refuses unauthenticated catalogue access", async () => {
  vi.mocked(getCurrentChildProfileId).mockResolvedValue(null);
  expect(await collectionAlbumAction()).toBeNull();
  expect(loadCollectionAlbum).not.toHaveBeenCalled();
});
it("derives both profile and world access from the server", async () => {
  vi.mocked(getCurrentChildProfileId).mockResolvedValue(9);
  vi.mocked(loadCollectionAlbum).mockReturnValue({ entries: [], families: [] });
  expect(await collectionAlbumAction()).toEqual({ entries: [], families: [] });
  expect(loadCollectionAlbum).toHaveBeenCalledWith("DB", 9, 6);
});
