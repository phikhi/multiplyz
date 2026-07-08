import { afterEach, describe, expect, it, vi } from "vitest";

const run = vi.fn(() => ({ changes: 1 }));
const where = vi.fn(() => ({ run }));
const set = vi.fn(() => ({ where }));
const update = vi.fn(() => ({ set }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ update }) }));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/test-only/socle-reset", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/test-only/socle-reset (route de test — story #199/6.11)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    update.mockClear();
    set.mockClear();
    where.mockClear();
    run.mockClear();
  });

  it("404 en production — route de test INERTE hors dev/test (aucune mutation tentée)", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const res = await POST(req({ slot: 0 }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("400 si le JSON du corps est invalide", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const badReq = new Request("http://localhost/api/test-only/socle-reset", {
      method: "POST",
      body: "{ pas du json",
    });

    const res = await POST(badReq);

    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["chaîne", "0"],
    ["flottant", 0.5],
    ["négatif", -1],
  ])("400 si `slot` n'est pas un entier ≥ 0 (%s)", async (_label, slot) => {
    vi.stubEnv("NODE_ENV", "development");

    const res = await POST(req({ slot }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "slot invalide : entier ≥ 0 attendu",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("remet le slot au placeholder canonique `socleAssetRefs(slot)` via `getDb()` (même connexion que le serveur)", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const res = await POST(req({ slot: 2 }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, changes: 1 });
    expect(update).toHaveBeenCalledTimes(1);
    // Effet observable : la valeur écrite est EXACTEMENT `socleAssetRefs(2)` (placeholder canonique,
    // même forme qu'après `runMigrations`) — rougit si un slot arbitraire ou une URL owner fuitait.
    expect(set).toHaveBeenCalledWith({
      assetRefs: JSON.stringify({
        background: "placeholder://socle/2/background",
        tiles: "placeholder://socle/2/tiles",
        teddy: "placeholder://socle/2/teddy",
      }),
    });
  });

  it("NODE_ENV=test (défaut vitest) : route ACTIVE (pas 404) — seule `production` est bloquée", async () => {
    vi.stubEnv("NODE_ENV", "test");

    const res = await POST(req({ slot: 0 }));

    expect(res.status).toBe(200);
  });
});
