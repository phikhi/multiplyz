import "server-only";
import { getConfig, getWorldGenConfig, type WorldGenConfig } from "@/config/server-config";

/**
 * Client d'image **server-only** du pipeline de génération de mondes (WORLDGEN §5, ADR 0008).
 *
 * Appelle le modèle **Nano Banana (Gemini 2.5 Flash Image)** via l'API REST
 * `:generateContent` en demandant explicitement une sortie image
 * (`responseModalities: ["IMAGE"]`), retourne les octets bruts (`Buffer`) de l'image.
 *
 * **Server-only** : `import "server-only"` interdit tout import depuis un composant client
 * (le bundle client résout ce paquet vers un module qui *throw* à l'import → la clé Gemini
 * et l'URL de l'API ne peuvent pas fuir côté navigateur). Consommé par le worker daemon
 * (Stage A/B, stories 6.x) qui tourne dans le runtime Node.
 *
 * **Retry transitoire** (ADR 0008 contrainte 1) : le spike a observé des 5xx/429 ponctuels
 * (1/5). Les statuts **transitoires** (429/500/503) déclenchent un ré-essai avec **backoff**
 * (jusqu'à `worldgen.maxRetries` ré-essais). Une erreur **non transitoire** (4xx hors 429) ou
 * une **censure kid-safe** (`finishReason: SAFETY` / prompt bloqué) échoue **immédiatement**
 * (inutile de ré-essayer un contenu refusé).
 *
 * **Aucun secret ni URL en dur** : modèle + clé viennent de la config centrale
 * (`imageModel`), les ⚙️ retry de `worldgen` (source unique, ADR 0002).
 */

/** Hôte de base de l'API Generative Language (Gemini). */
const GEMINI_API_HOST = "https://generativelanguage.googleapis.com/v1beta";

/** Statuts HTTP **transitoires** → un ré-essai avec backoff peut réussir (ADR 0008 contrainte 1). */
const TRANSIENT_STATUS = new Set([429, 500, 503]);

/** Entrée de `generateImage` : le prompt + d'éventuelles images de référence (img2img Teddy). */
export interface GenerateImageInput {
  /** Prompt complet (gabarit ART §5 déjà assemblé par l'appelant). */
  prompt: string;
  /**
   * Images de référence (img2img / fusion multi-référence — Teddy Stage A/B, WORLDGEN §8).
   * Octets bruts + type MIME. Optionnel : une génération de fond n'en a pas.
   */
  refImages?: readonly ImageRef[];
}

/** Une image de référence : octets bruts + type MIME (ex. `image/png`). */
export interface ImageRef {
  data: Buffer;
  mimeType: string;
}

/**
 * Dépendances **injectables** (tests) : `fetch` réel + un `sleep` réel par défaut. En test on
 * injecte un `fetch` mocké (aucun appel réseau réel — DoD) et un `sleep` immédiat (déterministe).
 * En prod, les défauts s'appliquent (rien à passer).
 */
export interface ImageClientDeps {
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  config: WorldGenConfig;
  apiKey: string;
  model: string;
}

/** Erreur de génération d'image (transitoire épuisée, statut non-ok, ou censure kid-safe). */
export class ImageGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Résout les dépendances par défaut depuis la config centrale (prod), surchargées en test. */
function resolveDeps(overrides?: Partial<ImageClientDeps>): ImageClientDeps {
  const worldgen = overrides?.config ?? getWorldGenConfig();
  const imageModel = getConfig().imageModel;
  return {
    fetchImpl: overrides?.fetchImpl ?? fetch,
    sleep: overrides?.sleep ?? realSleep,
    config: worldgen,
    apiKey: overrides?.apiKey ?? imageModel.apiKey,
    model: overrides?.model ?? imageModel.model,
  };
}

