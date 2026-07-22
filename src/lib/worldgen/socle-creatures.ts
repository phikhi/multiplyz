import "server-only";
import { CREATURE_ASSET_DIR } from "@/config/creatures";
import type { AppDatabase } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { legendaryForWorld } from "@/lib/game/collection";
import { isRenderableAssetRef } from "@/lib/game/world-theme";
import { strings } from "@/strings";
import {
  buildCreaturePrompt,
  creatureCharacterId,
  creatureRefImages,
  creatureSpeciesKey,
  deriveCreatureSplit,
  pickFromBank,
  resolveDeps,
  WorldGenError,
  type GeneratedCreature,
  type GeneratedRarity,
  type GenerateWorldDeps,
} from "./generate-world";
import { regenerateSocleContent, socleSeed } from "./socle";

/**
 * **Génération réelle des CRÉATURES d'un monde du socle** (story R3.1, #378, épic R3 #319) —
 * l'**infra owner-run** qui peuple `characters` (communes + rares + légendaire) d'un monde du socle
 * avec de **vrais `art_ref`**, en réutilisant les **gabarits ART verrouillés** (`buildCreaturePrompt`,
 * ADR 0009) et la **répartition déterministe** de `generate-world.ts` (`deriveCreatureSplit`).
 *
 * **Server-only** (transitif via `generate-world.ts` → `image-client.ts`) : appelle le client image
 * Gemini. Volontairement **distinct de `generateWorld`** (chemin monde complet) et de
 * `generateSocleWorldAssets` (fond/tuiles/Teddy) :
 *
 * - **PAS de master-gate** : `generateWorld` exige un master Teddy approuvé (`getApprovedMaster`,
 *   L353) **uniquement** pour ancrer la variante Teddy du monde (img2img). Une **créature n'est pas
 *   Teddy** (ADR 0009 : cohérence par `{base_style}` en TEXTE, jamais le master) → ce chemin
 *   **n'appelle jamais** `getApprovedMaster` et **tourne sans master** (garde mutation-prouvée :
 *   ré-ajouter le gate ici rougit le test `tourne sans master approuvé`).
 * - **PAS de variante Teddy** ni de fond/tuiles : ceux-ci viennent de `generateSocleWorldAssets`
 *   (`socle_worlds.asset_refs`). Ce chemin **n'écrit QUE** `characters` (le catalogue de créatures).
 *
 * **Contrat de format (#189)** : chaque `art_ref` est une réf **relative** `socle/creature/<species>.png`
 * (namespace `CREATURE_ASSET_DIR`, déjà accepté par `isRenderableAssetRef` — la même garde que Teddy
 * et les assets per-monde). Une réf **absolue** `/generated/…` (défaut #189 découvert au run) est
 * **rejetée loud** par `assertRenderableRef` **avant** toute persistance → le chemin format-réel est
 * prouvé non-null (fixture valide) ET le format fautif rejeté (mutation-preuve de la garde).
 *
 * **Câblage consommateur (#180)** : les ids/species des créatures sont **identiques** à ceux que
 * consomment déjà les chemins R2 — la légendaire (`legendaryForWorld(worldIndex)`, id `legendary:<i>`)
 * est la MÊME ligne que le boss câble (`grantLegendaryInTx`), et les œufs (`creature:<i>:<slot>`,
 * `in_egg_pool = true`, `world_index = <i>`) sont la MÊME clé que le tirage d'œuf (`isInEggPool`) →
 * l'art réel atteint l'enfant en Collection via `<AssetImage>` (guardé) sans câblage neuf.
 *
 * **Mapping slot ↔ position de carte** : le socle est un pool réutilisable servi à la position
 * `worldIndex % taille_pool` (`resolveWorld`). Pour les `SOCLE_WORLD_COUNT` premiers slots, `slot`
 * **est** la position de carte servie → on câble `characters.world_index = slot` (les créatures du
 * monde socle `slot` sont celles de la position de carte `slot`).
 *
 * **Défaut committé INERTE (0 dépense, 0 régression CI)** : `deps.generate` défaut = client Gemini
 * réel, `deps.writeAsset` défaut = `defaultSocleCreatureWriteAsset` (**no-I/O**, marqueur de chemin
 * relatif). Les tests **mockent** `generate` (aucun appel réseau) ; le **run payant réel** injecte un
 * `writeAsset` disque + `generate` réel via `scripts/gen-socle-creatures.local.ts` (Phase 2,
 * owner-supervisée, #377) — jamais au défaut, jamais en CI.
 */

