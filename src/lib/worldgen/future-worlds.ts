import "server-only";
import { count, eq, sql } from "drizzle-orm";
import { getMapConfig } from "@/config/server-config";
import { CURATED_THEMES, findCuratedTheme } from "@/config/worldgen-themes";
import type { AppDatabase } from "@/lib/db";
import { adventureSessions, progress, socleWorlds, worlds } from "@/lib/db/schema";

type Db = Pick<AppDatabase, "select">;

/** Protect the current map, finished levels and every saved adventure, including a boss receipt. */
export function lastReservedWorld(db: Db): number {
  const levels = getMapConfig().levelsPerWorld;
  const reached =
    db
      .select({
        index: sql<number | null>`max(${progress.worldIndex} +
    CASE WHEN ${progress.levelIndex} = ${levels} THEN 1 ELSE 0 END)`,
      })
      .from(progress)
      .get()?.index ?? 0;
  const sessions = db.select({ state: adventureSessions.state }).from(adventureSessions).all();
  return Math.max(0, reached, ...sessions.map(({ state }) => state.worldIndex));
}

export function socleSize(db: Db): number {
  return db.select({ n: count() }).from(socleWorlds).get()!.n;
}

/** Keep retries stable and avoid the two preceding themes, including the family's actual socle. */
export function futureWorldTheme(db: Db, index: number) {
  const existing = db
    .select({ theme: worlds.theme })
    .from(worlds)
    .where(eq(worlds.index, index))
    .get();
  const saved = existing && findCuratedTheme(existing.theme);
  if (saved) return saved;
  const socle = db
    .select({ theme: socleWorlds.theme })
    .from(socleWorlds)
    .orderBy(socleWorlds.slot)
    .all();
  const recent = new Set<string>();
  for (let previous = Math.max(0, index - 2); previous < index; previous++) {
    const generated = db
      .select({ theme: worlds.theme, status: worlds.status })
      .from(worlds)
      .where(eq(worlds.index, previous))
      .get();
    const theme =
      generated && generated.status !== "rejected"
        ? generated.theme
        : socle[previous % socle.length]?.theme;
    const curated = theme && findCuratedTheme(theme);
    if (curated) recent.add(curated.slug);
  }
  for (let offset = 0; offset < CURATED_THEMES.length; offset++) {
    const candidate = CURATED_THEMES[(index + offset) % CURATED_THEMES.length];
    if (!recent.has(candidate.slug)) return candidate;
  }
  throw new Error("Aucun thème curaté disponible.");
}

/** Generation is beyond the existing socle and never replaces a world already reached. */
export function assertFutureWorld(db: Db, index: number): void {
  if (!Number.isSafeInteger(index) || index < socleSize(db) || index <= lastReservedWorld(db)) {
    throw new Error("Ce monde appartient au socle ou au parcours déjà ouvert ; il est préservé.");
  }
  const existing = db
    .select({ status: worlds.status })
    .from(worlds)
    .where(eq(worlds.index, index))
    .get();
  if (existing && existing.status !== "buffered") {
    throw new Error("Un monde actif ou rejeté ne peut pas être régénéré.");
  }
}
