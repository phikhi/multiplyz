import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { profiles } from "@/lib/db/schema";
import { recordStars } from "./progress";
import {
  bossLevelIndex,
  currentNodeIndex,
  getUnlockedWorldCount,
  isBossCompleted,
  isLevelCompleted,
  isLevelPlayable,
  isWorldUnlocked,
  loadWorldProgress,
} from "./unlock";

/**
 * Tests d'intégration du **déblocage linéaire** (5.3, MAP §1/§6) sur **base réelle**
 * (SQLite en mémoire + migrations). Gardes à **effet observable** (rouges si la garde est
 * mutée) — notamment : boss ⇒ déblocage, niveau non-boss ⇒ PAS de déblocage, et **étoiles
 * ≠ barrière** (1★ au boss débloque comme 3★).
 */

let db: AppDatabase;
let profileId: number;
const NOW = new Date(Date.UTC(2026, 6, 4, 10, 0, 0));
/** Structure de test : 10 niveaux + boss → boss à `level_index === 10` (le dernier). */
const LEVELS_PER_WORLD = 10;
const BOSS = LEVELS_PER_WORLD; // 10
const NODE_COUNT = LEVELS_PER_WORLD + 1; // 11

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

/** Marque un niveau `(monde, niveau)` complété avec `stars` étoiles (via la persistance 5.1). */
function complete(worldIndex: number, levelIndex: number, stars: 0 | 1 | 2 | 3): void {
  recordStars(db, { profileId, worldIndex, levelIndex }, stars, NOW);
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = seedProfile("Léa");
});

describe("bossLevelIndex", () => {
  it("le boss est le dernier nœud (index = levelsPerWorld)", () => {
    expect(bossLevelIndex(LEVELS_PER_WORLD)).toBe(10);
    expect(bossLevelIndex(3)).toBe(3);
  });
});

describe("isLevelCompleted", () => {
  it("false pour un niveau jamais joué (aucune ligne)", () => {
    expect(isLevelCompleted(db, profileId, 0, 0)).toBe(false);
  });

  it("true dès qu'une ligne progress existe — INDÉPENDANT du nombre d'étoiles (0★ compte)", () => {
    complete(0, 0, 0); // 0 étoile = niveau quand même complété (no-fail, étoiles ≠ barrière)
    expect(isLevelCompleted(db, profileId, 0, 0)).toBe(true);
  });

  it("est scopé au profil (le niveau d'un autre profil ne compte pas)", () => {
    const other = seedProfile("Tom");
    recordStars(db, { profileId: other, worldIndex: 0, levelIndex: 0 }, 3, NOW);
    expect(isLevelCompleted(db, profileId, 0, 0)).toBe(false);
    expect(isLevelCompleted(db, other, 0, 0)).toBe(true);
  });
});

describe("isBossCompleted", () => {
  it("false tant que le boss (dernier nœud) n'est pas complété — même si des niveaux le sont", () => {
    complete(0, 0, 3);
    complete(0, 5, 3);
    expect(isBossCompleted(db, profileId, 0, LEVELS_PER_WORLD)).toBe(false);
  });

  // GARDE « le boss est le DERNIER nœud » (MAP §6) : compléter un nœud non-boss ne rend pas
  // le boss complété. Rouge si `bossLevelIndex` pointait un autre index.
  it("un niveau non-boss (même le pénultième) ne compte PAS comme boss complété", () => {
    complete(0, LEVELS_PER_WORLD - 1, 3); // niveau 9, juste avant le boss
    expect(isBossCompleted(db, profileId, 0, LEVELS_PER_WORLD)).toBe(false);
  });

  it("true quand le dernier nœud (boss) a une ligne progress", () => {
    complete(0, BOSS, 1);
    expect(isBossCompleted(db, profileId, 0, LEVELS_PER_WORLD)).toBe(true);
  });
});

describe("getUnlockedWorldCount — déblocage linéaire (MAP §1/§6)", () => {
  it("profil vierge → 1 (le monde 0 est toujours débloqué)", () => {
    expect(getUnlockedWorldCount(db, profileId, LEVELS_PER_WORLD)).toBe(1);
  });

  // GARDE « boss ⇒ déblocage » (MAP §6) : compléter le boss du monde 0 débloque le monde 1.
  it("boss du monde 0 complété ⇒ 2 mondes débloqués (le suivant s'ouvre)", () => {
    complete(0, BOSS, 3);
    expect(getUnlockedWorldCount(db, profileId, LEVELS_PER_WORLD)).toBe(2);
  });

  // GARDE « niveau non-boss ne débloque PAS » (effet observable) : compléter TOUS les
  // niveaux non-boss du monde 0 laisse le compte à 1 tant que le boss n'est pas fait.
  it("tous les niveaux non-boss du monde 0 complétés SANS le boss ⇒ toujours 1 monde débloqué", () => {
    for (let i = 0; i < BOSS; i += 1) {
      complete(0, i, 3);
    }
    expect(getUnlockedWorldCount(db, profileId, LEVELS_PER_WORLD)).toBe(1);
  });

  // GARDE « étoiles ≠ barrière » (MAP §1/§8) : boss à 1★ débloque EXACTEMENT comme 3★.
  it("ÉTOILES ≠ BARRIÈRE : boss complété avec 1★ débloque le monde suivant comme 3★", () => {
    complete(0, BOSS, 1); // une seule étoile
    expect(getUnlockedWorldCount(db, profileId, LEVELS_PER_WORLD)).toBe(2);
  });

  it("chaîne de boss (mondes 0 et 1 complétés) ⇒ 3 mondes débloqués", () => {
    complete(0, BOSS, 2);
    complete(1, BOSS, 2);
    expect(getUnlockedWorldCount(db, profileId, LEVELS_PER_WORLD)).toBe(3);
  });

  // GARDE « la chaîne s'arrête au 1ᵉʳ boss manquant » : un trou dans la chaîne verrouille
  // tout au-delà (le boss du monde 2 complété SANS celui du monde 1 ne compte pas).
  it("boss du monde 2 complété mais PAS celui du monde 1 ⇒ 2 mondes (la chaîne s'arrête au trou)", () => {
    complete(0, BOSS, 3);
    complete(2, BOSS, 3); // saute le monde 1 → sans effet sur la chaîne linéaire
    expect(getUnlockedWorldCount(db, profileId, LEVELS_PER_WORLD)).toBe(2);
  });
});

