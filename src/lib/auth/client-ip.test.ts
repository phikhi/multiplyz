import { describe, expect, it } from "vitest";
import { parseClientIp, UNKNOWN_IP } from "./client-ip";

describe("parseClientIp", () => {
  it("prend la 1ʳᵉ IP de x-forwarded-for (client, proxy1, proxy2)", () => {
    expect(parseClientIp("1.2.3.4, 10.0.0.1, 10.0.0.2")).toBe("1.2.3.4");
  });

  it("gère une IP unique (avec espaces)", () => {
    expect(parseClientIp("  9.9.9.9 ")).toBe("9.9.9.9");
  });

  it("repli UNKNOWN_IP si en-tête absent", () => {
    expect(parseClientIp(null)).toBe(UNKNOWN_IP);
  });

  it("repli UNKNOWN_IP si en-tête vide", () => {
    expect(parseClientIp("   ")).toBe(UNKNOWN_IP);
  });
});
