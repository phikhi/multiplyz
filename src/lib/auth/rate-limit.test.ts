import { describe, expect, it } from "vitest";
import type { RateLimitConfig } from "@/config/server-config";
import { backoffDelayMs, isBlocked, retryAfterMs, type AttemptState } from "./rate-limit";

// Config de test : backoffMaxMs volontairement bas (5 s) pour exercer le plafond.
const CONFIG: RateLimitConfig = {
  maxAttemptsPerProfile: 5,
  maxAttemptsPerIp: 15,
  backoffBaseMs: 1000,
  backoffFactor: 2,
  backoffMaxMs: 5000,
};
const THRESHOLD = 5;
const NOW = new Date("2026-07-01T12:00:00.000Z");

/** État à `failures` échecs, dernier échec à `msAgo` ms avant NOW. */
function stateAt(failures: number, msAgo: number): AttemptState {
  return { failures, lastFailureAt: new Date(NOW.getTime() - msAgo) };
}

describe("backoffDelayMs — courbe", () => {
  it("0 sous le seuil (les `threshold` premières tentatives sont tolérées)", () => {
    expect(backoffDelayMs(3, THRESHOLD, CONFIG)).toBe(0);
    expect(backoffDelayMs(4, THRESHOLD, CONFIG)).toBe(0); // 5 essais tolérés (failures 0→4)
  });

  it("dès le seuil, croissance géométrique base * factor^(failures - threshold)", () => {
    expect(backoffDelayMs(5, THRESHOLD, CONFIG)).toBe(1000); // 6ᵉ tentative → base
    expect(backoffDelayMs(6, THRESHOLD, CONFIG)).toBe(2000);
    expect(backoffDelayMs(7, THRESHOLD, CONFIG)).toBe(4000);
  });

  it("plafonnée à backoffMaxMs (jamais de verrou permanent)", () => {
    expect(backoffDelayMs(8, THRESHOLD, CONFIG)).toBe(5000); // 8000 → capé
    expect(backoffDelayMs(50, THRESHOLD, CONFIG)).toBe(5000);
  });
});

describe("retryAfterMs — fenêtre restante", () => {
  it("0 si aucun état", () => {
    expect(retryAfterMs(null, THRESHOLD, CONFIG, NOW)).toBe(0);
  });

  it("0 sous le seuil (délai nul)", () => {
    expect(retryAfterMs(stateAt(4, 0), THRESHOLD, CONFIG, NOW)).toBe(0);
  });

  it("0 si le délai est déjà écoulé depuis le dernier échec", () => {
    // failures=5 → délai 1000 ; dernier échec il y a 2000 ms → écoulé.
    expect(retryAfterMs(stateAt(5, 2000), THRESHOLD, CONFIG, NOW)).toBe(0);
  });

  it("temps restant si le délai n'est pas écoulé", () => {
    // failures=5 → délai 1000 ; dernier échec il y a 300 ms → reste 700.
    expect(retryAfterMs(stateAt(5, 300), THRESHOLD, CONFIG, NOW)).toBe(700);
  });
});

describe("isBlocked", () => {
  it("true tant qu'il reste du backoff, false sinon", () => {
    expect(isBlocked(stateAt(5, 300), THRESHOLD, CONFIG, NOW)).toBe(true);
    expect(isBlocked(stateAt(5, 2000), THRESHOLD, CONFIG, NOW)).toBe(false);
    expect(isBlocked(null, THRESHOLD, CONFIG, NOW)).toBe(false);
  });
});
