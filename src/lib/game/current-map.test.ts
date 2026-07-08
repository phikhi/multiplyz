import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { profiles } from "@/lib/db/schema";
import { CONFIG_DEFAULTS, type EngineConfig, type MapConfig } from "@/config/server-config";
import { generateFacts } from "@/lib/engine/facts";
import { upsertMastery } from "@/lib/engine/persistence";
import type { MasteryState } from "@/lib/engine/mastery";
import { buildSocleWorld } from "@/lib/worldgen/socle";
import { deserializePalette } from "@/lib/worldgen/palette";
import { recordStars } from "./progress";
import { loadCurrentWorldMap, toMapBuildConfig } from "./current-map";

/**
 * Tests d'intégration de la **composition carte du monde courant** (5.4, story #125)
 * sur base réelle : câble `buildMap` (5.2) + `getUnlockedWorldCount`/`loadWorldProgress`
 * (5.3) + `computeRevisionDebt` (moteur 3.4/3.6). Vérifie que la carte affichée est
 * bien celle du **dernier monde débloqué** (déblocage linéaire, MAP §1/§6) et que la
 * dette de révision du profil se propage jusqu'à l'overlay (MAP §5).
 */

let db: AppDatabase;
let profileId: number;
const NOW = Date.UTC(2026, 6, 4, 10, 0, 0);
const MAP: MapConfig = { ...CONFIG_DEFAULTS.map, levelsPerWorld: 3, treasureEvery: 2 };
const ENGINE: EngineConfig = CONFIG_DEFAULTS.engine;
const NODE_COUNT = MAP.levelsPerWorld + 1; // 4

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

function complete(worldIndex: number, levelIndex: number): void {
  recordStars(db, { profileId, worldIndex, levelIndex }, 2, new Date(NOW));
}

/** Faits `add` canoniques réels du domaine (ENGINE §1) — garantit des clés distinctes,
 * contrairement à des opérandes synthétiques qui peuvent canonicaliser en collision. */
const ADD_FACTS = generateFacts("add");

/** Marque le `index`-ième fait `add` DUE (déjà vu, boîte basse, échéance dépassée). */
function markDue(index: number): void {
  const fact = ADD_FACTS[index];
  const state: MasteryState = {
    box: 1,
    correctCount: 1,
    wrongCount: 0,
    avgResponseMs: 1000,
    lastSeen: NOW - 100_000,
    nextDue: NOW - 1, // échéance déjà dépassée → DUE
  };
  upsertMastery(db, profileId, fact, state);
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = seedProfile("Léa");
});

describe("toMapBuildConfig", () => {
  it("compose MapConfig + revisionDebtThreshold d'EngineConfig", () => {
    const composed = toMapBuildConfig(MAP, ENGINE);
    expect(composed.levelsPerWorld).toBe(MAP.levelsPerWorld);
    expect(composed.treasureEvery).toBe(MAP.treasureEvery);
    expect(composed.revisionDebtThreshold).toBe(ENGINE.revisionDebtThreshold);
  });
});

describe("loadCurrentWorldMap — monde affiché (déblocage linéaire, MAP §1/§6)", () => {
  it("profil neuf → carte du monde 0 (1ᵉʳ monde toujours débloqué)", () => {
    const map = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    expect(map.worldIndex).toBe(0);
    expect(map.nodes).toHaveLength(NODE_COUNT);
    expect(map.nodes[0].status).toBe("current");
  });

  it("boss du monde 0 complété → carte bascule sur le monde 1 (jamais le monde 0 figé)", () => {
    // Complète tout le monde 0 y compris son boss.
    for (let i = 0; i < NODE_COUNT; i += 1) complete(0, i);

    const map = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    // Effet observable : le monde AFFICHÉ a changé, pas seulement l'unlock interne.
    expect(map.worldIndex).toBe(1);
    expect(map.nodes[0].status).toBe("current");
  });

  it("monde 0 partiellement joué (boss PAS complété) → reste affiché (jamais le suivant)", () => {
    complete(0, 0);
    complete(0, 1);
    // Boss (index 3) volontairement non joué.

    const map = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    expect(map.worldIndex).toBe(0);
    // Nœud courant = le 1ᵉʳ non terminé (index 2), pas le boss.
    const current = map.nodes.find((n) => n.status === "current");
    expect(current?.index).toBe(2);
  });
});

