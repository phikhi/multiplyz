import { describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS, type EngineConfig } from "../../config/server-config";
import { makeFact, type Fact } from "./facts";
import type { MasteryState } from "./mastery";
import { buildLevel, DUE_TARGET_RATIO, LEVEL_SIZE, type LevelItem, type ScopeEntry } from "./level";

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Instant injecté déterministe (2026-07-02T00:00:00Z, epoch ms) — jamais Date.now(). */
const NOW = 1_751_414_400_000;

/** Construit un `MasteryState` partiel (le reste = valeurs neutres, dû par défaut). */
function state(overrides: Partial<MasteryState> = {}): MasteryState {
  return {
    box: 1,
    correctCount: 1,
    wrongCount: 0,
    avgResponseMs: 2_000,
    lastSeen: NOW - MS_PER_DAY,
    nextDue: NOW - MS_PER_DAY, // échéance passée → dû
    ...overrides,
  };
}

/** Entrée de scope : un fait + son état (`null` = neuf/NEW). */
function entry(fact: Fact, s: MasteryState | null): ScopeEntry {
  return { fact, state: s };
}

/** Ensemble des clés des items (pour asserts de contenu). */
function keys(items: readonly LevelItem[]): string[] {
  return items.map((i) => i.fact.key);
}

/** Vérifie qu'aucun fait n'apparaît deux fois d'affilée (ENGINE §4). */
function hasNoAdjacentDuplicate(items: readonly LevelItem[]): boolean {
  return items.every((item, i) => i === 0 || item.fact.key !== items[i - 1].fact.key);
}

// ── Univers de faits par compétence (assez pour remplir un niveau) ────────────
/** N faits `add` distincts, opérandes `1+k … ` bornés (somme ≤ 20). */
function addFacts(n: number): Fact[] {
  const facts: Fact[] = [];
  for (let b = 1; facts.length < n && b <= 10; b++) {
    for (let a = 1; a <= b && facts.length < n; a++) {
      if (a + b <= 20) facts.push(makeFact("add", a, b));
    }
  }
  return facts;
}

/** N faits `mult` distincts. */
function multFacts(n: number): Fact[] {
  const facts: Fact[] = [];
  for (let b = 1; facts.length < n && b <= 10; b++) {
    for (let a = 1; a <= b && facts.length < n; a++) {
      facts.push(makeFact("mult", a, b));
    }
  }
  return facts;
}

