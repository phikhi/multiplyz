import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  assertNewNames,
  namesClash,
  validateCreatureDesign,
  WORLD_HABITATS,
} from "./creature-design";
import {
  catalogueSheets,
  createCreaturePlanner,
  creatureDesignRequest,
  savedCreatureDesign,
} from "./creature-design-runtime";
import { testCreatureDesign } from "./creature-design.test-helper";
import { createVisionInspector, parseInspection } from "./vision-inspector";
import { assessAsset } from "./qa";
import { loadWorldGenConfig } from "@/config/server-config";

const directories: string[] = [];
afterEach(() => {
  for (const folder of directories.splice(0)) rmSync(folder, { recursive: true, force: true });
});
const signals = {
  detectedText: "",
  unsafeScore: 0,
  styleScore: 1,
  identityMatches: true,
  growthVisible: true,
  habitatMatches: true,
  visuallyDistinct: true,
};
const response = (value: unknown) => ({
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }],
});

it("never accepts an explicit negative comparison even when the configurable style threshold is zero", () => {
  const config = { ...loadWorldGenConfig({}).qa, styleMinScore: 0 };
  for (const field of ["identityMatches", "growthVisible", "habitatMatches", "visuallyDistinct"])
    expect(assessAsset({ ...signals, [field]: false }, config)).toEqual({
      ok: false,
      failedRule: "style_coherence",
    });
});

it("rejects catalogue duplicates, accent/case variants, near-names and collisions within the new world", () => {
  for (const name of ["PISTACHE", "Pistaché", "Pistachou", "Pistache-2"])
    expect(() => assertNewNames([name], ["Pistache"])).toThrow();
  expect(namesClash("Coquillette", "Coquillete")).toBe(true);
  expect(() => assertNewNames(["Orivelle", "Orivelle"], [])).toThrow();
  expect(() => assertNewNames(["Orivelle"], ["Pistache", "Bulle"])).not.toThrow();
});

it("requires distinct structural briefs and explicit growth before generating any pixels", () => {
  const plan = testCreatureDesign();
  const duplicate = structuredClone(plan);
  duplicate.creatures[1].anatomy = duplicate.creatures[0].anatomy;
  duplicate.creatures[1].signature = duplicate.creatures[0].signature;
  expect(() => validateCreatureDesign(duplicate, 6, "magic", [])).toThrow(/même anatomie/);
  plan.creatures[0].adult = plan.creatures[0].adolescent;
  expect(() => validateCreatureDesign(plan, 6, "magic", [])).toThrow(/âge/);
});

it("gives each environment its own ecological requirements, including a truly underwater ocean", () => {
  expect(Object.keys(WORLD_HABITATS)).toHaveLength(6);
  expect(new Set(Object.values(WORLD_HABITATS)).size).toBe(6);
  const input = {
    index: 6,
    theme: "ocean",
    history: [{ id: "old", name: "Pistache", artRefs: [] }],
    sheets: [],
  };
  const prompt = creatureDesignRequest(input)
    .contents[0].parts.flatMap((part) => ("text" in part ? [part.text] : []))
    .join("");
  expect(prompt).toContain("Fully underwater");
  expect(prompt).toContain("No land mammal wearing diving equipment");
  expect(prompt).toContain("Pistache");
  expect(prompt).toContain("NOT templates to imitate");
});

it("parses a real structured-model response and rejects a repeated name or blocked output", async () => {
  const plan = testCreatureDesign(6, "ocean");
  const input = {
    index: 6,
    theme: "ocean",
    history: [],
    sheets: [Buffer.from("comparison-evidence")],
  };
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(request.generationConfig.responseModalities).toBeUndefined();
    expect(request.generationConfig.responseSchema.properties.creatures.items.required).toContain(
      "adult",
    );
    expect(request.contents[0].parts[0].inlineData.data).toBe(input.sheets[0].toString("base64"));
    return Response.json(response(plan));
  });
  const planner = createCreaturePlanner({ apiKey: "unit", model: "gemini-3.8-flash", fetchImpl });
  expect(await planner(input)).toEqual(plan);
  await expect(
    planner({ ...input, history: [{ id: "old", name: plan.creatures[0].name, artRefs: [] }] }),
  ).rejects.toThrow(/Nom/);
  fetchImpl.mockResolvedValueOnce(Response.json({ candidates: [{ finishReason: "SAFETY" }] }));
  await expect(planner(input)).rejects.toThrow(/bloquée/);
});

