import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { progress, progressKey, profiles } from "@/lib/db/schema";
import { loadStars, recordStars, totalStars, type LevelKey } from "./progress";

/**
 * Tests d'intégration de la couche progression (5.1) sur **base réelle** (SQLite en
 * mémoire + migrations). Vérifient l'écriture idempotente + **monotone** des étoiles
 * et la lecture des totaux — gardes à effet observable (rouges si la garde est mutée).
 */

let db: AppDatabase;
let profileId: number;
const NOW = new Date(Date.UTC(2026, 6, 3, 10, 0, 0));
const LATER = new Date(Date.UTC(2026, 6, 3, 11, 0, 0));

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = seedProfile("Léa");
});

function level(worldIndex: number, levelIndex: number): LevelKey {
  return { profileId, worldIndex, levelIndex };
}

describe("recordStars", () => {
  it("insère une progression neuve et renvoie les étoiles stockées", () => {
    const stored = recordStars(db, level(0, 0), 2, NOW);
    expect(stored).toBe(2);
    const row = db
      .select()
      .from(progress)
      .where(eq(progress.id, progressKey(profileId, 0, 0)))
      .get();
    expect(row).toMatchObject({ worldIndex: 0, levelIndex: 0, stars: 2 });
    expect(row?.updatedAt.getTime()).toBe(NOW.getTime());
  });

  it("est idempotent : rejouer la même écriture ne crée pas de doublon", () => {
    recordStars(db, level(1, 2), 3, NOW);
    recordStars(db, level(1, 2), 3, LATER);
    const rows = db.select().from(progress).where(eq(progress.profileId, profileId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].stars).toBe(3);
  });

  // GARDE MONOTONE (MAP §4 / SYNC) : une reprise MOINS réussie ne baisse jamais les
  // étoiles. Rouge si `max(...)` est remplacé par une écriture directe de `stars`.
  it("MONOTONE : rejoue 3★ puis 1★ → reste 3★ (jamais de régression)", () => {
    recordStars(db, level(0, 0), 3, NOW);
    const after = recordStars(db, level(0, 0), 1, LATER);
    expect(after).toBe(3);
    expect(loadStars(db, level(0, 0))).toBe(3);
  });

  it("MONOTONE : une meilleure reprise fait bien progresser (1★ puis 3★ → 3★)", () => {
    recordStars(db, level(0, 0), 1, NOW);
    const after = recordStars(db, level(0, 0), 3, LATER);
    expect(after).toBe(3);
    expect(loadStars(db, level(0, 0))).toBe(3);
  });

  it("met à jour updated_at à chaque reprise (même si les étoiles ne bougent pas)", () => {
    recordStars(db, level(0, 0), 2, NOW);
    recordStars(db, level(0, 0), 2, LATER);
    const row = db
      .select()
      .from(progress)
      .where(eq(progress.id, progressKey(profileId, 0, 0)))
      .get();
    expect(row?.updatedAt.getTime()).toBe(LATER.getTime());
  });

  it("isole les niveaux (une progression par (monde, niveau))", () => {
    recordStars(db, level(0, 0), 1, NOW);
    recordStars(db, level(0, 1), 2, NOW);
    recordStars(db, level(1, 0), 3, NOW);
    expect(db.select().from(progress).where(eq(progress.profileId, profileId)).all()).toHaveLength(
      3,
    );
    expect(loadStars(db, level(0, 1))).toBe(2);
  });

  it("isole les profils (même niveau, autre profil → indépendant)", () => {
    const other = seedProfile("Tom");
    recordStars(db, level(0, 0), 3, NOW);
    recordStars(db, { profileId: other, worldIndex: 0, levelIndex: 0 }, 1, NOW);
    expect(loadStars(db, level(0, 0))).toBe(3);
    expect(loadStars(db, { profileId: other, worldIndex: 0, levelIndex: 0 })).toBe(1);
  });
});

describe("loadStars", () => {
  it("renvoie 0 pour un niveau jamais joué (aucune ligne, no-fail)", () => {
    expect(loadStars(db, level(9, 9))).toBe(0);
  });

  it("renvoie les étoiles stockées après une écriture", () => {
    recordStars(db, level(2, 3), 2, NOW);
    expect(loadStars(db, level(2, 3))).toBe(2);
  });
});

describe("totalStars", () => {
  it("renvoie 0 pour un profil sans progression (SUM sur zéro ligne → 0)", () => {
    expect(totalStars(db, profileId)).toBe(0);
  });

  it("somme les étoiles de tous les niveaux (affichage/collection, MAP §4)", () => {
    recordStars(db, level(0, 0), 1, NOW);
    recordStars(db, level(0, 1), 2, NOW);
    recordStars(db, level(1, 0), 3, NOW);
    expect(totalStars(db, profileId)).toBe(6);
  });

  it("est scopé au profil (n'additionne pas les étoiles d'un autre profil)", () => {
    const other = seedProfile("Tom");
    recordStars(db, level(0, 0), 3, NOW);
    recordStars(db, { profileId: other, worldIndex: 0, levelIndex: 0 }, 2, NOW);
    expect(totalStars(db, profileId)).toBe(3);
    expect(totalStars(db, other)).toBe(2);
  });
});
