import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { socleWorlds, worlds } from "@/lib/db/schema";
import {
  buildSocle,
  buildSocleWorld,
  hashSeed,
  regenerateSocleContent,
  resolveWorld,
  seedSocleWorlds,
  socleAssetRefs,
  socleSeed,
  socleWorldId,
  SocleUnavailableError,
  SOCLE_WORLD_COUNT,
} from "./socle";

const tmpRoot = mkdtempSync(join(tmpdir(), "multiplyz-socle-"));
let counter = 0;
/** Base fraîche **migrée** (donc socle déjà amorcé par `runMigrations` → prouve le câblage). */
function freshDb(): AppDatabase {
  counter += 1;
  const db = createDatabase(join(tmpRoot, `case-${counter}`, "app.sqlite"));
  runMigrations(db);
  return db;
}
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

/** Insère un `worlds` avec un statut donné (pour exercer le filtre `active` / le chemin généré). */
function seedGeneratedWorld(
  db: AppDatabase,
  index: number,
  status: "buffered" | "active",
  refs = "{}",
): void {
  db.insert(worlds)
    .values({
      id: `world:${index}`,
      index,
      theme: `Monde généré ${index}`,
      palette: `{"slug":"gen-${index}","accent":"#123456"}`,
      assetRefs: refs,
      prompt: `prompt-${index}`,
      seed: `seed-gen-${index}`,
      status,
    })
    .run();
}

describe("hashSeed (dérivation déterministe pure)", () => {
  it("est déterministe (même seed ⇒ même hash) et entier ≥ 0", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hashSeed("socle-world-3"))).toBe(true);
  });

  it("distingue deux seeds différents (le hash dépend de l'entrée)", () => {
    expect(hashSeed("socle-world-0")).not.toBe(hashSeed("socle-world-1"));
  });
});

describe("regenerateSocleContent (reproductibilité depuis le seed — WORLDGEN §7, AC #4)", () => {
  it("REPRODUCTIBLE : même seed ⇒ même thème + palette (régénérable à l'identique)", () => {
    const a = regenerateSocleContent("socle-world-2");
    const b = regenerateSocleContent("socle-world-2");
    expect(a).toEqual(b);
  });

  // GARDE AC #4 (mutation-prouvée) : le seed est LOAD-BEARING. Si `regenerateSocleContent`
  // ignorait le seed (ex. renvoyait toujours CURATED_THEMES[0]), ce test rougirait — les seeds
  // des slots 0 et 1 dérivent vers des thèmes DISTINCTS (indices de thème 3 vs 2, sur 6 thèmes).
  it("SEED-SENSIBLE : muter le seed change le thème dérivé (garde AC #4)", () => {
    const s0 = regenerateSocleContent(socleSeed(0));
    const s1 = regenerateSocleContent(socleSeed(1));
    expect(s0.theme.slug).not.toBe(s1.theme.slug);
  });
});

describe("socleAssetRefs (placeholder — gate owner, même signal que la légendaire 5.6)", () => {
  it("émet des refs `placeholder://socle/<slot>/…` (asset non encore généré)", () => {
    const refs = socleAssetRefs(4);
    expect(refs.background).toBe("placeholder://socle/4/background");
    expect(refs.tiles).toBe("placeholder://socle/4/tiles");
    expect(refs.teddy).toBe("placeholder://socle/4/teddy");
  });
});

describe("buildSocleWorld / buildSocle (fixture déterministe du socle — WORLDGEN §1)", () => {
  it("construit exactement SOCLE_WORLD_COUNT mondes (⚙️ taille du socle, ~5-8)", () => {
    expect(buildSocle()).toHaveLength(SOCLE_WORLD_COUNT);
    expect(SOCLE_WORLD_COUNT).toBeGreaterThanOrEqual(5);
    expect(SOCLE_WORLD_COUNT).toBeLessThanOrEqual(8);
  });

  it("est DÉTERMINISTE : même slot ⇒ même monde (reproductible)", () => {
    expect(buildSocleWorld(0)).toEqual(buildSocleWorld(0));
  });

  it("chaque monde porte id `socle:<slot>`, prompt + seed non vides, refs placeholder", () => {
    const socle = buildSocle();
    socle.forEach((row, slot) => {
      expect(row.id).toBe(socleWorldId(slot));
      expect(row.slot).toBe(slot);
      expect(row.seed).toBe(socleSeed(slot));
      expect(row.prompt.length).toBeGreaterThan(0);
      expect(row.theme.length).toBeGreaterThan(0);
      expect(JSON.parse(row.assetRefs).background).toContain("placeholder://socle/");
    });
  });

  it("les SOCLE_WORLD_COUNT mondes ont des thèmes DISTINCTS (variété du socle)", () => {
    const themes = buildSocle().map((r) => r.theme);
    expect(new Set(themes).size).toBe(SOCLE_WORLD_COUNT);
  });
});

