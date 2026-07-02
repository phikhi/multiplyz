import { describe, expect, it } from "vitest";
import { COMP10_TARGET, DOMAIN, SKILLS, type Skill } from "./domain";
import {
  factKey,
  generateAllFacts,
  generateFacts,
  makeFact,
  parseFactKey,
  type Fact,
} from "./facts";

// Cardinaux attendus des univers Tier 1 (ENGINE §1) — vérifiés par calcul exhaustif
// dans la story (comp10=9, add=55, sub=210, mult=55).
const EXPECTED_CARDINALS: Record<Skill, number> = {
  comp10: 9,
  add: 55,
  sub: 210,
  mult: 55,
};

describe("factKey — clé canonique (ENGINE §1)", () => {
  it("comp10 : un seul opérande, ordre naturel (b ignoré)", () => {
    expect(factKey("comp10", 3, 0)).toBe("comp10_3");
    // Le second argument est ignoré pour comp10 (compétence à un opérande).
    expect(factKey("comp10", 3, 99)).toBe("comp10_3");
  });

  it("add : commutatif → opérandes triés (même clé quel que soit l'ordre)", () => {
    expect(factKey("add", 3, 8)).toBe("add_3+8");
    expect(factKey("add", 8, 3)).toBe("add_3+8");
  });

  it("add : opérandes déjà égaux → pas d'inversion", () => {
    expect(factKey("add", 5, 5)).toBe("add_5+5");
  });

  it("mult : commutatif → opérandes triés", () => {
    expect(factKey("mult", 6, 8)).toBe("mult_6x8");
    expect(factKey("mult", 8, 6)).toBe("mult_6x8");
  });

  it("sub : non-commutatif → ordre naturel conservé", () => {
    expect(factKey("sub", 15, 6)).toBe("sub_15-6");
    // Ordre préservé même si a < b (la génération ne produit jamais ce cas, mais
    // la fonction reste fidèle à l'entrée pour les non-commutatifs).
    expect(factKey("sub", 6, 15)).toBe("sub_6-15");
  });
});

describe("makeFact — construction complète (clé + opérandes + réponse)", () => {
  it("comp10 : réponse = complément à 10, un seul opérande", () => {
    const fact = makeFact("comp10", 3, 0);
    expect(fact).toEqual<Fact>({
      key: "comp10_3",
      skill: "comp10",
      operands: [3],
      answer: COMP10_TARGET - 3,
    });
  });

  it("add : réponse = a + b, opérandes canonisés triés", () => {
    const fact = makeFact("add", 8, 3);
    expect(fact.key).toBe("add_3+8");
    expect(fact.operands).toEqual([3, 8]);
    expect(fact.answer).toBe(11);
  });

  it("sub : réponse = a − b, ordre naturel", () => {
    const fact = makeFact("sub", 15, 6);
    expect(fact.operands).toEqual([15, 6]);
    expect(fact.answer).toBe(9);
  });

  it("mult : réponse = a × b, opérandes canonisés triés", () => {
    const fact = makeFact("mult", 8, 6);
    expect(fact.key).toBe("mult_6x8");
    expect(fact.operands).toEqual([6, 8]);
    expect(fact.answer).toBe(48);
  });
});

