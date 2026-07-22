import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { characters, worlds } from "@/lib/db/schema";
import { loadWorldGenConfig } from "@/config/server-config";
import { CURATED_THEMES } from "@/config/worldgen-themes";
import { strings } from "@/strings";
import {
  approveAsset,
  MASTER_ASSET_ID,
  upsertCandidate,
  type ReferenceAssetInput,
} from "./reference-assets";
import { legendaryCharacterId, legendaryForWorld } from "@/lib/game/collection";
import type { GenerateImageInput, ImageRef } from "./image-client";
import * as imageClient from "./image-client";
import {
  CREATURE_TOTALS,
  creatureCharacterId,
  creatureSpeciesKey,
  defaultWriteAsset,
  deriveCreatureSplit,
  ESTIMATED_EUR_PER_IMAGE,
  generateWorld,
  makeSeededRandom,
  masterRefBytes,
  resolveDeps,
  worldSeed,
} from "./generate-world";

/**
 * Tests du **générateur de monde Stage B** (WORLDGEN §4/§8, story 6.3), sur **base réelle**
 * (SQLite fichier + migrations), **client image mocké** (zéro appel réseau réel — DoD). Prouvent
 * à effet observable la **fidélité au modèle** (game-design review le MODÈLE, pas l'AC) :
 * - **Teddy** = img2img ancré sur le **master approuvé** (jamais photos) ;
 * - **Créatures** = `{base_style}` en TEXTE (+ bible optionnelle), **JAMAIS** le master ;
 * - **Rareté** ECONOMY : plusieurs communes + 1-2 rares + **exactement 1 légendaire** hors œufs ;
 * - **Master absent** ⇒ **échec loud** (jamais génération silencieuse) ;
 * - thème hors pool / banni / doublon récent ⇒ refus ;
 * - prompt + seed persistés (reproductibilité §7) + déterminisme ;
 * - **budget lu/rapporté, JAMAIS enforce** (enforce = worker 6.4, rétro #155) ;
 * - **atomicité** de la persistance (rollback si une écriture gardée casse).
 */

const tmpRoot = mkdtempSync(join(tmpdir(), "multiplyz-genworld-"));
let counter = 0;
function freshDb(): AppDatabase {
  counter += 1;
  const db = createDatabase(join(tmpRoot, `case-${counter}`, "app.sqlite"));
  runMigrations(db);
  return db;
}
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

/** Seed un master Teddy **approuvé** (prérequis d'ancrage Stage B). */
function seedApprovedMaster(db: AppDatabase): void {
  const input: ReferenceAssetInput = {
    id: MASTER_ASSET_ID,
    kind: "master",
    expression: null,
    assetRef: "storage/reference/teddy/teddy-master.png",
    backgroundStrategy: "post-cutout",
    transparent: true,
    sourcePhotosHash: "hash-master",
  };
  upsertCandidate(db, input);
  approveAsset(db, MASTER_ASSET_ID, "owner");
}

/** Un générateur d'image mocké : renvoie des octets factices + enregistre chaque appel. */
function recordingGenerate() {
  const calls: GenerateImageInput[] = [];
  const generate = vi.fn(async (input: GenerateImageInput): Promise<Buffer> => {
    calls.push(input);
    return Buffer.from(`img:${input.prompt.slice(0, 12)}`);
  });
  return { calls, generate };
}

/** Deps par défaut du test : master approuvé requis, écriture déterministe, horloge figée. */
function baseDeps(overrides: Record<string, unknown> = {}) {
  const now = new Date(Date.UTC(2026, 6, 7, 12, 0, 0));
  return {
    now: () => now,
    config: loadWorldGenConfig({}),
    ...overrides,
  };
}

let db: AppDatabase;
beforeEach(() => {
  db = freshDb();
  seedApprovedMaster(db);
});

// ───────────────────────────── helpers purs ─────────────────────────────

