import { describe, expect, it } from "vitest";
import { SKILLS, type Skill } from "./domain";
import { generateFacts, makeFact, type Fact } from "./facts";
import {
  buildDistractors,
  buildQuestionChoices,
  chooseFormat,
  QCM_CHOICE_COUNT,
  type Rng,
} from "./distractors";

/**
 * RNG déterministe : rejoue une séquence fixée de flottants `[0,1)`, puis
 * boucle sur le dernier élément si `shuffle` en consomme davantage. Permet des
 * assertions **reproductibles** sur le mélange (LEARNINGS aléa/#34 : jamais de
 * `Math.random` réel en test).
 */
function fakeRng(sequence: number[]): Rng {
  let i = 0;
  return () => {
    const value = sequence[Math.min(i, sequence.length - 1)];
    i++;
    return value;
  };
}

/** RNG qui ne mélange jamais (facteur `0` à chaque appel → identité). */
const IDENTITY_RNG: Rng = fakeRng([0]);

describe("chooseFormat — bornes de box (ENGINE §6)", () => {
  it("box=0 → QCM", () => {
    expect(chooseFormat(0)).toBe("qcm");
  });

  it("box=1 → QCM (borne haute incluse)", () => {
    expect(chooseFormat(1)).toBe("qcm");
  });

  it("box=2 → pavé (bascule)", () => {
    expect(chooseFormat(2)).toBe("pave");
  });

  it("box=5 (maxBox) → pavé", () => {
    expect(chooseFormat(5)).toBe("pave");
  });
});

describe("buildDistractors — erreurs typiques par compétence (ENGINE §6), paramétré sur les 4 skills", () => {
  // Un fait « normal » par compétence, loin des bords de domaine, pour vérifier
  // que les distracteurs typiques (pas la complétion ±1/±2) dominent le résultat.
  const sample: Record<Skill, Fact> = {
    comp10: makeFact("comp10", 3, 0), // a=3, réponse=7
    add: makeFact("add", 3, 8), // réponse=11
    sub: makeFact("sub", 15, 6), // réponse=9
    mult: makeFact("mult", 6, 8), // réponse=48
  };

  it.each(SKILLS)("%s : renvoie exactement 3 distracteurs uniques, ≥0, ≠ réponse", (skill) => {
    const fact = sample[skill];
    const distractors = buildDistractors(fact);

    expect(distractors).toHaveLength(3);
    expect(new Set(distractors).size).toBe(3); // uniques
    for (const d of distractors) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).not.toBe(fact.answer);
      expect(Number.isInteger(d)).toBe(true);
    }
  });

  it("mult 6×8 (réponse 48) : distracteurs typiques attendus (ligne voisine, confusion op, chiffres inversés)", () => {
    const distractors = buildDistractors(sample.mult);
    // a×(b+1)=54, a×(b-1)=42, a+b=14, inversion(48)=84.
    expect(distractors).toEqual(expect.arrayContaining([54, 42, 14]));
  });

  it("add 3+8 (réponse 11) : distracteurs typiques attendus (±1, ±10, confusion op)", () => {
    const distractors = buildDistractors(sample.add);
    // answer+1=12, answer-1=10, answer+10=21, answer-10=1, |a-b|=5.
    expect(distractors).toEqual(expect.arrayContaining([12, 10, 21]));
  });

  it("sub 15-6 (réponse 9) : distracteurs typiques attendus (confusion op a+b, ±1, inversion b-a filtrée car <0)", () => {
    const distractors = buildDistractors(sample.sub);
    // a+b=21, answer+1=10, answer-1=8 ; b-a=-9 rejeté (<0).
    expect(distractors).toEqual(expect.arrayContaining([21, 10, 8]));
    expect(distractors).not.toContain(-9);
  });

  it("comp10 a=3 (réponse 7) : distracteurs typiques attendus (a lui-même, ±1)", () => {
    const distractors = buildDistractors(sample.comp10);
    // candidat 'a'=3, réponse+1=8, réponse-1=6, réponse+2=9 (repli, non nécessaire ici).
    expect(distractors).toEqual(expect.arrayContaining([3, 8, 6]));
  });

  it.each(SKILLS)("%s : univers Tier 1 complet — toujours exactement 3 distracteurs valides", (skill) => {
    // Balayage exhaustif du domaine réel (pas seulement un échantillon) : garantit
    // qu'aucun fait du Tier 1 ne tombe en dessous de 3 distracteurs, y compris aux
    // bords de domaine où les candidats typiques collisionnent le plus.
    for (const fact of generateFacts(skill)) {
      const distractors = buildDistractors(fact);
      expect(distractors).toHaveLength(3);
      expect(new Set(distractors).size).toBe(3);
      expect(distractors.every((d) => d >= 0 && d !== fact.answer)).toBe(true);
    }
  });
});