/**
 * Écriture d'asset **par défaut** du chemin créature-socle = réf relative `socle/creature/<name>`
 * (namespace `CREATURE_ASSET_DIR`, **pas** d'I/O disque). Renvoie la forme rendable **exacte** que
 * `isRenderableAssetRef`/`<AssetImage>` acceptent (la DB stocke le relatif ; le front préfixe
 * `WORLD_ASSET_BASE=/generated/`). Le stockage réel des octets (disque VPS/Nginx, gitignoré
 * `public/generated/`) est **injecté** à l'exécution owner (comme `defaultSocleWriteAsset` du Stage
 * assets). Pure (aucune I/O) → déterministe. `slot` non utilisé (le nom porte déjà l'espèce, clé
 * unique par slot) mais gardé pour rester assignable au type `writeAsset` (parité owner-script).
 */
export function defaultSocleCreatureWriteAsset(slot: number, name: string): Promise<string> {
  return Promise.resolve(`${CREATURE_ASSET_DIR}/${name}`);
}

/** Nom de fichier rendable d'une espèce (`<species>.png`) — dernier segment de `socle/creature/…`. */
function creatureAssetName(species: string): string {
  return `${species}.png`;
}

/**
 * **Garde de format (#189)** : refuse **loud** une `art_ref` qui n'honore pas le contrat du
 * consommateur committé (`isRenderableAssetRef` : `socle/creature/<species>.png` relatif). Empêche
 * qu'un `writeAsset` owner-run divergent (ex. réf **absolue** `/generated/…`) persiste une réf
 * **dormante** (rendue `null` en aval, art invisible sans qu'aucun test ne rougisse — le piège #189).
 * Mutation-preuve : retirer cette garde rend vert le test `réf absolue → rejet loud`.
 */
function assertRenderableRef(artRef: string): void {
  if (!isRenderableAssetRef(artRef)) {
    throw new WorldGenError(
      `Réf d'art créature "${artRef}" non rendable : attendu ` +
        `${CREATURE_ASSET_DIR}/<species>.png relatif (jamais une URL absolue /generated/…). ` +
        `Le writeAsset owner-run doit honorer littéralement le contrat isRenderableAssetRef (#189).`,
    );
  }
}

/**
 * **Génère + persiste les vraies créatures** (communes + rares + **1 légendaire**) d'UN monde du
 * socle (`slot`), et câble leur art réel dans `characters` (`art_ref`/`story`/`rarity`/`in_egg_pool`/
 * `max_stage`). Le thème/palette dérivent du **seed du slot** (`regenerateSocleContent(socleSeed(slot))`)
 * → **identiques** à `buildSocle`/`generateSocleWorldAssets` (reproductibilité WORLDGEN §7).
 *
 * **Ne touche NI le master-gate NI la variante Teddy** (cf. docblock module). Réutilise la
 * répartition (`deriveCreatureSplit`), les gabarits (`buildCreaturePrompt`) et la sélection
 * déterministe (`pickFromBank`) de `generate-world.ts` → aucune divergence de contrat de génération.
 *
 * **Persistance atomique** (`db.transaction`) : le batch de N upserts créatures est **tout-ou-rien**
 * (jamais un set de créatures partiel). **Idempotent** : re-run **remplace** l'art (upsert par PK,
 * `onConflictDoUpdate`) — aucune ligne dupliquée. Appelé **hors** transaction externe (better-sqlite3
 * ne supporte pas les transactions asynchrones ; les `generate` sont `await` **avant** la transaction).
 *
 * @throws {WorldGenError} si un `writeAsset` renvoie une réf non rendable (garde de format #189).
 * @returns les créatures générées (communes + rares + légendaire), art réel câblé.
 */