describe("makeSeededRandom / worldSeed / clés", () => {
  it("PRNG déterministe : même seed ⇒ même suite", () => {
    const a = makeSeededRandom(42);
    const b = makeSeededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("worldSeed = <slug>-<index> reproductible (WORLDGEN §7)", () => {
    expect(worldSeed(3, "ocean")).toBe("ocean-3");
  });

  it("clés de créature stables et distinctes de la légendaire", () => {
    expect(creatureCharacterId(2, 0)).toBe("creature:2:0");
    expect(creatureSpeciesKey(2, 0)).toBe("creature_world_2_0");
    expect(creatureCharacterId(2, 0)).not.toBe(legendaryCharacterId(2));
  });

  it("masterRefBytes encode l'assetRef (marqueur d'ancrage déterministe)", () => {
    expect(masterRefBytes("storage/x.png").toString("utf8")).toBe("storage/x.png");
  });
});

describe("resolveDeps / defaults prod", () => {
  it("câble les défauts prod (generate fn, writeAsset déterministe, bible vide, horloge, config)", () => {
    const deps = resolveDeps();
    expect(deps.generate).toBeTypeOf("function");
    expect(deps.writeAsset).toBe(defaultWriteAsset);
    expect(deps.creatureStyleBible).toEqual([]);
    // Défaut = marqueur déterministe (octets réels injectés à l'exécution owner, ADR 0009).
    expect(deps.loadMasterBytes).toBe(masterRefBytes);
    expect(deps.now()).toBeInstanceOf(Date); // horloge réelle par défaut.
    expect(deps.config.monthlyBudgetEur).toBeTypeOf("number"); // bloc worldgen central.
  });

  it("le generate par défaut délègue au client image 6.1 (generateImage) — zéro appel réseau ici", async () => {
    const spy = vi
      .spyOn(imageClient, "generateImage")
      .mockResolvedValue(Buffer.from("FROM_CLIENT"));
    const { generate } = resolveDeps();
    const out = await generate({ prompt: "p" });
    expect(spy).toHaveBeenCalledWith({ prompt: "p" });
    expect(out.toString()).toBe("FROM_CLIENT");
    // Pas de `spy.mockRestore()` manuel (fuite si l'assertion ci-dessus lève, rétro #186/#193) :
    // `restoreMocks: true` (vitest.config) restaure le spy avant le test suivant.
  });

  it("defaultWriteAsset renvoie une réf d'URL déterministe world/<index>/<name>", async () => {
    const ref = await defaultWriteAsset(3, "background.png");
    expect(ref).toBe("world/3/background.png");
  });
});

// ───────────────────────── répartition de rareté ─────────────────────────

describe("deriveCreatureSplit — rareté ECONOMY §5", () => {
  it("total ∈ [6,8], rares ∈ [1,2], commons ≥ 1, +1 légendaire (non compté)", () => {
    for (let i = 0; i < 50; i += 1) {
      const s = deriveCreatureSplit(i);
      const total = s.commons + s.rares + CREATURE_TOTALS.legendaries;
      expect(total).toBeGreaterThanOrEqual(CREATURE_TOTALS.minTotal);
      expect(total).toBeLessThanOrEqual(CREATURE_TOTALS.maxTotal);
      expect(s.rares).toBeGreaterThanOrEqual(CREATURE_TOTALS.minRares);
      expect(s.rares).toBeLessThanOrEqual(CREATURE_TOTALS.maxRares);
      expect(s.commons).toBeGreaterThanOrEqual(1);
    }
  });

  it("déterministe : même world_index ⇒ même répartition", () => {
    expect(deriveCreatureSplit(7)).toEqual(deriveCreatureSplit(7));
  });
});

// ─────────────────── validation de thème (WORLDGEN §4.1) ───────────────────

describe("generateWorld — validation de thème", () => {
  it("refuse un thème banni (échec loud, kid-safe)", async () => {
    const { generate } = recordingGenerate();
    await expect(
      generateWorld(db, "monde de guerre", 0, [], baseDeps({ generate })),
    ).rejects.toThrow(/banni/);
    expect(generate).not.toHaveBeenCalled(); // aucune image générée si le thème est refusé.
  });

  it("refuse un thème hors du pool curaté", async () => {
    const { generate } = recordingGenerate();
    await expect(
      generateWorld(db, "désert inconnu", 0, [], baseDeps({ generate })),
    ).rejects.toThrow(/hors du pool/);
    expect(generate).not.toHaveBeenCalled();
  });

  it("refuse un doublon récent (éviter le même thème deux fois de suite)", async () => {
    const { generate } = recordingGenerate();
    await expect(generateWorld(db, "ocean", 0, ["ocean"], baseDeps({ generate }))).rejects.toThrow(
      /récemment/,
    );
    expect(generate).not.toHaveBeenCalled();
  });
});

// ─────────────────── master absent = échec loud (#157) ───────────────────

describe("generateWorld — master approuvé requis (WORLDGEN §8, #157)", () => {
  it("lève si aucun master approuvé (jamais de Teddy non ancré silencieux)", async () => {
    const bare = freshDb(); // pas de master approuvé.
    const { generate } = recordingGenerate();
    await expect(generateWorld(bare, "ocean", 0, [], baseDeps({ generate }))).rejects.toThrow(
      /master Teddy approuvé/,
    );
    // Échec AVANT toute génération payante.
    expect(generate).not.toHaveBeenCalled();
  });

  it("un master seulement CANDIDATE (non approuvé) ne suffit pas → lève", async () => {
    const bare = freshDb();
    upsertCandidate(bare, {
      id: MASTER_ASSET_ID,
      kind: "master",
      expression: null,
      assetRef: "x.png",
      backgroundStrategy: "post-cutout",
      transparent: true,
      sourcePhotosHash: "h",
    });
    const { generate } = recordingGenerate();
    await expect(generateWorld(bare, "ocean", 0, [], baseDeps({ generate }))).rejects.toThrow(
      /master Teddy approuvé/,
    );
  });
});

// ─────────────── fidélité d'ancrage : Teddy=master, créatures≠master ───────────────

describe("generateWorld — fidélité d'ancrage (ADR 0009)", () => {
  it("la variante Teddy est ancrée img2img sur le MASTER (refImages = master, pas photos)", async () => {
    const { calls, generate } = recordingGenerate();
    await generateWorld(db, "ocean", 0, [], baseDeps({ generate }));
    // Le prompt Teddy porte l'accessoire du monde + le gabarit teddy (mohair/cream chest).
    const teddyCall = calls.find((c) => /Steiff teddy bear/.test(c.prompt));
    expect(teddyCall).toBeDefined();
    // Effet observable : il passe EXACTEMENT une image de référence = le master approuvé.
    expect(teddyCall?.refImages).toHaveLength(1);
    expect(teddyCall?.refImages?.[0].data.toString("utf8")).toBe(
      "storage/reference/teddy/teddy-master.png",
    );
  });

  it("les créatures ne passent JAMAIS le master en référence (une créature n'est pas Teddy)", async () => {
    const { calls, generate } = recordingGenerate();
    await generateWorld(db, "ocean", 0, [], baseDeps({ generate }));
    const creatureCalls = calls.filter((c) => /collectible creature/.test(c.prompt));
    expect(creatureCalls.length).toBeGreaterThan(0);
    for (const c of creatureCalls) {
      // Aucune référence par défaut (cohérence par {base_style} en TEXTE, ADR 0009).
      expect(c.refImages ?? []).toHaveLength(0);
      // Et surtout : le prompt créature ne mentionne pas Teddy/Steiff.
      expect(c.prompt).not.toMatch(/Teddy|Steiff/);
    }
  });

  it("la légendaire du boss a un concept DISTINCT de toute créature œufs (récompense spéciale, ECONOMY §5/§8)", async () => {
    // Extrait le `{creature_concept}` d'un prompt créature (gabarit ART §5 : « collectible creature: <concept>, 1-2 distinctive »).
    const conceptOf = (prompt: string): string | null => {
      const m = /collectible creature: (.+?), 1-2 distinctive/.exec(prompt);
      return m ? m[1] : null;
    };
    // Balaye TOUS les thèmes curatés (surfaces disjointes) sur plusieurs world_index.
    for (let i = 0; i < CURATED_THEMES.length; i += 1) {
      const theme = CURATED_THEMES[i];
      // Un index dont `findCuratedTheme` résout ce thème : on passe le slug directement.
      const fresh = freshDb();
      seedApprovedMaster(fresh);
      const { calls, generate } = recordingGenerate();
      await generateWorld(fresh, theme.slug, i, [], baseDeps({ generate }));

      const creatureConcepts = calls
        .map((c) => conceptOf(c.prompt))
        .filter((x): x is string => x !== null);
      // Le DERNIER concept créature = la légendaire (générée après le pool d'œufs) ; les précédents = œufs.
      const legendaryConcept = creatureConcepts[creatureConcepts.length - 1];
      const eggConcepts = creatureConcepts.slice(0, -1);
      expect(eggConcepts.length).toBeGreaterThan(0);
      // Effet observable : le concept de la légendaire n'apparaît dans AUCUN concept d'œufs du monde.
      // Muter `curated.legendaryConcept` → `creatureConcepts[conceptBase % len]` (collision slot-0)
      // rend `legendaryConcept === eggConcepts[0]` → ce test rouge.
      expect(eggConcepts).not.toContain(legendaryConcept);
      expect(legendaryConcept).toBe(theme.legendaryConcept.concept);
    }
  });

  it("la style-bible OPTIONNELLE est passée aux créatures quand fournie (jamais le master)", async () => {
    const bible: ImageRef[] = [{ data: Buffer.from("bible-creature-1"), mimeType: "image/png" }];
    const { calls, generate } = recordingGenerate();
    await generateWorld(db, "ocean", 0, [], baseDeps({ generate, creatureStyleBible: bible }));
    const creatureCalls = calls.filter((c) => /collectible creature/.test(c.prompt));
    for (const c of creatureCalls) {
      expect(c.refImages).toEqual(bible);
      // La bible n'est PAS le master (garde de non-confusion).
      expect(c.refImages?.[0].data.toString("utf8")).not.toContain("teddy-master");
    }
  });

  it("le prompt de fond/tuiles utilise le thème + la palette et pas de personnage", async () => {
    const { calls, generate } = recordingGenerate();
    await generateWorld(db, "ocean", 0, [], baseDeps({ generate }));
    const bg = calls.find((c) => /background landscape/.test(c.prompt));
    expect(bg?.prompt).toMatch(/Océan scintillant/);
    expect(bg?.prompt).toMatch(/#2BB7E6/);
    expect(bg?.refImages ?? []).toHaveLength(0);
  });
});

// ─────────────── câblage art réel + persistance (WORLDGEN §4/§5/§7) ───────────────

describe("generateWorld — câblage art réel + persistance", () => {
  it("un monde généré = { theme, palette, fond, tuiles, Teddy, 6-8 créatures nommées+histoire }", async () => {
    const { generate } = recordingGenerate();
    const world = await generateWorld(db, "ocean", 0, [], baseDeps({ generate }));

    expect(world.themeSlug).toBe("ocean");
    expect(world.themeLabel).toBe("Océan scintillant");
    expect(JSON.parse(world.palette)).toEqual({ slug: "ocean", accent: "#2BB7E6" });
    expect(world.assetRefs.background).toBe("world/0/background.png");
    expect(world.assetRefs.tiles).toBe("world/0/tiles.png");
    expect(world.assetRefs.teddy).toBe("world/0/teddy.png");

    // 6-8 créatures TOTAL (œufs + 1 légendaire).
    expect(world.creatures.length).toBeGreaterThanOrEqual(6);
    expect(world.creatures.length).toBeLessThanOrEqual(8);
    for (const c of world.creatures) {
      expect(c.nameDefault.length).toBeGreaterThan(0);
      expect(c.story.length).toBeGreaterThan(0);
      expect(c.artRef).toMatch(/^world\/0\//);
    }
  });

  it("persiste worlds (prompt + seed + status=buffered) — reproductibilité §7", async () => {
    const { generate } = recordingGenerate();
    await generateWorld(db, "forest", 1, [], baseDeps({ generate }));
    const row = db.select().from(worlds).where(eq(worlds.id, "world:1")).get();
    expect(row).toMatchObject({
      id: "world:1",
      index: 1,
      theme: "Forêt enchantée",
      seed: "forest-1",
      status: "buffered",
    });
    expect(row?.prompt.length).toBeGreaterThan(0);
    expect(JSON.parse(row!.assetRefs)).toMatchObject({ background: "world/1/background.png" });
  });

  it("câble l'art réel des créatures œufs dans characters (in_egg_pool=true, art non placeholder)", async () => {
    const { generate } = recordingGenerate();
    await generateWorld(db, "ocean", 0, [], baseDeps({ generate }));
    const rows = db.select().from(characters).where(eq(characters.worldIndex, 0)).all();
    const eggs = rows.filter((r) => r.rarity !== "legendary");
    expect(eggs.length).toBeGreaterThanOrEqual(5);
    for (const e of eggs) {
      expect(e.inEggPool).toBe(true);
      expect(e.artRef).toMatch(/^world\/0\//);
      expect(e.artRef).not.toMatch(/^placeholder:/); // art RÉEL, pas placeholder épic #5.
      expect(e.story).toBeTruthy();
    }
  });

  it("exactement 1 légendaire, hors œufs (in_egg_pool=false), art réel câblé (MAP §6)", async () => {
    const { generate } = recordingGenerate();
    await generateWorld(db, "ocean", 0, [], baseDeps({ generate }));
    const rows = db.select().from(characters).where(eq(characters.worldIndex, 0)).all();
    const legendaries = rows.filter((r) => r.rarity === "legendary");
    expect(legendaries).toHaveLength(1);
    expect(legendaries[0].id).toBe(legendaryCharacterId(0));
    expect(legendaries[0].inEggPool).toBe(false); // boss only, hors œufs (ECONOMY §4.2).
    expect(legendaries[0].artRef).toMatch(/^world\/0\/legendary\.png$/);
    expect(legendaries[0].artRef).not.toMatch(/^placeholder:/);
  });

  it("remplace le placeholder de la légendaire amorcée par l'épic #5 (art réel), garde le nom", async () => {
    // Simule l'amorçage épic #5 (placeholder art) AVANT la génération 6.3.
    const legendary = legendaryForWorld(0);
    db.insert(characters)
      .values({
        id: legendary.id,
        worldIndex: 0,
        speciesKey: legendary.speciesKey,
        nameDefault: legendary.nameDefault,
        rarity: "legendary",
        inEggPool: false,
        // Simule un ancien placeholder (état pré-R3.1) que generateWorld REMPLACE par son art généré
        // `world/0/legendary.png` — la valeur pré-seed importe peu (upsert ciblé art), mais on la fige
        // en placeholder explicite pour que le titre « remplace le placeholder » reste littéral (#164).
        artRef: "placeholder://legendary/0",
        story: legendary.story,
      })
      .run();

    const { generate } = recordingGenerate();
    await generateWorld(db, "ocean", 0, [], baseDeps({ generate }));

    const row = db.select().from(characters).where(eq(characters.id, legendary.id)).get();
    // L'art placeholder est REMPLACÉ par l'art réel (câblage §4).
    expect(row?.artRef).toBe("world/0/legendary.png");
    // Le nom déterministe de l'épic #5 est conservé (upsert ciblé art, pas d'écrasement du nom).
    expect(row?.nameDefault).toBe(legendary.nameDefault);
  });

  it("déterministe + idempotent : re-générer le même monde ⇒ même sortie, sans doublon", async () => {
    const first = await generateWorld(
      db,
      "ocean",
      0,
      [],
      baseDeps({ generate: recordingGenerate().generate }),
    );
    const second = await generateWorld(
      db,
      "ocean",
      0,
      [],
      baseDeps({ generate: recordingGenerate().generate }),
    );
    // Même seed, mêmes refs, mêmes créatures (noms/histoires dérivés).
    expect(second.seed).toBe(first.seed);
    expect(second.creatures.map((c) => c.id)).toEqual(first.creatures.map((c) => c.id));
    // Pas de doublon en base (upsert par PK).
    const worldRows = db.select().from(worlds).where(eq(worlds.index, 0)).all();
    expect(worldRows).toHaveLength(1);
    const charRows = db.select().from(characters).where(eq(characters.worldIndex, 0)).all();
    expect(charRows).toHaveLength(first.creatures.length);
  });

  it("les noms de créatures viennent de la banque worldgen centralisée (voix douce, zéro texte en dur)", async () => {
    const { generate } = recordingGenerate();
    const world = await generateWorld(db, "ocean", 0, [], baseDeps({ generate }));
    const eggNames = world.creatures
      .filter((c) => c.rarity !== "legendary")
      .map((c) => c.nameDefault);
    for (const n of eggNames) {
      expect(strings.worldgen.creatureNames).toContain(n);
    }
  });
});

// ─────────────── budget : lu/rapporté, JAMAIS enforce (rétro #155) ───────────────

describe("generateWorld — budget lu/rapporté, jamais enforce (6.3 ≠ 6.4)", () => {
  it("rapporte le coût (nb d'appels payants × coût estimé) + le plafond LU en contexte", async () => {
    const { calls, generate } = recordingGenerate();
    const world = await generateWorld(db, "ocean", 0, [], baseDeps({ generate }));
    // Le coût rapporté = 1 image par appel de génération réellement effectué.
    expect(world.cost.paidImageCalls).toBe(calls.length);
    expect(world.cost.estimatedEur).toBeCloseTo(calls.length * ESTIMATED_EUR_PER_IMAGE, 6);
    // Le plafond est LU (contexte), pas enforce.
    expect(world.cost.monthlyBudgetEur).toBe(20);
  });

  it("NE BLOQUE PAS la génération sur le plafond ⚙️ (enforce = worker 6.4, jamais 6.3)", async () => {
    // Plafond ridiculement bas (1 €, < coût cumulé même sur un seul monde à terme) → 6.3 doit
    // TOUT DE MÊME générer un monde complet. 6.3 lit le plafond mais ne refuse jamais dessus.
    const { generate } = recordingGenerate();
    const config = loadWorldGenConfig({ WORLDGEN_MONTHLY_BUDGET_EUR: "1" });
    const world = await generateWorld(db, "ocean", 0, [], baseDeps({ generate, config }));
    // Effet observable : le plafond LU est 1, et la génération a produit un monde complet quand même.
    expect(world.cost.monthlyBudgetEur).toBe(1);
    expect(world.creatures.length).toBeGreaterThanOrEqual(6);
    // Le coût est RAPPORTÉ (jamais comparé/enforce ici) : c'est une donnée du retour, pas une garde.
    expect(world.cost.estimatedEur).toBeGreaterThan(0);
    // Aucun compteur de dépense n'est persisté (pas de changement de modèle de données 6.3).
    // (worlds ne porte aucune colonne de dépense — cf. schema.ts).
  });
});

// ─────────────── atomicité de la persistance (rollback multi-écritures, #122) ───────────────

describe("generateWorld — atomicité de la persistance (transaction)", () => {
  it("rollback : si l'écriture du monde casse, aucune créature n'est persistée (tout ou rien)", async () => {
    // On casse la 2ᵉ phase d'écriture (le monde) APRÈS que les créatures (1ʳᵉ phase) soient écrites,
    // en violant la contrainte UNIQUE de world_index (un monde à l'index 0 existe déjà).
    db.insert(worlds)
      .values({
        id: "world:existing",
        index: 0, // même index → la génération de l'index 0 violera worlds_index_unique.
        theme: "x",
        palette: "{}",
        assetRefs: "{}",
        prompt: "p",
        seed: "s",
      })
      .run();

    const { generate } = recordingGenerate();
    await expect(generateWorld(db, "ocean", 0, [], baseDeps({ generate }))).rejects.toThrow();

    // La transaction a rollback → AUCUNE créature du monde 0 n'a été persistée.
    const charRows = db.select().from(characters).where(eq(characters.worldIndex, 0)).all();
    expect(charRows).toHaveLength(0);
  });
});
