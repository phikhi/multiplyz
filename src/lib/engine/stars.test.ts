import { describe, expect, it } from "vitest";
import { computeAccuracy, computeStars } from "./stars";
import { CONFIG_DEFAULTS } from "@/config/server-config";

const THRESHOLDS = CONFIG_DEFAULTS.engine.starThresholds; // [0.6, 0.85, 1.0]

describe("computeStars", () => {
  it("renvoie 0 étoile sous le 1er seuil", () => {
    expect(computeStars(0, THRESHOLDS)).toBe(0);
    expect(computeStars(0.59, THRESHOLDS)).toBe(0);
  });

  // Bornes exactes (>=, pas >) — mutation `>=`→`>` tuée par ces 3 tests pile-seuil.
  it("renvoie 1 étoile pile au 1er seuil (borne large, pas stricte)", () => {
    expect(computeStars(0.6, THRESHOLDS)).toBe(1);
  });

  it("renvoie 1 étoile entre le 1er et le 2e seuil", () => {
    expect(computeStars(0.7, THRESHOLDS)).toBe(1);
    expect(computeStars(0.84, THRESHOLDS)).toBe(1);
  });

  it("renvoie 2 étoiles pile au 2e seuil", () => {
    expect(computeStars(0.85, THRESHOLDS)).toBe(2);
  });

  it("renvoie 2 étoiles entre le 2e et le 3e seuil", () => {
    expect(computeStars(0.9, THRESHOLDS)).toBe(2);
    expect(computeStars(0.99, THRESHOLDS)).toBe(2);
  });

  it("renvoie 3 étoiles pile au 3e seuil (100 %)", () => {
    expect(computeStars(1, THRESHOLDS)).toBe(3);
  });

  it("respecte des seuils personnalisés (pas seulement le défaut)", () => {
    const custom: readonly [number, number, number] = [0.5, 0.75, 0.9];
    expect(computeStars(0.4, custom)).toBe(0);
    expect(computeStars(0.5, custom)).toBe(1);
    expect(computeStars(0.75, custom)).toBe(2);
    expect(computeStars(0.9, custom)).toBe(3);
  });
});

describe("computeAccuracy", () => {
  it("calcule le ratio 1re-réponse-juste / total", () => {
    expect(computeAccuracy(7, 10)).toBe(0.7);
    expect(computeAccuracy(10, 10)).toBe(1);
    expect(computeAccuracy(0, 10)).toBe(0);
  });

  it("niveau vide (total=0, défensif) renvoie 0 — jamais NaN", () => {
    expect(computeAccuracy(0, 0)).toBe(0);
    expect(Number.isNaN(computeAccuracy(0, 0))).toBe(false);
  });

  it("total négatif (défensif, ne devrait jamais arriver) reste borné à 0", () => {
    expect(computeAccuracy(0, -1)).toBe(0);
  });
});