describe("seedSocleWorlds (amorçage idempotent — WORLDGEN §7, AC #3)", () => {
  it("amorce le socle au 1er lancement (rows == fixture) via runMigrations (câblage)", () => {
    const db = freshDb(); // runMigrations a déjà appelé seedSocleWorlds.
    const rows = db.select().from(socleWorlds).orderBy(socleWorlds.slot).all();
    expect(rows).toHaveLength(SOCLE_WORLD_COUNT);
    expect(rows.map((r) => ({ id: r.id, slot: r.slot, theme: r.theme }))).toEqual(
      buildSocle().map((r) => ({ id: r.id, slot: r.slot, theme: r.theme })),
    );
  });

  it("IDEMPOTENT : ré-amorcer ne duplique rien et ne lève pas", () => {
    const db = freshDb();
    expect(() => seedSocleWorlds(db)).not.toThrow();
    expect(db.select().from(socleWorlds).all()).toHaveLength(SOCLE_WORLD_COUNT);
  });

  // GARDE (mutation-prouvée) : `onConflictDoNothing` ne RÉÉCRIT jamais une ligne existante — les
  // vrais assets validés par le proprio (gate owner) survivent au ré-amorçage placeholder. Passer
  // à `onConflictDoUpdate` écraserait la ref réelle → ce test rougirait.
  it("NE RÉÉCRIT JAMAIS l'existant : un assetRef réel survit au ré-amorçage (gate owner)", () => {
    const db = freshDb();
    const realRef = '{"background":"world/real/bg.png"}';
    // Simule le proprio ayant remplacé le placeholder du slot 0 par un vrai asset validé.
    db.update(socleWorlds)
      .set({ assetRefs: realRef })
      .where(eq(socleWorlds.id, socleWorldId(0)))
      .run();
    // Ré-amorçage (redéploiement) : le placeholder NE DOIT PAS écraser le vrai asset.
    seedSocleWorlds(db);
    const row = db
      .select()
      .from(socleWorlds)
      .where(eq(socleWorlds.id, socleWorldId(0)))
      .get();
    expect(row?.assetRefs).toBe(realRef);
  });
});

describe("resolveWorld (résolveur généré/socle — WORLDGEN §7, AC #1)", () => {
  it("FALLBACK socle quand aucun monde actif (base fraîche, hors réseau — AC #1/#3)", () => {
    const db = freshDb(); // aucun `worlds` généré.
    const resolved = resolveWorld(db, 0);
    expect(resolved.source).toBe("socle");
    expect(resolved.worldIndex).toBe(0);
    expect(resolved.theme).toBe(buildSocleWorld(0).theme);
  });

  it("rend le monde GÉNÉRÉ `active` s'il existe à cet index", () => {
    const db = freshDb();
    seedGeneratedWorld(db, 3, "active", '{"background":"world/3/bg.png"}');
    const resolved = resolveWorld(db, 3);
    expect(resolved.source).toBe("generated");
    expect(resolved.assetRefs).toBe('{"background":"world/3/bg.png"}');
    expect(resolved.seed).toBe("seed-gen-3");
  });

  // GARDE (mutation-prouvée) : filtre `status = active`. Un monde `buffered` (encore en QA,
  // WORLDGEN §6) n'est JAMAIS servi → fallback socle. Retirer `eq(worlds.status,"active")` ferait
  // servir le monde buffered → ce test rougirait.
  it("un monde BUFFERED (en QA) n'est pas servi → fallback socle (garde status)", () => {
    const db = freshDb();
    seedGeneratedWorld(db, 4, "buffered");
    const resolved = resolveWorld(db, 4);
    expect(resolved.source).toBe("socle");
  });

  // GARDE (mutation-prouvée) : mapping modulo sur la taille du pool (le socle est un pool
  // RÉUTILISABLE sur toute la carte infinie). Casser `% pool.length` renverrait le mauvais slot.
  it("mappe worldIndex → socle[index % taille] (pool réutilisé, ⚙️ consommé)", () => {
    const db = freshDb();
    expect(resolveWorld(db, 0).theme).toBe(buildSocleWorld(0).theme);
    expect(resolveWorld(db, SOCLE_WORLD_COUNT).theme).toBe(buildSocleWorld(0).theme);
    expect(resolveWorld(db, SOCLE_WORLD_COUNT + 2).theme).toBe(buildSocleWorld(2).theme);
  });

  // GARDE (mutation-prouvée, trou #60/#61 démasqué par QA) : `resolveWorld` trie explicitement
  // `.orderBy(asc(socleWorlds.slot))` AVANT `pool[index % len]` → le mapping suit le SLOT, jamais
  // l'ordre de scan (rowid). Le seul writer `seedSocleWorlds` insère par slot croissant, donc
  // l'ordre de scan coïncide PAR CONSTRUCTION et masquerait le trou. On ré-insère ici en ordre slot
  // DÉCROISSANT (rowid inverse du slot) : sans le `.orderBy`, `pool[i]` viserait le slot `len-1-i`
  // (mauvais monde pour TOUT i) → ce test rougit. Avec le `.orderBy`, la résolution reste par slot.
  it("résout par SLOT (invariant d'ordre du pool), pas par ordre d'insertion (garde orderBy)", () => {
    const db = freshDb();
    const socle = buildSocle();
    db.delete(socleWorlds).run();
    // Ré-insertion en ordre slot DÉCROISSANT → l'ordre rowid ≠ l'ordre slot.
    for (const row of [...socle].reverse()) {
      db.insert(socleWorlds).values(row).run();
    }
    for (let i = 0; i < SOCLE_WORLD_COUNT; i += 1) {
      expect(resolveWorld(db, i).theme).toBe(buildSocleWorld(i).theme);
    }
  });

  // GARDE loud (#157) : socle jamais amorcé → échec actionnable, pas un TypeError cryptique.
  it("lève SocleUnavailableError si le socle est vide (garde loud)", () => {
    const db = freshDb();
    db.delete(socleWorlds).run();
    expect(() => resolveWorld(db, 0)).toThrow(SocleUnavailableError);
  });
});