describe("parseFactKey — désérialisation robuste", () => {
  it("aller-retour fidèle sur chaque compétence", () => {
    expect(parseFactKey("comp10_3")).toEqual(makeFact("comp10", 3, 0));
    expect(parseFactKey("add_3+8")).toEqual(makeFact("add", 3, 8));
    expect(parseFactKey("sub_15-6")).toEqual(makeFact("sub", 15, 6));
    expect(parseFactKey("mult_6x8")).toEqual(makeFact("mult", 6, 8));
  });

  it("aller-retour sur tout l'univers généré (factKey ↔ parseFactKey bijectif)", () => {
    for (const fact of generateAllFacts()) {
      expect(parseFactKey(fact.key)).toEqual(fact);
    }
  });

  it("rejette une clé sans séparateur", () => {
    expect(parseFactKey("comp10")).toBeNull();
    expect(parseFactKey("")).toBeNull();
  });

  it("rejette un préfixe de compétence inconnu", () => {
    expect(parseFactKey("div_6-2")).toBeNull();
  });

  it("comp10 : rejette un opérande non numérique ou vide", () => {
    expect(parseFactKey("comp10_x")).toBeNull();
    expect(parseFactKey("comp10_")).toBeNull();
    expect(parseFactKey("comp10_-3")).toBeNull();
  });

  it("binaire : rejette un nombre d'opérandes ≠ 2", () => {
    expect(parseFactKey("add_3")).toBeNull();
    expect(parseFactKey("add_3+8+1")).toBeNull();
  });

  it("binaire : rejette un opérande non numérique", () => {
    expect(parseFactKey("add_x+8")).toBeNull();
    expect(parseFactKey("mult_6xY")).toBeNull();
  });

  it("commutatif : rejette une clé non triée (canonicité stricte)", () => {
    // add_8+3 est « équivalente » à add_3+8 mais NON canonique → rejetée.
    expect(parseFactKey("add_8+3")).toBeNull();
    expect(parseFactKey("mult_8x6")).toBeNull();
  });
});

describe("generateFacts — univers Tier 1 par compétence (ENGINE §1)", () => {
  it.each(SKILLS)("%s : cardinal attendu, sans doublon de clé", (skill) => {
    const facts = generateFacts(skill);
    expect(facts.length).toBe(EXPECTED_CARDINALS[skill]);
    const keys = facts.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Toutes les entrées portent la bonne compétence.
    for (const fact of facts) {
      expect(fact.skill).toBe(skill);
    }
  });

  it("comp10 : couvre a ∈ 1..9, réponse = complément à 10", () => {
    const facts = generateFacts("comp10");
    expect(facts[0]).toEqual(makeFact("comp10", DOMAIN.comp10.minOperand, 0));
    for (const fact of facts) {
      expect(fact.operands[0] + fact.answer).toBe(COMP10_TARGET);
    }
  });

  it("add : toutes les sommes ≤ 20, opérandes canoniques (triés)", () => {
    for (const fact of generateFacts("add")) {
      const [a, b] = fact.operands;
      expect(a).toBeLessThanOrEqual(b); // canonique trié
      expect(a + b).toBeLessThanOrEqual(DOMAIN.add.maxSum);
      expect(fact.answer).toBe(a + b);
    }
  });

  it("sub : minuende ≤ 20, résultat ≥ 0", () => {
    for (const fact of generateFacts("sub")) {
      const [a, b] = fact.operands;
      expect(a).toBeLessThanOrEqual(DOMAIN.sub.maxMinuend);
      expect(b).toBeLessThanOrEqual(a);
      expect(fact.answer).toBe(a - b);
      expect(fact.answer).toBeGreaterThanOrEqual(0);
    }
  });

  it("mult : opérandes ∈ 1..10, canoniques (triés), réponse = produit", () => {
    for (const fact of generateFacts("mult")) {
      const [a, b] = fact.operands;
      expect(a).toBeLessThanOrEqual(b); // canonique trié
      expect(b).toBeLessThanOrEqual(DOMAIN.mult.maxOperand);
      expect(fact.answer).toBe(a * b);
    }
  });
});

describe("generateAllFacts — univers Tier 1 complet", () => {
  it("concatène toutes les compétences, clés globalement uniques", () => {
    const all = generateAllFacts();
    const total = Object.values(EXPECTED_CARDINALS).reduce((s, n) => s + n, 0);
    expect(all.length).toBe(total);
    const keys = all.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("couvre les 4 compétences", () => {
    const skills = new Set(generateAllFacts().map((f) => f.skill));
    expect(skills).toEqual(new Set(SKILLS));
  });
});
