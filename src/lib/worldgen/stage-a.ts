import "server-only";
import { createHash } from "node:crypto";
import { getConfig, getWorldGenConfig, type StageAConfig } from "@/config/server-config";
import type { AppDatabase } from "@/lib/db";
import { generateImage, type GenerateImageInput } from "./image-client";
import { TEDDY_EXPRESSIONS } from "./expressions";
import {
  expressionAssetId,
  MASTER_ASSET_ID,
  upsertCandidate,
  type ReferenceAssetInput,
} from "./reference-assets";

/**
 * **Outil Stage A** (WORLDGEN §8, story 6.2) — **one-shot, hors chemin runtime enfant**.
 *
 * Transforme les **photos réelles** de Teddy (`docs/teddy/`, gitignorées) en :
 * - un **master Teddy kawaii** (Teddy canonique, ancre du Stage B) ;
 * - un **model sheet de 5 expressions** (neutre · content · oups · acclame · intrépide —
 *   WORLDGEN §8 + COPY §3), réutilisé comme sprites de réaction en jeu (double usage).
 *
 * Les prompts sont assemblés depuis la **charte ART §5 centralisée** (`WorldGenConfig.prompts`,
 * story 6.1 — jamais de texte en dur ici, CLAUDE.md « prompt de base verrouillé ») ; le gabarit
 * Teddy porte déjà « blank ear tag, no text » (ADR 0008 contrainte 2). Chaque asset est
 * persisté en **candidat** (`upsertCandidate`) ; le figeage du Teddy canonique reste un
 * **sign-off propriétaire manuel** (`approveAsset`, jamais appelé ici — WORLDGEN §8, ADR 0008).
 *
 * **Garde WORLDGEN §8** : les photos sont lues **une seule fois** (au démarrage de `runStageA`,
 * pour la génération + l'empreinte `sourcePhotosHash`). Le Stage B (par monde) ancre sur le
 * master dérivé, **jamais** les photos — `runStageA` est le **seul** consommateur de `photosDir`.
 *
 * Dépendances **injectables** (tests) : générateur d'image (mocké → aucun appel réseau réel),
 * lecture des photos + écriture des assets (mockées → aucune photo réelle en test). En prod, les
 * défauts s'appliquent (vrai client image + `node:fs`).
 */

/** Un fichier photo lu : nom + octets + type MIME (pour l'img2img de référence). */
export interface PhotoFile {
  name: string;
  data: Buffer;
  mimeType: string;
}

/**
 * Résultat de la génération d'UN asset (avant persistance) : les octets finaux (post
 * stratégie de fond) + le drapeau `transparent` effectif. Isolé pour tester la stratégie.
 */
export interface RenderedAsset {
  bytes: Buffer;
  transparent: boolean;
}

/** Dépendances injectables de l'outil Stage A. */
export interface StageADeps {
  /** Générateur d'image (défaut : client image 6.1). Mocké en test. */
  generate: (input: GenerateImageInput) => Promise<Buffer>;
  /** Lecture des photos de référence depuis `photosDir` (défaut : `node:fs`). Mockée en test. */
  readPhotos: (photosDir: string) => Promise<PhotoFile[]>;
  /** Écriture d'un asset dérivé sous `outputDir` (défaut : `node:fs`) → renvoie sa `assetRef`. */
  writeAsset: (outputDir: string, fileName: string, bytes: Buffer) => Promise<string>;
  /**
   * **Détourage** : retire le matte plein (fond blanc, ADR 0008) → octets à fond transparent.
   * **Injecté obligatoirement** en `post-cutout` (défaut : lève, cf. `defaultCutout`). Appelé
   * **seulement** en `post-cutout` (jamais en `full-card`). Le calibrage pixel du seuil de matte
   * = ⚙️ de playtest → l'implémentation (ex. `sharp`) est fournie à l'exécution owner, pas figée
   * dans une dépendance native ici (story = outil + mécanisme, pas la génération réelle).
   */
  cutout: (bytes: Buffer, matteColor: string) => Promise<Buffer>;
  /** Config Stage A (défaut : config centrale). Injectée en test (stratégie réglable). */
  config: StageAConfig;
}

