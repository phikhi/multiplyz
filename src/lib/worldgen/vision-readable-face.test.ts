import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { createVisionInspector, parseInspection } from "./vision-inspector";
import { assessAsset } from "./qa";
import { loadWorldGenConfig } from "@/config/server-config";
const signals = {
  detectedText: "",
  unsafeScore: 0,
  styleScore: 0.95,
  identityMatches: true,
  growthVisible: true,
  habitatMatches: true,
  visuallyDistinct: true,
};
const response = (fields: object) => ({
  candidates: [
    {
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify({ ...signals, ...fields }) }] },
    },
  ],
});
it("rejects a face illegible in thumbnail even when every original QA signal is positive", () => {
  const result = parseInspection(response({ faceReadable: false }), true, true, true);
  expect(result.faceReadable).toBe(false);
  expect(result.styleScore).toBe(0);
  expect(assessAsset({ ...result, styleScore: 0.95 }, loadWorldGenConfig({}).qa).ok).toBe(false);
});
it.each([{}, { faceReadable: "yes" }])(
  "requires an explicit boolean face verdict: %j",
  (fields) => {
    expect(() => parseInspection(response(fields), true, true, true)).toThrow(
      /visage en vignette absent/,
    );
  },
);
it("accepts a readable face only with all other guards still satisfied", () => {
  const result = parseInspection(response({ faceReadable: true }), true, true, true);
  expect(assessAsset(result, loadWorldGenConfig({}).qa).ok).toBe(true);
  const wrongIdentity = parseInspection(
    response({ faceReadable: true, identityMatches: false }),
    true,
    true,
    true,
  );
  expect(assessAsset(wrongIdentity, loadWorldGenConfig({}).qa).ok).toBe(false);
});
it("sends a real 128px target thumbnail after the canonical ages and requires its verdict", async () => {
  const target = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#776633" },
  })
    .png()
    .toBuffer();
  const reference = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#ccbbaa" },
  })
    .png()
    .toBuffer();
  const fetchImpl = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(response({ faceReadable: true })), { status: 200 }),
  );
  const inspect = createVisionInspector({
    apiKey: "test-key",
    model: "test-model",
    style: "gentle",
    readAsset: (ref) => (ref === "adult" ? target : reference),
    readMaster: () => {
      throw new Error("Teddy untouched");
    },
    fetchImpl,
  });
  await inspect({
    kind: "creature",
    ref: "adult",
    stage: 3,
    babyRef: "baby",
    previousRef: "ado",
    requireReadableFace: true,
  });
  const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(body.generationConfig.responseSchema.required).toContain("faceReadable");
  const images = body.contents[0].parts.filter((part: { inlineData?: unknown }) => part.inlineData);
  expect(images).toHaveLength(4);
  const thumb = Buffer.from(images[3].inlineData.data, "base64");
  expect(thumb).toEqual(
    await sharp(target)
      .flatten({ background: "white" })
      .resize(128, 128, { fit: "contain", background: "white" })
      .png()
      .toBuffer(),
  );
  expect(body.contents[0].parts.at(-1).text).toContain("without zooming");
});
it("keeps the original inspection contract for assets not opting into the new check", () => {
  expect(assessAsset(parseInspection(response({}), true, true), loadWorldGenConfig({}).qa).ok).toBe(
    true,
  );
});
