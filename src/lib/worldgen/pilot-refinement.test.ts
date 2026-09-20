import { expect, it } from "vitest";
import { parseInspection } from "./vision-inspector";
import { assessAsset } from "./qa";
import { loadWorldGenConfig } from "@/config/server-config";
import { createHash } from "node:crypto";
import { recordedDiagnostic } from "./pilot-refinement";

it("retains the Pistache growth diagnostic without weakening its rejection", () => {
  const inspection = parseInspection(
    {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              {
                text: JSON.stringify({
                  detectedText: "",
                  unsafeScore: 0.2,
                  styleScore: 0.72,
                  identityMatches: true,
                  growthVisible: false,
                }),
              },
            ],
          },
        },
      ],
    },
    true,
  );
  expect(inspection).toMatchObject({ identityMatches: true, growthVisible: false, styleScore: 0 });
  expect(assessAsset(inspection, loadWorldGenConfig({}).qa)).toEqual({
    ok: false,
    failedRule: "style_coherence",
  });
});

it("uses archived verdicts only for the exact model, prompt, pixels and ordered references", () => {
  const bytes = ["adult-pixels", "baby-pixels", "teen-pixels"];
  const body = {
    contents: [
      {
        parts: [
          { text: "inspect growth" },
          ...bytes.map((value) => ({
            inlineData: { data: Buffer.from(value).toString("base64") },
          })),
        ],
      },
    ],
  };
  const request = {
    call: 29,
    type: "vision",
    model: "gemini-3.8-flash",
    prompts: ["inspect growth"],
    referenceSha256: bytes.map((value) => createHash("sha256").update(value).digest("hex")),
  };
  const response = {
    call: 29,
    status: 200,
    verdict: ['{"identityMatches":true,"growthVisible":false}'],
  };
  expect(recordedDiagnostic([request, response], request.model, body)?.call).toBe(29);
  expect(recordedDiagnostic([request, response], "another-model", body)).toBeUndefined();
  for (let i = 0; i < bytes.length; i++) {
    const changed = structuredClone(body);
    changed.contents[0].parts[i + 1] = {
      inlineData: { data: Buffer.from("changed").toString("base64") },
    };
    expect(recordedDiagnostic([request, response], request.model, changed)).toBeUndefined();
  }
  const changed = structuredClone(body);
  changed.contents[0].parts[0] = { text: "different prompt" };
  expect(recordedDiagnostic([request, response], request.model, changed)).toBeUndefined();
  expect(
    recordedDiagnostic([request, { ...response, finishReason: "SAFETY" }], request.model, body),
  ).toBeUndefined();
  expect(
    recordedDiagnostic([request, { ...response, status: 404 }], request.model, body),
  ).toBeUndefined();
  expect(recordedDiagnostic([request], request.model, body)).toBeUndefined();
});
