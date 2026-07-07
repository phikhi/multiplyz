import { and, asc, eq } from "drizzle-orm";
import { CURATED_THEMES, type CuratedTheme } from "@/config/worldgen-themes";
import type { AppDatabase } from "@/lib/db";
import { socleWorlds, worlds } from "@/lib/db/schema";
import { deriveWorldPalette, serializePalette } from "./palette";

/**
 * **Socle de fallback + résolveur de monde** (WORLDGEN §1/§7, story 6.6, épic #6). Deux rôles :
 *
 * 1. **Socle pré-généré embarqué** (`buildSocle` + `seedSocleWorlds`) : un pool **fixe** de
 *    `SOCLE_WORLD_COUNT` (~5-8, WORLDGEN §1) mondes déterministes, amorcés **idempotemment** au 1er
 *    lancement (dans `runMigrations`, **hors réseau**). Chaque monde stocke **thème + palette +
 *    assetRefs + prompt + seed** (reproductibilité à l'identique, WORLDGEN §7).
 * 2. **Résolveur** (`resolveWorld`) : rend le monde **généré `active`** s'il existe à cet index de
 *    carte, **SINON** retombe sur un monde du socle (`socle[worldIndex % taille_du_pool]`). C'est le
 *    « secours si IA indispo / hors buffer » + le « démarrage instantané » de WORLDGEN §7.
 *
 * **PAS de réseau, PAS de génération ici** : lecture DB pure (SYNC : online-first, mais le socle
 * garantit un monde jouable **même hors-ligne / IA en panne**). Le socle est un pool **réutilisable**
 * (non lié à une position de carte), **distinct** de `worlds` (indexé par position) : le worker (6.4)
 * ne lit/écrit que `worlds` → l'amorçage du socle n'entrave **jamais** la génération paresseuse.
 *
 * **Gate owner** (même patron que le master Teddy 6.2, #158) : les `assetRefs` du socle sont des
 * **placeholders** (`placeholder://socle/…`, même signal que la légendaire 5.6) tant que le proprio
 * n'a pas généré+validé les ~5-8 mondes réels (Gemini + sign-off visuel). Ce module pose le
 * **mécanisme + une fixture déterministe** ; les vrais assets restent un `needs-owner` (cf. runbook).
 *
 * **Pas de `server-only`** : ce module est importé par `runMigrations` (script `tsx db:migrate`,
 * hors contexte RSC) → il ne doit rester que sur des dépendances **pures** (palette, thèmes curatés,
 * schéma DB), jamais `generate-world.ts` (client image `server-only`).
 */

/**
 * ⚙️ **Taille du socle** (WORLDGEN §1 « ~5-8 mondes »). **Consommée** sur le vrai chemin runtime :
 * `buildSocle` produit exactement ce nombre de mondes → amorcés en base → `resolveWorld` pioche
 * `worldIndex % taille_du_pool_réel`.
 *
 * À 6, les slots 0..5 dérivent leur thème via `hashSeed(socleSeed(slot)) % CURATED_THEMES.length`
 * (avec `CURATED_THEMES.length === 6`) vers les indices `[3, 2, 5, 4, 1, 0]` — soit une **bijection**
 * (6 thèmes tous distincts) par simple **coïncidence de hash**, PAS un algorithme anti-collision.
 * Cette variété est donc **fragile** : changer `SOCLE_WORLD_COUNT` ou le nombre/ordre de
 * `CURATED_THEMES` peut réintroduire un doublon de thème. Le test de régression « thèmes DISTINCTS »
 * verrouille cet invariant (il rougit si la bijection casse).
 */
export const SOCLE_WORLD_COUNT = 6;

/** Une ligne du socle (miroir de la table `socle_worlds`) — thème + palette + refs + prompt + seed. */
export interface SocleWorldRow {
  readonly id: string;
  readonly slot: number;
  /** Label du thème curaté (affichable). */
  readonly theme: string;
  /** Palette sérialisée (json `WorldPalette`) → `--world-accent`. */
  readonly palette: string;
  /** Refs d'assets sérialisées (json) — **placeholder** jusqu'au gate owner. */
  readonly assetRefs: string;
  /** Prompt complet (reproductibilité, WORLDGEN §7). */
  readonly prompt: string;
  /** Seed (reproductibilité à l'identique, WORLDGEN §7). */
  readonly seed: string;
}

/** Refs d'assets d'un monde du socle (fond + tuiles + variante Teddy), avant sérialisation json. */
export interface SocleAssetRefs {
  readonly background: string;
  readonly tiles: string;
  readonly teddy: string;
}

