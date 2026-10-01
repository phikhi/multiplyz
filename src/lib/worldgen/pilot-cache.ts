import "server-only";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { GenerateImageInput } from "./image-client";
import { readPilotTrace } from "./pilot-status";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const key = (prompts: string[], references: string[]) => JSON.stringify({ prompts, references });

/** Reuse only successfully recorded images matching the exact prompt and reference bytes.
 * These bytes still go through storage validation and the complete fresh vision QA.
 */
export async function loadPilotImageCache(directory: string) {
  const trace = readPilotTrace(directory);
  const archive = join(directory, "storage/worldgen/raw");
  const files = existsSync(archive) ? readdirSync(archive) : [];
  const cache = new Map<string, Buffer>();
  for (const entry of trace) {
    if (
      entry.type !== "image" ||
      !Number.isSafeInteger(entry.call) ||
      entry.call < 1 ||
      !entry.prompts?.every((p) => typeof p === "string") ||
      !entry.referenceSha256?.every((p) => typeof p === "string") ||
      !trace.some((r) => r.call === entry.call && r.status === 200)
    )
      continue;
    const raw = files
      .filter((f) => new RegExp(`^${entry.call}-\\d+\\.(png|jpg)$`).test(f))
      .sort()[0];
    if (!raw) continue;
    const bytes = readFileSync(join(archive, raw));
    // Decode now: corrupt cached bytes must stop a resume before another request is sent.
    await sharp(bytes, { limitInputPixels: 40_000_000 }).stats();
    cache.set(key(entry.prompts, entry.referenceSha256), bytes);
  }
  return {
    size: cache.size,
    read(input: GenerateImageInput) {
      return cache.get(
        key(
          [input.prompt],
          (input.refImages ?? []).map((ref) => hash(ref.data)),
        ),
      );
    },
  };
}
