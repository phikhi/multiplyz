import { describe, expect, it } from "vitest";
import { signedPercentPoints, toPercent, toSecondsFr } from "./dashboard-format";

describe("toPercent", () => {
  it("arrondit un ratio [0,1] en pourcentage entier", () => {
    expect(toPercent(0.823)).toBe(82);
    expect(toPercent(0)).toBe(0);
    expect(toPercent(1)).toBe(100);
    expect(toPercent(0.005)).toBe(1); // arrondi au-dessus (0.5 → 1)
  });
});

describe("toSecondsFr", () => {
  it("convertit des ms en secondes, 1 décimale, virgule française", () => {
    expect(toSecondsFr(3200)).toBe("3,2");
    expect(toSecondsFr(1000)).toBe("1,0");
    expect(toSecondsFr(0)).toBe("0,0");
    // Pas de point décimal anglais résiduel.
    expect(toSecondsFr(3200)).not.toContain(".");
  });
});

describe("signedPercentPoints", () => {
  it("signe + (typographique moins −) selon le delta, arrondi entier", () => {
    expect(signedPercentPoints(0.05)).toBe("+5");
    expect(signedPercentPoints(-0.03)).toBe("−3");
    expect(signedPercentPoints(0)).toBe("0");
    // Signe typographique MOINS (U+2212), jamais le trait d'union ASCII (U+002D).
    expect(signedPercentPoints(-0.01)).not.toContain("-");
    expect(signedPercentPoints(-0.01)).toContain("−");
  });
});