/** Clé de catalogue stable d'un monde du socle (`socle:<slot>`) — déterministe → amorçage idempotent. */
export function socleWorldId(slot: number): string {
  return `socle:${slot}`;
}

/**
 * Seed **reproductible** d'un monde du socle (WORLDGEN §7) : `socle-world-<slot>`. Stable → le monde
 * est régénérable à l'identique (le proprio peut relancer la génération réelle depuis ce seed).
 * Persisté dans `socle_worlds.seed`.
 */
export function socleSeed(slot: number): string {
  return `socle-world-${slot}`;
}

/**
 * Refs d'assets **placeholder** d'un monde du socle (schéma `placeholder://`, même signal explicite
 * « asset non encore généré » que la légendaire 5.6). Remplacés par les vraies URLs Nginx quand le
 * proprio a généré+validé les assets réels (gate owner, cf. runbook `needs-owner`).
 */
export function socleAssetRefs(slot: number): SocleAssetRefs {
  return {
    background: `placeholder://socle/${slot}/background`,
    tiles: `placeholder://socle/${slot}/tiles`,
    teddy: `placeholder://socle/${slot}/teddy`,
  };
}

/**
 * Hash **pur** d'un seed (djb2, entier ≥ 0) — aucune dépendance à `Math.random`. Sert à dériver de
 * façon **déterministe + reproductible** le contenu d'un monde du socle depuis son seed (le seed est
 * **load-bearing** : deux seeds distincts donnent, en général, deux thèmes distincts — cf. AC #4).
 */
export function hashSeed(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * **Régénère le contenu déterministe** d'un monde du socle **depuis son seed** (WORLDGEN §7 : « un
 * monde peut être régénéré à l'identique depuis prompt + seed »). Le thème est **dérivé du seed**
 * (`hashSeed(seed) % nb_thèmes`) → le seed est **load-bearing** : reproductible (même seed ⇒ même
 * thème/palette) ET sensible (seed muté ⇒ thème dérivé différent, garde AC #4). Pure.
 */
export function regenerateSocleContent(seed: string): { theme: CuratedTheme; palette: string } {
  const theme = CURATED_THEMES[hashSeed(seed) % CURATED_THEMES.length];
  const palette = serializePalette(deriveWorldPalette(theme.slug, theme.accent));
  return { theme, palette };
}

/**
 * Assemble le **prompt** d'un monde du socle (déterministe depuis thème + seed). C'est un prompt de
 * **reproductibilité** (WORLDGEN §7) : il porte le seed pour que la régénération réelle (owner) soit
 * ancrée. Placeholder textuel (les vrais prompts verrouillés ART §5 sont ceux de `generate-world`).
 */
export function soclePrompt(theme: CuratedTheme, seed: string): string {
  return `socle world "${theme.label}" (${theme.slug}), kid-safe fluffy-kawaii, seed=${seed}`;
}

/**
 * Construit **un** monde du socle pour un slot (pur, déterministe, reproductible : même slot ⇒ même
 * monde). Le seed dérive du slot ; le thème/palette **dérivent du seed** (`regenerateSocleContent`).
 */
export function buildSocleWorld(slot: number): SocleWorldRow {
  const seed = socleSeed(slot);
  const { theme, palette } = regenerateSocleContent(seed);
  return {
    id: socleWorldId(slot),
    slot,
    theme: theme.label,
    palette,
    assetRefs: JSON.stringify(socleAssetRefs(slot)),
    prompt: soclePrompt(theme, seed),
    seed,
  };
}

/** Construit **tout** le socle (`SOCLE_WORLD_COUNT` mondes déterministes). Pure. */
export function buildSocle(): SocleWorldRow[] {
  return Array.from({ length: SOCLE_WORLD_COUNT }, (_, slot) => buildSocleWorld(slot));
}

/**
 * **Amorce le socle** (WORLDGEN §7, story 6.6) : insère les `SOCLE_WORLD_COUNT` mondes déterministes
 * dans `socle_worlds`. Appelé par `runMigrations` (après `migrate`) → **1er lancement instantané,
 * hors réseau**.
 *
 * **Idempotent** : `onConflictDoNothing` par PK (`socle:<slot>`) → un rejeu ne duplique rien et ne
 * réécrit **jamais** une ligne existante (les vrais assets validés par le proprio ne seront pas
 * écrasés par le placeholder au rejeu — même garde que `ensureCharacterInTx` 5.6).
 *
 * **Transaction** = amorçage **atomique** (`resolveWorld` ne voit jamais un pool partiel → mapping
 * modulo stable). Ce n'est **pas** une garde de rollback revendiquée-testée : chaque insert étant
 * idempotent (`onConflictDoNothing`), un amorçage partiel est **auto-guérissant** au rejeu → aucun
 * test de rollback non-vacuous n'existerait (il passerait AVEC et SANS la transaction, rétro #124).
 */
export function seedSocleWorlds(db: AppDatabase): void {
  const rows = buildSocle();
  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(socleWorlds).values(row).onConflictDoNothing({ target: socleWorlds.id }).run();
    }
  });
}

