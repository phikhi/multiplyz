import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { characters, worlds } from "@/lib/db/schema";
import { assertNewNames } from "./creature-design";
import { assertFutureWorld } from "./future-worlds";

type Character = typeof characters.$inferSelect;
type World = typeof worlds.$inferSelect;
export interface ReviewedRenewal {
  before: Character[];
  after: Character[];
  world: World;
}
const canonical = (row: object) =>
  JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
const same = (a: object | undefined, b: object) => !!a && canonical(a) === canonical(b);

/** Hashes, never child data, are written to the publication receipt. */
export function preservedTableDigests(db: AppDatabase) {
  const tables = db.$client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('characters','worlds') ORDER BY name",
    )
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => {
      const rows = db.$client.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all();
      return [
        name,
        {
          count: rows.length,
          sha256: createHash("sha256")
            .update(JSON.stringify(rows.map((r) => canonical(r as object)).sort()))
            .digest("hex"),
        },
      ];
    }),
  );
}

/** Explicit owner-reviewed catalogue installation. Does not alter the automatic generation/QA path. */
export function publishReviewedRenewal(
  db: AppDatabase,
  plan: ReviewedRenewal,
  verifyFiles: () => void,
) {
  return db.transaction(
    (tx) => {
      verifyFiles();
      const beforeIds = new Set(plan.before.map((c) => c.id));
      const afterIds = new Set(plan.after.map((c) => c.id));
      if (
        beforeIds.size !== plan.before.length ||
        afterIds.size !== plan.after.length ||
        plan.before.some((c) => !afterIds.has(c.id))
      )
        throw new Error("Correspondance des identifiants invalide.");
      const current = tx.select().from(characters).all();
      const currentWorld = tx.select().from(worlds).where(eq(worlds.index, plan.world.index)).get();
      const protectedBefore = preservedTableDigests(db);
      if (
        plan.after.every((c) =>
          same(
            current.find((r) => r.id === c.id),
            c,
          ),
        ) &&
        same(currentWorld, plan.world)
      )
        return {
          outcome: "already-installed",
          updated: 0,
          inserted: 0,
          preserved: protectedBefore,
        };
      if (
        currentWorld ||
        plan.before.some(
          (c) =>
            !same(
              current.find((r) => r.id === c.id),
              c,
            ),
        ) ||
        plan.after.some((c) => !beforeIds.has(c.id) && current.some((r) => r.id === c.id))
      )
        throw new Error("Catalogue modifié ou installation partielle ; aucune écriture.");
      assertFutureWorld(tx, plan.world.index);
      assertNewNames(
        plan.after.map((c) => c.nameDefault),
        current.filter((c) => !afterIds.has(c.id)).map((c) => c.nameDefault),
      );
      for (const after of plan.after) {
        const before = plan.before.find((c) => c.id === after.id);
        if (before) {
          // No spread into the update: progression-bearing identity fields are never writable here.
          if (
            after.worldIndex !== before.worldIndex ||
            after.speciesKey !== before.speciesKey ||
            after.rarity !== before.rarity ||
            after.inEggPool !== before.inEggPool ||
            after.maxStage !== before.maxStage
          )
            throw new Error("La refonte doit préserver identité, rareté et stades disponibles.");
          tx.update(characters)
            .set({
              nameDefault: after.nameDefault,
              story: after.story,
              artRef: after.artRef,
              artRefStages: after.artRefStages,
            })
            .where(eq(characters.id, after.id))
            .run();
        } else {
          if (after.worldIndex !== plan.world.index)
            throw new Error("Créature hors du nouveau monde.");
          tx.insert(characters).values(after).run();
        }
      }
      tx.insert(worlds).values(plan.world).run();
      const protectedAfter = preservedTableDigests(db);
      if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter))
        throw new Error("Données familiales modifiées ; transaction annulée.");
      return {
        outcome: "installed",
        updated: plan.before.length,
        inserted: plan.after.length - plan.before.length,
        preserved: protectedAfter,
      };
    },
    { behavior: "immediate" },
  );
}
