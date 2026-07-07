import "server-only";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { socleWorlds } from "@/lib/db/schema";
import type { ImageRef } from "./image-client";
import {
  buildBackgroundPrompt,
  buildTeddyPrompt,
  buildTilesPrompt,
  resolveDeps,
  WorldGenError,
  type GenerateWorldDeps,
} from "./generate-world";
import { getApprovedMaster } from "./reference-assets";
import { regenerateSocleContent, socleSeed, socleWorldId, type SocleAssetRefs } from "./socle";

/**
 * **Génération réelle des assets du socle** (story 6.8, épic #6) — l'**infra owner-run** qui
 * remplace les placeholders `placeholder://socle/…` posés par 6.6 (#153) par de **vrais** assets
 * (fond + tuiles + variante Teddy), en réutilisant les **prompts ART verrouillés** (ADR 0009) et en
 * **ancrant réellement** la variante Teddy sur le master figé (#158, WORLDGEN §8).
 *
 * **Server-only** (transitif via `generate-world.ts` → `image-client.ts`) : ce module appelle le
 * client image Gemini. Il est **volontairement séparé de `socle.ts`** (pur, importé par
 * `runMigrations`) pour ne **jamais** tirer le client image dans le chemin de migration — `socle.ts`
 * reste sur des dépendances pures, ce module porte l'I/O réseau/disque.
 *
 * **Distinct de `generateWorld`** : ici on ne produit QUE `{background, tiles, teddy}` (ce que le
 * socle stocke), **aucune créature/légendaire**, et on écrit dans `socle_worlds.asset_refs`
 * **jamais** dans `worlds`/`characters` (le socle est un pool réutilisable distinct, WORLDGEN §7).
 */

/**
 * Convention d'URL des assets du socle **par défaut** = `socle/<slot>/<name>` (pas d'I/O ; namespace
 * **distinct** de `world/<index>/…` pour ne jamais collisionner avec un monde généré). Le stockage
 * réel des octets (disque VPS/Nginx, gitignoré `public/generated/`) est injecté à l'exécution owner.
 */
export function defaultSocleWriteAsset(slot: number, name: string): Promise<string> {
  return Promise.resolve(`socle/${slot}/${name}`);
}

/**
 * Charge les **octets réels** du master depuis le disque pour l'ancrage img2img de la variante
 * Teddy (WORLDGEN §8, ADR 0009), en **contraignant** le chemin sous `storage/reference/`. Le
 * `assetRef` provient de la DB (donc contrôlé), mais on refuse par **défense en profondeur** tout
 * chemin qui s'échapperait du répertoire de référence (anti path-traversal). Injecté comme
 * `loadMasterBytes` à l'exécution owner (run réel #181) ; **jamais** le défaut committé (qui reste
 * le marqueur déterministe, pour ne pas dépendre d'un PNG gitignoré en CI).
 *
 * @param assetRef réf d'asset du master (ex. `storage/reference/teddy/teddy-master.png`), relative à `cwd`.
 * @param opts.cwd racine de résolution (défaut `process.cwd()`) — injectable pour les tests.
 * @throws {WorldGenError} si le chemin résolu sort de `storage/reference/`.
 */
export function readMasterBytesFromDisk(assetRef: string, opts?: { cwd?: string }): Buffer {
  const cwd = opts?.cwd ?? process.cwd();
  const root = resolve(cwd, "storage", "reference");
  const full = resolve(cwd, assetRef);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new WorldGenError(
      `Réf master "${assetRef}" hors de storage/reference/ (anti-traversal, sécurité).`,
    );
  }
  return readFileSync(full);
}