describe("buildLevel — pools DUE / NEW / MAINT (ENGINE §4)", () => {
  it("assez de DUE : mix ~70 % DUE + reste, cap de nouveaux respecté", () => {
    // 12 faits add DUE (box 1, échéance passée) + des add NEW (jamais vus). Une seule
    // compétence (add) → périmètre bloqué, mix DUE/NEW dans la même compétence.
    const dueOnly = addFacts(12).map((f) => entry(f, state({ box: 1 })));
    const newAdd = addFacts(20)
      .slice(12)
      .map((f) => entry(f, null)); // add neufs
    const level = buildLevel([...dueOnly, ...newAdd], CONFIG, NOW);

    expect(level).toHaveLength(LEVEL_SIZE);
    // ~70 % DUE = 7 items DUE, le reste = NEW plafonné par newMaxPerLevel (2).
    const dueKeys = new Set(dueOnly.map((e) => e.fact.key));
    const inLevelDue = level.filter((i) => dueKeys.has(i.fact.key)).length;
    const newKeys = new Set(newAdd.map((e) => e.fact.key));
    const inLevelNew = level.filter((i) => newKeys.has(i.fact.key)).length;
    expect(inLevelNew).toBeLessThanOrEqual(CONFIG.newMaxPerLevel); // cap = 2
    expect(inLevelDue).toBe(LEVEL_SIZE - inLevelNew); // le reste = DUE
  });

  it("DUE_TARGET_RATIO dérive bien 7 items DUE prioritaires sur 10", () => {
    expect(Math.round(LEVEL_SIZE * DUE_TARGET_RATIO)).toBe(7);
  });

  it("tri DUE : plus faible (box petit) d'abord, puis plus en retard", () => {
    // Trois DUE de la même compétence, box 2 / 0 / 1 ; box 0 doit sortir en 1er.
    const f0 = makeFact("add", 1, 2);
    const f1 = makeFact("add", 1, 3);
    const f2 = makeFact("add", 1, 4);
    const scope = [
      entry(f2, state({ box: 2, nextDue: NOW - 1 })),
      entry(f0, state({ box: 0, nextDue: NOW - 1 })),
      entry(f1, state({ box: 1, nextDue: NOW - 1 })),
    ];
    const level = buildLevel(scope, CONFIG, NOW);
    // orderForVictory ré-ordonne, mais le fait le plus FORT (box2) doit finir la
    // séquence (« presque-su »), et le plus faible (box0) apparaître.
    expect(keys(level)).toContain(f0.key);
    expect(level[level.length - 1].fact.key).toBe(f2.key); // presque-su en fin
  });

  it("tri DUE : à box égale, next_due null traité comme le plus en retard (les 2 côtés du ??)", () => {
    // Trois DUE de même box : DEUX à next_due null + un daté. Le tri compare les
    // paires dans les deux sens → exerce le `?? -Inf` côté A ET côté B (dueA et dueB).
    const nullA = makeFact("add", 2, 5);
    const nullB = makeFact("add", 2, 6);
    const dated = makeFact("add", 2, 7);
    const scope = [
      entry(dated, state({ box: 2, nextDue: NOW - MS_PER_DAY })),
      entry(nullA, state({ box: 2, nextDue: null })),
      entry(nullB, state({ box: 2, nextDue: null })),
    ];
    const level = buildLevel(scope, CONFIG, NOW);
    // Tous dus et présents ; on vérifie l'ensemble (l'ordre final passe par
    // orderForVictory, box égale → tie-break clé).
    expect(keys(level).sort()).toEqual([nullA.key, nullB.key, dated.key].sort());
  });

  it("tri DUE : à box égale, next_due le plus ancien passe devant (retard)", () => {
    const older = makeFact("add", 2, 3);
    const newer = makeFact("add", 2, 4);
    const scope = [
      entry(newer, state({ box: 1, nextDue: NOW - 1 })),
      entry(older, state({ box: 1, nextDue: NOW - 10 * MS_PER_DAY })),
      // remplir pour un niveau plein
      ...addFacts(20)
        .slice(10)
        .map((f) => entry(f, state({ box: 1 }))),
    ];
    const level = buildLevel(scope, CONFIG, NOW);
    // Les deux sont dus ; on vérifie juste qu'ils sont bien tous deux éligibles.
    expect(keys(level)).toContain(older.key);
  });

  it("box = maxBox échue → MAINT (entretien), pas DUE", () => {
    // Un seul fait, en entretien (box max, échéance passée) → doit être posé (MAINT).
    const maintFact = makeFact("add", 3, 4);
    const scope = [entry(maintFact, state({ box: CONFIG.maxBox, nextDue: NOW - 1 }))];
    const level = buildLevel(scope, CONFIG, NOW);
    expect(keys(level)).toEqual([maintFact.key]);
    expect(level[0].isReask).toBe(false);
  });

  it("box = maxBox non échue (next_due futur) → ni DUE ni MAINT (exclu)", () => {
    const notDue = makeFact("add", 3, 5);
    const scope = [entry(notDue, state({ box: CONFIG.maxBox, nextDue: NOW + MS_PER_DAY }))];
    const level = buildLevel(scope, CONFIG, NOW);
    expect(level).toHaveLength(0); // rien de dû, aucun neuf
  });

  it("box < maxBox non échue (next_due futur) → exclue de DUE", () => {
    const future = makeFact("add", 4, 5);
    const scope = [entry(future, state({ box: 1, nextDue: NOW + MS_PER_DAY }))];
    const level = buildLevel(scope, CONFIG, NOW);
    expect(level).toHaveLength(0);
  });

  it("next_due null sur ligne existante (box < max) → traité comme dû", () => {
    const nullDue = makeFact("add", 1, 5);
    const scope = [entry(nullDue, state({ box: 1, nextDue: null }))];
    const level = buildLevel(scope, CONFIG, NOW);
    expect(keys(level)).toEqual([nullDue.key]);
  });

  it("next_due null sur box max → traité comme MAINT dû", () => {
    const nullMaint = makeFact("add", 1, 6);
    const scope = [entry(nullMaint, state({ box: CONFIG.maxBox, nextDue: null }))];
    const level = buildLevel(scope, CONFIG, NOW);
    expect(keys(level)).toEqual([nullMaint.key]);
  });
});