/** Origine d'un monde résolu : généré par l'IA (`worlds` actif) ou tiré du socle de secours. */
export type ResolvedWorldSource = "generated" | "socle";

/** Un monde résolu prêt à être chargé par la carte (contenu unifié généré/socle, WORLDGEN §7). */
export interface ResolvedWorld {
  /** `generated` (monde IA `active`) | `socle` (fallback pré-généré). */
  readonly source: ResolvedWorldSource;
  /** Index de carte **demandé** (position d'affichage), pas le slot du socle. */
  readonly worldIndex: number;
  readonly theme: string;
  readonly palette: string;
  readonly assetRefs: string;
  readonly prompt: string;
  readonly seed: string;
}

/** Le socle est vide en base (jamais amorcé) — échec **loud + actionnable** (ne doit pas arriver post-migration). */
export class SocleUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocleUnavailableError";
  }
}

/**
 * **Résout le monde** à afficher pour un index de carte (WORLDGEN §7, story 6.6) :
 *
 * 1. Si un monde **généré `active`** existe à cet index (`worlds`, après QA + validation parent —
 *    WORLDGEN §6) → on le rend (`source: "generated"`).
 * 2. **SINON** (base fraîche, IA indispo, monde encore `buffered` en QA, ou hors buffer) → **fallback
 *    socle** : `socle[worldIndex % taille_du_pool]` (`source: "socle"`). C'est la branche de repli qui
 *    garantit **toujours** un monde jouable (jamais « pas de monde ») — retirer cette branche rougit
 *    le test `fallback socle quand aucun monde actif`.
 *
 * Le filtre **`status = active`** est une garde à effet observable (WORLDGEN §6 : un monde `buffered`
 * en QA n'est **jamais** servi) : le retirer ferait servir un monde non-validé → rougit le test
 * `un monde buffered n'est pas servi → fallback socle`.
 *
 * Lecture DB pure (aucun réseau, aucune génération). `worldIndex ≥ 0` (position de carte, MAP §1).
 *
 * @throws {SocleUnavailableError} si aucun monde actif ET socle non amorcé (garde loud, #157).
 */
export function resolveWorld(db: AppDatabase, worldIndex: number): ResolvedWorld {
  const active = db
    .select({
      theme: worlds.theme,
      palette: worlds.palette,
      assetRefs: worlds.assetRefs,
      prompt: worlds.prompt,
      seed: worlds.seed,
    })
    .from(worlds)
    .where(and(eq(worlds.index, worldIndex), eq(worlds.status, "active")))
    .get();

  if (active !== undefined) {
    return { source: "generated", worldIndex, ...active };
  }

  // ── Fallback socle (WORLDGEN §7) : base fraîche / IA indispo / hors buffer / monde encore en QA ──
  const pool = db
    .select({
      theme: socleWorlds.theme,
      palette: socleWorlds.palette,
      assetRefs: socleWorlds.assetRefs,
      prompt: socleWorlds.prompt,
      seed: socleWorlds.seed,
    })
    .from(socleWorlds)
    .orderBy(asc(socleWorlds.slot))
    .all();

  if (pool.length === 0) {
    throw new SocleUnavailableError(
      `Socle vide : aucun monde de secours amorcé (attendu ${SOCLE_WORLD_COUNT}). ` +
        `\`seedSocleWorlds\` doit tourner dans \`runMigrations\` avant tout \`resolveWorld\`.`,
    );
  }

  // Pool réutilisable → mapping modulo sur la taille **réelle** du pool (⚙️ SOCLE_WORLD_COUNT
  // consommée ici : muter le modulo change le monde de secours servi → rougit le test de mapping).
  const chosen = pool[worldIndex % pool.length];
  return { source: "socle", worldIndex, ...chosen };
}
