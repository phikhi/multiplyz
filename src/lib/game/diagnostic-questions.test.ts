import { describe, expect, it } from "vitest";
import { diagnosticToQuestions } from "./diagnostic-questions";
import type { DiagnosticItem } from "@/lib/engine/diagnostic";
import { makeFact } from "@/lib/engine/facts";
import { SKILLS, type Skill } from "@/lib/engine/domain";

const fixedRng = () => 0; // déterministe : pas de mélange effectif, ordre stable en test.

function item(skill: DiagnosticItem["fact"]["skill"], a: number, b = 0): DiagnosticItem {
  const fact = skill === "comp10" ? makeFact("comp10", a, 0) : makeFact(skill, a, b);
  return { fact, difficulty: "easy" };
}

/** Un fait valide représentatif de chaque compétence (opérandes canoniques Tier 1). */
function sampleItem(skill: Skill): DiagnosticItem {
  switch (skill) {
    case "comp10":
      return item("comp10", 3);
    case "add":
      return item("add", 3, 8);
    case "sub":
      return item("sub", 15, 6);
    case "mult":
      return item("mult", 6, 8);
  }
}

describe("diagnosticToQuestions", () => {
  it("produit une LevelQuestion par item, format QCM systématique", () => {
    const items = [item("mult", 6, 8), item("comp10", 3)];
    const questions = diagnosticToQuestions(items, fixedRng);

    expect(questions).toHaveLength(2);
    for (const q of questions) {
      expect(q.format).toBe("qcm");
      expect(q.choices).not.toBeNull();
      expect(q.choices).toHaveLength(4);
      expect(q.isReask).toBe(false);
    }
  });

  // Test paramétré sur TOUTES les compétences du domaine (LEARNINGS #59 : une logique
  // indexée par clé de domaine doit être vérifiée sur chaque clé — comp10/add/sub/mult).
  it.each(SKILLS)("produit une question QCM valide pour la compétence %s", (skill: Skill) => {
    const [q] = diagnosticToQuestions([sampleItem(skill)], fixedRng);
    expect(q.skill).toBe(skill);
    expect(q.format).toBe("qcm");
    expect(q.choices).toHaveLength(4);
    expect(q.isReask).toBe(false);
  });

  it("préserve factKey/skill/operands du fait sous-jacent", () => {
    const [q] = diagnosticToQuestions([item("mult", 6, 8)], fixedRng);
    expect(q.factKey).toBe("mult_6x8");
    expect(q.skill).toBe("mult");
    expect(q.operands).toEqual([6, 8]);
  });

  it("les choix QCM incluent la bonne réponse", () => {
    const [q] = diagnosticToQuestions([item("add", 3, 8)], fixedRng);
    expect(q.choices).toContain(11);
  });

  it("liste vide → aucune question (cas défensif)", () => {
    expect(diagnosticToQuestions([], fixedRng)).toEqual([]);
  });
});
