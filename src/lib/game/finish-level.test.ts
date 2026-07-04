import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { profiles } from "@/lib/db/schema";
import type { MapConfig } from "@/config/server-config";
import { loadStars, recordStars } from "./progress";
import { getUnlockedWorldCount } from "./unlock";
import { finishLevel, type FinishLevelInput } from "./finish-level";

/**
 * Tests d'intégration de la **fin de niveau** (5.3, MAP §1/§4/§6) sur **base réelle**
 * (SQLite en mémoire + migrations). Prouvent, à effet observable (rouge si la garde est
 * mutée) : persistance monotone, idempotence (pas de double effet / double déblocage),
 * **boss ⇒ déblocage**, **niveau non-boss ⇒ PAS de déblocage**, **étoiles ≠ barrière**, et
 * les gardes de déblocage linéaire (monde/niveau verrouillé) + gardes de forme.
 */

let db: AppDatabase;
let profileId: number;
const NOW = new Date(Date.UTC(2026, 6, 4, 10, 0, 0));
const LATER = new Date(Date.UTC(2026, 6, 4, 11, 0, 0));
/** 10 niveaux + boss (index 10). */
const CONFIG: MapConfig = { levelsPerWorld: 10, treasureEvery: 4, bossQuestionCount: 13 };
const BOSS = CONFIG.levelsPerWorld; // 10

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

/** Marque un niveau complété directement (met en place l'état de progression d'un test). */
function complete(worldIndex: number, levelIndex: number, stars: 0 | 1 | 2 | 3): void {
  recordStars(db, { profileId, worldIndex, levelIndex }, stars, NOW);
}

/** Complète linéairement les niveaux `0..upTo` (exclus) du monde 0 pour ouvrir le nœud voulu. */
function completeUpTo(worldIndex: number, upTo: number): void {
  for (let i = 0; i < upTo; i += 1) {
    complete(worldIndex, i, 3);
  }
}

function input(worldIndex: number, levelIndex: number, stars: number): FinishLevelInput {
  return { worldIndex, levelIndex, stars };
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = seedProfile("Léa");
});

describe("finishLevel — persistance (MAP §4)", () => {
  it("persiste la fin du niveau courant (0) → progress écrit, étoiles stockées, point de reprise", () => {
    const result = finishLevel(db, profileId, input(0, 0, 2), CONFIG, NOW);
    expect(result).toEqual({ ok: true, stars: 2, unlockedNextWorld: false });
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 0 })).toBe(2);
  });

  it("avance linéairement : compléter 0 ouvre 1, compléter 1 ouvre 2", () => {
    finishLevel(db, profileId, input(0, 0, 3), CONFIG, NOW);
    expect(finishLevel(db, profileId, input(0, 1, 3), CONFIG, NOW).ok).toBe(true);
    expect(finishLevel(db, profileId, input(0, 2, 3), CONFIG, NOW).ok).toBe(true);
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 2 })).toBe(3);
  });

  // GARDE MONOTONE (MAP §4 / SYNC) : rejouer un niveau moins bien ne baisse jamais les étoiles.
  it("MONOTONE : rejoue le niveau 0 à 3★ puis 1★ → reste 3★", () => {
    finishLevel(db, profileId, input(0, 0, 3), CONFIG, NOW);
    const after = finishLevel(db, profileId, input(0, 0, 1), CONFIG, LATER);
    expect(after).toEqual({ ok: true, stars: 3, unlockedNextWorld: false });
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 0 })).toBe(3);
  });

  it("MONOTONE : une meilleure reprise fait progresser (1★ puis 3★ → 3★)", () => {
    finishLevel(db, profileId, input(0, 0, 1), CONFIG, NOW);
    const after = finishLevel(db, profileId, input(0, 0, 3), CONFIG, LATER);
    expect(after.ok && after.stars).toBe(3);
  });
});

describe("finishLevel — déblocage linéaire boss ⇒ monde suivant (MAP §6)", () => {
  // GARDE « boss ⇒ déblocage » (effet observable) : compléter le boss (dernier nœud) ouvre
  // le monde suivant. Rouge si `unlockedNextWorld` cessait de dépendre de `levelIndex === boss`.
  it("BOSS COMPLÉTÉ ⇒ unlockedNextWorld: true ET monde suivant réellement débloqué", () => {
    completeUpTo(0, BOSS); // ouvre le boss (nœud courant = 10)
    const result = finishLevel(db, profileId, input(0, BOSS, 3), CONFIG, NOW);
    expect(result).toEqual({ ok: true, stars: 3, unlockedNextWorld: true });
    // Effet réel dérivé du progress : le monde 1 est désormais débloqué.
    expect(getUnlockedWorldCount(db, profileId, CONFIG.levelsPerWorld)).toBe(2);
  });

  // GARDE « niveau NON-boss ne débloque PAS » (effet observable, contraste avec le test ci-dessus).
  it("NIVEAU NON-BOSS complété ⇒ unlockedNextWorld: false ET monde suivant TOUJOURS verrouillé", () => {
    const result = finishLevel(db, profileId, input(0, 0, 3), CONFIG, NOW);
    expect(result.ok && result.unlockedNextWorld).toBe(false);
    expect(getUnlockedWorldCount(db, profileId, CONFIG.levelsPerWorld)).toBe(1); // pas de déblocage
  });

  // GARDE « ÉTOILES ≠ BARRIÈRE » (MAP §1/§8) : boss à 1★ débloque EXACTEMENT comme à 3★.
  it("ÉTOILES ≠ BARRIÈRE : boss complété avec 1★ débloque le monde suivant (comme 3★)", () => {
    completeUpTo(0, BOSS);
    const result = finishLevel(db, profileId, input(0, BOSS, 1), CONFIG, NOW);
    expect(result).toEqual({ ok: true, stars: 1, unlockedNextWorld: true });
    expect(getUnlockedWorldCount(db, profileId, CONFIG.levelsPerWorld)).toBe(2);
  });
});

