import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import {
  batchTasks,
  BatchTransportError,
  generateRenewalBatch,
  type BatchWorld,
} from "./renewal-batch";

const folders: string[] = [];
afterEach(() => folders.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
const worlds: BatchWorld[] = [
  {
    worldIndex: 1,
    label: "Monde test",
    creatures: [{ name: "Créature", ages: [1, 2, 3].map((stage) => ({ stage, prompt: "Draw" })) }],
  },
];
const art = async (frame = false) =>
  sharp(
    Buffer.from(
      `<svg width="256" height="256"><rect width="256" height="256" fill="white"/>${frame ? '<rect x="2" y="2" width="252" height="252" fill="none" stroke="#888" stroke-width="3"/>' : ""}<circle cx="128" cy="128" r="65" fill="#947452"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
function setup() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "teddy-batch-")));
  folders.push(directory);
  return {
    directory,
    worlds,
    planSha256: "pinned",
    guard: () => {},
    remainingUnits: () => 300_000,
  };
}

describe("all-world candidate generation", () => {
  it("keeps an unreliable matte, completes the batch and resumes without another image call", async () => {
    const options = setup(),
      framed = await art(true),
      clean = await art();
    let calls = 0;
    const generate = async () => (++calls === 1 ? framed : clean);
    const result = await generateRenewalBatch({ ...options, generate });
    expect(calls).toBe(3);
    expect(result.generated).toBe(3);
    expect(result.issues[0].status).toBe("cutout-review");
    expect(result.inspections).toBe(0);
    expect(result.published).toBe(false);
    expect(readFileSync(join(options.directory, "renewal-batch/1-0-1/raw.png"))).toEqual(framed);
    expect(
      readFileSync(join(options.directory, "renewal-batch/world-1.html"), "utf8").match(/<img /g),
    ).toHaveLength(3);
    await generateRenewalBatch({ ...options, remainingUnits: () => 0, generate });
    expect(calls).toBe(3);
    await expect(
      generateRenewalBatch({ ...options, planSha256: "changed", generate }),
    ).rejects.toThrow("Plan du lot modifié");
  });
  it("recovers received pixels locally and never repays an interrupted uncertain request", async () => {
    const options = setup(),
      clean = await art();
    for (const key of ["1-0-1", "1-0-3"]) {
      const path = join(options.directory, "renewal-batch", key);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "attempt.json"), "{}");
    }
    writeFileSync(join(options.directory, "renewal-batch/1-0-1/raw.png"), clean);
    let calls = 0;
    const result = await generateRenewalBatch({
      ...options,
      remainingUnits: () => 100_000,
      generate: async () => {
        calls++;
        return clean;
      },
    });
    expect(calls).toBe(1);
    expect(result.generated).toBe(2);
    expect(result.issues).toEqual([expect.objectContaining({ key: "1-0-3", status: "uncertain" })]);
  });
  it("checks the complete budget and stops on a systemic provider failure", async () => {
    const options = setup(),
      clean = await art();
    let calls = 0;
    const generate = async () => {
      if (++calls === 2) throw new BatchTransportError("HTTP 429");
      return clean;
    };
    await expect(
      generateRenewalBatch({ ...options, remainingUnits: () => 299_999, generate }),
    ).rejects.toThrow("Budget insuffisant");
    expect(calls).toBe(0);
    await expect(generateRenewalBatch({ ...options, generate })).rejects.toThrow("HTTP 429");
    expect(calls).toBe(2);
    expect(existsSync(join(options.directory, "renewal-batch/1-0-1/result.json"))).toBe(true);
    expect(existsSync(join(options.directory, "renewal-batch/1-0-2/attempt.json"))).toBe(false);
  });
  it("detects altered output before resuming and never schedules preserved art", async () => {
    const options = setup(),
      clean = await art();
    await generateRenewalBatch({ ...options, generate: async () => clean });
    const result = JSON.parse(
      readFileSync(join(options.directory, "renewal-batch/1-0-1/result.json"), "utf8"),
    );
    writeFileSync(join(options.directory, "storage/generated", result.ref), "tampered");
    await expect(generateRenewalBatch({ ...options, generate: async () => clean })).rejects.toThrow(
      "Image du lot modifiée",
    );
    expect(
      batchTasks([
        {
          worldIndex: 0,
          label: "Preserved",
          creatures: [
            { name: "Existing", ages: [1, 2, 3].map((stage) => ({ stage, ref: "existing.png" })) },
          ],
        },
      ]),
    ).toEqual([]);
  });
});
