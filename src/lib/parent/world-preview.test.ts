import { describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { worlds, jobs, characters } from "@/lib/db/schema";
import { deriveWorldPalette, serializePalette } from "@/lib/worldgen/palette";
import {
  GENERATE_WORLD_JOB,
  serializeJobPayload,
  approveWorld,
  rejectWorld,
} from "@/lib/worldgen/worker";
import { listPendingWorlds, countPendingWorlds } from "./world-approval";
describe("TEDDy world preview projection", () => {
  it("only exposes QA-passed pending worlds, with real own-world creatures, and no writes", () => {
    const db = createDatabase(":memory:");
    runMigrations(db);
    try {
      for (const index of [80, 81, 82]) {
        db.insert(worlds)
          .values({
            id: `world:${index}`,
            index,
            theme: "Jardin",
            palette:
              index === 82 ? "broken" : serializePalette(deriveWorldPalette("foret", "#4CAF50")),
            assetRefs: JSON.stringify({ background: `world/${index}/background.png` }),
            prompt: "test",
            seed: "test",
            status: "buffered",
          })
          .run();
      }
      for (const index of [80, 82])
        db.insert(jobs)
          .values({ type: GENERATE_WORLD_JOB, payload: serializeJobPayload(index), status: "done" })
          .run();
      db.insert(characters)
        .values({
          id: "world:80:creature",
          worldIndex: 80,
          speciesKey: "preview-80",
          nameDefault: "Lumo",
          rarity: "common",
          artRef: "world/80/lumo.png",
          story: "Dans les racines.",
        })
        .run();
      db.$client.pragma("query_only=ON");
      const pending = listPendingWorlds(db);
      expect(countPendingWorlds(db)).toBe(1);
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        id: "world:80",
        theme: { background: "/generated/world/80/background.png" },
        creatures: [{ name: "Lumo", artRef: "world/80/lumo.png" }],
      });
      db.$client.pragma("query_only=OFF");
      approveWorld(db, "world:80", "Parent");
      expect(listPendingWorlds(db)).toEqual([]);
      expect(() => rejectWorld(db, "world:80")).toThrow();
    } finally {
      db.$client.close();
    }
  });
});