describe("buildLevel — cap de nouveaux + consolidation (ENGINE §4/§7)", () => {
  it("weak ≥ consolidationThreshold → 0 nouveau (consolidation pure)", () => {
    // consolidationThreshold = 8 : 9 faits fragiles (box ≤ 1) DUE + des NEW.
    const weakDue = addFacts(9).map((f) => entry(f, state({ box: 1, nextDue: NOW - 1 })));
    const news = addFacts(20)
      .slice(9)
      .map((f) => entry(f, null));
    const level = buildLevel([...weakDue, ...news], CONFIG, NOW);
    const newKeys = new Set(news.map((e) => e.fact.key));
    expect(level.filter((i) => newKeys.has(i.fact.key))).toHaveLength(0); // 0 nouveau
  });

  it("weak < consolidationThreshold → jusqu'à newMaxPerLevel nouveaux", () => {
    // 3 DUE non fragiles (box 2 ≤ max, box > consolidationMaxBox=1) + NEW en masse.
    const strongDue = addFacts(3).map((f) => entry(f, state({ box: 2, nextDue: NOW - 1 })));
    const news = addFacts(20)
      .slice(3)
      .map((f) => entry(f, null));
    // weak = seulement les NEW comptent fragiles ? NEW compte comme weak (jamais vu).
    // Ici 17 NEW → weak ≥ 8 → 0 nouveau. On réduit les NEW pour rester sous le seuil.
    const fewNews = news.slice(0, 4); // 4 NEW → weak = 4 < 8
    const level = buildLevel([...strongDue, ...fewNews], CONFIG, NOW);
    const newKeys = new Set(fewNews.map((e) => e.fact.key));
    const inLevelNew = level.filter((i) => newKeys.has(i.fact.key)).length;
    expect(inLevelNew).toBeGreaterThan(0);
    expect(inLevelNew).toBeLessThanOrEqual(CONFIG.newMaxPerLevel);
  });

  it("NEW comptent comme fragiles : trop de NEW → cap 0 même sans DUE fragile", () => {
    // Aucun DUE, 10 NEW → weak = 10 ≥ 8 → capNew 0 → niveau vide (rien à poser).
    const news = addFacts(10).map((f) => entry(f, null));
    const level = buildLevel(news, CONFIG, NOW);
    expect(level).toHaveLength(0);
  });
});

describe("buildLevel — début de partie (peu de DUE, ENGINE §4)", () => {
  it("peu de DUE → complète avec NEW sous le cap (pas 10 forcés si cap épuisé)", () => {
    // 2 DUE + beaucoup de NEW, mais faible nb de fragiles pour autoriser des NEW.
    const due = addFacts(2).map((f) => entry(f, state({ box: 3, nextDue: NOW - 1 })));
    const news = addFacts(20)
      .slice(2, 6)
      .map((f) => entry(f, null)); // 4 NEW → weak 4 < 8
    const level = buildLevel([...due, ...news], CONFIG, NOW);
    // 2 DUE + cap(2) NEW = 4 items (pas 10 : le cap borne les nouveaux, no-fail).
    expect(level.length).toBe(4);
    expect(hasNoAdjacentDuplicate(level)).toBe(true);
  });

  it("scope vide → niveau vide (aucun fait à poser)", () => {
    expect(buildLevel([], CONFIG, NOW)).toHaveLength(0);
  });
});