/**
 * **Génère + persiste les vrais assets** (fond + tuiles + variante Teddy) d'UN monde du socle
 * (`slot`), puis met à jour `socle_worlds.asset_refs` (remplace le placeholder). Le thème/palette
 * sont **re-dérivés du seed** du slot (`regenerateSocleContent(socleSeed(slot))`) → **identiques**
 * à `buildSocle` (reproductibilité WORLDGEN §7). La variante Teddy est **ancrée img2img sur le
 * master** (octets réels via `deps.loadMasterBytes`) — jamais les photos, jamais une créature
 * (ADR 0009).
 *
 * **Écriture UNIQUE** (un `UPDATE` par `id`) → **aucun état partiel à annuler** : pas de transaction
 * de rollback (aucun test de rollback non-vacuous n'existerait, cf. #124). Idempotent : re-run
 * **remplace** les refs (jamais de doublon). Le socle doit être **amorcé** (`seedSocleWorlds`, fait
 * par `runMigrations`) — sinon 0 ligne touchée → échec **loud** (base incohérente).
 *
 * @throws {WorldGenError} master approuvé absent, ou slot du socle non amorcé.
 */
export async function generateSocleWorldAssets(
  db: AppDatabase,
  slot: number,
  overrides?: Partial<GenerateWorldDeps>,
): Promise<SocleAssetRefs> {
  const deps = resolveDeps(overrides);
  const { config } = deps;
  // `writeAsset` du socle : défaut **socle-scopé** (`socle/<slot>/…`), pas le défaut `world/…` de
  // `resolveDeps` — sinon les refs du socle collisionneraient avec l'espace des mondes générés.
  const writeAsset = overrides?.writeAsset ?? defaultSocleWriteAsset;

  // Master approuvé requis pour ancrer la variante Teddy (échec loud si absent — #157, ADR 0009).
  const master = getApprovedMaster(db);
  if (master === null) {
    throw new WorldGenError(
      `Aucun master Teddy approuvé : impossible d'ancrer la variante Teddy du socle (ADR 0009). ` +
        `Fige d'abord le master (Stage A, story 6.2, #158).`,
    );
  }

  // Thème/palette dérivés du seed du slot — IDENTIQUES à `buildSocle` (reproductibilité §7).
  const { theme } = regenerateSocleContent(socleSeed(slot));

  // Fond + tuiles : texte seul (prompts ART verrouillés réutilisés, aucune référence image).
  const backgroundBytes = await deps.generate({ prompt: buildBackgroundPrompt(config, theme) });
  const background = await writeAsset(slot, "background.png", backgroundBytes);

  const tilesBytes = await deps.generate({ prompt: buildTilesPrompt(config, theme) });
  const tiles = await writeAsset(slot, "tiles.png", tilesBytes);

  // Variante Teddy = img2img ANCRÉ sur le master (octets réels via `loadMasterBytes`) — jamais les
  // photos, jamais une créature (WORLDGEN §8, ADR 0009).
  const teddyMasterRef: ImageRef = {
    data: deps.loadMasterBytes(master.assetRef),
    mimeType: "image/png",
  };
  const teddyBytes = await deps.generate({
    prompt: buildTeddyPrompt(config, theme),
    refImages: [teddyMasterRef],
  });
  const teddy = await writeAsset(slot, "teddy.png", teddyBytes);

  const assetRefs: SocleAssetRefs = { background, tiles, teddy };

  // Écriture UNIQUE : remplace le placeholder par les vraies refs, par `id` (idempotent). 0 ligne
  // touchée ⇒ le slot n'est pas amorcé ⇒ échec loud (ne doit pas arriver post-migration).
  const result = db
    .update(socleWorlds)
    .set({ assetRefs: JSON.stringify(assetRefs) })
    .where(eq(socleWorlds.id, socleWorldId(slot)))
    .run();
  if (result.changes === 0) {
    throw new WorldGenError(
      `Slot socle ${slot} ("${socleWorldId(slot)}") absent : amorce d'abord le socle ` +
        `(seedSocleWorlds / runMigrations) avant de générer ses assets réels.`,
    );
  }

  return assetRefs;
}
