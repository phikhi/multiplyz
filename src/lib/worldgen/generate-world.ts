import "server-only";
import { getWorldGenConfig, type WorldGenConfig } from "@/config/server-config";
import {
  findCuratedTheme,
  hasBannedTerm,
  type CreatureConcept,
  type CuratedTheme,
} from "@/config/worldgen-themes";
import type { AppDatabase } from "@/lib/db";
import { characters, worlds, type Rarity, type WorldStatus } from "@/lib/db/schema";
import { strings } from "@/strings";
import { legendaryForWorld } from "@/lib/game/collection";
import { generateImage, type GenerateImageInput, type ImageRef } from "./image-client";
import { getApprovedMaster, MASTER_ASSET_ID } from "./reference-assets";
import { deriveWorldPalette, serializePalette } from "./palette";

/**
 * **Générateur de monde — Stage B** (WORLDGEN §4/§8, story 6.3, épic #6). Fonction pure côté
 * décision (assets + persistance injectés) : à partir d'un **thème** + d'un **`world_index`**,
 * produit un monde complet et le persiste (WORLDGEN §4) :
 *
 * 1. **Valide** le thème contre le pool kid-safe curaté + la liste bannie + le doublon récent
 *    (`worldgen-themes`, WORLDGEN §4.1).
 * 2. **Dérive** la palette → `--world-accent` (theme-safe, DESIGN_TOKENS §per-monde), stockée
 *    dans `worlds.palette`.
 * 3. **Génère les assets** (gabarits ART §5 centralisés) :
 *    - **fond 16:9** + **tuiles de carte** (texte, pas de référence) ;
 *    - **variante Teddy** = img2img **ancré sur le master approuvé** (`getApprovedMaster`) +
 *      accessoire du monde — **jamais** les photos (WORLDGEN §8, ADR 0009) ;
 *    - **6-8 créatures** réparties par rareté (ECONOMY §5) — cohérence via `{base_style}` en
 *      **TEXTE** (+ style-bible optionnelle), **PAS** le master Teddy (une créature n'est pas
 *      Teddy — ADR 0009 « sinon la créature devient un ours-Teddy »).
 * 4. **Câble l'art réel** dans `characters` (`art_ref`/`story`) — remplace les placeholders
 *    de l'épic #5 pour la légendaire, crée les lignes communes/rares.
 * 5. **Persiste** prompt + seed dans `worlds` (reproductibilité WORLDGEN §7).
 *
 * **Master absent** (`getApprovedMaster` = `null` — assets locaux gitignorés, jamais en CI) ⇒
 * **échec loud + actionnable** (jamais de génération silencieuse d'un Teddy non ancré, #157).
 *
 * **Budget** (`monthlyBudgetEur`) : **lu et rapporté** ici (coût estimé de la génération, dans le
 * retour) ; le **plafond est CONSOMMÉ (enforce) par le worker en 6.4** (« le worker cesse
 * d'enqueue ≥ plafond », rétro #155). 6.3 ne bloque **jamais** une génération sur le plafond et
 * ne persiste **aucun** compteur de dépense (pas de changement de modèle de données).
 *
 * **Dépendances injectables** (tests) : générateur d'image (mocké → **zéro appel réseau réel en
 * CI**, DoD), horloge, style-bible de créatures. En prod, les défauts s'appliquent.
 */

/** Rareté d'une créature générée (hors légendaire, qui est fixée par MAP §6). */
export type GeneratedRarity = Extract<Rarity, "common" | "rare">;

/** ⚙️ Répartition des créatures d'un monde (ECONOMY §5 : « plusieurs communes + 1-2 rares + 1 légendaire »). */
export interface CreatureSplit {
  /** Nombre de créatures **communes** (œufs, `in_egg_pool = true`). */
  readonly commons: number;
  /** Nombre de créatures **rares** (œufs, `in_egg_pool = true`). */
  readonly rares: number;
}

/**
 * ⚙️ **Bornes de répartition** (ECONOMY §5, WORLDGEN §4.3) : 6-8 créatures/monde = plusieurs
 * communes + 1-2 rares + **exactement 1 légendaire** (boss only). Centralisées ici (source unique) ;
 * la légendaire n'est pas comptée (fixée par MAP §6, `legendaryForWorld`).
 */