/**
 * Applique la **stratégie de fond** ⚙️ (ADR 0008 contrainte 3) aux octets bruts du modèle
 * (rendus sur un matte plein). **Consommée** ici — la stratégie change la sortie observable :
 * - `post-cutout` : **détoure** le matte → octets à fond **transparent** (`transparent = true`),
 *   lisibilité Pokédex (PRODUCT §2.3 : la vignette se fond dans l'UI).
 * - `full-card` : garde le fond plein → octets **inchangés** (`transparent = false`).
 *
 * Fonction pure côté décision (le `cutout` est injecté) → mutation-testable : muter la
 * stratégie (`post-cutout` ↔ `full-card`) change `transparent` ET déclenche/évite l'appel
 * `cutout` (sortie octets différente).
 */
export async function applyBackgroundStrategy(
  raw: Buffer,
  config: StageAConfig,
  cutout: StageADeps["cutout"],
): Promise<RenderedAsset> {
  if (config.backgroundStrategy === "post-cutout") {
    return { bytes: await cutout(raw, config.matteColor), transparent: true };
  }
  return { bytes: raw, transparent: false };
}

/**
 * Détourage **par défaut** = **non configuré** : lève avec un message d'action. En
 * `post-cutout`, l'owner injecte une vraie implémentation (ex. `sharp` avec flood-remove du
 * matte, calibré au playtest — ⚙️) au moment de lancer l'outil. On **ne fige pas** une
 * dépendance native ici : la story livre l'outil + le mécanisme, pas la génération réelle.
 * Ce défaut n'est **jamais** atteint en `full-card` (aucun détourage).
 */
export function defaultCutout(): Promise<Buffer> {
  return Promise.reject(
    new Error(
      "Stage A : stratégie `post-cutout` sans détourage configuré. Injecte `cutout` " +
        "(ex. sharp flood-remove du matte) au lancement, ou bascule sur `full-card`.",
    ),
  );
}

/**
 * Lecture des photos par défaut (prod) — `node:fs`. Ne retient que les fichiers image (les
 * `README`/`.DS_Store` sont ignorés → jamais passés au modèle). Testé sur un dossier temp
 * (octets factices, jamais de vraie photo).
 */
export async function defaultReadPhotos(photosDir: string): Promise<PhotoFile[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join, extname } = await import("node:path");
  const MIME: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  const entries = await readdir(photosDir);
  const photos: PhotoFile[] = [];
  for (const name of entries.sort()) {
    const mimeType = MIME[extname(name).toLowerCase()];
    if (!mimeType) continue; // ignore les non-images (README, .DS_Store…)
    photos.push({ name, data: await readFile(join(photosDir, name)), mimeType });
  }
  return photos;
}

/** Écriture d'un asset par défaut (prod) — `node:fs`, renvoie le chemin du fichier servi par Nginx. */
export async function defaultWriteAsset(
  outputDir: string,
  fileName: string,
  bytes: Buffer,
): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(outputDir, { recursive: true });
  const full = join(outputDir, fileName);
  await writeFile(full, bytes);
  return full;
}

/** Résout les dépendances par défaut (prod), surchargées en test. */
export function resolveDeps(overrides?: Partial<StageADeps>): StageADeps {
  return {
    generate: overrides?.generate ?? ((input) => generateImage(input)),
    readPhotos: overrides?.readPhotos ?? defaultReadPhotos,
    writeAsset: overrides?.writeAsset ?? defaultWriteAsset,
    cutout: overrides?.cutout ?? defaultCutout,
    config: overrides?.config ?? getWorldGenConfig().stageA,
  };
}

/**
 * Empreinte **déterministe** du lot de photos (garde WORLDGEN §8 : matérialise « quel lot a
 * produit ce master »). SHA-256 sur les noms + octets triés → même lot ⇒ même empreinte.
 */
