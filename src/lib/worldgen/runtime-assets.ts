import "server-only";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
  readdirSync,
} from "node:fs";
import { resolve, join, sep } from "node:path";
import sharp from "sharp";
import { isRenderableAssetRef } from "@/lib/game/world-theme";

/** Immutable attempt filenames: regenerating a rejected candidate never overwrites a cached image. */
export function createWorldAssetStore(root: string) {
  const base = resolve(root);
  const attempt = randomUUID();
  return {
    async write(worldIndex: number, name: string, bytes: Buffer) {
      if (
        !Number.isSafeInteger(worldIndex) ||
        worldIndex < 0 ||
        !/^(background|tiles|teddy|(?:legendary|creature-\d+)(?:-(?:ado|adulte))?)\.png$/.test(name)
      ) {
        throw new Error("Nom d’asset de monde invalide.");
      }
      if (bytes.length > 20_000_000) throw new Error("Image générée trop volumineuse.");
      const png = await sharp(bytes, { limitInputPixels: 40_000_000 }).png().toBuffer();
      // Forge shares this configured root across releases. Resolve only the root;
      // world directories and files still cannot escape it through symlinks.
      mkdirSync(base, { recursive: true });
      const canonicalBase = realpathSync(base);
      const directory = join(canonicalBase, "world", String(worldIndex));
      mkdirSync(directory, { recursive: true });
      if (realpathSync(directory) !== directory)
        throw new Error("Le stockage généré ne doit pas traverser un lien symbolique.");
      const ref = `world/${worldIndex}/runtime-${attempt}-${name}`;
      writeFileSync(join(canonicalBase, ref), png, { flag: "wx" });
      return ref;
    },
    read(ref: string) {
      if (!isRenderableAssetRef(ref) || !ref.startsWith("world/"))
        throw new Error("Référence d’inspection invalide.");
      const canonicalBase = realpathSync(base);
      const full = resolve(canonicalBase, ref);
      if (!realpathSync(full).startsWith(canonicalBase + sep) || !lstatSync(full).isFile())
        throw new Error("Asset hors du stockage généré.");
      return readFileSync(full);
    },
  };
}

/** One reservation BEFORE each HTTP attempt, including errors/retries. Caller holds daemon lock.
 * Conservative configured reservations, not an invoice or a guarantee about provider pricing.
 */
export function reserveRequest(
  directory: string,
  amountEur: number,
  budgetEur: number,
  now: Date,
): void {
  if (![amountEur, budgetEur].every((n) => Number.isFinite(n) && n > 0))
    throw new Error("Budget invalide.");
  const month = now.toISOString().slice(0, 7);
  const folder = join(directory, month);
  mkdirSync(folder, { recursive: true });
  const units = Math.ceil(amountEur * 1_000_000);
  let spent = 0;
  for (const file of readdirSync(folder)) {
    const record: unknown = JSON.parse(readFileSync(join(folder, file), "utf8"));
    if (
      !record ||
      typeof record !== "object" ||
      !("units" in record) ||
      typeof record.units !== "number" ||
      !Number.isSafeInteger(record.units) ||
      record.units <= 0
    ) {
      throw new Error("Journal de budget illisible ; aucun appel envoyé.");
    }
    spent += record.units;
  }
  if (spent + units > Math.floor(budgetEur * 1_000_000))
    throw new Error("Plafond mensuel de génération atteint.");
  const fd = openSync(join(folder, randomUUID() + ".json"), "wx");
  try {
    writeFileSync(fd, JSON.stringify({ units, at: now.toISOString() }));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
