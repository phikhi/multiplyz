import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldGenConfig } from "@/config/server-config";
import {
  generateImage,
  ImageGenerationError,
  type GenerateImageInput,
  type ImageClientDeps,
} from "./image-client";

// AUCUN appel réseau réel (DoD) : `fetch` est TOUJOURS mocké et `sleep` immédiat.
// Config injectée → indépendante de l'env réel + déterministe.

/** Config worldgen minimale pour les tests (retry réglable par cas). */
function cfg(overrides: Partial<WorldGenConfig> = {}): WorldGenConfig {
  return {
    monthlyBudgetEur: 20,
    bufferAhead: 2,
    maxRetries: 3,
    retryBackoffMs: 500,
    prompts: { style: "", negative: "", teddy: "", creature: "", background: "" },
    stageA: {
      photosDir: "docs/teddy",
      outputDir: "storage/reference/teddy",
      backgroundStrategy: "post-cutout",
      matteColor: "#ffffff",
    },
    ...overrides,
  };
}

/** Construit une réponse fetch mockée (ok + json, ou statut d'erreur). */
function mockResponse(init: { ok: boolean; status?: number; json?: unknown }): Response {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    json: async () => init.json ?? {},
  } as unknown as Response;
}

/** Réponse OK portant une image inline base64 (`data` = octets encodés). */
function okImageResponse(bytes: Buffer): Response {
  return mockResponse({
    ok: true,
    json: {
      candidates: [{ content: { parts: [{ inlineData: { data: bytes.toString("base64") } }] } }],
    },
  });
}

/** Dépendances injectées : fetch séquencé sur une liste de réponses + sleep espionné. */
function deps(
  responses: Response[],
  configOverrides: Partial<WorldGenConfig> = {},
): {
  deps: Partial<ImageClientDeps>;
  fetchImpl: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
} {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("fetch appelé plus de fois que de réponses mockées");
    return next;
  });
  const sleep = vi.fn(async () => {});
  return {
    fetchImpl,
    sleep,
    deps: {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
      config: cfg(configOverrides),
      apiKey: "test-key",
      model: "gemini-2.5-flash-image",
    },
  };
}

const input: GenerateImageInput = { prompt: "flat kawaii forest background" };

afterEach(() => vi.restoreAllMocks());

