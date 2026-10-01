import "server-only";
import { eq, and } from "drizzle-orm";
import { join } from "node:path";
import type { AppDatabase } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import type { WorldGenConfig } from "@/config/server-config";
import { generateImage } from "./image-client";
import { generateWorld, type GeneratedWorld } from "./generate-world";
import {
  catalogueSheets,
  creatureHistory,
  createCreaturePlanner,
  readCatalogueArt,
  savedCreatureDesign,
  type CreaturePlanner,
  type HistoricalCreature,
} from "./creature-design-runtime";
import { assertNewNames } from "./creature-design";
import { cutoutNewCreature, generateCreatureGrowth } from "./creature-growth";
import { getApprovedMaster } from "./reference-assets";
import { readMasterBytesFromDisk } from "./socle-assets";
import { createWorldAssetStore, reserveRequest } from "./runtime-assets";
import { createVisionInspector } from "./vision-inspector";
import { publishRuntimeCatalogue, saveRuntimeCatalogue } from "./runtime-catalogue";
import { assertFutureWorld, lastReservedWorld, futureWorldTheme } from "./future-worlds";
import { runWorkerTick, parseWorldIndex, GENERATE_WORLD_JOB, type WorkerDeps } from "./worker";

export interface RuntimeOptions {
  cwd: string;
  apiKey: string;
  imageModel: string;
  qaModel: string;
  config: WorldGenConfig;
  /** Conservative per-request reservations. Set against the chosen models before operation. */
  imageReservationEur: number;
  qaReservationEur: number;
  fetchImpl?: typeof fetch;
  /** Explicit pilot recovery only: saved generated pixels still require full current QA. */
  reuseImage?: (input: Parameters<typeof generateImage>[0]) => Buffer | undefined;
  now?: () => Date;
  /** Public catalogue art may live outside the isolated pilot's generated storage. */
  publicArtRoot?: string;
  planCreatures?: CreaturePlanner;
  readHistoricalArt?: (ref: string) => Buffer;
}

