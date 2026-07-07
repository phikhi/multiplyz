import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { jobs, profiles, progress, worlds } from "@/lib/db/schema";
import { loadWorldGenConfig, type WorldGenConfig } from "@/config/server-config";
import { CURATED_THEMES } from "@/config/worldgen-themes";
import type { GeneratedWorld } from "./generate-world";
import * as generateWorldModule from "./generate-world";
import {
  ACTIVE_JOB_STATUSES,
  bufferTargetIndices,
  budgetAllowsNextWorld,
  currentMonthSpendEur,
  currentWorldIndexFromProgress,
  ensureBuffer,
  ESTIMATED_EUR_PER_WORLD,
  GENERATE_WORLD_JOB,
  hasActiveJobForWorld,
  monthBounds,
  parseWorldIndex,
  processNextJob,
  recoverStaleJobs,
  resolveWorkerDeps,
  runWorkerTick,
  serializeJobPayload,
  themeForWorld,
  worldExists,
} from "./worker";

/**
 * Tests du **worker daemon** (WORLDGEN §2/§3, story 6.4), sur **base réelle** (SQLite fichier +
 * migrations), **générateur MOCKÉ** (zéro appel réseau réel — DoD). Chaque garde est prouvée à
 * **effet observable + mutation-prouvée** (retirer/inverser la garde → rouge) :
 * - **Buffer** : avance simulée → enqueue du bon monde manquant ; géométrie INVARIANTE (#123) ;
 * - **Budget qui AGIT** : dépense simulée ≥ plafond → plus d'enqueue (rétro #155) ;
 * - **Idempotence** : re-jouer un job ne double pas un monde (#82/#144) ;
 * - **Rollback** : panne de la 2ᵉ écriture (job `done`) ⇒ monde `buffered` annulé (#122/#124) ;
 * - **Reprise après crash** : job `running` orphelin re-tentable (pas de perte, pas de double).
 */

const tmpRoot = mkdtempSync(join(tmpdir(), "multiplyz-worker-"));
let counter = 0;
function freshDb(): AppDatabase {
  counter += 1;
  const db = createDatabase(join(tmpRoot, `case-${counter}`, "app.sqlite"));
  runMigrations(db);
  return db;
}
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

/** Horloge figée : 2026-07-07 12:00 UTC (milieu du mois de juillet). */
const NOW = new Date(Date.UTC(2026, 6, 7, 12, 0, 0));

/** Config worldgen par défaut (⚙️ : buffer 2, plafond 20 €, maxRetries 3), surchargeable. */
function cfg(overrides: Partial<WorldGenConfig> = {}): WorldGenConfig {
  return { ...loadWorldGenConfig({}), ...overrides };
}

/** Deps de base : horloge figée + config par défaut (générateur injecté au cas par cas). */
function baseDeps(overrides: Record<string, unknown> = {}) {
  return { now: () => NOW, config: cfg(), ...overrides };
}

/** Insère un `worlds` directement (par ex. pour simuler des mondes déjà générés / dépense). */
function seedWorld(db: AppDatabase, index: number, createdAt: Date = NOW): void {
  db.insert(worlds)
    .values({
      id: `world:${index}`,
      index,
      theme: "Océan scintillant",
      palette: "{}",
      assetRefs: "{}",
      prompt: "p",
      seed: `s-${index}`,
      status: "buffered",
      createdAt,
    })
    .run();
}

/** Crée un profil (prérequis FK de `progress.profile_id`), idempotent par id. */
function seedProfile(db: AppDatabase, profileId: number): void {
  db.insert(profiles)
    .values({
      id: profileId,
      name: `Enfant ${profileId}`,
      nameKey: `enfant ${profileId}`,
      pinHash: "$argon2id$hash",
      avatar: "cat",
    })
    .onConflictDoNothing()
    .run();
}

/** Insère une progression (trace du monde joué) pour dériver le `world_index` courant. */
function seedProgress(db: AppDatabase, profileId: number, worldIndex: number): void {
  seedProfile(db, profileId);
  db.insert(progress)
    .values({
      id: `${profileId}:${worldIndex}:0`,
      profileId,
      worldIndex,
      levelIndex: 0,
      stars: 1,
      updatedAt: NOW,
    })
    .run();
}

