import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { loadBatchRepair } from "./renewal-batch-repair";
import { batchHash, batchTasks, generateRenewalBatch, type BatchWorld } from "./renewal-batch";
import { createWorldAssetStore } from "./runtime-assets";
const folders: string[] = [];
afterEach(() => folders.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
async function setup() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "teddy-selective-")));
  folders.push(directory);
  const save = (p: string, v: unknown) => writeFileSync(join(directory, p), JSON.stringify(v));
  const worlds: BatchWorld[] = [
    {
      worldIndex: 1,
      label: "Snow",
      creatures: [
        { name: "Bird", ages: [1, 2, 3].map((stage) => ({ stage, prompt: "Draw bird" })) },
      ],
    },
  ];
  const bytes = await sharp(
    Buffer.from(
      '<svg width="128" height="128"><circle cx="64" cy="64" r="32" fill="#bd8734"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const store = createWorldAssetStore(join(directory, "storage/generated"));
  const ref = await store.write(1, "creature-0.png", bytes),
    sha256 = batchHash(store.read(ref));
  const states = [
    { status: "ready", ref, sha256 },
    { status: "failed", reason: "no image" },
    { status: "cutout-review", raw: "raw.png", sha256: batchHash(bytes) },
  ];
  const results: Record<string, string> = {};
  mkdirSync(join(directory, "renewal-batch"));
  save("renewal-batch-plan.json", {});
  save("renewal-batch/summary.json", { generated: 2 });
  writeFileSync(join(directory, "raw.png"), bytes);
  for (let i = 0; i < 3; i++) {
    const key = `1-0-${i + 1}`;
    mkdirSync(join(directory, "renewal-batch", key));
    save(`renewal-batch/${key}/result.json`, states[i]);
    save(`renewal-batch/${key}/attempt.json`, {});
    results[key] = batchHash(readFileSync(join(directory, `renewal-batch/${key}/result.json`)));
  }
  const plan = {
    version: 1,
    batchPlanSha256: batchHash(readFileSync(join(directory, "renewal-batch-plan.json"))),
    summarySha256: batchHash(readFileSync(join(directory, "renewal-batch/summary.json"))),
    results,
    repairs: [
      {
        key: "1-0-2",
        prompt:
          "A friendly fictional bird animal with two wings, two legs, a small beak, white feathers and a soft grey chest, on plain white.",
      },
      { key: "1-0-3", ref, sha256 },
    ],
  };
  save("renewal-batch-repair-plan.json", plan);
  return { directory, worlds, bytes, plan, save, ref };
}
it("only generates the missing age, keeps the local matte and approved art, and resumes without paying twice", async () => {
  const f = await setup(),
    repair = loadBatchRepair(f.directory, f.worlds);
  expect(batchTasks(repair.worlds).map((t) => t.key)).toEqual(["1-0-2"]);
  expect(repair.worlds[0].creatures[0].ages[0].ref).toBe(f.ref);
  expect(repair.worlds[0].creatures[0].ages[2].ref).toBe(f.ref);
  const source = readFileSync(join(f.directory, "renewal-batch/1-0-2/result.json"));
  let calls = 0;
  const options = {
    directory: f.directory,
    worlds: repair.worlds,
    batchName: "renewal-batch-repair" as const,
    planSha256: repair.sha256,
    guard: repair.verify,
    remainingUnits: () => 100_000,
    generate: async () => {
      calls++;
      return f.bytes;
    },
  };
  const output = await generateRenewalBatch(options);
  expect(output.generated).toBe(1);
  await generateRenewalBatch({ ...options, remainingUnits: () => 0 });
  expect(calls).toBe(1);
  expect(readFileSync(join(f.directory, "renewal-batch/1-0-2/result.json"))).toEqual(source);
  writeFileSync(join(f.directory, "storage/generated", f.ref), "changed");
  expect(repair.verify).toThrow("Image approuvée modifiée");
});
it("refuses to include an approved age in the repair scope", async () => {
  const f = await setup();
  f.plan.repairs.push({ key: "1-0-1", prompt: "A replacement that must never be requested" });
  f.save("renewal-batch-repair-plan.json", f.plan);
  expect(() => loadBatchRepair(f.directory, f.worlds)).toThrow(
    "Une image approuvée ne doit pas être reprise",
  );
});