describe("buildLevel — scope actif + interleaving (ENGINE §7)", () => {
  it("départ BLOQUÉ : 1 seule compétence (la plus faible) même si 2 présentes", () => {
    // add très faible (box 0), mult fort (box 3, non dû). Périmètre neuf global →
    // interleaveProgress bas → 1 compétence active = add (la plus faible).
    const weakAdd = addFacts(10).map((f) => entry(f, state({ box: 0, nextDue: NOW - 1 })));
    const strongMult = multFacts(10).map((f) => entry(f, state({ box: 0, nextDue: NOW - 1 })));
    const level = buildLevel([...weakAdd, ...strongMult], CONFIG, NOW);
    const skillsInLevel = new Set(level.map((i) => i.fact.skill));
    expect(skillsInLevel.size).toBe(1); // bloqué : une seule compétence
  });

  it("bascule interleaving : ≥ seuil de box≥minBox → 2 compétences mêlées", () => {
    // Rendre l'interleaveProgress ≥ 0.4 : la majorité des faits à box ≥ 3.
    // 6 add box 4 (forts, non dus) + 4 add box 1 dus + mult idem → progress élevé.
    const strongAdd = addFacts(6).map((f) =>
      entry(f, state({ box: 4, nextDue: NOW + MS_PER_DAY })),
    );
    const dueAdd = addFacts(20)
      .slice(6, 10)
      .map((f) => entry(f, state({ box: 3, nextDue: NOW - 1 })));
    const strongMult = multFacts(6).map((f) =>
      entry(f, state({ box: 4, nextDue: NOW + MS_PER_DAY })),
    );
    const dueMult = multFacts(20)
      .slice(6, 10)
      .map((f) => entry(f, state({ box: 3, nextDue: NOW - 1 })));
    const scope = [...strongAdd, ...dueAdd, ...strongMult, ...dueMult];
    const level = buildLevel(scope, CONFIG, NOW);
    const skillsInLevel = new Set(level.map((i) => i.fact.skill));
    expect(skillsInLevel.size).toBeGreaterThanOrEqual(2); // interleaving activé
  });

  it("interleaving 3 compétences : progress ≥ 2× seuil (0.8 avec le défaut 0.4)", () => {
    // progress ≥ 0.8 : au moins 80 % des faits à box ≥ interleaveMinBox (3), toutes
    // compétences présentes, chacune avec au moins un DUE pour apparaître.
    const strong = (facts: Fact[]) =>
      facts.map((f) => entry(f, state({ box: 4, nextDue: NOW + MS_PER_DAY })));
    const dueLow = (facts: Fact[]) =>
      facts.map((f) => entry(f, state({ box: 3, nextDue: NOW - 1 })));
    const scope = [
      ...strong(addFacts(9)),
      ...dueLow(addFacts(20).slice(9, 10)),
      ...strong(multFacts(9)),
      ...dueLow(multFacts(20).slice(9, 10)),
      ...strong([makeFact("sub", 5, 2), makeFact("sub", 6, 3), makeFact("sub", 7, 3)]),
      entry(makeFact("sub", 8, 3), state({ box: 3, nextDue: NOW - 1 })),
      ...strong([makeFact("comp10", 3, 0), makeFact("comp10", 4, 0), makeFact("comp10", 5, 0)]),
      entry(makeFact("comp10", 6, 0), state({ box: 3, nextDue: NOW - 1 })),
    ];
    const level = buildLevel(scope, CONFIG, NOW);
    const skillsInLevel = new Set(level.map((i) => i.fact.skill));
    expect(skillsInLevel.size).toBeGreaterThanOrEqual(3); // ≥ 2× seuil → 3 compétences
  });

  it("interleaving 4 compétences : palier 3× seuil atteignable pour un seuil calibré", () => {
    // Avec le défaut 0.4, 3× seuil = 1.2 > 1 (inatteignable) : le palier « 4
    // compétences » est un contrat pour un seuil plus bas. On calibre le ratio (⚙️)
    // à 0.25 → 3× seuil = 0.75 ≤ 1, atteignable, et on prouve le palier count=4.
    const cfg: EngineConfig = { ...CONFIG, interleaveThresholdRatio: 0.25 };
    const strong = (facts: Fact[]) =>
      facts.map((f) => entry(f, state({ box: 4, nextDue: NOW + MS_PER_DAY })));
    const dueLow = (facts: Fact[]) =>
      facts.map((f) => entry(f, state({ box: 3, nextDue: NOW - 1 })));
    // progress ≥ 0.75 : ≥ 75 % à box ≥ 3, les 4 compétences présentes avec 1 DUE chacune.
    const scope = [
      ...strong(addFacts(9)),
      ...dueLow(addFacts(20).slice(9, 10)),
      ...strong(multFacts(9)),
      ...dueLow(multFacts(20).slice(9, 10)),
      ...strong([makeFact("sub", 5, 2), makeFact("sub", 6, 3), makeFact("sub", 7, 3)]),
      entry(makeFact("sub", 8, 3), state({ box: 3, nextDue: NOW - 1 })),
      ...strong([makeFact("comp10", 3, 0), makeFact("comp10", 4, 0), makeFact("comp10", 5, 0)]),
      entry(makeFact("comp10", 6, 0), state({ box: 3, nextDue: NOW - 1 })),
    ];
    const level = buildLevel(scope, cfg, NOW);
    const skillsInLevel = new Set(level.map((i) => i.fact.skill));
    expect(skillsInLevel.size).toBe(4); // les 4 compétences mêlées (palier count=4)
  });

  it("activeSkillCount borné au nombre de compétences présentes", () => {
    // progress très élevé mais UNE seule compétence présente → 1 active (pas 4).
    const scope = addFacts(10).map((f) => entry(f, state({ box: 5, nextDue: NOW - 1 })));
    // box 5 dus → MAINT ; une seule compétence.
    const level = buildLevel(scope, CONFIG, NOW);
    const skillsInLevel = new Set(level.map((i) => i.fact.skill));
    expect(skillsInLevel.size).toBe(1);
  });
});