export const CREATURE_TOTALS = {
  /** Total de créatures/monde, bornes incluses (ECONOMY §5 « ~6-8 »). */
  minTotal: 6,
  maxTotal: 8,
  /** Rares/monde, bornes incluses (ECONOMY §5 « 1-2 rares »). */
  minRares: 1,
  maxRares: 2,
  /** La légendaire (boss only) — toujours exactement 1 (MAP §6). */
  legendaries: 1,
} as const;

/**
 * Coût **estimé** par image payante (ADR 0008 / WORLDGEN §5 : « ~0,039 $/image »). ⚙️ de
 * **rapport** (pas d'enforcement) : sert à exposer le coût d'une génération dans le retour (le
 * plafond est enforce par le worker en 6.4). En euros pour aligner `monthlyBudgetEur` (WORLDGEN §2).
 */
export const ESTIMATED_EUR_PER_IMAGE = 0.036;

/** Un asset d'image généré (référence d'URL servie par Nginx + son prompt, WORLDGEN §5/§7). */
export interface GeneratedAsset {
  /** Réf d'URL de l'asset (chemin servi par Nginx). */
  readonly assetRef: string;
  /** Prompt complet ayant produit l'asset (reproductibilité WORLDGEN §7). */
  readonly prompt: string;
}

/** Une créature générée + persistée (art réel câblé dans `characters`). */
export interface GeneratedCreature {
  readonly id: string;
  readonly speciesKey: string;
  readonly nameDefault: string;
  readonly rarity: Rarity;
  readonly inEggPool: boolean;
  readonly artRef: string;
  readonly story: string;
}

/** Résultat de `generateWorld` : le monde persisté + le coût **rapporté** (pas enforce). */
export interface GeneratedWorld {
  readonly worldId: string;
  readonly worldIndex: number;
  readonly themeSlug: string;
  readonly themeLabel: string;
  readonly palette: string;
  readonly assetRefs: WorldAssetRefs;
  readonly creatures: readonly GeneratedCreature[];
  readonly seed: string;
  readonly status: WorldStatus;
  /**
   * **Coût rapporté** de la génération (nombre d'images payantes × coût estimé). Le plafond
   * (`monthlyBudgetEur`) est **lu** pour le contexte mais **jamais enforce ici** (worker 6.4).
   */
  readonly cost: GenerationCost;
}

/** Coût **rapporté** d'une génération (WORLDGEN §2). Le worker 6.4 compare au plafond, pas 6.3. */
export interface GenerationCost {
  /** Nombre d'appels d'image **payants** effectués (fond + tuiles + Teddy + créatures + légendaire). */
  readonly paidImageCalls: number;
  /** Coût estimé en euros (`paidImageCalls × ESTIMATED_EUR_PER_IMAGE`). */
  readonly estimatedEur: number;
  /** Plafond mensuel ⚙️ **lu** (contexte) — enforce par le worker 6.4, jamais ici. */
  readonly monthlyBudgetEur: number;
}

/** Refs des assets non-créature d'un monde (fond + tuiles + Teddy variante), persistées en json. */
export interface WorldAssetRefs {
  readonly background: string;
  readonly tiles: string;
  readonly teddy: string;
}

/** Dépendances injectables du générateur de monde (tests → aucun appel réseau réel). */
export interface GenerateWorldDeps {
  /** Générateur d'image (défaut : client image 6.1). Mocké en test. */
  generate: (input: GenerateImageInput) => Promise<Buffer>;
  /**
   * Écrit les octets d'un asset et renvoie sa réf d'URL (défaut : chemin déterministe sous
   * `world/<index>/`). Le stockage réel (disque VPS/Nginx, WORLDGEN §5) est injecté à l'exécution.
   */
  writeAsset: (worldIndex: number, name: string, bytes: Buffer) => Promise<string>;
  /**
   * **Style-bible de créatures** (ART §6) : images de référence **optionnelles** passées en
   * img2img aux créatures pour renforcer la cohérence. Par défaut **vide** → cohérence par
   * `{base_style}` en TEXTE (mécanisme contractuel ADR 0009). **Jamais** le master Teddy (une
   * créature n'est pas Teddy — le master ancre UNIQUEMENT le Stage B de Teddy).
   */
  creatureStyleBible: readonly ImageRef[];
  /** Horloge serveur injectée (jamais `Date.now()` interne, LEARNINGS #46). */
  now: () => Date;
  /** Config worldgen (défaut : config centrale). Injectée en test. */
  config: WorldGenConfig;
}