export function hashPhotos(photos: readonly PhotoFile[]): string {
  const h = createHash("sha256");
  for (const p of [...photos].sort((a, b) => a.name.localeCompare(b.name))) {
    h.update(p.name);
    h.update(p.data);
  }
  return h.digest("hex");
}

/** Assemble le prompt Teddy : gabarit ART §5 (`{base_style}` résolu) + nuance de mimique. */
function buildTeddyPrompt(
  prompts: ReturnType<typeof getWorldGenConfig>["prompts"],
  mood: string,
): string {
  // `{base_style}` = STYLE DE BASE verrouillé (ART §5) ; l'accessoire est neutre au Stage A
  // (aucun monde encore) → « no accessory ». La mimique s'ajoute après le gabarit verrouillé.
  const base = prompts.teddy
    .replace("{base_style}", prompts.style)
    .replace("{world_accessory}", "no accessory (neutral reference pose)");
  return `${base}, ${mood}. Negative: ${prompts.negative}`;
}

/** Un asset produit et persisté (retour de `runStageA`). */
export interface StageAAsset {
  id: string;
  kind: "master" | "expression";
  expression: string | null;
  assetRef: string;
  transparent: boolean;
}

/**
 * Exécute le Stage A : lit les photos **une fois**, génère le master + les 5 expressions,
 * applique la stratégie de fond, persiste chaque asset en **candidat**. Retourne les assets
 * produits (le figeage du canonique reste un sign-off owner manuel — non fait ici).
 *
 * @throws si `photosDir` est vide (aucune photo → rien à ancrer ; erreur explicite).
 */
export async function runStageA(
  db: AppDatabase,
  overrides?: Partial<StageADeps>,
): Promise<StageAAsset[]> {
  const deps = resolveDeps(overrides);
  const { prompts } = getConfig().worldgen;

  // ── SEUL point de lecture des photos (WORLDGEN §8 : jamais re-consommées après A) ──
  const photos = await deps.readPhotos(deps.config.photosDir);
  if (photos.length === 0) {
    throw new Error(
      `Stage A : aucune photo trouvée dans "${deps.config.photosDir}". Fournis les photos ` +
        `réelles de Teddy (WORLDGEN §8) avant de lancer l'outil.`,
    );
  }
  const sourcePhotosHash = hashPhotos(photos);
  const refImages = photos.map((p) => ({ data: p.data, mimeType: p.mimeType }));

  // Le lot d'assets à produire : master (mimique neutre) + les 5 expressions du model sheet.
  const targets: {
    id: string;
    kind: "master" | "expression";
    expression: string | null;
    mood: string;
    file: string;
  }[] = [
    {
      id: MASTER_ASSET_ID,
      kind: "master",
      expression: null,
      mood: "canonical reference pose, calm neutral friendly expression",
      file: "teddy-master",
    },
    ...TEDDY_EXPRESSIONS.map((e) => ({
      id: expressionAssetId(e.slug),
      kind: "expression" as const,
      expression: e.slug,
      mood: e.promptMood,
      file: `teddy-${e.slug}`,
    })),
  ];

  const produced: StageAAsset[] = [];
  for (const t of targets) {
    const prompt = buildTeddyPrompt(prompts, t.mood);
    // Stage A = photos en img2img (le SEUL stage qui les passe, WORLDGEN §8).
    const raw = await deps.generate({ prompt, refImages });
    const rendered = await applyBackgroundStrategy(raw, deps.config, deps.cutout);
    const ext = rendered.transparent ? "png" : "jpg";
    const assetRef = await deps.writeAsset(
      deps.config.outputDir,
      `${t.file}.${ext}`,
      rendered.bytes,
    );

    const input: ReferenceAssetInput = {
      id: t.id,
      kind: t.kind,
      expression: t.expression,
      assetRef,
      backgroundStrategy: deps.config.backgroundStrategy,
      transparent: rendered.transparent,
      sourcePhotosHash,
    };
    upsertCandidate(db, input);
    produced.push({
      id: t.id,
      kind: t.kind,
      expression: t.expression,
      assetRef,
      transparent: rendered.transparent,
    });
  }

  return produced;
}