describe("loadCurrentWorldMap — dette de révision propagée (MAP §5)", () => {
  it("aucun fait DUE → aucun overlay révision sur le nœud courant", () => {
    const map = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    const current = map.nodes.find((n) => n.status === "current");
    expect(current?.type).not.toBe("revision");
  });

  it("dette > seuil ⚙️ → le nœud courant est overlay-é révision (remédiation immédiate)", () => {
    // Dépasse strictement revisionDebtThreshold (défaut 12, MAP §5 « > 12 »).
    for (let i = 0; i < ENGINE.revisionDebtThreshold + 1; i += 1) markDue(i);

    const map = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    const current = map.nodes.find((n) => n.status === "current");
    expect(current?.type).toBe("revision");
  });

  it("dette au seuil exact (pas au-delà) → PAS d'overlay (borne stricte `>`, MAP §5)", () => {
    for (let i = 0; i < ENGINE.revisionDebtThreshold; i += 1) markDue(i);

    const map = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    const current = map.nodes.find((n) => n.status === "current");
    expect(current?.type).not.toBe("revision");
  });
});

describe("loadCurrentWorldMap — étoiles reportées (MAP §4, jamais une barrière)", () => {
  it("un nœud complété porte ses étoiles stockées", () => {
    complete(0, 0); // 2 étoiles (helper `complete`)
    const map = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    expect(map.nodes[0].stars).toBe(2);
    expect(map.nodes[0].status).toBe("completed");
  });
});

describe("loadCurrentWorldMap — thème per-monde câblé BOUT-EN-BOUT (story 6.7, WORLDGEN §7)", () => {
  it("profil neuf → le thème du SOCLE de secours atteint la carte (fallback servi à l'enfant)", () => {
    // `runMigrations` a amorcé le socle (aucun monde généré `active`) → resolveWorld(0) retombe
    // sur socle[0]. Effet observable BOUT-EN-BOUT (pas juste `resolveWorld` appelé) : la palette
    // réelle du socle atteint la donnée carte → `--world-accent` côté front.
    const world0 = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    expect(world0.theme.label).toBe(buildSocleWorld(0).theme);
    expect(world0.theme.accent).toBe(deserializePalette(buildSocleWorld(0).palette).accent);
    expect(world0.theme.slug).toBe(deserializePalette(buildSocleWorld(0).palette).slug);
    // Assets socle = placeholder (gate owner) → pas de fond réel rendable (fond teinté côté front).
    expect(world0.theme.background).toBeNull();
  });

  it("le thème est un attribut NON-CLÉ : il n'altère NI le nombre de nœuds NI leurs positions (invariance #123)", () => {
    // Même monde, dette élevée (overlay révision) : la géométrie (compte + positions) est
    // IDENTIQUE à dette nulle — seul le thème/attributs non-clés varient. Casse si le thème
    // rétroagissait sur la géométrie.
    const clean = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    for (let i = 0; i < ENGINE.revisionDebtThreshold + 1; i += 1) markDue(i);
    const withDebt = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    expect(withDebt.nodes).toHaveLength(clean.nodes.length);
    expect(withDebt.nodes.map((n) => n.position)).toEqual(clean.nodes.map((n) => n.position));
    // Le thème reste attaché dans les deux cas (même monde → même thème).
    expect(withDebt.theme.accent).toBe(clean.theme.accent);
  });

  it("le thème VARIE par monde (effet observable end-to-end, #180) : monde 0 ≠ monde 1", () => {
    const world0 = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    // Complète tout le monde 0 (boss inclus) → la carte bascule sur le monde 1 (socle[1]).
    for (let i = 0; i < NODE_COUNT; i += 1) complete(0, i);
    const world1 = loadCurrentWorldMap(db, profileId, MAP, ENGINE, NOW);
    expect(world1.worldIndex).toBe(1);
    expect(world1.theme.accent).toBe(deserializePalette(buildSocleWorld(1).palette).accent);
    // Effet observable : l'accent per-monde change réellement d'un monde à l'autre.
    expect(world1.theme.accent).not.toBe(world0.theme.accent);
  });
});
