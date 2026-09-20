import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { testCreatureDesign } from "./creature-design.test-helper";
import { createWorldAssetStore } from "./runtime-assets";
import { cutoutNewCreature } from "./creature-growth";
import type { loadRenewalGrowth } from "./renewal-growth";
import {
  prepareRenewalGrowthRecovery,
  loadRenewalGrowthRecovery,
  removeReviewedNeutralFrame,
} from "./renewal-growth-recovery";

let directory: string, growth: ReturnType<typeof loadRenewalGrowth>, framed: Buffer;
const run = "11111111-1111-1111-1111-111111111111";
const save = (path: string, value: unknown) =>
  writeFileSync(join(directory, path), JSON.stringify(value));
const pixels = (r: number) =>
  sharp({
    create: { width: 32, height: 32, channels: 4, background: { r, g: 130, b: 80, alpha: 1 } },
  })
    .extend({
      top: 16,
      bottom: 16,
      left: 16,
      right: 16,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
beforeEach(async () => {
  directory = mkdtempSync(join(realpathSync(tmpdir()), "teddy-renewal-recovery-"));
  mkdirSync(join(directory, "renewal/0"), { recursive: true });
  mkdirSync(join(directory, "storage/worldgen/raw"), { recursive: true });
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  const plan = testCreatureDesign(0, "forest");
  const artRefs = await Promise.all(
    plan.creatures.map(async (_, i) => store.write(0, `creature-${i}.png`, await pixels(200 + i))),
  );
  growth = {
    source: { plan, artRefs },
    prompts: plan.creatures.map((c, slot) => ({
      slot,
      name: c.name,
      adolescent: `juvenile-${slot}`,
      adult: `mature-${slot}`,
    })),
    recipeSha256: "growth-plan",
    sourceRun: "approved-babies",
    historySha256: "history",
  };
  const draft = {
    ...growth.source,
    stageArt: plan.creatures.map(() => ({}) as Partial<Record<2 | 3, string>>),
  };
  save("renewal/0/growth-started.json", {
    runId: run,
    growthRecipeSha256: growth.recipeSha256,
    sourceRun: growth.sourceRun,
    historySha256: growth.historySha256,
  });
  save(`renewal/0/${run}-draft-0.json`, draft);
  framed = await sharp(
    Buffer.from(
      '<svg width="256" height="256"><rect width="256" height="256" fill="white"/><rect x="2" y="2" width="252" height="252" rx="8" fill="white" stroke="#999" stroke-width="1"/><ellipse cx="130" cy="130" rx="65" ry="40" fill="#b27248"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const trace = [];
  for (let i = 0; i < 6; i++) {
    const raw = i === 5 ? framed : await pixels(10 + i);
    writeFileSync(join(directory, `storage/worldgen/raw/${233 + i}-0.png`), raw);
    trace.push(
      {
        runId: run,
        phase: "renewal-0-growth",
        call: 233 + i,
        type: "image",
        prompts: [growth.prompts[i].adult],
        referenceSha256: [],
      },
      { runId: run, phase: "renewal-0-growth", call: 233 + i, status: 200, finishReason: "STOP" },
    );
    if (i < 5) {
      draft.stageArt[i][3] = await store.write(
        0,
        `creature-${i}-adulte.png`,
        await cutoutNewCreature(raw),
      );
      save(`renewal/0/${run}-draft-${i + 1}.json`, draft);
    }
  }
  writeFileSync(join(directory, "requests.jsonl"), trace.map((e) => JSON.stringify(e)).join("\n"));
  save(`renewal/0/${run}-result.json`, {
    outcome: "stopped",
    reason: "Détourage non fiable : inspecter le fond et la silhouette.",
    imagesSaved: 5,
    inspectionsSaved: 0,
    published: false,
    databaseWritten: false,
  });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it("reproduces a thin closed frame, crops only the reviewed white interior and preserves the five saved adults", async () => {
  await expect(cutoutNewCreature(framed)).rejects.toThrow(
    "Détourage non fiable : inspecter le fond et la silhouette.",
  );
  const original = readFileSync(join(directory, `renewal/0/${run}-draft-5.json`));
  const before = JSON.parse(original.toString());
  const recovered = await prepareRenewalGrowthRecovery(directory, growth, {
    left: 16,
    top: 16,
    width: 224,
    height: 224,
  });
  expect(recovered.completedCount).toBe(6);
  expect(recovered.draft.artRefs).toEqual(before.artRefs);
  expect(recovered.draft.stageArt.slice(0, 5)).toEqual(before.stageArt.slice(0, 5));
  expect(recovered.draft.stageArt[6]).toEqual({});
  expect(readFileSync(join(directory, `renewal/0/${run}-draft-5.json`))).toEqual(original);
  expect(readFileSync(join(directory, "storage/worldgen/raw/238-0.png"))).toEqual(framed);
  const recoveredBytes = createWorldAssetStore(join(directory, "storage/generated")).read(
    recovered.draft.stageArt[5][3]!,
  );
  const { data, info } = await sharp(recoveredBytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(224);
  expect(data[3]).toBe(0);
  expect(data[((130 - 16) * info.width + 130 - 16) * 4 + 3]).toBe(255);
  await expect(
    prepareRenewalGrowthRecovery(directory, growth, { left: 16, top: 16, width: 224, height: 224 }),
  ).rejects.toThrow(/déjà préparée/);
  expect(loadRenewalGrowthRecovery(directory, growth).draft).toEqual(recovered.draft);
});
it("refuses a rectangle crossing the creature and refuses any later change to recovered pixels", async () => {
  await expect(
    prepareRenewalGrowthRecovery(directory, growth, { left: 100, top: 100, width: 80, height: 80 }),
  ).rejects.toThrow(/marge blanche/);
  const recovered = await prepareRenewalGrowthRecovery(directory, growth, {
    left: 16,
    top: 16,
    width: 224,
    height: 224,
  });
  writeFileSync(join(directory, "storage/generated", recovered.draft.stageArt[5][3]!), "changed");
  expect(() => loadRenewalGrowthRecovery(directory, growth)).toThrow(/Pixels/);
});
it("does not recover a QA rejection as if it were a technical cutout failure", async () => {
  save(`renewal/0/${run}-result.json`, {
    outcome: "rejected",
    reason: "style_coherence",
    imagesSaved: 5,
    inspectionsSaved: 1,
    published: false,
    databaseWritten: false,
  });
  await expect(
    prepareRenewalGrowthRecovery(directory, growth, { left: 16, top: 16, width: 224, height: 224 }),
  ).rejects.toThrow(/arrêt technique/);
});

it("removes a reviewed internal neutral frame without cutting the coloured anatomy crossing it or clearing enclosed markings", async () => {
  const raw = await sharp(
    Buffer.from(
      '<svg width="256" height="256"><rect width="256" height="256" fill="white"/><rect x="40" y="40" width="176" height="176" fill="white" stroke="#999" stroke-width="1"/><ellipse cx="128" cy="128" rx="110" ry="60" fill="#b27248"/><ellipse cx="128" cy="128" rx="12" ry="8" fill="white"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const old = await sharp(await cutoutNewCreature(raw))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const result = await removeReviewedNeutralFrame(raw, {
    left: 38,
    top: 38,
    width: 180,
    height: 180,
    thickness: 5,
  });
  const after = await sharp(result).ensureAlpha().raw().toBuffer();
  const before = await sharp(raw).ensureAlpha().raw().toBuffer();
  const alpha = (x: number, y: number) => (y * 256 + x) * 4 + 3;
  expect(old[alpha(128, 50)]).toBe(255); // Matte trapped inside the frame.
  expect(after[alpha(128, 50)]).toBe(0);
  expect(after[alpha(128, 128)]).toBe(255); // Enclosed pale marking stays opaque.
  for (let i = 0; i < before.length; i += 4) {
    if (Math.max(...before.subarray(i, i + 3)) - Math.min(...before.subarray(i, i + 3)) > 16)
      expect(after.subarray(i, i + 4)).toEqual(before.subarray(i, i + 4));
  }
});
it("pins a separate matte repair without replacing the original recovery or the other twelve arts", async () => {
  const initial = await prepareRenewalGrowthRecovery(directory, growth, {
    left: 16,
    top: 16,
    width: 224,
    height: 224,
  });
  const path = "renewal/0/growth-recovery.json",
    original = readFileSync(join(directory, path));
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  const ref = await store.write(0, "creature-2-adulte.png", await pixels(180));
  const repair = {
    version: 1,
    method: "reviewed-neutral-frame",
    sourceRecoverySha256: hash(original),
    published: false,
    slot: 2,
    stage: 3,
    sourceRef: initial.draft.stageArt[2][3],
    raw: "storage/worldgen/raw/235-0.png",
    rawSha256: hash(readFileSync(join(directory, "storage/worldgen/raw/235-0.png"))),
    ref,
    sha256: hash(store.read(ref)),
  };
  save("renewal/0/growth-matte-repair.json", repair);
  const updated = loadRenewalGrowthRecovery(directory, growth);
  expect(updated.recipeSha256).not.toBe(initial.recipeSha256);
  expect(updated.draft.artRefs).toEqual(initial.draft.artRefs);
  initial.draft.stageArt.forEach((ages, i) =>
    expect(updated.draft.stageArt[i]).toEqual(i === 2 ? { 3: ref } : ages),
  );
  expect(readFileSync(join(directory, path))).toEqual(original);
  writeFileSync(join(directory, "storage/generated", ref), "changed");
  expect(() => loadRenewalGrowthRecovery(directory, growth)).toThrow(/Correction du fond détachée/);
});

const crop = { left: 16, top: 16, width: 224, height: 224 };
const readJson = (path: string) => JSON.parse(readFileSync(join(directory, path), "utf8"));
it.each([
  ["marker", "Source de récupération différente"],
  ["count", "Nombre d’images récupérables invalide"],
  ["extra-file", "Brouillons ou inspections inattendus"],
  ["trace-length", "Trace de génération incomplète"],
  ["trace-prompt", "Réponse brute détachée"],
  ["ambiguous-raw", "Image brute absente ou ambiguë"],
  ["missing-stage", "Stade enregistré absent"],
  ["changed-baby", "ne conserve pas les bébés"],
  ["changed-raw", "diffère de sa réponse brute"],
  ["no-cutout-failure", "n’est pas reproduite"],
])("refuses recovery after %s tampering", async (change, message) => {
  if (change === "marker") save("renewal/0/growth-started.json", { ...readJson("renewal/0/growth-started.json"), historySha256: "changed" });
  if (change === "count") save(`renewal/0/${run}-result.json`, { ...readJson(`renewal/0/${run}-result.json`), imagesSaved: 14 });
  if (change === "extra-file") save(`renewal/0/${run}-unexpected.json`, {});
  if (change.startsWith("trace-")) {
    const trace = readFileSync(join(directory, "requests.jsonl"), "utf8").split("\n").map((line) => JSON.parse(line));
    if (change === "trace-length") trace.pop();
    else trace[0].prompts = ["altered"];
    writeFileSync(join(directory, "requests.jsonl"), trace.map((entry) => JSON.stringify(entry)).join("\n"));
  }
  if (change === "ambiguous-raw") writeFileSync(join(directory, "storage/worldgen/raw/233-1.png"), framed);
  if (change === "missing-stage") { const draft = readJson(`renewal/0/${run}-draft-1.json`); draft.stageArt[0] = {}; save(`renewal/0/${run}-draft-1.json`, draft); }
  if (change === "changed-baby") { const draft = readJson(`renewal/0/${run}-draft-0.json`); draft.artRefs[0] = "world/0/changed.png"; save(`renewal/0/${run}-draft-0.json`, draft); }
  if (change === "changed-raw") writeFileSync(join(directory, "storage/worldgen/raw/233-0.png"), await pixels(220));
  if (change === "no-cutout-failure") writeFileSync(join(directory, "storage/worldgen/raw/238-0.png"), await pixels(225));
  await expect(prepareRenewalGrowthRecovery(directory, growth, crop)).rejects.toThrow(message);
});
it.each([
  ["binding", "Récupération détachée"], ["input", "Source de récupération modifiée"],
  ["path", "Chemin du groupe récupéré invalide"], ["hash", "Groupe récupéré modifié"],
  ["arts", "conserver tous les autres arts exacts"],
])("refuses a prepared recovery with altered %s", async (change, message) => {
  await prepareRenewalGrowthRecovery(directory, growth, crop);
  const path = "renewal/0/growth-recovery.json", recipe = readJson(path);
  if (change === "binding") recipe.traceSha256 = "changed";
  if (change === "input") recipe.inputs[0].sha256 = "changed";
  if (change === "path") recipe.prepared.path = "../outside.json";
  if (change === "hash") recipe.prepared.sha256 = "changed";
  if (change === "arts") recipe.arts = [];
  save(path, recipe);
  expect(() => loadRenewalGrowthRecovery(directory, growth)).toThrow(message);
});
it("refuses invalid frame coordinates and a frame with no neutral pixels to change", async () => {
  await expect(removeReviewedNeutralFrame(framed, { left: -1, top: 0, width: 10, height: 10, thickness: 1 })).rejects.toThrow("Cadre de correction invalide");
  const solid = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#b27248" } }).png().toBuffer();
  await expect(removeReviewedNeutralFrame(solid, { left: 8, top: 8, width: 48, height: 48, thickness: 2 })).rejects.toThrow("Aucun pixel de cadre corrigé");
});
