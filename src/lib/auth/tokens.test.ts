import { describe, expect, it } from "vitest";
import {
  OPAQUE_TOKEN_BYTES,
  RECOVERY_CODE_LENGTH,
  generateOpaqueToken,
  generateRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
} from "./tokens";

describe("generateOpaqueToken", () => {
  it("produit un token base64url non vide", () => {
    const t = generateOpaqueToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThan(0);
  });

  it("deux tokens successifs diffèrent (entropie CSPRNG)", () => {
    expect(generateOpaqueToken()).not.toBe(generateOpaqueToken());
  });

  it("respecte la longueur d'octets demandée", () => {
    expect(Buffer.from(generateOpaqueToken(16), "base64url")).toHaveLength(16);
  });

  it("utilise 32 octets par défaut (256 bits)", () => {
    expect(Buffer.from(generateOpaqueToken(), "base64url")).toHaveLength(OPAQUE_TOKEN_BYTES);
  });
});

describe("generateRecoveryCode", () => {
  it("produit 8 caractères de l'alphabet lisible (sans 0/O/1/I/L)", () => {
    const code = generateRecoveryCode();
    expect(code).toHaveLength(RECOVERY_CODE_LENGTH);
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });

  it("varie d'un appel à l'autre", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRecoveryCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("hashRecoveryCode / verifyRecoveryCode", () => {
  it("ne stocke que le hash et vérifie le bon code", async () => {
    const code = generateRecoveryCode();
    const h = await hashRecoveryCode(code);
    expect(h).not.toBe(code);
    expect(await verifyRecoveryCode(h, code)).toBe(true);
    expect(await verifyRecoveryCode(h, "WRONGCOD")).toBe(false);
  });
});
