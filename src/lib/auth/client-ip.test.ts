import { describe, expect, it } from "vitest";
import { parseForwardedFor, resolveClientIp, UNKNOWN_IP } from "./client-ip";

describe("parseForwardedFor", () => {
  it("prend la 1ʳᵉ IP de x-forwarded-for (client, proxy1, proxy2)", () => {
    expect(parseForwardedFor("1.2.3.4, 10.0.0.1, 10.0.0.2")).toBe("1.2.3.4");
  });

  it("gère une IP unique (avec espaces)", () => {
    expect(parseForwardedFor("  9.9.9.9 ")).toBe("9.9.9.9");
  });

  it("repli UNKNOWN_IP si en-tête absent", () => {
    expect(parseForwardedFor(null)).toBe(UNKNOWN_IP);
  });

  it("repli UNKNOWN_IP si en-tête vide", () => {
    expect(parseForwardedFor("   ")).toBe(UNKNOWN_IP);
  });
});

describe("resolveClientIp", () => {
  it("préfère X-Real-IP (non-spoofable) à X-Forwarded-For", () => {
    // XFF est contrôlable par le client → on ignore quand X-Real-IP est présent.
    expect(resolveClientIp("203.0.113.7", "1.2.3.4, 10.0.0.1")).toBe("203.0.113.7");
  });

  it("retombe sur X-Forwarded-For si X-Real-IP absent", () => {
    expect(resolveClientIp(null, "1.2.3.4, 10.0.0.1")).toBe("1.2.3.4");
  });

  it("retombe sur X-Forwarded-For si X-Real-IP vide", () => {
    expect(resolveClientIp("  ", "1.2.3.4")).toBe("1.2.3.4");
  });

  it("UNKNOWN_IP si aucune source (dev / appel direct)", () => {
    expect(resolveClientIp(null, null)).toBe(UNKNOWN_IP);
  });
});