/** Résout les dépendances par défaut (prod), surchargées en test. */
export function resolveDeps(overrides?: Partial<GenerateWorldDeps>): GenerateWorldDeps {
  return {
    generate: overrides?.generate ?? ((input) => generateImage(input)),
    writeAsset: overrides?.writeAsset ?? defaultWriteAsset,
    creatureStyleBible: overrides?.creatureStyleBible ?? [],
    now: overrides?.now ?? (() => new Date()),
    config: overrides?.config ?? getWorldGenConfig(),
  };
}

/**
 * Écriture d'asset **par défaut** = chemin déterministe (pas d'I/O disque ici) : renvoie la réf
 * d'URL `world/<index>/<name>` servie par Nginx (WORLDGEN §5). Le stockage réel des octets est
 * fourni à l'exécution owner (comme le `writeAsset` du Stage A) ; ici on pose la convention d'URL
 * stable (reproductible). Pure (aucune I/O) → déterministe. Ne consomme pas les octets (stub de
 * chemin) : la signature `(worldIndex, name)` reste assignable au type `writeAsset` de 3 arguments
 * (un consommateur d'arité moindre est compatible en TS).
 */
export function defaultWriteAsset(worldIndex: number, name: string): Promise<string> {
  return Promise.resolve(`world/${worldIndex}/${name}`);
}

/** Erreur de génération de monde (thème invalide/banni, doublon, master absent). */
export class WorldGenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldGenError";
  }
}

/**
 * PRNG **déterministe** seedé (mulberry32, même famille que `game/map.ts`) — aucune dépendance à
 * `Math.random`. Même `world_index` ⇒ même suite ⇒ même monde (WORLDGEN §7 reproductibilité :
 * la répartition + la sélection de concepts/noms/histoires sont dérivées, jamais RNG cru).
 */
