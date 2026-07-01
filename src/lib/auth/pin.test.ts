import { describe, expect, it } from "vitest";
import { hashPin, hashSecret, verifyPin, verifySecret } from "./pin";

describe("hashSecret / verifySecret (argon2id)", () => {
  it("produit un hash argon2id, jamais le secret en clair", async () => {
    const h = await hashSecret("1234");
    expect(h).not.toBe("1234");
    expect(h.startsWith("$argon2id$")).toBe(true);
  });

  it("valide le bon secret et rejette le mauvais", async () => {
    const h = await hashSecret("code-secret");
    expect(await verifySecret(h, "code-secret")).toBe(true);
    expect(await verifySecret(h, "mauvais")).toBe(false);
  });

  it("renvoie false (sans throw) sur un hash malformé", async () => {
    expect(await verifySecret("pas-un-hash", "1234")).toBe(false);
  });

  it("deux hash du même secret diffèrent (sel aléatoire)", async () => {
    const [a, b] = await Promise.all([hashSecret("1234"), hashSecret("1234")]);
    expect(a).not.toBe(b);
  });
});

describe("hashPin / verifyPin (alias PIN)", () => {
  it("hash + vérifie un PIN", async () => {
    const h = await hashPin("4821");
    expect(await verifyPin(h, "4821")).toBe(true);
    expect(await verifyPin(h, "0000")).toBe(false);
  });
});
