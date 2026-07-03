import { describe, expect, it } from "vitest";
import { formatEquation } from "./equation";
import { SKILLS, type Skill } from "@/lib/engine/domain";

describe("formatEquation", () => {
  it("compléments à 10 : 1 opérande connu + cible 10 (jamais l'opérande comme inconnue)", () => {
    expect(formatEquation("comp10", [3])).toBe("3 + ? = 10");
  });

  it("addition : signe +", () => {
    expect(formatEquation("add", [7, 5])).toBe("7 + 5 = ?");
  });

  it("soustraction : signe − typographique (pas un trait d'union ASCII)", () => {
    expect(formatEquation("sub", [12, 4])).toBe("12 − 4 = ?");
    expect(formatEquation("sub", [12, 4])).not.toContain("-4");
  });

  it("multiplication : signe × (pas x/X)", () => {
    expect(formatEquation("mult", [6, 8])).toBe("6 × 8 = ?");
  });

  // Test paramétré sur TOUTES les compétences du domaine (LEARNINGS #59 : une logique
  // indexée par clé de domaine doit être vérifiée sur chaque clé, pas un seul cas).
  it.each(SKILLS)("produit un énoncé non vide pour chaque compétence (%s)", (skill: Skill) => {
    const operands = skill === "comp10" ? [4] : [3, 6];
    const equation = formatEquation(skill, operands);
    expect(equation.length).toBeGreaterThan(0);
    expect(equation).toContain("?");
  });
});