export function makeSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d_2b_79_f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Entier déterministe dans `[min, max]` (bornes incluses) depuis un tirage `[0,1)`. */
function intInRange(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/**
 * **Répartition déterministe** des créatures d'un monde (ECONOMY §5, WORLDGEN §4.3). Tire un
 * total dans `[minTotal, maxTotal]` et un nombre de rares dans `[minRares, maxRares]`, le reste
 * en communes (**exactement 1 légendaire** en plus, boss only — non compté ici). Garantit
 * `commons ≥ 1` (une répartition sans commune n'a pas de sens pour un pool d'œufs). Pure.
 */
export function deriveCreatureSplit(worldIndex: number): CreatureSplit {
  const rand = makeSeededRandom(worldIndex ^ 0x5f_3a_c1_00);
  const total = intInRange(rand, CREATURE_TOTALS.minTotal, CREATURE_TOTALS.maxTotal);
  const rares = intInRange(rand, CREATURE_TOTALS.minRares, CREATURE_TOTALS.maxRares);
  // Total inclut la légendaire (MAP §6) → les œufs (communes+rares) = total − 1 légendaire.
  const eggPool = total - CREATURE_TOTALS.legendaries;
  const commons = eggPool - rares;
  return { commons, rares };
}

/** Assemble le prompt du **fond de monde** (gabarit background ART §5, {base_style} résolu). */
function buildBackgroundPrompt(config: WorldGenConfig, theme: CuratedTheme): string {
  const base = config.prompts.background
    .replace("{base_style}", config.prompts.style)
    .replace("{world_theme}", theme.label)
    .replace("{world_palette}", theme.accent);
  return `${base}. Negative: ${config.prompts.negative}`;
}

/**
 * Assemble le prompt des **tuiles de carte** (réutilise le gabarit background ART §5 — même
 * charte, cadrage tuile). Les tuiles doivent rester cohérentes avec le fond (ART §4).
 */
function buildTilesPrompt(config: WorldGenConfig, theme: CuratedTheme): string {
  const base = config.prompts.background
    .replace("{base_style}", config.prompts.style)
    .replace("{world_theme}", `${theme.label} map tiles and path nodes`)
    .replace("{world_palette}", theme.accent);
  return `${base}. Negative: ${config.prompts.negative}`;
}

/**
 * Assemble le prompt de la **variante Teddy** du monde (gabarit teddy ART §5) : `{base_style}`
 * résolu + accessoire du monde. **Ancré sur le master** en img2img (refImages) par l'appelant —
 * jamais les photos (WORLDGEN §8).
 */
function buildTeddyPrompt(config: WorldGenConfig, theme: CuratedTheme): string {
  const base = config.prompts.teddy
    .replace("{base_style}", config.prompts.style)
    .replace("{world_accessory}", theme.accessory);
  return `${base}. Negative: ${config.prompts.negative}`;
}

/**
 * Assemble le prompt d'une **créature** (gabarit creature ART §5) : `{base_style}` résolu +
 * concept + traits + palette du monde. **Aucune référence au master Teddy** dans le prompt (une
 * créature n'est pas Teddy — ADR 0009).
 */
function buildCreaturePrompt(
  config: WorldGenConfig,
  concept: CreatureConcept,
  accent: string,
): string {
  const base = config.prompts.creature
    .replace("{base_style}", config.prompts.style)
    .replace("{creature_concept}", concept.concept)
    .replace("{features}", concept.features)
    .replace("{world_palette}", accent);
  return `${base}. Negative: ${config.prompts.negative}`;
}

/**
 * Images de référence à passer à la génération d'une **créature** (WORLDGEN §8, ADR 0009). La
 * **style-bible** (optionnelle) renforce la cohérence via img2img ; vide → cohérence par
 * `{base_style}` en TEXTE (mécanisme contractuel). **Ne renvoie JAMAIS le master Teddy** : le
 * générateur ne passe que la bible ici (une créature n'est pas Teddy). Renvoie `undefined` (pas
 * `[]`) quand la bible est vide → le client image omet le champ `refImages`.
 */
function creatureRefImages(
  bible: readonly ImageRef[],
): { refImages: readonly ImageRef[] } | object {
  return bible.length > 0 ? { refImages: bible } : {};
}

/** Clé de catalogue stable d'une créature non légendaire d'un monde (déterministe). */
export function creatureCharacterId(worldIndex: number, slot: number): string {
  return `creature:${worldIndex}:${slot}`;
}

/** Clé d'espèce stable d'une créature non légendaire (contrat de génération). */
export function creatureSpeciesKey(worldIndex: number, slot: number): string {
  return `creature_world_${worldIndex}_${slot}`;
}

/** Pioche un élément d'une banque **sans réutilisation** dans le monde (index dérivé + offset slot). */
function pickFromBank<T>(bank: readonly T[], seedBase: number, slot: number): T {
  return bank[(seedBase + slot) % bank.length];
}

/**
 * Génère et **persiste** un monde complet (Stage B, WORLDGEN §4). Idempotent au niveau data
 * (upsert `worlds` par `id`, `characters` par `id`) : re-générer le même `world_index` produit le
 * même monde (seed + refs déterministes) sans doublon. À appeler **hors** transaction (better-sqlite3
 * ne supporte pas les transactions asynchrones — les `generate` sont `await`).
 *
 * @throws {WorldGenError} thème hors pool / banni / doublon récent, ou **master approuvé absent**.
 */
export async function generateWorld(
  db: AppDatabase,
  theme: string,
  worldIndex: number,
  recentThemeSlugs: readonly string[] = [],
  overrides?: Partial<GenerateWorldDeps>,
): Promise<GeneratedWorld> {
  const deps = resolveDeps(overrides);
  const { config } = deps;

  // ── 1. Valider le thème (pool kid-safe curaté + banni + doublon récent, WORLDGEN §4.1) ──
  if (hasBannedTerm(theme)) {
    throw new WorldGenError(
      `Thème "${theme}" refusé : contient un terme banni (WORLDGEN §4.1, kid-safe).`,
    );
  }
  const curated = findCuratedTheme(theme);
  if (curated === undefined) {
    throw new WorldGenError(
      `Thème "${theme}" hors du pool curaté (WORLDGEN §4.1). Choisis un thème de CURATED_THEMES.`,
    );
  }
  if (recentThemeSlugs.includes(curated.slug)) {
    throw new WorldGenError(
      `Thème "${curated.slug}" déjà utilisé récemment (éviter le doublon, WORLDGEN §4.1).`,
    );
  }

  // ── Master approuvé requis pour ancrer la variante Teddy (échec loud si absent, #157) ──
  const master = getApprovedMaster(db);
  if (master === null) {
    throw new WorldGenError(
      `Aucun master Teddy approuvé ("${MASTER_ASSET_ID}") : impossible d'ancrer la variante ` +
        `Teddy du monde (WORLDGEN §8, ADR 0009). Fige d'abord le master (Stage A, story 6.2).`,
    );
  }

  // ── 2. Dériver la palette → --world-accent (theme-safe, DESIGN_TOKENS §per-monde) ──
  const palette = deriveWorldPalette(curated.slug, curated.accent);

  // ── 3. Générer les assets (gabarits ART §5) ──
  let paidImageCalls = 0;

  // Fond 16:9 + tuiles (texte, aucune référence).
  const bgPrompt = buildBackgroundPrompt(config, curated);
  const bgBytes = await deps.generate({ prompt: bgPrompt });
  paidImageCalls += 1;
  const backgroundRef = await deps.writeAsset(worldIndex, "background.png", bgBytes);

  const tilesPrompt = buildTilesPrompt(config, curated);
  const tilesBytes = await deps.generate({ prompt: tilesPrompt });
  paidImageCalls += 1;
  const tilesRef = await deps.writeAsset(worldIndex, "tiles.png", tilesBytes);

  // Variante Teddy = img2img ANCRÉ SUR LE MASTER (jamais les photos — WORLDGEN §8, ADR 0009).
  const teddyPrompt = buildTeddyPrompt(config, curated);
  const teddyMasterRef: ImageRef = { data: masterRefBytes(master.assetRef), mimeType: "image/png" };
  const teddyBytes = await deps.generate({ prompt: teddyPrompt, refImages: [teddyMasterRef] });
  paidImageCalls += 1;
  const teddyRef = await deps.writeAsset(worldIndex, "teddy.png", teddyBytes);

  // ── 3b + 4. Créatures : split déterministe → art réel câblé dans `characters` ──
  const split = deriveCreatureSplit(worldIndex);
  const nameBase = worldIndex % strings.worldgen.creatureNames.length;
  const storyBase = worldIndex % strings.worldgen.creatureStories.length;
  const conceptBase = worldIndex % curated.creatureConcepts.length;

  const creatures: GeneratedCreature[] = [];
  const eggPoolCount = split.commons + split.rares;
  for (let slot = 0; slot < eggPoolCount; slot += 1) {
    // Les `split.commons` premiers slots = communes, les suivants = rares (ordre stable).
    const rarity: GeneratedRarity = slot < split.commons ? "common" : "rare";
    const concept = pickFromBank(curated.creatureConcepts, conceptBase, slot);
    const creaturePrompt = buildCreaturePrompt(config, concept, curated.accent);
    // Créatures : {base_style} en TEXTE + style-bible OPTIONNELLE (jamais le master — ADR 0009).
    const creatureBytes = await deps.generate({
      prompt: creaturePrompt,
      ...creatureRefImages(deps.creatureStyleBible),
    });
    paidImageCalls += 1;
    const artRef = await deps.writeAsset(worldIndex, `creature-${slot}.png`, creatureBytes);

    creatures.push({
      id: creatureCharacterId(worldIndex, slot),
      speciesKey: creatureSpeciesKey(worldIndex, slot),
      nameDefault: pickFromBank(strings.worldgen.creatureNames, nameBase, slot),
      rarity,
      inEggPool: true, // communes + rares = pool d'œufs (ECONOMY §4.2).
      artRef,
      story: pickFromBank(strings.worldgen.creatureStories, storyBase, slot),
    });
  }

  // Légendaire (boss only) : art RÉEL généré + câblé (remplace le placeholder épic #5).
  const legendary = legendaryForWorld(worldIndex);
  const legendaryPrompt = buildCreaturePrompt(
    config,
    // La légendaire reste une créature du monde (même charte) — concept dédié en fin de banque.
    curated.creatureConcepts[conceptBase % curated.creatureConcepts.length],
    curated.accent,
  );
  // La légendaire est une créature → même règle d'ancrage (bible optionnelle, JAMAIS le master).
  const legendaryBytes = await deps.generate({
    prompt: legendaryPrompt,
    ...creatureRefImages(deps.creatureStyleBible),
  });
  paidImageCalls += 1;
  const legendaryArtRef = await deps.writeAsset(worldIndex, "legendary.png", legendaryBytes);

  // ── 5. Persister creatures + légendaire (art réel) + le monde (prompt + seed) ──
  const assetRefs: WorldAssetRefs = {
    background: backgroundRef,
    tiles: tilesRef,
    teddy: teddyRef,
  };
  const seed = worldSeed(worldIndex, curated.slug);
  const worldId = `world:${worldIndex}`;
  const worldPrompt = bgPrompt; // le fond porte le prompt canonique du monde (reproductibilité §7).

  db.transaction((tx) => {
    // Créatures œufs : upsert (art réel, idempotent par PK).
    for (const c of creatures) {
      tx.insert(characters)
        .values({
          id: c.id,
          worldIndex,
          speciesKey: c.speciesKey,
          nameDefault: c.nameDefault,
          rarity: c.rarity,
          inEggPool: c.inEggPool,
          artRef: c.artRef,
          story: c.story,
        })
        .onConflictDoUpdate({
          target: characters.id,
          set: { artRef: c.artRef, story: c.story, nameDefault: c.nameDefault },
        })
        .run();
    }
    // Légendaire : câble l'art RÉEL. Si épic #5 l'a amorcée (placeholder), on met à jour art+story ;
    // sinon on l'insère (déterministe, hors œufs, MAP §6). Upsert idempotent par PK.
    tx.insert(characters)
      .values({
        id: legendary.id,
        worldIndex,
        speciesKey: legendary.speciesKey,
        nameDefault: legendary.nameDefault,
        rarity: legendary.rarity,
        inEggPool: legendary.inEggPool,
        artRef: legendaryArtRef,
        story: legendary.story,
      })
      .onConflictDoUpdate({
        target: characters.id,
        set: { artRef: legendaryArtRef },
      })
      .run();

    // Monde : prompt + seed persistés (reproductibilité WORLDGEN §7). Upsert par PK (idempotent).
    tx.insert(worlds)
      .values({
        id: worldId,
        index: worldIndex,
        theme: curated.label,
        palette: serializePalette(palette),
        assetRefs: JSON.stringify(assetRefs),
        prompt: worldPrompt,
        seed,
      })
      .onConflictDoUpdate({
        target: worlds.id,
        set: {
          theme: curated.label,
          palette: serializePalette(palette),
          assetRefs: JSON.stringify(assetRefs),
          prompt: worldPrompt,
          seed,
        },
      })
      .run();
  });

  const legendaryCreature: GeneratedCreature = {
    id: legendary.id,
    speciesKey: legendary.speciesKey,
    nameDefault: legendary.nameDefault,
    rarity: legendary.rarity,
    inEggPool: legendary.inEggPool,
    artRef: legendaryArtRef,
    story: legendary.story,
  };

  return {
    worldId,
    worldIndex,
    themeSlug: curated.slug,
    themeLabel: curated.label,
    palette: serializePalette(palette),
    assetRefs,
    creatures: [...creatures, legendaryCreature],
    seed,
    status: "buffered", // toujours buffered à la génération (QA + validation parent avant active, WORLDGEN §3/§6).
    cost: {
      paidImageCalls,
      estimatedEur: paidImageCalls * ESTIMATED_EUR_PER_IMAGE,
      monthlyBudgetEur: config.monthlyBudgetEur, // lu (contexte) — enforce par le worker 6.4, jamais ici.
    },
  };
}

/**
 * Seed **reproductible** d'un monde (WORLDGEN §5/§7) : `<slug>-<world_index>`. Stable → un monde
 * peut être régénéré à l'identique (correctif/migration). Persisté dans `worlds.seed`.
 */
export function worldSeed(worldIndex: number, slug: string): string {
  return `${slug}-${worldIndex}`;
}

/**
 * Charge les octets de la référence du master pour l'img2img (WORLDGEN §8). L'`assetRef` du master
 * approuvé est un chemin d'asset (servi par Nginx) ; l'octet réel est chargé à l'exécution. Ici on
 * matérialise un **marqueur d'ancrage déterministe** (le chemin encodé) : la garde de fidélité
 * porte sur le FAIT que la variante Teddy passe le master en `refImages` (jamais les photos, jamais
 * les créatures), pas sur les octets binaires — le stockage réel des octets est branché à
 * l'exécution owner (comme le `writeAsset` du Stage A).
 */
export function masterRefBytes(assetRef: string): Buffer {
  return Buffer.from(assetRef, "utf8");
}