describe("isWorldUnlocked", () => {
  it("monde 0 toujours débloqué (profil vierge)", () => {
    expect(isWorldUnlocked(db, profileId, 0, LEVELS_PER_WORLD)).toBe(true);
  });

  it("monde négatif jamais débloqué (garde de forme)", () => {
    expect(isWorldUnlocked(db, profileId, -1, LEVELS_PER_WORLD)).toBe(false);
  });

  it("monde 1 verrouillé tant que le boss du monde 0 n'est pas complété", () => {
    expect(isWorldUnlocked(db, profileId, 1, LEVELS_PER_WORLD)).toBe(false);
  });

  it("monde 1 débloqué dès que le boss du monde 0 est complété (1★ suffit — étoiles ≠ barrière)", () => {
    complete(0, BOSS, 1);
    expect(isWorldUnlocked(db, profileId, 1, LEVELS_PER_WORLD)).toBe(true);
  });

  it("monde 2 verrouillé si le boss du monde 1 manque (même avec le boss du monde 0)", () => {
    complete(0, BOSS, 3);
    expect(isWorldUnlocked(db, profileId, 2, LEVELS_PER_WORLD)).toBe(false);
  });
});

describe("loadWorldProgress", () => {
  it("monde jamais joué → starsByLevel vide", () => {
    expect(loadWorldProgress(db, profileId, 0).starsByLevel.size).toBe(0);
  });

  it("mappe les étoiles par level_index du monde demandé (feed buildMap 5.2)", () => {
    complete(0, 0, 1);
    complete(0, 3, 2);
    complete(1, 0, 3); // autre monde → ne doit pas apparaître
    const { starsByLevel } = loadWorldProgress(db, profileId, 0);
    expect(starsByLevel.get(0)).toBe(1);
    expect(starsByLevel.get(3)).toBe(2);
    expect(starsByLevel.has(1)).toBe(false); // niveau 1 pas joué
    expect(starsByLevel.size).toBe(2); // scopé au monde 0
  });

  it("est scopé au profil (n'agrège pas la progression d'un autre profil)", () => {
    const other = seedProfile("Tom");
    recordStars(db, { profileId: other, worldIndex: 0, levelIndex: 0 }, 3, NOW);
    expect(loadWorldProgress(db, profileId, 0).starsByLevel.size).toBe(0);
    expect(loadWorldProgress(db, other, 0).starsByLevel.size).toBe(1);
  });
});

describe("currentNodeIndex", () => {
  it("aucun niveau complété → nœud courant = 0", () => {
    expect(currentNodeIndex(new Set(), NODE_COUNT)).toBe(0);
  });

  it("1ᵉʳ non complété au milieu (0 et 1 faits, 2 non) → 2", () => {
    expect(currentNodeIndex(new Set([0, 1]), NODE_COUNT)).toBe(2);
  });

  it("un trou avant la fin (0 fait, 1 non, 2 fait) → 1 (le 1ᵉʳ non terminé, pas le max)", () => {
    expect(currentNodeIndex(new Set([0, 2]), NODE_COUNT)).toBe(1);
  });

  it("tous complétés → nodeCount (monde bouclé, aucun nœud courant)", () => {
    const all = new Set(Array.from({ length: NODE_COUNT }, (_, i) => i));
    expect(currentNodeIndex(all, NODE_COUNT)).toBe(NODE_COUNT);
  });
});

describe("isLevelPlayable — déblocage linéaire intra-monde (MAP §1)", () => {
  it("nœud courant (1ᵉʳ non terminé) → jouable", () => {
    expect(isLevelPlayable(0, new Set(), NODE_COUNT)).toBe(true);
  });

  it("nœud déjà complété → jouable (rejoue monotone, PRODUCT §1.3)", () => {
    expect(isLevelPlayable(0, new Set([0, 1]), NODE_COUNT)).toBe(true);
  });

  // GARDE « nœud verrouillé refusé » (effet observable) : sauter au-delà du courant est refusé.
  it("nœud au-delà du courant (saut) → VERROUILLÉ (refusé)", () => {
    // courant = 1 (0 fait) ; tenter le niveau 3 (sauté) → refusé.
    expect(isLevelPlayable(3, new Set([0]), NODE_COUNT)).toBe(false);
  });

  it("nœud courant exact → jouable (borne <= courant)", () => {
    // courant = 2 (0 et 1 faits) ; le niveau 2 est jouable, le 3 non.
    expect(isLevelPlayable(2, new Set([0, 1]), NODE_COUNT)).toBe(true);
    expect(isLevelPlayable(3, new Set([0, 1]), NODE_COUNT)).toBe(false);
  });

  it("index négatif → refusé (borne de forme)", () => {
    expect(isLevelPlayable(-1, new Set(), NODE_COUNT)).toBe(false);
  });

  it("index ≥ nodeCount → refusé (hors géométrie du monde)", () => {
    expect(isLevelPlayable(NODE_COUNT, new Set(), NODE_COUNT)).toBe(false);
  });
});