describe("finishLevel — idempotence (SYNC §2)", () => {
  it("rejeu de la même fin de niveau ⇒ pas de double ligne, étoiles inchangées (monotone)", () => {
    completeUpTo(0, BOSS);
    finishLevel(db, profileId, input(0, BOSS, 2), CONFIG, NOW);
    finishLevel(db, profileId, input(0, BOSS, 2), CONFIG, LATER);
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: BOSS })).toBe(2);
  });

  // GARDE « pas de DOUBLE déblocage » : le déblocage est DÉRIVÉ du progress (pas incrémenté),
  // donc rejouer le boss ne double jamais le compte de mondes.
  it("rejeu du boss ⇒ PAS de double déblocage (déblocage dérivé, pas incrémenté)", () => {
    completeUpTo(0, BOSS);
    finishLevel(db, profileId, input(0, BOSS, 3), CONFIG, NOW);
    finishLevel(db, profileId, input(0, BOSS, 3), CONFIG, LATER); // rejeu
    // Toujours exactement 2 mondes débloqués (monde 0 + monde 1), pas 3.
    expect(getUnlockedWorldCount(db, profileId, CONFIG.levelsPerWorld)).toBe(2);
  });
});

describe("finishLevel — gardes de déblocage linéaire (source de vérité serveur)", () => {
  // GARDE « monde verrouillé refusé » (effet observable) : on ne persiste pas la fin d'un
  // niveau d'un monde non débloqué (boss du précédent non fait).
  it("monde verrouillé (boss du monde 0 non complété) ⇒ WORLD_LOCKED, aucune écriture", () => {
    const result = finishLevel(db, profileId, input(1, 0, 3), CONFIG, NOW);
    expect(result).toEqual({ ok: false, error: "WORLD_LOCKED" });
    expect(loadStars(db, { profileId, worldIndex: 1, levelIndex: 0 })).toBe(0); // rien écrit
  });

  it("monde débloqué → la fin de son 1ᵉʳ niveau passe", () => {
    completeUpTo(0, BOSS);
    finishLevel(db, profileId, input(0, BOSS, 3), CONFIG, NOW); // ouvre le monde 1
    const result = finishLevel(db, profileId, input(1, 0, 2), CONFIG, NOW);
    expect(result).toEqual({ ok: true, stars: 2, unlockedNextWorld: false });
  });

  // GARDE « niveau verrouillé refusé » (effet observable) : sauter un niveau dans un monde
  // débloqué est refusé (déblocage linéaire intra-monde).
  it("niveau sauté (au-delà du courant) ⇒ LEVEL_LOCKED, aucune écriture", () => {
    // courant du monde 0 = niveau 0 ; tenter le niveau 3 (sauté).
    const result = finishLevel(db, profileId, input(0, 3, 3), CONFIG, NOW);
    expect(result).toEqual({ ok: false, error: "LEVEL_LOCKED" });
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 3 })).toBe(0);
  });

  it("rejoue d'un niveau déjà complété (monotone) est autorisée", () => {
    complete(0, 0, 1);
    const result = finishLevel(db, profileId, input(0, 0, 3), CONFIG, LATER);
    expect(result).toEqual({ ok: true, stars: 3, unlockedNextWorld: false });
  });
});

describe("finishLevel — gardes de forme (payload public non fiable, #36)", () => {
  it("worldIndex non-entier ⇒ INVALID_INPUT", () => {
    expect(finishLevel(db, profileId, input(0.5, 0, 2), CONFIG, NOW)).toEqual({
      ok: false,
      error: "INVALID_INPUT",
    });
  });

  it("worldIndex négatif ⇒ INVALID_INPUT", () => {
    expect(finishLevel(db, profileId, input(-1, 0, 2), CONFIG, NOW)).toEqual({
      ok: false,
      error: "INVALID_INPUT",
    });
  });

  it("levelIndex non-numérique ⇒ INVALID_INPUT", () => {
    expect(
      finishLevel(db, profileId, { worldIndex: 0, levelIndex: "boss", stars: 2 }, CONFIG, NOW),
    ).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("stars hors bornes (4) ⇒ INVALID_INPUT", () => {
    expect(finishLevel(db, profileId, input(0, 0, 4), CONFIG, NOW)).toEqual({
      ok: false,
      error: "INVALID_INPUT",
    });
  });

  it("stars négatif ⇒ INVALID_INPUT", () => {
    expect(finishLevel(db, profileId, input(0, 0, -1), CONFIG, NOW)).toEqual({
      ok: false,
      error: "INVALID_INPUT",
    });
  });

  it("stars non-entier ⇒ INVALID_INPUT", () => {
    expect(finishLevel(db, profileId, input(0, 0, 2.5), CONFIG, NOW)).toEqual({
      ok: false,
      error: "INVALID_INPUT",
    });
  });

  it("stars = 0 accepté (niveau complété sans étoile — no-fail, étoiles ≠ barrière)", () => {
    const result = finishLevel(db, profileId, input(0, 0, 0), CONFIG, NOW);
    expect(result).toEqual({ ok: true, stars: 0, unlockedNextWorld: false });
    // Le niveau est bien complété (ligne progress présente) même à 0★.
    expect(loadStars(db, { profileId, worldIndex: 0, levelIndex: 0 })).toBe(0);
  });
});
