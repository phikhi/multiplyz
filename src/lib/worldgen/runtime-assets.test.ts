import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { createWorldAssetStore } from "./runtime-assets";
import { GET } from "@/app/generated/world/[world]/[file]/route";

let directory: string;
let pixels: Buffer;
beforeEach(async () => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "teddy-shared-assets-")));
  pixels = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#123456" } })
    .png()
    .toBuffer();
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function sharedStorage() {
  const shared = join(directory, "shared/generated");
  const release = join(directory, "release");
  const root = join(release, "storage/generated");
  mkdirSync(shared, { recursive: true });
  mkdirSync(dirname(root), { recursive: true });
  symlinkSync(shared, root, "dir");
  return { shared, release, root };
}

describe("stockage partagé entre releases Forge", () => {
  it("lit les images existantes via la racine partagée et la vraie route HTTP", async () => {
    const { shared, release, root } = sharedStorage();
    const ref = await createWorldAssetStore(shared).write(6, "teddy.png", pixels);
    const stored = readFileSync(join(shared, ref));
    expect(createWorldAssetStore(root).read(ref)).toEqual(stored);
    vi.spyOn(process, "cwd").mockReturnValue(release);
    const response = await GET(new Request("http://unit"), {
      params: Promise.resolve({ world: "6", file: ref.split("/").at(-1)! }),
    });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(stored);
    expect(response.headers.get("Cache-Control")).toContain("immutable");
  });

  it("ajoute un fichier immuable dans la racine partagée, lisible depuis une autre release", async () => {
    const { shared, root } = sharedStorage();
    const ref = await createWorldAssetStore(root).write(7, "creature-0-ado.png", pixels);
    const other = join(directory, "other-release-assets");
    symlinkSync(shared, other, "dir");
    expect(createWorldAssetStore(other).read(ref)).toEqual(readFileSync(join(shared, ref)));
  });

  it("refuse toujours un sous-dossier de monde détourné hors de la racine", async () => {
    const { shared, root } = sharedStorage();
    const outside = join(directory, "outside");
    const ref = await createWorldAssetStore(outside).write(6, "teddy.png", pixels);
    mkdirSync(join(shared, "world"));
    symlinkSync(join(outside, "world/6"), join(shared, "world/6"), "dir");
    expect(() => createWorldAssetStore(root).read(ref)).toThrow(/hors du stockage/);
    await expect(createWorldAssetStore(root).write(6, "teddy.png", pixels)).rejects.toThrow(
      /lien symbolique/,
    );
  });

  it("refuse un lien de fichier et une traversée même dans un stockage partagé", async () => {
    const { shared, root } = sharedStorage();
    const ref = await createWorldAssetStore(shared).write(6, "teddy.png", pixels);
    const alias = ref.replace("teddy.png", "background.png");
    symlinkSync(join(shared, ref), join(shared, alias));
    expect(() => createWorldAssetStore(root).read(alias)).toThrow();
    expect(() => createWorldAssetStore(root).read("world/../private.png")).toThrow();
  });
});