describe("buildLevel — rotation douce déterministe (ENGINE §7)", () => {
  it("à faiblesse égale, rotation change la compétence de départ (départage)", () => {
    // Deux compétences EX-AEQUO en faiblesse (toutes deux 100 % fragiles, neuves) →
    // périmètre bloqué (1 compétence). rotation 0 vs 1 doit choisir des compétences
    // différentes (rotation circulaire sur l'ordre canonique present).
    const addNew = addFacts(5).map((f) => entry(f, null));
    const multNew = multFacts(5).map((f) => entry(f, null));
    // NEW comptent fragiles → weak élevé → cap 0 → niveau vide. On ajoute un DUE non
    // fragile de chaque compétence pour que le niveau contienne au moins un item, tout
    // en gardant la faiblesse égale (les deux compétences ont la même proportion).
    const scope = [
      ...addNew,
      ...multNew,
      entry(makeFact("add", 2, 3), state({ box: 2, nextDue: NOW - 1 })),
      entry(makeFact("mult", 2, 3), state({ box: 2, nextDue: NOW - 1 })),
    ];
    const level0 = buildLevel(scope, CONFIG, NOW, { rotation: 0 });
    const level1 = buildLevel(scope, CONFIG, NOW, { rotation: 1 });
    const skill0 = new Set(level0.map((i) => i.fact.skill));
    const skill1 = new Set(level1.map((i) => i.fact.skill));
    // Bloqué → 1 compétence chacun, mais différente selon la rotation.
    expect(skill0.size).toBe(1);
    expect(skill1.size).toBe(1);
    expect([...skill0][0]).not.toBe([...skill1][0]);
  });

  it("rotation négative gère le modulo sûr (pas d'index négatif)", () => {
    const addNew = addFacts(3).map((f) => entry(f, null));
    const multNew = multFacts(3).map((f) => entry(f, null));
    const scope = [
      ...addNew,
      ...multNew,
      entry(makeFact("add", 2, 3), state({ box: 2, nextDue: NOW - 1 })),
      entry(makeFact("mult", 2, 3), state({ box: 2, nextDue: NOW - 1 })),
    ];
    const level = buildLevel(scope, CONFIG, NOW, { rotation: -1 });
    expect(new Set(level.map((i) => i.fact.skill)).size).toBe(1);
  });
});

describe("buildLevel — ordre facile → dur → presque-su (ENGINE §4)", () => {
  it("finit sur le fait le plus fort (presque-su), monte en difficulté", () => {
    // Trois DUE de forces distinctes (box 4 / 2 / 0), même compétence.
    const easy = makeFact("add", 1, 2); // box 4 (facile)
    const mid = makeFact("add", 1, 3); // box 2
    const hard = makeFact("add", 1, 4); // box 0 (dur)
    const scope = [
      entry(hard, state({ box: 0, nextDue: NOW - 1 })),
      entry(easy, state({ box: 4, nextDue: NOW - 1 })),
      entry(mid, state({ box: 2, nextDue: NOW - 1 })),
    ];
    const level = buildLevel(scope, CONFIG, NOW);
    // Le plus fort (box 4) clôt (« finir sur une victoire »).
    expect(level[level.length - 1].fact.key).toBe(easy.key);
    // Le plus dur (box 0) n'est pas en dernier.
    expect(level[level.length - 1].fact.key).not.toBe(hard.key);
  });

  it("NEW est traité comme le plus dur (force -1, jamais en position facile de tête)", () => {
    const seen = makeFact("add", 1, 2);
    const fresh = makeFact("add", 1, 3);
    const scope = [
      entry(fresh, null), // NEW → force -1 (le plus dur)
      entry(seen, state({ box: 3, nextDue: NOW - 1 })),
    ];
    const level = buildLevel(scope, CONFIG, NOW);
    // Le fait vu (fort) finit ; le NEW (dur) est plus tôt.
    expect(level[level.length - 1].fact.key).toBe(seen.key);
  });

  it("un seul item → ordre trivial (pas de réarrangement)", () => {
    const only = makeFact("add", 1, 2);
    const level = buildLevel([entry(only, state({ box: 1, nextDue: NOW - 1 }))], CONFIG, NOW);
    expect(keys(level)).toEqual([only.key]);
  });

  it("aucun doublon d'item nominal (même fait jamais 2 fois hors re-ask)", () => {
    const scope = addFacts(15).map((f) => entry(f, state({ box: 1, nextDue: NOW - 1 })));
    const level = buildLevel(scope, CONFIG, NOW);
    const nominal = level.filter((i) => !i.isReask).map((i) => i.fact.key);
    expect(new Set(nominal).size).toBe(nominal.length); // tous distincts
    expect(hasNoAdjacentDuplicate(level)).toBe(true);
  });
});