it("keeps one design across restarts and stops repeated paid planning after an invalid proposal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "teddy-design-"));
  directories.push(directory);
  const input = { index: 6, theme: "magic", history: [], sheets: [] };
  const planner = vi.fn(async () => testCreatureDesign());
  const first = await savedCreatureDesign(directory, input, planner);
  expect(await savedCreatureDesign(directory, input, planner)).toEqual(first);
  expect(planner).toHaveBeenCalledTimes(1);
  expect(JSON.parse(readFileSync(join(directory, "world-6.json"), "utf8"))).toEqual(first);
  await expect(
    savedCreatureDesign(directory, { ...input, theme: "ocean" }, planner),
  ).rejects.toThrow(/autre milieu/);
  const failedDirectory = mkdtempSync(join(tmpdir(), "teddy-design-failed-"));
  directories.push(failedDirectory);
  const broken = vi.fn(async () => {
    throw new Error("modèle indisponible");
  });
  await expect(savedCreatureDesign(failedDirectory, input, broken)).rejects.toThrow(/indisponible/);
  await expect(savedCreatureDesign(failedDirectory, input, broken)).rejects.toThrow(
    /déjà demandée/,
  );
  expect(broken).toHaveBeenCalledTimes(1);
});

it("represents every historical age in the comparison sheets", async () => {
  const pixels = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#ab9" } })
    .png()
    .toBuffer();
  const history = Array.from({ length: 5 }, (_, i) => ({
    id: `old-${i}`,
    name: `name-${i}`,
    artRefs: [`baby-${i}`, `teen-${i}`, `adult-${i}`],
  }));
  const read = vi.fn(() => pixels);
  const sheets = await catalogueSheets(history, read);
  expect(sheets).toHaveLength(2);
  expect(read.mock.calls).toHaveLength(15);
  expect((await sharp(sheets[0]).metadata()).width).toBe(1024);
});

it.each([
  { ...signals, visuallyDistinct: false },
  { ...signals, habitatMatches: false },
])(
  "rejects ecological mismatch or visual near-copies without relaxing existing QA: %j",
  (verdict) => {
    expect(parseInspection(response(verdict), true, true).styleScore).toBe(0);
  },
);

it("fails closed if a novelty verdict is missing, and labels comparison sheets separately from identity refs", async () => {
  expect(() =>
    parseInspection(response({ detectedText: "", unsafeScore: 0, styleScore: 1 }), false, true),
  ).toThrow(/catalogue/);
  const pixels = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#ab9" } })
    .png()
    .toBuffer();
  const inspect = createVisionInspector({
    apiKey: "unit",
    model: "gemini-3.8-flash",
    style: "gentle",
    readAsset: () => pixels,
    readMaster: () => pixels,
    designContext: async () => ({ brief: WORLD_HABITATS.ocean, sheets: [pixels] }),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(
        body.contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData),
      ).toHaveLength(4);
      expect(body.contents[0].parts.at(-1).text).toContain("OTHER companions");
      expect(body.generationConfig.responseSchema.required).toEqual(
        expect.arrayContaining([
          "identityMatches",
          "growthVisible",
          "habitatMatches",
          "visuallyDistinct",
        ]),
      );
      return Response.json(response(signals));
    },
  });
  expect(
    (
      await inspect({
        ref: "adult",
        kind: "creature",
        stage: 3,
        babyRef: "baby",
        previousRef: "teen",
      })
    ).styleScore,
  ).toBe(1);
});

it("rejects unknown habitats and invalid planner credentials before any HTTP call", () => {
  const input = { index: 6, theme: "unknown", history: [], sheets: [] };
  expect(() => creatureDesignRequest(input)).toThrow("Milieu non défini");
  const fetchImpl = vi.fn();
  for (const [apiKey, model] of [["", "valid"], ["key", "../unsafe"]])
    expect(() => createCreaturePlanner({ apiKey, model, fetchImpl })).toThrow("Modèle de conception invalide");
  expect(fetchImpl).not.toHaveBeenCalled();
});
it.each([
  { status: 503, payload: {} },
  { status: 200, payload: null },
  { status: 200, payload: { promptFeedback: { blockReason: "SAFETY" } } },
  { status: 200, payload: { candidates: [{ finishReason: "STOP" }] } },
  { status: 200, payload: { candidates: [{ finishReason: "STOP", content: { parts: [{}] } }] } },
])("rejects unavailable or incomplete planner response %# without returning a plan", async ({ status, payload }) => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  const planner = createCreaturePlanner({ apiKey: "fixture", model: "test-model", fetchImpl });
  await expect(planner({ index: 6, theme: "magic", history: [], sheets: [] })).rejects.toThrow();
  expect(fetchImpl).toHaveBeenCalledOnce();
});
it("records non-Error planner failures and preserves the request marker to prevent automatic retries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "teddy-nonerror-planner-")); directories.push(directory);
  const planner = vi.fn(async () => { throw "interrupted"; });
  const input = { index: 6, theme: "magic", history: [], sheets: [] };
  await expect(savedCreatureDesign(directory, input, planner)).rejects.toBe("interrupted");
  expect(JSON.parse(readFileSync(join(directory, "world-6-failed.json"), "utf8")).reason).toBe("Conception interrompue.");
  await expect(savedCreatureDesign(directory, input, planner)).rejects.toThrow("déjà demandée");
  expect(planner).toHaveBeenCalledOnce();
});