describe("buildDistractors — complétion ±1/±2 quand < 3 candidats typiques valides", () => {
  it("comp10 a=5 (réponse=5) : le candidat typique 'a' collisionne avec la réponse mais 3 typiques restent valides (answer±1, answer+2)", () => {
    // a=5 → answer=10-5=5 → le distracteur typique 'a' (=5) est filtré (= réponse),
    // mais answer+1=6, answer-1=4, answer+2=7 (4e candidat typique comp10) suffisent
    // à eux seuls → pas de complétion nécessaire ici (cf. test dédié sub_5-5 pour un
    // vrai cas de complétion ±1/±2).
    const fact = makeFact("comp10", 5, 0);
    const distractors = buildDistractors(fact);
    expect(distractors).toHaveLength(3);
    expect(distractors).not.toContain(5); // le candidat 'a' était égal à la réponse
    expect(distractors).toEqual(expect.arrayContaining([6, 4, 7]));
  });

  it("sub a=b (ex. 5-5, réponse=0) : seuls 2 candidats typiques valides → complétion par +2", () => {
    // a+b=10 (valide) ; answer+1=1 (valide) ; answer-1=-1 (rejeté, <0) ;
    // b-a=0 (= réponse, rejeté) → seulement {10, 1} typiques valides (2 < 3).
    // fillWithOffsets : +1→1 (déjà pris), -1→-1 (rejeté <0), +2→2 (valide) → complète.
    const fact = makeFact("sub", 5, 5); // réponse=0
    const distractors = buildDistractors(fact);
    expect(distractors).toHaveLength(3);
    expect(distractors).toEqual(expect.arrayContaining([10, 1, 2]));
    expect(new Set([...distractors, fact.answer]).size).toBe(4);
  });

  it("sub 1-1 (réponse=0) : cas le plus serré du domaine Tier 1 — ±1/±2 insuffisants, repli ±3 nécessaire", () => {
    // a+b=2 (valide) ; answer+1=1 (valide) ; answer-1=-1 (rejeté <0) ;
    // b-a=0 (= réponse, rejeté) → {2, 1} typiques valides (2 < 3).
    // fillWithOffsets : +1→1 (pris), -1→-1 (rejeté), +2→2 (pris), -2→-2 (rejeté),
    // +3→3 (valide) → complète. Seul fait de tout le domaine Tier 1 (~330 faits,
    // vérifié par balayage exhaustif) qui atteint le repli ±3.
    const fact = makeFact("sub", 1, 1); // réponse=0
    const distractors = buildDistractors(fact);
    expect(distractors).toHaveLength(3);
    expect(distractors).toEqual(expect.arrayContaining([2, 1, 3]));
    expect(new Set([...distractors, fact.answer]).size).toBe(4);
  });

  it("comp10 a=6 (réponse=4) : candidat typique dupliqué (a=6 et answer+2=6) → dédupliqué, reste 3 valides sans passer sous 3", () => {
    const fact = makeFact("comp10", 6, 0);
    const distractors = buildDistractors(fact);
    // candidats typiques : a=6, answer+1=5, answer-1=3, answer+2=6 (doublon de 'a').
    expect(distractors).toHaveLength(3);
    expect(distractors).toEqual(expect.arrayContaining([6, 5, 3]));
  });

  it("fillWithOffsets exercé directement : fait minimal où seul 1 candidat typique est valide", () => {
    // comp10 a=9 (borne haute du domaine) : réponse=1. Candidats typiques :
    // a=9, answer+1=2, answer-1=0, answer+2=3 → tous valides (4 candidats, aucune
    // collision) donc ce n'est PAS un cas de complétion ; documenté pour mémoire de
    // balayage de bord (couvert aussi par le test exhaustif ci-dessus).
    const fact = makeFact("comp10", 9, 0);
    const distractors = buildDistractors(fact);
    expect(distractors).toHaveLength(3);
  });
});

describe("buildQuestionChoices — mélange déterministe (aléa injecté, ENGINE §6)", () => {
  const fact = makeFact("mult", 6, 8); // réponse=48

  it("contient la bonne réponse + les 3 distracteurs, taille QCM_CHOICE_COUNT", () => {
    const choices = buildQuestionChoices(fact, IDENTITY_RNG);
    expect(choices).toHaveLength(QCM_CHOICE_COUNT);
    expect(choices).toContain(fact.answer);
    expect(new Set(choices).size).toBe(QCM_CHOICE_COUNT); // unicité stricte
  });

  it("même RNG (même séquence) → même ordre à chaque appel (reproductible)", () => {
    const rngFactory = () => fakeRng([0.9, 0.1, 0.5]);
    const choicesA = buildQuestionChoices(fact, rngFactory());
    const choicesB = buildQuestionChoices(fact, rngFactory());
    expect(choicesA).toEqual(choicesB);
  });

  it("RNG différent (séquence différente) → ordre différent (le mélange dépend bien du RNG injecté)", () => {
    const choicesIdentity = buildQuestionChoices(fact, fakeRng([0, 0, 0]));
    const choicesReversed = buildQuestionChoices(fact, fakeRng([0.99, 0.99, 0.99]));
    // Le contenu (en tant que set) est identique, l'ordre diffère.
    expect(new Set(choicesIdentity)).toEqual(new Set(choicesReversed));
    expect(choicesIdentity).not.toEqual(choicesReversed);
  });

  it.each(SKILLS)("%s : le mélange ne perd ni ne duplique aucun choix (balayage exhaustif du domaine)", (skill) => {
    for (const f of generateFacts(skill)) {
      const choices = buildQuestionChoices(f, fakeRng([0.3, 0.7, 0.1, 0.9]));
      expect(choices).toHaveLength(QCM_CHOICE_COUNT);
      expect(new Set(choices).size).toBe(QCM_CHOICE_COUNT);
      expect(choices).toContain(f.answer);
    }
  });
});
