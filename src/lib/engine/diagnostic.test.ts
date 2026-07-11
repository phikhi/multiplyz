import { describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS, type EngineConfig } from "../../config/server-config";
import { SKILLS, type Skill } from "./domain";
import { factKey, generateFacts, parseFactKey } from "./facts";
import {
  ADAPTIVE_DEEPEN_COUNT,
  ADAPTIVE_PROBE_COUNT,
  adaptDiagnostic,
  PER_SKILL_TARGET,
  recalibrateMastery,
  SEED_BOX_FLUENT,
  SEED_BOX_SLOW,
  SEED_BOX_WRONG,
  seedDiagnosticMastery,
  selectDiagnostic,
  type DiagnosticItem,
  type DiagnosticResponse,
} from "./diagnostic";
import type { MasteryState } from "./mastery";

/**
 * Config moteur réelle (⚙️ défauts de 3.2) → on teste la logique contre le contrat
 * effectif, pas des constantes ad hoc. Cloné en type mutable (readonly `as const`).
 */
const CONFIG: EngineConfig = {
  ...CONFIG_DEFAULTS.engine,
  leitnerDelaysDays: [...CONFIG_DEFAULTS.engine.leitnerDelaysDays],
  fluenceThresholdsMs: { ...CONFIG_DEFAULTS.engine.fluenceThresholdsMs },
  starThresholds: [...CONFIG_DEFAULTS.engine.starThresholds] as [number, number, number],
};