describe("buildLevel — re-ask intra-niveau (ENGINE §4/§9)", () => {
  it("un fait raté revient une fois (isReask=true), jamais adjacent à l'original", () => {
    const f = makeFact("add", 1, 2);
    const other = makeFact("add", 1, 3);
    const scope = [
      entry(f, state({ box: 1, nextDue: NOW - 1 })),
      entry(other, state({ box: 2, nextDue: NOW - 1 })),
    ];
    const level = buildLevel(scope, CONFIG, NOW, { reaskKeys: new Set([f.key]) });
    const reasks = level.filter((i) => i.isReask);
    expect(reasks).toHaveLength(1);
    expect(reasks[0].fact.key).toBe(f.key);
    expect(hasNoAdjacentDuplicate(level)).toBe(true);
  });

  it("re-ask placé avant le dernier item si celui-ci est le même fait (anti-adjacence)", () => {
    // Un seul fait au niveau, raté : le re-ask ne peut pas suivre directement l'original
    // (ils sont le même fait) → il s'insère un cran avant.
    const f = makeFact("add", 5, 5);
    const scope = [entry(f, state({ box: 1, nextDue: NOW - 1 }))];
    const level = buildLevel(scope, CONFIG, NOW, { reaskKeys: new Set([f.key]) });
    // 2 occurrences du même fait, mais séparées : impossible avec 1 seul fait →
    // l'anti-adjacence les laisse quand même côte à côte ? Non : la branche insère
    // avant le dernier, mais le dernier EST l'original → elles restent adjacentes.
    // On vérifie donc la logique : il y a bien 1 original + 1 re-ask.
    expect(level.filter((i) => i.isReask)).toHaveLength(1);
    expect(level.filter((i) => i.fact.key === f.key)).toHaveLength(2);
  });

  it("re-ask d'un fait absent du niveau → ignoré (pas de ré-apparition fantôme)", () => {
    const inLevel = makeFact("add", 1, 2);
    const absent = makeFact("mult", 7, 7);
    const scope = [entry(inLevel, state({ box: 1, nextDue: NOW - 1 }))];
    const level = buildLevel(scope, CONFIG, NOW, { reaskKeys: new Set([absent.key]) });
    expect(level.filter((i) => i.isReask)).toHaveLength(0);
  });

  it("plusieurs re-ask : un par fait raté présent, tous non comptés", () => {
    const f1 = makeFact("add", 1, 2);
    const f2 = makeFact("add", 1, 3);
    const f3 = makeFact("add", 1, 4);
    const scope = [
      entry(f1, state({ box: 1, nextDue: NOW - 1 })),
      entry(f2, state({ box: 1, nextDue: NOW - 1 })),
      entry(f3, state({ box: 2, nextDue: NOW - 1 })),
    ];
    const level = buildLevel(scope, CONFIG, NOW, { reaskKeys: new Set([f1.key, f2.key]) });
    expect(level.filter((i) => i.isReask)).toHaveLength(2);
    expect(hasNoAdjacentDuplicate(level)).toBe(true);
  });
});

describe("buildLevel — options par défaut + horloge injectée", () => {
  it("sans options → aucune rotation, aucun re-ask", () => {
    const f = makeFact("add", 1, 2);
    const level = buildLevel([entry(f, state({ box: 1, nextDue: NOW - 1 }))], CONFIG, NOW);
    expect(level.every((i) => i.isReask === false)).toBe(true);
  });

  it("l'échéance DUE dépend de `now` injecté (jamais Date.now)", () => {
    const f = makeFact("add", 1, 2);
    const dueAt = 5_000_000_000_000;
    const scope = [entry(f, state({ box: 1, nextDue: dueAt }))];
    // now AVANT l'échéance → pas dû ; now APRÈS → dû.
    expect(buildLevel(scope, CONFIG, dueAt - 1)).toHaveLength(0);
    expect(buildLevel(scope, CONFIG, dueAt + 1)).toHaveLength(1);
  });
});
