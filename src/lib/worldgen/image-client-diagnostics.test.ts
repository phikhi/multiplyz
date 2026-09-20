import { expect, it, vi } from "vitest";
import { loadWorldGenConfig } from "@/config/server-config";
import { generateImage } from "./image-client";

/** Reproduces the recorded response to pilot call 119; no network or family data. */
it("reports PROHIBITED_CONTENT instead of missing image, with no retry", async () => {
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [{ finishReason: "PROHIBITED_CONTENT" }],
        }),
        { status: 200 },
      ),
  );
  const sleep = vi.fn(async () => {});
  await expect(
    generateImage(
      { prompt: "A friendly cartoon leaf-footed reptile." },
      {
        apiKey: "test",
        model: "gemini-2.5-flash-image",
        config: { ...loadWorldGenConfig({}), maxRetries: 3 },
        fetchImpl,
        sleep,
      },
    ),
  ).rejects.toThrow(/PROHIBITED_CONTENT/);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

it.each([
  "SAFETY",
  "IMAGE_SAFETY",
  "PROHIBITED_CONTENT",
  "IMAGE_PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_RECITATION",
  "MAX_TOKENS",
  "NO_IMAGE",
  "IMAGE_OTHER",
  "OTHER",
  "UNKNOWN_FUTURE_CODE",
])("never accepts partial image bytes or retries a %s response", async (finishReason) => {
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason,
              content: {
                parts: [{ inlineData: { data: Buffer.from("partial").toString("base64") } }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  await expect(
    generateImage(
      { prompt: "A friendly fantasy reptile." },
      {
        apiKey: "test",
        model: "test",
        config: { ...loadWorldGenConfig({}), maxRetries: 3 },
        fetchImpl,
      },
    ),
  ).rejects.toThrow(finishReason);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it("keeps prompt blocks distinct from genuine image absence after STOP", async () => {
  for (const [body, message] of [
    [
      { promptFeedback: { blockReason: "PROHIBITED_CONTENT" } },
      /prompt bloqué : PROHIBITED_CONTENT/,
    ],
    [{ candidates: [{ finishReason: "STOP" }] }, /réponse sans image/],
  ] as const) {
    await expect(
      generateImage(
        { prompt: "A friendly fantasy reptile." },
        {
          apiKey: "test",
          model: "test",
          config: loadWorldGenConfig({}),
          fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }),
        },
      ),
    ).rejects.toThrow(message);
  }
});
it("still returns an image that completed normally", async () => {
  const bytes = Buffer.from("complete-image");
  const result = await generateImage(
    { prompt: "A friendly fantasy reptile." },
    {
      apiKey: "test",
      model: "test",
      config: loadWorldGenConfig({}),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ inlineData: { data: bytes.toString("base64") } }] },
              },
            ],
          }),
          { status: 200 },
        ),
    },
  );
  expect(result).toEqual(bytes);
});
