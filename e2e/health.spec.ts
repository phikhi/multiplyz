import { expect, test } from "@playwright/test";

test("GET /api/health prouve le round-trip DB en runtime Node", async ({ request }) => {
  const res = await request.get("/api/health");

  expect(res.status()).toBe(200);
  await expect(res.json()).resolves.toEqual({ ok: true });
});