/** Enfile un job `generate_world` `pending` pour un index (comme le ferait `ensureBuffer`). */
function enqueueJob(db: AppDatabase, worldIndex: number): number {
  const res = db
    .insert(jobs)
    .values({
      type: GENERATE_WORLD_JOB,
      payload: serializeJobPayload(worldIndex),
      status: "pending",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  return Number(res.lastInsertRowid);
}

/** Générateur mocké : enregistre chaque appel + insère un `worlds` (comme le vrai 6.3). */
function recordingGenerate(db: AppDatabase) {
  const calls: { theme: string; worldIndex: number }[] = [];
  const generate = vi.fn(
    async (_db: AppDatabase, theme: string, worldIndex: number): Promise<GeneratedWorld> => {
      calls.push({ theme, worldIndex });
      // Le vrai générateur persiste le monde (upsert par PK) → on reproduit l'insert minimal.
      db.insert(worlds)
        .values({
          id: `world:${worldIndex}`,
          index: worldIndex,
          theme,
          palette: "{}",
          assetRefs: "{}",
          prompt: "p",
          seed: `s-${worldIndex}`,
          status: "buffered",
          createdAt: NOW,
        })
        .onConflictDoNothing()
        .run();
      return {
        worldId: `world:${worldIndex}`,
        worldIndex,
        themeSlug: theme,
        themeLabel: theme,
        palette: "{}",
        assetRefs: { background: "b", tiles: "t", teddy: "td" },
        creatures: [],
        seed: `s-${worldIndex}`,
        status: "buffered",
        cost: { paidImageCalls: 11, estimatedEur: ESTIMATED_EUR_PER_WORLD, monthlyBudgetEur: 20 },
      };
    },
  );
  return { calls, generate };
}

// ───────────────────────────── helpers purs ─────────────────────────────

describe("themeForWorld / payload / monthBounds (purs)", () => {
  it("themeForWorld : déterministe + cyclique sur le pool curaté (WORLDGEN §7)", () => {
    expect(themeForWorld(0)).toBe(CURATED_THEMES[0]);
    expect(themeForWorld(CURATED_THEMES.length)).toBe(CURATED_THEMES[0]); // cycle
    expect(themeForWorld(1)).toBe(themeForWorld(1 + CURATED_THEMES.length));
  });

  it("serializeJobPayload / parseWorldIndex : aller-retour", () => {
    expect(parseWorldIndex(serializeJobPayload(5))).toBe(5);
  });

  it("parseWorldIndex : json corrompu / champ absent / non entier ⇒ null (garde de forme)", () => {
    expect(parseWorldIndex("not json")).toBeNull();
    expect(parseWorldIndex(JSON.stringify({ foo: 1 }))).toBeNull();
    expect(parseWorldIndex(JSON.stringify({ worldIndex: "3" }))).toBeNull();
    expect(parseWorldIndex(JSON.stringify({ worldIndex: 1.5 }))).toBeNull();
    expect(parseWorldIndex(JSON.stringify(null))).toBeNull();
  });

  it("monthBounds : bornes UTC [1er du mois, 1er du mois suivant[", () => {
    const b = monthBounds(NOW);
    expect(b.start).toBe(Date.UTC(2026, 6, 1));
    expect(b.end).toBe(Date.UTC(2026, 7, 1));
  });
});

describe("resolveWorkerDeps — défauts prod", () => {
  it("câble les défauts prod (generate fn, horloge réelle, config centrale)", () => {
    const deps = resolveWorkerDeps();
    expect(deps.generate).toBeTypeOf("function");
    expect(deps.now()).toBeInstanceOf(Date); // horloge réelle par défaut.
    expect(deps.config.bufferAhead).toBeTypeOf("number"); // bloc worldgen central.
  });

  it("le generate par défaut délègue à generateWorld (6.3) — zéro appel réseau ici (mocké)", async () => {
    const db = freshDb();
    const spy = vi
      .spyOn(generateWorldModule, "generateWorld")
      .mockResolvedValue({ worldIndex: 3 } as unknown as GeneratedWorld);
    const { generate } = resolveWorkerDeps();
    await generate(db, "ocean", 3, []);
    expect(spy).toHaveBeenCalledWith(db, "ocean", 3, []);
    spy.mockRestore();
  });
});

// ───────────────────────────── currentWorldIndexFromProgress ─────────────────────────────

describe("currentWorldIndexFromProgress", () => {
  it("aucune progression ⇒ -1 (base neuve)", () => {
    const db = freshDb();
    expect(currentWorldIndexFromProgress(db)).toBe(-1);
  });

  it("max world_index sur TOUS les profils (mondes partagés du foyer, WORLDGEN §1)", () => {
    const db = freshDb();
    seedProgress(db, 1, 3);
    seedProgress(db, 2, 5); // un autre profil, plus avancé → tire l'avance pour le foyer
    seedProgress(db, 1, 2);
    expect(currentWorldIndexFromProgress(db)).toBe(5);
  });
});

// ───────────────────────────── bufferTargetIndices (géométrie invariante #123) ─────────────────────────────

describe("bufferTargetIndices — géométrie INVARIANTE (#123)", () => {
  it("fenêtre [currentIndex+1 .. currentIndex+bufferAhead]", () => {
    expect(bufferTargetIndices(4, 2)).toEqual([5, 6]);
    expect(bufferTargetIndices(-1, 2)).toEqual([0, 1]); // base neuve
    expect(bufferTargetIndices(0, 3)).toEqual([1, 2, 3]);
  });

  it("le NOMBRE de cibles ne dépend QUE de bufferAhead (invariance à l'état runtime)", () => {
    // Même bufferAhead ⇒ même cardinalité quel que soit currentIndex (géométrie stable).
    for (const current of [-1, 0, 7, 42, 1000]) {
      expect(bufferTargetIndices(current, 2)).toHaveLength(2);
      expect(bufferTargetIndices(current, 5)).toHaveLength(5);
    }
  });

  it("borne défensive : jamais d'index négatif", () => {
    // currentIndex = -1, bufferAhead 2 ⇒ [0,1] (le 0 est le socle, jamais -1).
    expect(bufferTargetIndices(-1, 2).every((i) => i >= 0)).toBe(true);
  });
});

// ───────────────────────────── budget dérivé (WORLDGEN §2) ─────────────────────────────

describe("currentMonthSpendEur / budgetAllowsNextWorld (budget dérivé des données)", () => {
  it("compte les mondes du MOIS COURANT × coût prudent/monde (dérivé de worlds.createdAt)", () => {
    const db = freshDb();
    seedWorld(db, 0, new Date(Date.UTC(2026, 6, 2))); // juillet — compté
    seedWorld(db, 1, new Date(Date.UTC(2026, 6, 20))); // juillet — compté
    seedWorld(db, 2, new Date(Date.UTC(2026, 5, 15))); // JUIN — hors mois, pas compté
    expect(currentMonthSpendEur(db, NOW)).toBeCloseTo(2 * ESTIMATED_EUR_PER_WORLD, 6);
  });

  it("aucun monde ce mois ⇒ dépense 0", () => {
    const db = freshDb();
    seedWorld(db, 9, new Date(Date.UTC(2026, 5, 1))); // juin uniquement
    expect(currentMonthSpendEur(db, NOW)).toBe(0);
  });

  it("budgetAllowsNextWorld : borne INCLUSIVE (atteindre pile le plafond est toléré)", () => {
    const c = cfg({ monthlyBudgetEur: 20 });
    // Pile au plafond : dépense telle que dépense + coût == plafond ⇒ toléré.
    const atCap = 20 - ESTIMATED_EUR_PER_WORLD;
    expect(budgetAllowsNextWorld(atCap, c)).toBe(true);
    // Un cheveu au-dessus ⇒ refusé.
    expect(budgetAllowsNextWorld(atCap + 0.001, c)).toBe(false);
  });
});

// ───────────────────────────── ensureBuffer : BUFFER (AC observable) ─────────────────────────────

describe("ensureBuffer — maintient le buffer d'avance (WORLDGEN §3)", () => {
  it("avance simulée ⇒ enqueue EXACTEMENT les mondes manquants de la fenêtre", () => {
    const db = freshDb();
    // Enfant au monde 4 ⇒ fenêtre [5,6] (buffer 2). Aucun monde/job encore.
    const res = ensureBuffer(db, 4, baseDeps());
    expect(res.enqueued).toEqual([5, 6]);

    // Deux jobs pending insérés pour 5 et 6.
    const pend = db.select().from(jobs).where(eq(jobs.status, "pending")).all();
    expect(
      pend.map((j) => parseWorldIndex(j.payload)).sort((a, b) => Number(a) - Number(b)),
    ).toEqual([5, 6]);
  });

  it("géométrie du buffer INVARIANTE à l'état runtime (#123) : même currentIndex ⇒ mêmes cibles", () => {
    // Deux bases au MÊME currentIndex mais états dynamiques différents (progression, dette
    // simulée par plus de progress) ⇒ MÊME ensemble d'index CIBLÉS (enqueued ∪ skippedExisting).
    const a = freshDb();
    seedProgress(a, 1, 4);
    const b = freshDb();
    seedProgress(b, 1, 4);
    seedProgress(b, 2, 4); // état runtime différent (2 profils) — ne doit PAS changer la géométrie
    seedProgress(b, 1, 0);
    seedProgress(b, 1, 1);

    const ra = ensureBuffer(a, 4, baseDeps());
    const rb = ensureBuffer(b, 4, baseDeps());
    const targetsA = [...ra.enqueued, ...ra.skippedExisting, ...ra.skippedForBudget].sort();
    const targetsB = [...rb.enqueued, ...rb.skippedExisting, ...rb.skippedForBudget].sort();
    expect(targetsA).toEqual([5, 6]);
    expect(targetsB).toEqual([5, 6]);
  });

  it("respecte bufferAhead ⚙️ : buffer 3 ⇒ 3 mondes d'avance", () => {
    const db = freshDb();
    const res = ensureBuffer(db, 0, baseDeps({ config: cfg({ bufferAhead: 3 }) }));
    expect(res.enqueued).toEqual([1, 2, 3]);
  });
});

// ───────────────────────────── ensureBuffer : IDEMPOTENCE (#82) ─────────────────────────────

describe("ensureBuffer — idempotence (#82) : jamais deux jobs pour le même monde", () => {
  it("MUTATION-PROUVÉ : un monde déjà EXISTANT n'est jamais ré-enqueue", () => {
    const db = freshDb();
    seedWorld(db, 5); // le monde 5 existe déjà (généré)
    const res = ensureBuffer(db, 4, baseDeps()); // fenêtre [5,6]
    // 5 sauté (existe), seul 6 enqueue. Retirer la garde `worldExists` ⇒ 5 ré-enqueue (ce test rougit).
    expect(res.enqueued).toEqual([6]);
    expect(res.skippedExisting).toEqual([5]);
  });

  it("MUTATION-PROUVÉ : un monde déjà EN FILE (job actif) n'est jamais ré-enqueue", () => {
    const db = freshDb();
    enqueueJob(db, 6); // job pending déjà en file pour 6
    const res = ensureBuffer(db, 4, baseDeps()); // fenêtre [5,6]
    // 6 sauté (job actif), seul 5 enqueue. Retirer `hasActiveJobForWorld` ⇒ doublon 6 (ce test rougit).
    expect(res.enqueued).toEqual([5]);
    expect(res.skippedExisting).toEqual([6]);
    // Un seul job pour 6 (pas de doublon).
    const jobsFor6 = db
      .select()
      .from(jobs)
      .all()
      .filter((j) => parseWorldIndex(j.payload) === 6);
    expect(jobsFor6).toHaveLength(1);
  });

  it("rejouer ensureBuffer deux fois n'enqueue rien la 2ᵉ fois (idempotent)", () => {
    const db = freshDb();
    const first = ensureBuffer(db, 4, baseDeps());
    expect(first.enqueued).toEqual([5, 6]);
    const second = ensureBuffer(db, 4, baseDeps());
    expect(second.enqueued).toEqual([]); // déjà en file
    expect(db.select().from(jobs).all()).toHaveLength(2); // toujours 2 jobs, pas 4
  });
});

// ───────────────────────────── ensureBuffer : BUDGET QUI AGIT (rétro #155) ─────────────────────────────

describe("ensureBuffer — le plafond budgétaire AGIT (WORLDGEN §2, rétro #155)", () => {
  it("MUTATION-PROUVÉ : dépense simulée ≥ plafond ⇒ PLUS AUCUN enqueue", () => {
    const db = freshDb();
    // Plafond serré : 1 seul monde tient sous le plafond. On simule une dépense DÉJÀ au plafond
    // en insérant assez de mondes CE MOIS pour saturer le budget.
    const tightBudget = ESTIMATED_EUR_PER_WORLD; // le plafond = coût d'exactement 1 monde
    seedWorld(db, 100, NOW); // 1 monde généré ce mois ⇒ dépense == plafond
    const res = ensureBuffer(db, 4, baseDeps({ config: cfg({ monthlyBudgetEur: tightBudget }) }));
    // Dépense (1 monde) + coût prochain > plafond ⇒ AUCUN enqueue. Les deux cibles sont budget-skip.
    // Retirer/inverser la garde budget ⇒ 5 et 6 seraient enqueue (ce test rougit).
    expect(res.enqueued).toEqual([]);
    expect(res.skippedForBudget).toEqual([5, 6]);
    // AUCUN job inséré (garde effective).
    expect(db.select().from(jobs).all()).toHaveLength(0);
  });

  it("MUTATION-PROUVÉ : plafond n'autorisant que 1 monde ⇒ enqueue 1 SEUL puis stoppe", () => {
    const db = freshDb();
    // Budget pour exactement 1 monde ce mois (aucun monde encore généré).
    const oneWorldBudget = ESTIMATED_EUR_PER_WORLD;
    const res = ensureBuffer(
      db,
      4,
      baseDeps({ config: cfg({ monthlyBudgetEur: oneWorldBudget }) }),
    );
    // 1er enqueue (5) porte la dépense projetée au plafond ⇒ le 2ᵉ (6) dépasse ⇒ budget-skip.
    expect(res.enqueued).toEqual([5]);
    expect(res.skippedForBudget).toEqual([6]);
    expect(db.select().from(jobs).all()).toHaveLength(1);
  });

  it("budget large ⇒ tout le buffer enqueue (contrôle négatif : la garde ne bloque pas à tort)", () => {
    const db = freshDb();
    const res = ensureBuffer(db, 4, baseDeps({ config: cfg({ monthlyBudgetEur: 1000 }) }));
    expect(res.enqueued).toEqual([5, 6]);
    expect(res.skippedForBudget).toEqual([]);
  });
});

// ───────────────────────────── processNextJob ─────────────────────────────

describe("processNextJob — cycle pending → running → génération → buffered/done", () => {
  it("aucun job pending ⇒ idle", async () => {
    const db = freshDb();
    const { generate } = recordingGenerate(db);
    expect(await processNextJob(db, baseDeps({ generate }))).toEqual({ outcome: "idle" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("job pending ⇒ génère (mock) ⇒ monde buffered + job done", async () => {
    const db = freshDb();
    const jobId = enqueueJob(db, 7);
    const { calls, generate } = recordingGenerate(db);
    const res = await processNextJob(db, baseDeps({ generate }));
    expect(res).toEqual({ outcome: "done", jobId, worldIndex: 7 });
    // Générateur appelé avec le thème déterministe de l'index 7 (mocké, ZÉRO appel réseau réel).
    expect(calls).toEqual([{ theme: themeForWorld(7).slug, worldIndex: 7 }]);
    // Monde buffered + job done.
    const w = db.select().from(worlds).where(eq(worlds.index, 7)).get();
    expect(w?.status).toBe("buffered");
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.status).toBe("done");
  });

  it("FIFO : traite le job pending le plus ancien (id croissant)", async () => {
    const db = freshDb();
    enqueueJob(db, 10);
    enqueueJob(db, 11);
    const { calls, generate } = recordingGenerate(db);
    await processNextJob(db, baseDeps({ generate }));
    expect(calls).toEqual([{ theme: themeForWorld(10).slug, worldIndex: 10 }]);
  });

  it("payload illisible ⇒ job failed immédiat, générateur jamais appelé", async () => {
    const db = freshDb();
    const res = db
      .insert(jobs)
      .values({
        type: GENERATE_WORLD_JOB,
        payload: "corrompu",
        status: "pending",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    const jobId = Number(res.lastInsertRowid);
    const { generate } = recordingGenerate(db);
    const out = await processNextJob(db, baseDeps({ generate }));
    expect(out.outcome).toBe("failed");
    expect(generate).not.toHaveBeenCalled();
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.status).toBe("failed");
  });
});

// ───────────────────────────── processNextJob : RETRY / FAILED (seuil maxRetries #60/#61) ─────────────────────────────

describe("processNextJob — retry puis failed après maxRetries (garde de seuil)", () => {
  it("MUTATION-PROUVÉ : échec ⇒ attempts++ + last_error, job repasse pending tant que attempts ≤ maxRetries", async () => {
    const db = freshDb();
    const jobId = enqueueJob(db, 8);
    const generate = vi.fn(async () => {
      throw new Error("boom réseau");
    });
    const out = await processNextJob(db, baseDeps({ generate, config: cfg({ maxRetries: 3 }) }));
    expect(out).toMatchObject({ outcome: "retry", jobId, worldIndex: 8, attempts: 1 });
    const row = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    expect(row?.status).toBe("pending"); // re-tentable
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain("boom réseau");
  });

  it("MUTATION-PROUVÉ : dépasser maxRetries ⇒ job FAILED (reste sur fallback 6.6)", async () => {
    const db = freshDb();
    const jobId = enqueueJob(db, 8);
    const generate = vi.fn(async () => {
      throw new Error("échec persistant");
    });
    const deps = baseDeps({ generate, config: cfg({ maxRetries: 1 }) });
    // 1er essai ⇒ attempts 1 ≤ 1 ⇒ pending (retry).
    let out = await processNextJob(db, deps);
    expect(out.outcome).toBe("retry");
    // 2ᵉ essai ⇒ attempts 2 > 1 ⇒ failed. Inverser le seuil (`≥`→jamais failed) ⇒ ce test rougit.
    out = await processNextJob(db, deps);
    expect(out).toMatchObject({ outcome: "failed", attempts: 2 });
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.status).toBe("failed");
  });

  it("maxRetries 0 ⇒ un seul échec bascule directement en failed (aucun ré-essai)", async () => {
    const db = freshDb();
    const jobId = enqueueJob(db, 8);
    const generate = vi.fn(async () => {
      throw new Error("x");
    });
    const out = await processNextJob(db, baseDeps({ generate, config: cfg({ maxRetries: 0 }) }));
    expect(out).toMatchObject({ outcome: "failed", attempts: 1 });
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.status).toBe("failed");
  });

  it("échec par une valeur NON-Error (string) ⇒ last_error = valeur stringifiée (garde de forme)", async () => {
    const db = freshDb();
    const jobId = enqueueJob(db, 9);
    // Un générateur peut rejeter une valeur non-Error → la garde `error instanceof Error` doit
    // stringifier proprement (jamais `undefined`/crash). Branche `String(error)` exercée.
    const generate = vi.fn(async () => {
      throw "panne brute";
    });
    const out = await processNextJob(db, baseDeps({ generate, config: cfg({ maxRetries: 0 }) }));
    expect(out).toMatchObject({ outcome: "failed", worldIndex: 9 });
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.lastError).toBe("panne brute");
  });
});

// ───────────────────────────── processNextJob : ROLLBACK (#122/#124) ─────────────────────────────

describe("processNextJob — ATOMICITÉ de la finalisation (rollback #122/#124)", () => {
  // GARDE ROLLBACK MULTI-ÉCRITURES (effet observable, mutation-prouvé) :
  // La transaction de finalisation protège ≥2 écritures : (1) UPDATE worlds → status='buffered'
  // (1ʳᵉ), puis (2) UPDATE jobs → status='done' (2ᵉ, GARDÉE). On induit la panne à la SEULE 2ᵉ
  // écriture via une contrainte CHECK sur `jobs.status` qui INTERDIT la valeur 'done' (rebuild avec
  // `CHECK (status IN ('pending','running','failed'))`). Séquence observée :
  //   0. SELECT job (WHERE status='pending', lit id/payload/attempts) réussit ← lecture amont
  //   1. UPDATE jobs status='running' réussit (valeur autorisée par le CHECK) ← marquage (hors tx)
  //   2. UPDATE worlds status='buffered' réussit  ← 1ʳᵉ écriture de la transaction
  //   3. UPDATE jobs status='done' ÉCHOUE (CHECK viole 'done') ← 2ᵉ écriture GARDÉE
  //   ⇒ la transaction ROLLBACK : le monde ne reste PAS 'buffered' (revient à 'active' pré-panne).
  // PREUVE : retirer le wrapper `db.transaction` de processNextJob casse PRÉCISÉMENT ce test
  // (le monde resterait 'buffered' malgré l'échec du job). La panne frappe l'écriture GARDÉE (le
  // status='done'), jamais une lecture ni la 1ʳᵉ écriture (règle #122). Le CHECK autorise 'running'
  // → le marquage running (en amont de la transaction) n'est PAS court-circuité.
  it("ROLLBACK : panne de l'UPDATE jobs 'done' (2ᵉ écriture) ⇒ le statut du monde n'est PAS committé", async () => {
    const db = freshDb();
    const jobId = enqueueJob(db, 12);
    // Le générateur insère le monde 12 en 'active' (état pré-finalisation distinct de 'buffered')
    // pour que le rollback soit OBSERVABLE (le monde reste 'active', pas 'buffered').
    const generate = vi.fn(async (): Promise<GeneratedWorld> => {
      db.insert(worlds)
        .values({
          id: "world:12",
          index: 12,
          theme: "t",
          palette: "{}",
          assetRefs: "{}",
          prompt: "p",
          seed: "s",
          status: "active",
          createdAt: NOW,
        })
        .run();
      return {
        worldId: "world:12",
        worldIndex: 12,
        themeSlug: "ocean",
        themeLabel: "Océan",
        palette: "{}",
        assetRefs: { background: "b", tiles: "t", teddy: "td" },
        creatures: [],
        seed: "s",
        status: "buffered",
        cost: { paidImageCalls: 11, estimatedEur: 0.4, monthlyBudgetEur: 20 },
      };
    });

    // Rebuild `jobs` avec un CHECK qui INTERDIT 'done' → seule la 2ᵉ écriture de finalisation échoue
    // (status='done'), APRÈS le marquage 'running' (autorisé) et l'UPDATE worlds (1ʳᵉ écriture).
    db.run(sql`DROP TABLE jobs`);
    db.run(
      sql`CREATE TABLE jobs (
        id integer PRIMARY KEY AUTOINCREMENT,
        type text NOT NULL,
        payload text NOT NULL,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','failed')),
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        created_at integer NOT NULL DEFAULT (unixepoch()),
        updated_at integer NOT NULL DEFAULT (unixepoch())
      )`,
    );
    db.run(
      sql`INSERT INTO jobs (id, type, payload, status, attempts) VALUES (${jobId}, ${GENERATE_WORLD_JOB}, ${serializeJobPayload(12)}, 'pending', 0)`,
    );

    await expect(processNextJob(db, baseDeps({ generate }))).rejects.toThrow();

    // ROLLBACK PROUVÉ : le monde 12 n'est PAS passé 'buffered' (la 1ʳᵉ écriture a été annulée) →
    // il reste 'active' (l'état posé par le générateur, avant la finalisation).
    expect(db.select().from(worlds).where(eq(worlds.index, 12)).get()?.status).toBe("active");
  });

  it("CONTRÔLE : sans panne, la finalisation écrit bien monde 'buffered' ET job 'done' (rollback dû à la seule panne)", async () => {
    const db = freshDb();
    const jobId = enqueueJob(db, 13);
    const generate = vi.fn(async (): Promise<GeneratedWorld> => {
      db.insert(worlds)
        .values({
          id: "world:13",
          index: 13,
          theme: "t",
          palette: "{}",
          assetRefs: "{}",
          prompt: "p",
          seed: "s",
          status: "active",
          createdAt: NOW,
        })
        .run();
      return {
        worldId: "world:13",
        worldIndex: 13,
        themeSlug: "ocean",
        themeLabel: "Océan",
        palette: "{}",
        assetRefs: { background: "b", tiles: "t", teddy: "td" },
        creatures: [],
        seed: "s",
        status: "buffered",
        cost: { paidImageCalls: 11, estimatedEur: 0.4, monthlyBudgetEur: 20 },
      };
    });
    const out = await processNextJob(db, baseDeps({ generate }));
    expect(out).toEqual({ outcome: "done", jobId, worldIndex: 13 });
    expect(db.select().from(worlds).where(eq(worlds.index, 13)).get()?.status).toBe("buffered");
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.status).toBe("done");
  });
});

// ───────────────────────────── IDEMPOTENCE de bout en bout (#82/#144) ─────────────────────────────

describe("idempotence de bout en bout — rejouer un job ne double JAMAIS un monde (#82/#144)", () => {
  it("MUTATION-PROUVÉ : deux jobs pour le MÊME index ⇒ 1 seul monde (world_index UNIQUE + onConflictDoNothing)", async () => {
    const db = freshDb();
    enqueueJob(db, 20);
    enqueueJob(db, 20); // doublon (ex. crash entre marquage running et done → re-enqueue)
    const { generate } = recordingGenerate(db);
    await processNextJob(db, baseDeps({ generate }));
    await processNextJob(db, baseDeps({ generate }));
    // Un SEUL monde à l'index 20 (le 2ᵉ insert est un no-op onConflict). Retirer la garde
    // d'unicité/onConflict ⇒ 2ᵉ insert lève (world_index UNIQUE) ⇒ observable.
    const rows = db.select().from(worlds).where(eq(worlds.index, 20)).all();
    expect(rows).toHaveLength(1);
  });
});

// ───────────────────────────── recoverStaleJobs (reprise après crash) ─────────────────────────────

describe("recoverStaleJobs — reprise après crash (WORLDGEN §3)", () => {
  it("MUTATION-PROUVÉ : un job 'running' orphelin est remis 'pending' (re-tentable, pas de perte)", () => {
    const db = freshDb();
    const jobId = enqueueJob(db, 30);
    // Simule un crash : le job est resté 'running' (worker mort avant done).
    db.update(jobs).set({ status: "running" }).where(eq(jobs.id, jobId)).run();

    const recovered = recoverStaleJobs(db, baseDeps());
    expect(recovered).toBe(1);
    // Le job est de nouveau 'pending' ⇒ re-sélectionnable. Retirer la garde ⇒ il resterait 'running'
    // (jamais repris) ⇒ ce test rougit.
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.status).toBe("pending");
  });

  it("ne touche PAS les jobs done/failed/pending (seuls les running orphelins)", () => {
    const db = freshDb();
    const p = enqueueJob(db, 1);
    const d = enqueueJob(db, 2);
    const f = enqueueJob(db, 3);
    db.update(jobs).set({ status: "done" }).where(eq(jobs.id, d)).run();
    db.update(jobs).set({ status: "failed" }).where(eq(jobs.id, f)).run();
    expect(recoverStaleJobs(db, baseDeps())).toBe(0);
    expect(db.select().from(jobs).where(eq(jobs.id, p)).get()?.status).toBe("pending");
    expect(db.select().from(jobs).where(eq(jobs.id, d)).get()?.status).toBe("done");
    expect(db.select().from(jobs).where(eq(jobs.id, f)).get()?.status).toBe("failed");
  });

  it("crash APRÈS running puis reprise ⇒ le job se termine sans double monde (pas de perte, pas de double)", async () => {
    const db = freshDb();
    const jobId = enqueueJob(db, 31);
    // Crash simulé : running sans done.
    db.update(jobs).set({ status: "running" }).where(eq(jobs.id, jobId)).run();
    // Boot suivant : recover → pending → traité.
    recoverStaleJobs(db, baseDeps());
    const { generate } = recordingGenerate(db);
    const out = await processNextJob(db, baseDeps({ generate }));
    expect(out).toMatchObject({ outcome: "done", worldIndex: 31 });
    expect(db.select().from(worlds).where(eq(worlds.index, 31)).all()).toHaveLength(1); // 1 seul monde
  });
});

// ───────────────────────────── runWorkerTick (orchestration) ─────────────────────────────

describe("runWorkerTick — orchestration d'un tick (recover → buffer → process)", () => {
  it("tick de boot : recover + ensureBuffer + traite un job", async () => {
    const db = freshDb();
    // Un job orphelin 'running' d'un crash précédent.
    const staleId = enqueueJob(db, 40);
    db.update(jobs).set({ status: "running" }).where(eq(jobs.id, staleId)).run();

    const { generate } = recordingGenerate(db);
    const res = await runWorkerTick(db, 4, { recover: true }, baseDeps({ generate }));
    expect(res.recovered).toBe(1); // job 40 récupéré
    // ensureBuffer pour currentIndex 4 ⇒ vise [5,6] ; 40 n'est pas dans la fenêtre (job séparé).
    expect(res.buffer.enqueued).toEqual([5, 6]);
    // processNextJob traite le plus ancien pending = le job récupéré (40, id le plus bas).
    expect(res.processed).toMatchObject({ outcome: "done", worldIndex: 40 });
  });

  it("tick normal (sans recover) : buffer + process, aucune reprise", async () => {
    const db = freshDb();
    const { generate } = recordingGenerate(db);
    const res = await runWorkerTick(db, 0, {}, baseDeps({ generate }));
    expect(res.recovered).toBe(0);
    expect(res.buffer.enqueued).toEqual([1, 2]);
    expect(res.processed).toMatchObject({ outcome: "done" });
  });
});

// ───────────────────────────── constantes exportées ─────────────────────────────

describe("constantes exportées", () => {
  it("ACTIVE_JOB_STATUSES = pending + running", () => {
    expect([...ACTIVE_JOB_STATUSES]).toEqual(["pending", "running"]);
  });

  it("worldExists / hasActiveJobForWorld reflètent l'état DB", () => {
    const db = freshDb();
    expect(worldExists(db, 0)).toBe(false);
    seedWorld(db, 0);
    expect(worldExists(db, 0)).toBe(true);
    expect(hasActiveJobForWorld(db, 0)).toBe(false);
    enqueueJob(db, 0);
    expect(hasActiveJobForWorld(db, 0)).toBe(true);
  });
});