export async function generateSocleCreatures(
  db: AppDatabase,
  slot: number,
  overrides?: Partial<GenerateWorldDeps>,
): Promise<GeneratedCreature[]> {
  const deps = resolveDeps(overrides);
  const { config } = deps;
  // writeAsset créature-socle : défaut **créature-scopé** (`socle/creature/<species>.png`), pas le
  // défaut `world/…` de `resolveDeps` — sinon les refs collisionneraient avec l'espace des mondes.
  const writeAsset = overrides?.writeAsset ?? defaultSocleCreatureWriteAsset;

  // Thème dérivé du seed du slot — IDENTIQUE à buildSocle (reproductibilité §7). Aucun master requis.
  const { theme } = regenerateSocleContent(socleSeed(slot));
  // Le socle slot est servi à la position de carte `slot` (resolveWorld modulo) → world_index = slot.
  const worldIndex = slot;

  const split = deriveCreatureSplit(worldIndex);
  const nameBase = worldIndex % strings.worldgen.creatureNames.length;
  const storyBase = worldIndex % strings.worldgen.creatureStories.length;
  const conceptBase = worldIndex % theme.creatureConcepts.length;

  // ── Œufs : communes puis rares (ordre stable), art réel via {base_style} TEXTE (jamais le master) ──
  const eggCreatures: GeneratedCreature[] = [];
  const eggPoolCount = split.commons + split.rares;
  for (let s = 0; s < eggPoolCount; s += 1) {
    const rarity: GeneratedRarity = s < split.commons ? "common" : "rare";
    const speciesKey = creatureSpeciesKey(worldIndex, s);
    const concept = pickFromBank(theme.creatureConcepts, conceptBase, s);
    const prompt = buildCreaturePrompt(config, concept, theme.accent);
    const bytes = await deps.generate({ prompt, ...creatureRefImages(deps.creatureStyleBible) });
    const artRef = await writeAsset(slot, creatureAssetName(speciesKey), bytes);
    assertRenderableRef(artRef);
    eggCreatures.push({
      id: creatureCharacterId(worldIndex, s),
      speciesKey,
      nameDefault: pickFromBank(strings.worldgen.creatureNames, nameBase, s),
      rarity,
      inEggPool: true, // communes + rares = pool d'œufs (ECONOMY §4.2).
      artRef,
      story: pickFromBank(strings.worldgen.creatureStories, storyBase, s),
    });
  }

  // ── Légendaire (boss only, hors œufs) : concept DÉDIÉ, MÊME id/species que le boss (legendaryForWorld) ──
  const legendary = legendaryForWorld(worldIndex);
  const legendaryPrompt = buildCreaturePrompt(config, theme.legendaryConcept, theme.accent);
  const legendaryBytes = await deps.generate({
    prompt: legendaryPrompt,
    ...creatureRefImages(deps.creatureStyleBible),
  });
  const legendaryArtRef = await writeAsset(
    slot,
    creatureAssetName(legendary.speciesKey),
    legendaryBytes,
  );
  assertRenderableRef(legendaryArtRef);
  const legendaryCreature: GeneratedCreature = {
    id: legendary.id,
    speciesKey: legendary.speciesKey,
    nameDefault: legendary.nameDefault,
    rarity: legendary.rarity, // "legendary"
    inEggPool: legendary.inEggPool, // false (boss only).
    artRef: legendaryArtRef,
    story: legendary.story,
  };

  const all = [...eggCreatures, legendaryCreature];

  // ── Persistance atomique : câble l'art RÉEL dans characters (upsert par PK, idempotent) ──
  db.transaction((tx) => {
    for (const c of all) {
      tx.insert(characters)
        .values({
          id: c.id,
          worldIndex,
          speciesKey: c.speciesKey,
          nameDefault: c.nameDefault,
          rarity: c.rarity,
          maxStage: 1, // évolution différée (ECONOMY §2) — défaut explicite (brief R3.1).
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
  });

  return all;
}