/** Corps de requête `:generateContent` : le prompt + les réf. images en `inlineData` base64. */
function buildRequestBody(input: GenerateImageInput): unknown {
  const parts: unknown[] = [{ text: input.prompt }];
  for (const ref of input.refImages ?? []) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data.toString("base64") } });
  }
  return {
    contents: [{ parts }],
    // Demande explicite d'une sortie IMAGE (Nano Banana, ADR 0008).
    generationConfig: { responseModalities: ["IMAGE"] },
  };
}

/** Forme minimale de la réponse `:generateContent` qu'on lit (image inline + finishReason). */
interface GenerateContentResponse {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { inlineData?: { data?: string } }[] };
  }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Extrait les octets de la 1ʳᵉ image inline d'une réponse `:generateContent`. Lève une
 * `ImageGenerationError` **non transitoire** (pas de retry) si le contenu est **censuré**
 * (`finishReason: SAFETY`, `promptFeedback.blockReason`) ou si aucune image n'est présente.
 */
function extractImage(body: GenerateContentResponse): Buffer {
  // Censure kid-safe amont (prompt bloqué) — refus définitif, pas transitoire.
  const blockReason = body.promptFeedback?.blockReason;
  if (blockReason) {
    throw new ImageGenerationError(`génération refusée (prompt bloqué : ${blockReason})`);
  }
  const candidate = body.candidates?.[0];
  // Réponse censurée par le filtre de sécurité (finishReason SAFETY) — refus définitif.
  if (candidate?.finishReason === "SAFETY") {
    throw new ImageGenerationError("génération refusée (finishReason: SAFETY)");
  }
  const base64 = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!base64) {
    throw new ImageGenerationError("réponse sans image (aucune inlineData)");
  }
  return Buffer.from(base64, "base64");
}

/**
 * Génère une image via le modèle configuré et retourne ses octets bruts (`Buffer`).
 *
 * Boucle de **retry sur transitoire** (ADR 0008 contrainte 1) : jusqu'à `maxRetries` ré-essais
 * au-delà de la 1ʳᵉ tentative (total `maxRetries + 1` appels). Sur un statut transitoire
 * (429/500/503) et **s'il reste des essais**, on attend `retryBackoffMs × n° d'essai` puis on
 * ré-essaie ; sinon on lève. Un statut non-ok non transitoire ou une censure lèvent **sans**
 * ré-essai.
 *
 * @param deps dépendances injectables (tests) — fetch mocké + sleep immédiat. Prod : défauts.
 */
export async function generateImage(
  input: GenerateImageInput,
  deps?: Partial<ImageClientDeps>,
): Promise<Buffer> {
  const { fetchImpl, sleep, config, apiKey, model } = resolveDeps(deps);
  const url = `${GEMINI_API_HOST}/models/${model}:generateContent`;
  const requestInit: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(buildRequestBody(input)),
  };

  // `maxRetries` = nombre de RÉ-essais → `maxRetries + 1` tentatives au total.
  const maxAttempts = config.maxRetries + 1;

  /**
   * Une tentative. Récursive sur `attempt` : succès → `Buffer` ; échec **transitoire**
   * avec des essais restants → backoff puis ré-essai (`attempt + 1`) ; sinon (non
   * transitoire, ou dernier essai) → lève. La récursion (plutôt qu'une boucle `for(;;)`)
   * garantit un flot **exhaustif sans code mort** : chaque branche retourne ou lève, aucun
   * point de sortie implicite à ignorer pour le coverage.
   */
  async function attemptAt(attempt: number): Promise<Buffer> {
    const response = await fetchImpl(url, requestInit);

    if (response.ok) {
      return extractImage((await response.json()) as GenerateContentResponse);
    }

    // Statut non-ok. Transitoire ET il reste des essais → backoff puis retry ;
    // sinon (non transitoire, ou dernier essai) → échec définitif.
    const transient = TRANSIENT_STATUS.has(response.status);
    if (transient && attempt < maxAttempts) {
      await sleep(config.retryBackoffMs * attempt);
      return attemptAt(attempt + 1);
    }
    throw new ImageGenerationError(
      `échec de génération (HTTP ${response.status}${transient ? ", transitoire épuisé" : ""})`,
    );
  }

  return attemptAt(1);
}