/** Surcharge la config (clone mutable) pour tester le clamp / des tailles limites. */
function withConfig(overrides: Partial<EngineConfig>): EngineConfig {
  return { ...CONFIG, ...overrides };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Instant injecté déterministe (2026-07-02T00:00:00Z, epoch ms) — jamais Date.now(). */
const NOW = 1_751_414_400_000;

/** Délai (ms) attendu pour une boîte, dérivé de la config testée (barème Leitner partagé). */
function delayMs(box: number): number {
  return CONFIG.leitnerDelaysDays[box] * MS_PER_DAY;
}

/** Réponse de diagnostic (défaut : juste, fluente pour `add`). */
function response(overrides: Partial<DiagnosticResponse> = {}): DiagnosticResponse {
  return { factKey: "add_3+8", skill: "add", correct: true, responseMs: 1_500, ...overrides };
}

/** Clés des items (pour asserts de contenu). */
function keysOf(items: readonly DiagnosticItem[]): string[] {
  return items.map((item) => item.fact.key);
}

/** Items d'une compétence donnée. */
function itemsForSkill(items: readonly DiagnosticItem[], skill: Skill): DiagnosticItem[] {
  return items.filter((item) => item.fact.skill === skill);
}

// ─────────────────────────────────────────────────────────────────────────────
// selectDiagnostic — la liste ordonnée des ~18 faits (ENGINE §3)
// ─────────────────────────────────────────────────────────────────────────────

describe("selectDiagnostic — taille & répartition (ENGINE §3)", () => {
  it("pose exactement `diagnosticSize` faits (~18 au défaut)", () => {
    const items = selectDiagnostic(CONFIG);
    // Assertion de contenu exact : le total est piloté par la config ⚙️ (18), pas ~.
    expect(items).toHaveLength(CONFIG.diagnosticSize);
    expect(CONFIG.diagnosticSize).toBe(18); // épingle le défaut spec-littéral
  });

  it("répartit ~4–5 par compétence, chaque compétence présente", () => {
    const items = selectDiagnostic(CONFIG);
    for (const skill of SKILLS) {
      const count = itemsForSkill(items, skill).length;
      // « ~4–5 » : jamais moins de 4, jamais plus de 5 au défaut (18 réparti sur 4).
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(5);
    }
  });

  it("répartition exacte au défaut : [5, 5, 4, 4] (comp10, add = 5 ; sub, mult = 4)", () => {
    // Contenu exact de la répartition : le reste (18 − 16 = 2) va aux 2 premières
    // compétences (ordre canonique). Un mutant du sens de distribution casse ici.
    const items = selectDiagnostic(CONFIG);
    expect(itemsForSkill(items, "comp10")).toHaveLength(5);
    expect(itemsForSkill(items, "add")).toHaveLength(5);
    expect(itemsForSkill(items, "sub")).toHaveLength(4);
    expect(itemsForSkill(items, "mult")).toHaveLength(4);
  });

  it("est déterministe (mêmes entrées → même liste)", () => {
    expect(keysOf(selectDiagnostic(CONFIG))).toEqual(keysOf(selectDiagnostic(CONFIG)));
  });
});

describe("selectDiagnostic — faits valides du domaine Tier 1 (réutilise facts.ts)", () => {
  it("chaque fait posé est un fait Tier 1 valide (round-trip via parseFactKey)", () => {
    // Preuve de réutilisation du domaine canonique : toute clé posée est ré-acceptée par
    // parseFactKey (bijectif + bornes Tier 1). Un fait inventé hors-domaine échouerait.
    for (const item of selectDiagnostic(CONFIG)) {
      expect(parseFactKey(item.fact.key)).not.toBeNull();
    }
  });

  it("chaque fait posé appartient à l'univers `generateFacts` de sa compétence", () => {
    for (const skill of SKILLS) {
      const universe = new Set(generateFacts(skill).map((f) => f.key));
      for (const item of itemsForSkill(selectDiagnostic(CONFIG), skill)) {
        expect(universe.has(item.fact.key)).toBe(true);
      }
    }
    // Aucun doublon de clé dans tout le diagnostic.
    const allKeys = keysOf(selectDiagnostic(CONFIG));
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});

describe("selectDiagnostic — représentatif des 3 niveaux de difficulté (ENGINE §3)", () => {
  // Paramétré sur TOUTES les compétences (LEARNINGS #59 : logique indexée par clé de
  // domaine → tester chaque clé, pas seulement `add`).
  it.each(SKILLS)("%s couvre les 3 niveaux facile/moyen/difficile", (skill) => {
    const difficulties = new Set(
      itemsForSkill(selectDiagnostic(CONFIG), skill).map((i) => i.difficulty),
    );
    expect(difficulties.has("easy")).toBe(true);
    expect(difficulties.has("medium")).toBe(true);
    expect(difficulties.has("hard")).toBe(true);
  });

  it.each(SKILLS)("%s est ordonné facile → moyen → difficile (ordre de pose)", (skill) => {
    const rank = { easy: 0, medium: 1, hard: 2 };
    const seq = itemsForSkill(selectDiagnostic(CONFIG), skill).map((i) => rank[i.difficulty]);
    // La séquence des rangs de difficulté est non décroissante (facile d'abord, §3).
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
  });

  it("contenu exact des faits posés au défaut (ancre anti-régression de sélection)", () => {
    // Assertion de CONTENU EXACT (LEARNINGS #73 : module génératif → contenu, pas forme).
    // Ces clés sont issues du proxy de difficulté + prise centrale par tier ; un mutant
    // du score, des bornes de tercile ou de l'ordre central change cette liste.
    expect(keysOf(selectDiagnostic(CONFIG))).toEqual([
      "comp10_4",
      "comp10_6",
      "comp10_2",
      "comp10_7",
      "comp10_1",
      "add_1+6",
      "add_2+5",
      "add_2+9",
      "add_3+8",
      "add_6+9",
      "sub_8-8",
      "sub_9-1",
      "sub_15-1",
      "sub_19-5",
      "mult_1x8",
      "mult_2x4",
      "mult_4x6",
      "mult_7x8",
    ]);
  });
});

describe("selectDiagnostic — clamp de `diagnosticSize` (config brute, LEARNINGS #58)", () => {
  it("taille incohérente basse (0) → clampée à ≥ 1 par compétence (4 faits)", () => {
    // La logique consommatrice ne suppose jamais la config cohérente : `diagnosticSize=0`
    // ne doit pas produire un diagnostic vide (min = nb compétences).
    const items = selectDiagnostic(withConfig({ diagnosticSize: 0 }));
    expect(items).toHaveLength(SKILLS.length); // 1 par compétence
    for (const skill of SKILLS) {
      expect(itemsForSkill(items, skill)).toHaveLength(1);
    }
  });

  it("taille incohérente haute (999) → clampée à (target+1) par compétence", () => {
    // Plafond : jamais plus de PER_SKILL_TARGET+1 (garde le « ~4–5 »).
    const items = selectDiagnostic(withConfig({ diagnosticSize: 999 }));
    expect(items).toHaveLength((PER_SKILL_TARGET + 1) * SKILLS.length); // 5×4 = 20
    for (const skill of SKILLS) {
      expect(itemsForSkill(items, skill)).toHaveLength(PER_SKILL_TARGET + 1);
    }
  });

  it("taille = 16 (4×4) → exactement 4 par compétence, aucun reste distribué", () => {
    // Borne : quand size est un multiple exact, le reste est 0 → répartition uniforme.
    // Tue un mutant qui distribuerait un reste fantôme.
    const items = selectDiagnostic(withConfig({ diagnosticSize: 16 }));
    for (const skill of SKILLS) {
      expect(itemsForSkill(items, skill)).toHaveLength(PER_SKILL_TARGET);
    }
  });

  it("taille = 17 → reste 1 distribué à la SEULE 1ʳᵉ compétence (comp10)", () => {
    // Borne du remainder : 17 − 16 = 1 → comp10 passe à 5, les autres restent à 4.
    // Tue un mutant `remainder <= 0` → `< 0` (qui sur-distribuerait) et vérifie l'ordre.
    const items = selectDiagnostic(withConfig({ diagnosticSize: 17 }));
    expect(itemsForSkill(items, "comp10")).toHaveLength(5);
    expect(itemsForSkill(items, "add")).toHaveLength(4);
    expect(itemsForSkill(items, "sub")).toHaveLength(4);
    expect(itemsForSkill(items, "mult")).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// adaptDiagnostic — adaptatif léger (ENGINE §3)
// ─────────────────────────────────────────────────────────────────────────────

/** Réponses « tous ratés » aux N premiers items d'une compétence. */
function allWrongFirst(
  items: readonly DiagnosticItem[],
  skill: Skill,
  n: number,
): DiagnosticResponse[] {
  return itemsForSkill(items, skill)
    .slice(0, n)
    .map((item) => ({ factKey: item.fact.key, skill, correct: false, responseMs: 5_000 }));
}

/** Réponses « tous justes + rapides » aux N premiers items d'une compétence. */
function allFluentFirst(
  items: readonly DiagnosticItem[],
  skill: Skill,
  n: number,
): DiagnosticResponse[] {
  return itemsForSkill(items, skill)
    .slice(0, n)
    .map((item) => ({ factKey: item.fact.key, skill, correct: true, responseMs: 1_000 }));
}

describe("adaptDiagnostic — ne pas enfoncer si premiers tous ratés (ENGINE §3)", () => {
  it.each(SKILLS)("%s : premiers tous ratés → retire les faits DURS non répondus", (skill) => {
    const base = selectDiagnostic(CONFIG);
    const wrong = allWrongFirst(base, skill, ADAPTIVE_PROBE_COUNT);
    const adapted = itemsForSkill(adaptDiagnostic(base, wrong, CONFIG), skill);

    // EFFET OBSERVABLE (LEARNINGS #75/#60) : plus AUCUN fait `hard` non répondu ne reste.
    const answered = new Set(wrong.map((r) => r.factKey));
    const remainingHardUnanswered = adapted.filter(
      (item) => item.difficulty === "hard" && !answered.has(item.fact.key),
    );
    expect(remainingHardUnanswered).toHaveLength(0);
    // Et le plan a bien RÉTRÉCI par rapport à la base (la garde a un effet).
    expect(adapted.length).toBeLessThan(itemsForSkill(base, skill).length);
  });

  it("un fait DUR déjà RÉPONDU (raté) n'est PAS retiré (on ne re-teste pas dans le vide)", () => {
    // Le filtre garde `difficulty !== hard || byKey.has(key)` : un hard déjà répondu reste.
    const base = selectDiagnostic(CONFIG);
    const skill: Skill = "comp10";
    const skillItems = itemsForSkill(base, skill);
    const hard = skillItems.find((i) => i.difficulty === "hard")!;
    // Premiers ratés + le hard aussi répondu (raté).
    const responses: DiagnosticResponse[] = [
      ...allWrongFirst(base, skill, ADAPTIVE_PROBE_COUNT),
      { factKey: hard.fact.key, skill, correct: false, responseMs: 5_000 },
    ];
    const adapted = itemsForSkill(adaptDiagnostic(base, responses, CONFIG), skill);
    expect(keysOf(adapted)).toContain(hard.fact.key);
  });
});

describe("adaptDiagnostic — sonder plus dur si premiers tous fluents (ENGINE §3)", () => {
  it.each(SKILLS)(
    "%s : premiers tous justes+rapides → ajoute ADAPTIVE_DEEPEN_COUNT faits durs",
    (skill) => {
      const base = selectDiagnostic(CONFIG);
      const fluent = allFluentFirst(base, skill, ADAPTIVE_PROBE_COUNT);
      const adaptedAll = adaptDiagnostic(base, fluent, CONFIG);
      const adapted = itemsForSkill(adaptedAll, skill);

      // EFFET OBSERVABLE : le plan a grossi d'exactement ADAPTIVE_DEEPEN_COUNT.
      expect(adapted.length).toBe(itemsForSkill(base, skill).length + ADAPTIVE_DEEPEN_COUNT);
      // Les faits ajoutés sont des `hard`, valides Tier 1, non déjà présents dans la base.
      const baseKeys = new Set(keysOf(itemsForSkill(base, skill)));
      const added = adapted.filter((item) => !baseKeys.has(item.fact.key));
      expect(added).toHaveLength(ADAPTIVE_DEEPEN_COUNT);
      for (const item of added) {
        expect(item.difficulty).toBe("hard");
        expect(parseFactKey(item.fact.key)).not.toBeNull();
      }
    },
  );

  it("sonde le fait le PLUS dur disponible (mult all-fluent → ajoute mult_10x10, produit 100)", () => {
    // Contenu EXACT de la sonde (LEARNINGS #73) : `deeperProbes` trie par score
    // DÉCROISSANT → le plafond (10×10) d'abord. Un mutant `sb - sa` → `sa - sb` casse ici.
    const base = selectDiagnostic(CONFIG);
    const fluent = allFluentFirst(base, "mult", ADAPTIVE_PROBE_COUNT);
    const adapted = itemsForSkill(adaptDiagnostic(base, fluent, CONFIG), "mult");
    const baseKeys = new Set(keysOf(itemsForSkill(base, "mult")));
    const added = adapted.filter((item) => !baseKeys.has(item.fact.key));
    expect(keysOf(added)).toEqual(["mult_10x10"]);
  });

  it("ne redonne pas un fait dur déjà présent dans le plan (dédoublonné)", () => {
    // Si tous les faits durs sont déjà dans le plan, aucun ajout (candidats vides).
    // Compétence à petit univers dur → on force en donnant un plan qui contient déjà
    // tout `hard` de comp10 : la sonde ne peut rien ajouter d'unique.
    const hardComp10 = generateFacts("comp10")
      .map((f) => ({ fact: f, difficulty: "hard" as const }))
      .slice(0, 3);
    const items: DiagnosticItem[] = [
      ...hardComp10,
      // 2 premiers pour déclencher l'adaptatif fluent :
    ];
    const fluent = items.slice(0, ADAPTIVE_PROBE_COUNT).map((i) => ({
      factKey: i.fact.key,
      skill: "comp10" as const,
      correct: true,
      responseMs: 900,
    }));
    const adapted = itemsForSkill(adaptDiagnostic(items, fluent, CONFIG), "comp10");
    // Toutes les clés restent uniques (aucun doublon injecté par la sonde).
    expect(new Set(keysOf(adapted)).size).toBe(adapted.length);
  });
});

describe("adaptDiagnostic — cas neutres (ENGINE §3)", () => {
  it("échantillon insuffisant (< ADAPTIVE_PROBE_COUNT réponses) → plan inchangé", () => {
    const base = selectDiagnostic(CONFIG);
    // Une seule réponse sur comp10 (< 2) → aucun ajustement de cette compétence.
    const partial = allWrongFirst(base, "comp10", ADAPTIVE_PROBE_COUNT - 1);
    const adapted = adaptDiagnostic(base, partial, CONFIG);
    expect(keysOf(itemsForSkill(adapted, "comp10"))).toEqual(keysOf(itemsForSkill(base, "comp10")));
  });

  it("premiers MIXTES (ni tous ratés ni tous fluents) → plan inchangé", () => {
    // 1 juste-lent + 1 faux → allWrong faux ET allFluent faux → branche `else`.
    const base = selectDiagnostic(CONFIG);
    const skillItems = itemsForSkill(base, "add");
    const mixed: DiagnosticResponse[] = [
      { factKey: skillItems[0].fact.key, skill: "add", correct: true, responseMs: 9_000 }, // lent
      { factKey: skillItems[1].fact.key, skill: "add", correct: false, responseMs: 2_000 }, // faux
    ];
    const adapted = adaptDiagnostic(base, mixed, CONFIG);
    expect(keysOf(itemsForSkill(adapted, "add"))).toEqual(keysOf(skillItems));
  });

  it("aucune réponse → plan strictement inchangé (identité)", () => {
    const base = selectDiagnostic(CONFIG);
    expect(keysOf(adaptDiagnostic(base, [], CONFIG))).toEqual(keysOf(base));
  });

  it("premiers tous justes mais LENTS → PAS de sonde (fluent requis, pas juste seul)", () => {
    // Garde-fou : le deepen exige `isFluent` (rapide), pas seulement `correct`. Deux
    // justes LENTS ne déclenchent pas la sonde → tue un mutant `allFluent` → `allCorrect`.
    const base = selectDiagnostic(CONFIG);
    const skill: Skill = "sub"; // seuil fluence 4 s
    const slow: DiagnosticResponse[] = itemsForSkill(base, skill)
      .slice(0, ADAPTIVE_PROBE_COUNT)
      .map((i) => ({ factKey: i.fact.key, skill, correct: true, responseMs: 9_000 }));
    const adapted = itemsForSkill(adaptDiagnostic(base, slow, CONFIG), skill);
    expect(adapted.length).toBe(itemsForSkill(base, skill).length); // aucun ajout
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// seedDiagnosticMastery — amorçage des boîtes (ENGINE §3)
// ─────────────────────────────────────────────────────────────────────────────

describe("seedDiagnosticMastery — amorçage par palier (ENGINE §3)", () => {
  it("juste + rapide → box 3, next_due = now + délai(box 3)", () => {
    const [row] = seedDiagnosticMastery(
      [response({ correct: true, responseMs: 1_500 })],
      CONFIG,
      NOW,
    );
    expect(row.state.box).toBe(SEED_BOX_FLUENT);
    expect(SEED_BOX_FLUENT).toBe(3); // épingle le palier spec-littéral
    expect(row.state.nextDue).toBe(NOW + delayMs(3));
    expect(row.state.correctCount).toBe(1);
    expect(row.state.wrongCount).toBe(0);
    expect(row.state.avgResponseMs).toBe(1_500);
    expect(row.state.lastSeen).toBe(NOW);
  });

  it("juste mais lent → box 2, next_due = now + délai(box 2)", () => {
    // response_ms > seuil fluence add (3 s) → lent.
    const [row] = seedDiagnosticMastery(
      [response({ correct: true, responseMs: 5_000 })],
      CONFIG,
      NOW,
    );
    expect(row.state.box).toBe(SEED_BOX_SLOW);
    expect(SEED_BOX_SLOW).toBe(2);
    expect(row.state.nextDue).toBe(NOW + delayMs(2));
    expect(row.state.correctCount).toBe(1);
  });

  it("faux → box 0, next_due = now + délai(box 0), compteur faux", () => {
    const [row] = seedDiagnosticMastery(
      [response({ correct: false, responseMs: 2_000 })],
      CONFIG,
      NOW,
    );
    expect(row.state.box).toBe(SEED_BOX_WRONG);
    expect(SEED_BOX_WRONG).toBe(0);
    expect(row.state.nextDue).toBe(NOW + delayMs(0)); // box 0 = même session (0 j)
    expect(row.state.correctCount).toBe(0);
    expect(row.state.wrongCount).toBe(1);
  });

  it("anti-mash : juste TRÈS rapide (< antiMashMs) → box 2, PAS box 3 (ENGINE §9)", () => {
    // EFFET OBSERVABLE : une réponse < 600 ms juste n'est pas « fluente » → box 2, jamais 3.
    // Tue un mutant qui ignorerait l'anti-mash (donnerait box 3). Réutilise isFluent.
    const [row] = seedDiagnosticMastery(
      [response({ correct: true, responseMs: CONFIG.antiMashMs - 1 })],
      CONFIG,
      NOW,
    );
    expect(row.state.box).toBe(SEED_BOX_SLOW); // box 2, pas 3
  });

  it("réponse pile au seuil de fluence → box 3 (borne ≤ incluse)", () => {
    // Borne du classement fluent (≤). Tue un mutant `<=` → `<`.
    const [row] = seedDiagnosticMastery(
      [response({ skill: "add", correct: true, responseMs: CONFIG.fluenceThresholdsMs.add })],
      CONFIG,
      NOW,
    );
    expect(row.state.box).toBe(SEED_BOX_FLUENT);
  });

  it("réponse pile au seuil anti-mash → box 3 (borne ≥ incluse, fluente)", () => {
    // Borne basse de la fenêtre fluente (≥ antiMashMs). Tue un mutant `>=` → `>`.
    const [row] = seedDiagnosticMastery(
      [response({ correct: true, responseMs: CONFIG.antiMashMs })],
      CONFIG,
      NOW,
    );
    expect(row.state.box).toBe(SEED_BOX_FLUENT);
  });
});

describe("seedDiagnosticMastery — seuil de fluence PAR compétence (LEARNINGS #59)", () => {
  // Paramétré sur TOUTES les compétences : le seuil de fluence dépend de `skill`
  // (comp10/add 3 s ; sub/mult 4 s). Une régression de clé passerait le 100 % coverage.
  const SLOW_SKILLS: readonly Skill[] = ["sub", "mult"]; // seuil 4 s
  const FAST_SKILLS: readonly Skill[] = ["comp10", "add"]; // seuil 3 s
  const BETWEEN_MS = 3_500; // 3 s < 3,5 s < 4 s

  it.each(SLOW_SKILLS)("%s (seuil 4 s) : 3,5 s est rapide → box 3", (skill) => {
    expect(CONFIG.fluenceThresholdsMs[skill]).toBe(4_000);
    const [row] = seedDiagnosticMastery(
      [{ factKey: sampleKey(skill), skill, correct: true, responseMs: BETWEEN_MS }],
      CONFIG,
      NOW,
    );
    expect(row.state.box).toBe(SEED_BOX_FLUENT);
  });

  it.each(FAST_SKILLS)("%s (seuil 3 s) : la même 3,5 s est lente → box 2", (skill) => {
    expect(CONFIG.fluenceThresholdsMs[skill]).toBe(3_000);
    const [row] = seedDiagnosticMastery(
      [{ factKey: sampleKey(skill), skill, correct: true, responseMs: BETWEEN_MS }],
      CONFIG,
      NOW,
    );
    expect(row.state.box).toBe(SEED_BOX_SLOW);
  });
});

describe("seedDiagnosticMastery — non testé & dédoublonnage (ENGINE §3)", () => {
  it("aucune réponse → aucune ligne (fait non testé = « nouveau », pas de ligne)", () => {
    expect(seedDiagnosticMastery([], CONFIG, NOW)).toEqual([]);
  });

  it("une ligne PAR fait testé, dans l'ordre de 1ʳᵉ apparition", () => {
    const rows = seedDiagnosticMastery(
      [
        response({ factKey: "mult_6x8", skill: "mult", correct: true, responseMs: 1_000 }),
        response({ factKey: "add_3+8", skill: "add", correct: false, responseMs: 2_000 }),
      ],
      CONFIG,
      NOW,
    );
    expect(rows.map((r) => r.factKey)).toEqual(["mult_6x8", "add_3+8"]);
  });

  it("clé répondue deux fois → une seule ligne, la DERNIÈRE réponse gagne", () => {
    // EFFET OBSERVABLE du dédoublonnage : 1ʳᵉ réponse fausse puis 2ᵉ juste+rapide → box 3.
    // Tue un mutant qui garderait la 1ʳᵉ réponse (donnerait box 0).
    const rows = seedDiagnosticMastery(
      [
        response({ factKey: "add_3+8", skill: "add", correct: false, responseMs: 2_000 }),
        response({ factKey: "add_3+8", skill: "add", correct: true, responseMs: 1_200 }),
      ],
      CONFIG,
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].state.box).toBe(SEED_BOX_FLUENT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recalibrateMastery — fusion MONOTONE (max-merge) du re-diagnostic (ADR 0016, #237 Option A)
// ─────────────────────────────────────────────────────────────────────────────

/** État de maîtrise courant de test (compteurs/fluence non triviaux → détecte toute pollution). */
function masteryState(overrides: Partial<MasteryState> = {}): MasteryState {
  return {
    box: 1,
    correctCount: 2,
    wrongCount: 1,
    avgResponseMs: 1_800,
    lastSeen: NOW - MS_PER_DAY,
    nextDue: NOW - 1,
    ...overrides,
  };
}

describe("recalibrateMastery — CREATE (fait jamais amorcé, ADR 0016)", () => {
  it("current null + réponse juste+rapide → ligne CRÉÉE, IDENTIQUE à l'amorçage initial (parité seedMasteryRow)", () => {
    const resp = response(); // add fluent → box 3
    const [row, ...rest] = recalibrateMastery([{ response: resp, current: null }], CONFIG, NOW);
    expect(rest).toHaveLength(0);
    expect(row.action).toBe("create");
    // Parité EXACTE avec le diagnostic initial : la création réutilise `seedMasteryRow`.
    const [seeded] = seedDiagnosticMastery([resp], CONFIG, NOW);
    expect(row.state).toEqual(seeded.state);
  });

  it("current null + réponse fausse → ligne CRÉÉE en box 0 (compteur faux = 1)", () => {
    const [row] = recalibrateMastery(
      [{ response: response({ correct: false }), current: null }],
      CONFIG,
      NOW,
    );
    expect(row.state.box).toBe(SEED_BOX_WRONG);
    expect(row.state.wrongCount).toBe(1);
    expect(row.state.correctCount).toBe(0);
  });
});

describe("recalibrateMastery — RAISE (relève un fait sous-amorcé, ADR 0016)", () => {
  it("box 1 + réponse juste+rapide (box 3) → RELÈVE à 3, échéance recalculée, dernière-vue rafraîchie, COMPTEURS & fluence INCHANGÉS", () => {
    const current = masteryState({
      box: 1,
      correctCount: 2,
      wrongCount: 1,
      avgResponseMs: 1_800,
      lastSeen: NOW - MS_PER_DAY,
      nextDue: NOW - 1,
    });
    const [row, ...rest] = recalibrateMastery([{ response: response(), current }], CONFIG, NOW);
    expect(rest).toHaveLength(0);
    expect(row.action).toBe("raise");
    expect(row.factKey).toBe("add_3+8");
    expect(row.state.box).toBe(SEED_BOX_FLUENT); // 3
    expect(row.state.nextDue).toBe(NOW + delayMs(SEED_BOX_FLUENT)); // échéance recalculée sur la boîte relevée
    expect(row.state.lastSeen).toBe(NOW);
    // La sonde de calibrage ne DOIT PAS polluer la justesse/rapidité rapportées (agrégats parent
    // dérivent d'`attempts`, ADR 0012/0014) : compteurs + moyenne de fluence STRICTEMENT préservés.
    expect(row.state.correctCount).toBe(2);
    expect(row.state.wrongCount).toBe(1);
    expect(row.state.avgResponseMs).toBe(1_800);
  });

  it("box 0 + réponse juste-mais-LENTE (box 2) → relève à box 2 seulement (pas 3)", () => {
    const current = masteryState({ box: 0 });
    // add lent = responseMs > seuil fluence add (3000) → SEED_BOX_SLOW.
    const [row] = recalibrateMastery(
      [{ response: response({ responseMs: 3_500 }), current }],
      CONFIG,
      NOW,
    );
    expect(row.action).toBe("raise");
    expect(row.state.box).toBe(SEED_BOX_SLOW); // 2
  });
});

describe("recalibrateMastery — GARDE MONOTONE (jamais de régression, invariant ENGINE §2)", () => {
  it("boîte courante > sondée → AUCUNE écriture (jamais rétrograde) — mutation `seed > box` → rouge", () => {
    // box courant 4 ; réponse juste+rapide sonde box 3 < 4 → « keep », le fait est ABSENT de la sortie.
    // Un mutant qui relèverait/écraserait inconditionnellement produirait une ligne box 3 (RÉGRESSION).
    const current = masteryState({ box: 4 });
    expect(recalibrateMastery([{ response: response(), current }], CONFIG, NOW)).toEqual([]);
  });

  it("boîte courante = sondée → AUCUNE écriture (spacing préservé) — mutation `>`→`>=` → rouge", () => {
    // box courant 3 = box sondée (fluent) → « keep » : ne PAS ré-écrire (perturberait next_due/last_seen).
    const current = masteryState({ box: SEED_BOX_FLUENT });
    expect(recalibrateMastery([{ response: response(), current }], CONFIG, NOW)).toEqual([]);
  });

  it("réponse FAUSSE (box 0) sur un fait box 2 → AUCUNE écriture (0 ≤ 2, jamais rétrograde)", () => {
    // La correction VERS LE BAS (enfant surestimé) reste gérée par le rétrograde Leitner normal
    // pendant le jeu (−demoteBoxes sur faux, PRODUCT :108) — JAMAIS par le recalibrage (ADR 0016).
    const current = masteryState({ box: 2 });
    expect(
      recalibrateMastery([{ response: response({ correct: false }), current }], CONFIG, NOW),
    ).toEqual([]);
  });
});

describe("recalibrateMastery — mélange & dédoublonnage (ADR 0016)", () => {
  it("relève les sous-amorcés, crée les neufs, OMET les « keep » (boîte ≥ sondée)", () => {
    const upserts = recalibrateMastery(
      [
        {
          response: response({ factKey: "add_3+8", skill: "add" }),
          current: masteryState({ box: 1 }),
        }, // raise 1→3
        {
          response: response({ factKey: "add_2+9", skill: "add" }),
          current: masteryState({ box: 5 }),
        }, // keep (5 ≥ 3)
        {
          response: response({ factKey: "mult_6x8", skill: "mult", responseMs: 1_200 }),
          current: null,
        }, // create (mult fluent → box 3)
      ],
      CONFIG,
      NOW,
    );
    const byKey = new Map(upserts.map((u) => [u.factKey, u.action]));
    expect(byKey.get("add_3+8")).toBe("raise");
    expect(byKey.has("add_2+9")).toBe(false); // « keep » → ABSENT de la sortie (aucune écriture)
    expect(byKey.get("mult_6x8")).toBe("create");
    expect(upserts).toHaveLength(2);
  });

  it("dédoublonne par clé : la DERNIÈRE réponse d'un fait gagne (comme seedDiagnosticMastery)", () => {
    const upserts = recalibrateMastery(
      [
        { response: response({ correct: false }), current: null }, // box 0
        { response: response({ correct: true, responseMs: 1_200 }), current: null }, // fluent box 3
      ],
      CONFIG,
      NOW,
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0].state.box).toBe(SEED_BOX_FLUENT);
  });

  it("aucune entrée → aucune écriture (no-op)", () => {
    expect(recalibrateMastery([], CONFIG, NOW)).toEqual([]);
  });
});

describe("seedDiagnosticMastery — bout-à-bout avec selectDiagnostic (ENGINE §3)", () => {
  it("amorce une ligne par item posé, toutes clés Tier 1 valides", () => {
    const items = selectDiagnostic(CONFIG);
    const responses: DiagnosticResponse[] = items.map((item, i) => ({
      factKey: item.fact.key,
      skill: item.fact.skill,
      correct: i % 2 === 0, // alterne juste/faux
      responseMs: 1_500,
    }));
    const rows = seedDiagnosticMastery(responses, CONFIG, NOW);
    expect(rows).toHaveLength(items.length);
    for (const row of rows) {
      expect(parseFactKey(row.factKey)).not.toBeNull();
      // Boîte amorcée ∈ {0, 2, 3} (jamais autre chose).
      expect([SEED_BOX_WRONG, SEED_BOX_SLOW, SEED_BOX_FLUENT]).toContain(row.state.box);
    }
  });
});

/**
 * Une clé de fait **valide** représentative d'une compétence (pour tester le seuil de
 * fluence par compétence sans dépendre de l'ordre de sélection). Prend le 1ᵉʳ fait de
 * l'univers canonique → toujours Tier 1 valide.
 */
function sampleKey(skill: Skill): string {
  const first = generateFacts(skill)[0];
  return factKey(first.skill, first.operands[0], first.operands[1] ?? 0);
}