describe("generateImage — succès", () => {
  it("retourne les octets de l'image sur un succès direct (1 seul appel fetch)", async () => {
    const bytes = Buffer.from("PNGDATA");
    const d = deps([okImageResponse(bytes)]);
    const out = await generateImage(input, d.deps);
    expect(out.equals(bytes)).toBe(true);
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
  });

  it("cible l'endpoint :generateContent avec responseModalities IMAGE + la clé en header", async () => {
    const d = deps([okImageResponse(Buffer.from("X"))]);
    await generateImage(input, d.deps);
    const [url, reqInit] = d.fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    );
    expect((reqInit.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(reqInit.body as string);
    expect(body.generationConfig.responseModalities).toEqual(["IMAGE"]);
    expect(body.contents[0].parts[0].text).toBe(input.prompt);
  });

  it("encode les images de référence en inlineData base64 (img2img Teddy)", async () => {
    const d = deps([okImageResponse(Buffer.from("X"))]);
    const ref = Buffer.from("REFBYTES");
    await generateImage(
      { prompt: "teddy", refImages: [{ data: ref, mimeType: "image/png" }] },
      d.deps,
    );
    const body = JSON.parse((d.fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.contents[0].parts[1].inlineData).toEqual({
      mimeType: "image/png",
      data: ref.toString("base64"),
    });
  });
});

describe("generateImage — retry sur transitoire (ADR 0008 contrainte 1)", () => {
  it("ré-essaie après un 503 transitoire puis réussit (2 appels, 1 backoff)", async () => {
    const bytes = Buffer.from("OKAFTER503");
    const d = deps([mockResponse({ ok: false, status: 503 }), okImageResponse(bytes)]);
    const out = await generateImage(input, d.deps);
    expect(out.equals(bytes)).toBe(true);
    expect(d.fetchImpl).toHaveBeenCalledTimes(2);
    // Backoff appelé exactement une fois, avec retryBackoffMs × n° d'essai (500 × 1).
    expect(d.sleep).toHaveBeenCalledTimes(1);
    expect(d.sleep).toHaveBeenCalledWith(500);
  });

  it("ré-essaie sur 429 et 500 (tous transitoires)", async () => {
    const bytes = Buffer.from("OK");
    const d = deps([
      mockResponse({ ok: false, status: 429 }),
      mockResponse({ ok: false, status: 500 }),
      okImageResponse(bytes),
    ]);
    const out = await generateImage(input, d.deps);
    expect(out.equals(bytes)).toBe(true);
    expect(d.fetchImpl).toHaveBeenCalledTimes(3);
    // Backoff croissant : 500 × 1 puis 500 × 2.
    expect(d.sleep.mock.calls).toEqual([[500], [1000]]);
  });

  // MUTATION-PROOF de la garde retry : avec maxRetries=2 (→ 3 tentatives), trois 503
  // successifs épuisent les essais → échec. Retirer le retry (ex. transformer
  // `attempt < maxAttempts` en `false`, ou supprimer le `continue`/`sleep`) ferait échouer
  // ce test dès le 1er 503 (une seule tentative) → nombre d'appels ≠ 3, sleep ≠ 2.
  it("échoue quand les ré-essais transitoires sont épuisés (retries exhausted)", async () => {
    const d = deps(
      [
        mockResponse({ ok: false, status: 503 }),
        mockResponse({ ok: false, status: 503 }),
        mockResponse({ ok: false, status: 503 }),
      ],
      { maxRetries: 2 },
    );
    await expect(generateImage(input, d.deps)).rejects.toThrow(ImageGenerationError);
    // 3 tentatives (1 + 2 ré-essais), 2 backoffs (après les 2 premiers échecs).
    expect(d.fetchImpl).toHaveBeenCalledTimes(3);
    expect(d.sleep).toHaveBeenCalledTimes(2);
  });

  // MUTATION-PROOF complémentaire : maxRetries=0 → AUCUN ré-essai. Un 503 échoue au 1er coup,
  // sans backoff. Rouge si un retry est réintroduit inconditionnellement (fetch appelé > 1 fois).
  it("n'effectue AUCUN ré-essai quand maxRetries=0 (retry désactivable)", async () => {
    const d = deps([mockResponse({ ok: false, status: 503 })], { maxRetries: 0 });
    await expect(generateImage(input, d.deps)).rejects.toThrow(/HTTP 503/);
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
  });

  // Un statut NON transitoire (4xx hors 429) échoue IMMÉDIATEMENT, jamais de retry.
  // Effet observable : un 400 ne doit provoquer qu'un seul appel (pas de backoff).
  it("échoue immédiatement sur un statut non transitoire (400) sans ré-essai", async () => {
    const d = deps([mockResponse({ ok: false, status: 400 }), okImageResponse(Buffer.from("X"))]);
    await expect(generateImage(input, d.deps)).rejects.toThrow(/HTTP 400/);
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
  });
});

describe("generateImage — censure kid-safe (finishReason SAFETY / prompt bloqué)", () => {
  it("lève sans ré-essai quand finishReason = SAFETY (contenu censuré)", async () => {
    const d = deps([
      mockResponse({ ok: true, json: { candidates: [{ finishReason: "SAFETY" }] } }),
    ]);
    await expect(generateImage(input, d.deps)).rejects.toThrow(/SAFETY/);
    // Refus définitif → pas de retry.
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
  });

  it("lève quand le prompt est bloqué en amont (promptFeedback.blockReason)", async () => {
    const d = deps([
      mockResponse({ ok: true, json: { promptFeedback: { blockReason: "SAFETY" } } }),
    ]);
    await expect(generateImage(input, d.deps)).rejects.toThrow(/prompt bloqué/);
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("lève quand la réponse ne contient aucune image (inlineData absente)", async () => {
    const d = deps([
      mockResponse({ ok: true, json: { candidates: [{ content: { parts: [{}] } }] } }),
    ]);
    await expect(generateImage(input, d.deps)).rejects.toThrow(/sans image/);
  });

  it("lève quand candidates est absent (réponse vide)", async () => {
    const d = deps([mockResponse({ ok: true, json: {} })]);
    await expect(generateImage(input, d.deps)).rejects.toThrow(/sans image/);
  });
});

describe("generateImage — dépendances par défaut (config centrale, fetch/sleep globaux)", () => {
  it("dérive config/apiKey/model depuis la config centrale quand non injectés", async () => {
    // On n'injecte QUE fetchImpl → les fallbacks `?? getWorldGenConfig()`, `?? imageModel.apiKey`,
    // `?? imageModel.model` sont exercés (succès direct). Le modèle par défaut vient de la config.
    const bytes = Buffer.from("DEFAULTDEPS");
    const fetchImpl = vi.fn(async () => okImageResponse(bytes));
    const out = await generateImage(input, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.equals(bytes)).toBe(true);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    // Le modèle par défaut de la config centrale (gemini-2.5-flash-image) est dans l'URL.
    expect(url).toContain("gemini-2.5-flash-image:generateContent");
  });

  it("utilise le `fetch` global + le `sleep` réel par défaut quand non injectés (transitoire→backoff→succès)", async () => {
    // Aucune injection de fetchImpl/sleep → exerce `?? fetch` (global) ET `?? realSleep` (délai
    // RÉEL). On STUB `globalThis.fetch` (transitoire-puis-succès) → AUCUN appel réseau réel (DoD).
    // Le backoff réel est ultra-court (retryBackoffMs=1) → test rapide. Prouve que le retry marche
    // aussi via les dépendances de PROD (fetch global + realSleep), pas seulement les mocks injectés.
    const bytes = Buffer.from("REALDEPS");
    const queue = [mockResponse({ ok: false, status: 503 }), okImageResponse(bytes)];
    const stub = vi.fn(async () => queue.shift() as Response);
    vi.stubGlobal("fetch", stub);
    try {
      const out = await generateImage(input, {
        config: cfg({ maxRetries: 1, retryBackoffMs: 1 }),
        apiKey: "k",
        model: "m",
      });
      expect(out.equals(bytes)).toBe(true);
      expect(stub).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ImageGenerationError", () => {
  it("porte le nom de classe (identifiable par les appelants)", () => {
    const e = new ImageGenerationError("boom");
    expect(e.name).toBe("ImageGenerationError");
    expect(e.message).toBe("boom");
    expect(e).toBeInstanceOf(Error);
  });
});