/** Wiring only: the existing queue, generation, QA thresholds and parent toggle remain authoritative. */
export function createWorldRuntime(db: AppDatabase, options: RuntimeOptions) {
  const now = options.now ?? (() => new Date());
  const master = getApprovedMaster(db);
  if (!master) throw new Error("Master Teddy approuvé requis.");
  const masterBytes = readMasterBytesFromDisk(master.assetRef, { cwd: options.cwd });
  const loadMasterBytes = () => masterBytes;
  const storage = join(options.cwd, "storage", "generated");
  const ledger = join(options.cwd, "storage", "worldgen", "budget");
  const readHistoryArt =
    options.readHistoricalArt ??
    ((ref: string) =>
      readCatalogueArt(
        ref,
        storage,
        options.publicArtRoot ?? join(options.cwd, "public/generated"),
      ));
  let comparison:
    { world: GeneratedWorld; history: HistoricalCreature[]; sheets: Buffer[] } | undefined;
  const peerSheets = new Map<string, Promise<Buffer[]>>();
  const chargedFetch =
    (reservation: number): typeof fetch =>
    async (input, init) => {
      reserveRequest(ledger, reservation, options.config.monthlyBudgetEur, now());
      const timeout = AbortSignal.timeout(120_000);
      return (options.fetchImpl ?? fetch)(input, { ...init, signal: init?.signal ?? timeout });
    };
  const inspector = createVisionInspector({
    apiKey: options.apiKey,
    model: options.qaModel,
    style: options.config.prompts.style,
    readAsset: createWorldAssetStore(storage).read,
    readMaster: loadMasterBytes,
    fetchImpl: chargedFetch(options.qaReservationEur),
    async designContext(asset) {
      if (asset.kind !== "creature") return;
      const state = comparison;
      if (!state) throw new Error("Contexte du catalogue absent ; comparaison impossible.");
      const owner = state.world.creatures.find(
        (c) => c.artRef === asset.ref || Object.values(c.stageArt ?? {}).includes(asset.ref),
      );
      if (!owner?.design || !state.world.habitat)
        throw new Error("Conception de la créature absente.");
      if (!peerSheets.has(owner.id))
        peerSheets.set(
          owner.id,
          catalogueSheets(
            state.world.creatures
              .filter((c) => c.id !== owner.id)
              .map((c) => ({
                id: c.id,
                name: c.nameDefault,
                artRefs: [c.artRef, ...(c.stageArt ? [c.stageArt[2], c.stageArt[3]] : [])],
              })),
            createWorldAssetStore(storage).read,
          ),
        );
      return {
        brief: JSON.stringify({ habitat: state.world.habitat, ...owner.design }),
        sheets: [...state.sheets, ...(await peerSheets.get(owner.id)!)],
      };
    },
  });
  const deps: Partial<WorkerDeps> = {
    now,
    config: options.config,
    loadMasterBytes,
    inspect: inspector,
    beforeActivate(database, index) {
      assertFutureWorld(database, index);
      if (!comparison || comparison.world.worldIndex !== index)
        throw new Error("Comparaison du catalogue absente avant validation.");
      const currentHistory = creatureHistory(database, storage, index);
      if (JSON.stringify(currentHistory) !== JSON.stringify(comparison.history))
        throw new Error(
          "Le catalogue a changé pendant la génération ; la comparaison doit être refaite.",
        );
      assertNewNames(
        comparison.world.creatures.map((c) => c.nameDefault),
        currentHistory.map((c) => c.name),
      );
    },
    afterActivate(database, world) {
      publishRuntimeCatalogue(database, world.worldIndex, JSON.stringify(world.assetRefs), storage);
    },
    mayEnqueue(database, index) {
      try {
        assertFutureWorld(database, index);
      } catch {
        return false;
      }
      return !database
        .select({ payload: jobs.payload })
        .from(jobs)
        .where(eq(jobs.type, GENERATE_WORLD_JOB))
        .all()
        .some((job) => parseWorldIndex(job.payload) === index);
    },
    async generate(database, _theme, index, recent) {
      assertFutureWorld(database, index);
      comparison = undefined;
      peerSheets.clear();
      const theme = futureWorldTheme(database, index);
      const history = creatureHistory(database, storage, index);
      const sheets = await catalogueSheets(history, readHistoryArt);
      const design = await savedCreatureDesign(
        join(options.cwd, "storage/worldgen/designs"),
        { index, theme: theme.slug, history, sheets },
        options.planCreatures ??
          createCreaturePlanner({
            apiKey: options.apiKey,
            model: options.qaModel,
            fetchImpl: chargedFetch(options.qaReservationEur),
          }),
      );
      assertFutureWorld(database, index);
      const store = createWorldAssetStore(storage);
      const generate = (input: Parameters<typeof generateImage>[0]) => {
        assertFutureWorld(database, index);
        const cached = options.reuseImage?.(input);
        if (cached) return Promise.resolve(cached);
        return generateImage(input, {
          apiKey: options.apiKey,
          model: options.imageModel,
          config: options.config,
          fetchImpl: chargedFetch(options.imageReservationEur),
        });
      };
      const babyWorld = await generateWorld(database, theme.slug, index, recent, {
        creatureDesign: design,
        config: {
          ...options.config,
          prompts: {
            ...options.config.prompts,
            creature:
              options.config.prompts.creature.replace(
                /transparent background/gi,
                "plain uniform white background",
              ) +
              ". BABY proportions, one full-body companion, 10% empty margin. No floor shadow, no detached particles, no checkerboard.",
          },
        },
        loadMasterBytes,
        now,
        beforePersist: assertFutureWorld,
        deferCreatures: true,
        writeAsset: async (worldIndex, name, bytes) => {
          const png = /^(creature-\d+|legendary)\.png$/.test(name)
            ? await cutoutNewCreature(bytes)
            : bytes;
          return store.write(worldIndex, name, png);
        },
        generate,
      });
      const world = await generateCreatureGrowth(babyWorld, {
        config: options.config,
        generate,
        writeAsset: store.write,
        readAsset: store.read,
      });
      assertFutureWorld(database, index);
      saveRuntimeCatalogue(storage, world);
      comparison = { world, history, sheets };
      return world;
    },
  };
  return {
    async tick(recover = false) {
      try {
        return await runWorkerTick(db, lastReservedWorld(db), { recover }, deps);
      } catch (error) {
        // An activation guard or storage failure must not leave a live process with a stuck job.
        // Keep the world buffered and ineligible for parental approval (no successful QA receipt).
        db.update(jobs)
          .set({
            status: "failed",
            lastError: "Publication interrompue ; le parcours existant est conservé.",
            updatedAt: now(),
          })
          .where(and(eq(jobs.type, GENERATE_WORLD_JOB), eq(jobs.status, "running")))
          .run();
        throw error;
      }
    },
  };
}
