import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: () => ({ get }),
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("répond 200 { ok: true } quand le round-trip DB renvoie 1", async () => {
    get.mockReturnValue({ ok: 1 });

    const res = GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("répond 503 { ok: false } quand le round-trip DB échoue", async () => {
    get.mockReturnValue(undefined);

    const res = GET();

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false });
  });

  it("répond 503 { ok: false } quand la couche DB throw (injoignable / SQLITE_BUSY)", async () => {
    get.mockImplementation(() => {
      throw new Error("database is locked");
    });

    const res = GET();

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false });
  });
});
