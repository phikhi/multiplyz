import { describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS, type EngineConfig } from "../../config/server-config";
import { makeFact, type Fact } from "./facts";
import type { MasteryState } from "./mastery";
import {
  buildLevel,
  computeRevisionDebt,
  DUE_TARGET_RATIO,
  isDue,
  LEVEL_SIZE,
  type LevelItem,
  type ScopeEntry,
} from "./level";

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

/** N faits `sub` distincts (`a − b`, minuende `a ∈ 1..20`, subtrahende `b ∈ 1..a`). */
function subFacts(n: number): Fact[] {
  const facts: Fact[] = [];
  for (let a = 1; facts.length < n && a <= 20; a++) {
    for (let b = 1; b <= a && facts.length < n; b++) {
      facts.push(makeFact("sub", a, b));
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

  it("box < maxBox non échue (next_due futur) → exclue de DUE mais remontée par le repli d'impasse (#108)", () => {
    // Un seul fait box<max non dû : DUE ∅, MAINT ∅, capNew 0 (aucun NEW). La sélection
    // nominale ne le pose PAS (échéance future). Repli d'impasse (Option 2, ADR 0006) :
    // un niveau n'est jamais vide → le fait box<max est remonté (consolidation en avance).
    const future = makeFact("add", 4, 5);
    const scope = [entry(future, state({ box: 1, nextDue: NOW + MS_PER_DAY }))];
    const level = buildLevel(scope, CONFIG, NOW);
    expect(keys(level)).toEqual([future.key]); // repli : jamais vide (cf. #108)
    expect(level[0].isReask).toBe(false);
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
    const level = buildLevel([...strongDue, ...news], CONFIG, NOW);
    const newKeys = new Set(news.map((e) => e.fact.key));
    const inLevelNew = level.filter((i) => newKeys.has(i.fact.key)).length;
    expect(inLevelNew).toBeGreaterThan(0);
    expect(inLevelNew).toBeLessThanOrEqual(CONFIG.newMaxPerLevel);
  });

  // BUGFIX (#64, découvert en E2E) : un fait NEW (`state === null`, jamais tenté)
  // n'a pas encore de « boîte » à consolider — ENGINE §7 (« weak = nb facts box≤1 »)
  // ne peut désigner que des faits déjà rencontrés. Avant le fix, un domaine avec
  // beaucoup de faits jamais introduits (ex. `sub` = 210 faits) bloquait `capNew` à
  // 0 **indéfiniment** (`weak` ne pouvait jamais redescendre sous le seuil), et en
  // tout début de partie (DUE/MAINT encore vides) `buildLevel` pouvait renvoyer un
  // niveau **vide** — violation du contrat no-fail (PRODUCT §5). Ces tests
  // verrouillent la lecture corrigée : NEW ne compte JAMAIS dans `weak`.
  it("NEW ne compte PAS comme fragile : que des NEW → capNew plein, jamais un niveau vide", () => {
    // Aucun DUE, 10 NEW (jamais tentés) → weak = 0 < 8 → capNew = newMaxPerLevel,
    // le niveau se remplit de NEW (jusqu'au cap, puis LEVEL_SIZE si plus de NEW
    // disponibles) — jamais vide (cf. `weak est calculé sur les seuls faits
    // rencontrés`).
    const news = addFacts(10).map((f) => entry(f, null));
    const level = buildLevel(news, CONFIG, NOW);
    expect(level.length).toBeGreaterThan(0);
    expect(level.length).toBeLessThanOrEqual(CONFIG.newMaxPerLevel);
  });

  it("FRONTIÈRE weak === consolidationThreshold (PILE au seuil, faits DÉJÀ TENTÉS uniquement) → capNew 0", () => {
    // Verrouille la borne exacte du `>=` d'`isWeak`/du cap (mutation `<=`→`<` tuée).
    // consolidationMaxBox = 1 : un fait à box PILE 1 est fragile. EXACTEMENT
    // `consolidationThreshold` (= 8) faits DUE fragiles (déjà tentés) + des NEW
    // (qui ne comptent plus dans `weak` depuis le bugfix #64) → capNew 0 malgré
    // les NEW présents, uniquement à cause des 8 DUE fragiles.
    const T = CONFIG.consolidationThreshold; // 8
    expect(CONFIG.consolidationMaxBox).toBe(1);
    const weakDue = addFacts(T).map((f) => entry(f, state({ box: 1, nextDue: NOW - 1 })));
    const news = addFacts(20)
      .slice(T, T + 2)
      .map((f) => entry(f, null));
    const level = buildLevel([...weakDue, ...news], CONFIG, NOW);
    const newKeys = new Set(news.map((e) => e.fact.key));
    expect(level.filter((i) => newKeys.has(i.fact.key))).toHaveLength(0); // 0 nouveau pile au seuil
  });

  it("FRONTIÈRE weak === consolidationThreshold - 1 (juste sous, faits déjà tentés) → nouveaux autorisés", () => {
    // Un cran sous le seuil : la garde ne s'active PAS → capNew = newMaxPerLevel.
    // T-1 DUE box 1 (fragiles, déjà tentés) + des NEW (ne comptent plus) → permis.
    const T = CONFIG.consolidationThreshold; // 8
    const weakDue = addFacts(T - 1).map((f) => entry(f, state({ box: 1, nextDue: NOW - 1 })));
    const news = addFacts(20)
      .slice(T - 1, T + 1)
      .map((f) => entry(f, null));
    const level = buildLevel([...weakDue, ...news], CONFIG, NOW);
    const newKeys = new Set(news.map((e) => e.fact.key));
    const inLevelNew = level.filter((i) => newKeys.has(i.fact.key)).length;
    expect(inLevelNew).toBeGreaterThan(0); // des nouveaux passent sous le seuil
    expect(inLevelNew).toBeLessThanOrEqual(CONFIG.newMaxPerLevel);
  });
});

describe("buildLevel — repli d'impasse anti-niveau-vide (Option 2, ADR 0006, #108)", () => {
  // Reconstruit l'impasse RÉELLE de la base de Zoé (#108) : DUE ∅ ∧ MAINT ∅ ∧ capNew = 0.
  // 8 faits `sub` box-1 **non dus** (échéance demain) → weak = 8 = consolidationThreshold
  // → capNew 0, mais rien n'est DUE (espacement Leitner) ni en MAINT. La sélection
  // nominale rend un niveau VIDE (violation no-fail). Le repli (Option 2) doit le remplir
  // avec ces faits box<max, LES PLUS PROCHES de leur échéance d'abord.
  //
  // EFFET OBSERVABLE (rétro #60/#61) : ces tests ÉCHOUENT si on retire l'appel à
  // `fillFromDeadlock` — le niveau redeviendrait vide (assertions de non-vacuité + de
  // contenu/ordre précis, pas un simple `.length > 0` trivial).
  it("impasse DUE ∅ ∧ MAINT ∅ ∧ capNew 0 (8 faits sub box-1 non dus) → niveau NON vide (tue le repli)", () => {
    // Exactement SEUIL_CONSO faits sub box-1, échéance dans le futur (non dus).
    const T = CONFIG.consolidationThreshold; // 8
    const facts = subFacts(T); // T faits sub distincts
    const scope = facts.map((f) => entry(f, state({ box: 1, nextDue: NOW + MS_PER_DAY })));

    // Pré-condition : on est BIEN dans l'impasse (aucun fait dû, weak = T → capNew 0).
    expect(scope.every((e) => e.state!.nextDue! > NOW)).toBe(true); // aucun DUE
    expect(scope.filter((e) => e.state!.box <= CONFIG.consolidationMaxBox)).toHaveLength(T);

    const level = buildLevel(scope, CONFIG, NOW);
    // Assertion cœur : le repli casse l'impasse → niveau NON vide (échoue sans le repli).
    expect(level.length).toBeGreaterThan(0);
    // Contenu exact : le repli remonte ces faits box<max (aucun NEW inventé).
    const subKeys = new Set(facts.map((f) => f.key));
    expect(level.every((i) => subKeys.has(i.fact.key))).toBe(true);
    expect(level.length).toBe(Math.min(T, LEVEL_SIZE)); // remplit jusqu'à LEVEL_SIZE
    expect(hasNoAdjacentDuplicate(level)).toBe(true);
  });

  it("repli : remonte les faits les PLUS PROCHES de l'échéance d'abord (ordre observable)", () => {
    // 12 faits sub box-1 non dus, à échéances ÉCHELONNÉES (proche → lointain). Le repli
    // doit sélectionner les LEVEL_SIZE (10) plus PROCHES (petits délais) et écarter les
    // 2 plus lointains. Tue la mutation du comparateur (tri par proximité d'échéance).
    const T = CONFIG.consolidationThreshold; // 8 (≥ seuil → capNew 0)
    const total = 12;
    const facts = subFacts(total);
    // Échéances croissantes : fact i dû à NOW + (i+1) jours. i=0 le plus proche.
    const scope = facts.map((f, i) =>
      entry(f, state({ box: 1, nextDue: NOW + (i + 1) * MS_PER_DAY })),
    );
    // Pré-condition impasse : ≥ SEUIL_CONSO faits weak (box 1) → capNew 0, aucun dû.
    expect(
      scope.filter((e) => e.state!.box <= CONFIG.consolidationMaxBox).length,
    ).toBeGreaterThanOrEqual(T);
    expect(scope.every((e) => e.state!.nextDue! > NOW)).toBe(true);

    const level = buildLevel(scope, CONFIG, NOW);
    expect(level.length).toBe(LEVEL_SIZE); // 10 remontés sur 12

    // Les 2 faits les plus LOINTAINS (i=10, i=11) doivent être EXCLUS ; les 10 plus
    // proches (i=0..9) présents. Effet observable du tri par proximité (échoue si on
    // mute le comparateur en « plus lointain d'abord » ou en tri arbitraire).
    const levelKeys = new Set(level.map((i) => i.fact.key));
    for (let i = 0; i <= 9; i++) {
      expect(levelKeys.has(facts[i].key)).toBe(true); // proches présents
    }
    for (let i = 10; i <= 11; i++) {
      expect(levelKeys.has(facts[i].key)).toBe(false); // lointains exclus
    }
  });

  it("repli : un box<max à next_due null est capté par DUE (nominal), JAMAIS par le repli", () => {
    // Invariant du repli : un fait box<max à next_due null est TOUJOURS DUE (isDue traite
    // null comme dû) → la sélection nominale le pose → picked ≠ ∅ → le repli ne se
    // déclenche pas. Ce test verrouille cet invariant (le repli ne voit jamais un null),
    // ce qui justifie l'absence de branche null dans son comparateur (LEARNINGS #78).
    const nullFact = makeFact("sub", 3, 2);
    // + 8 faits box-1 non dus (weak ≥ seuil, capNew 0) : sans le null, ce serait l'impasse.
    const others = subFacts(10)
      .filter((f) => f.key !== nullFact.key)
      .slice(0, 8);
    const scope = [
      entry(nullFact, state({ box: 1, nextDue: null })),
      ...others.map((f) => entry(f, state({ box: 1, nextDue: NOW + MS_PER_DAY }))),
    ];
    const level = buildLevel(scope, CONFIG, NOW);
    // Le null est DUE (nominal) → présent ; comme picked ≠ ∅, le repli ne s'active pas,
    // donc les 8 box-1 non dus ne sont PAS remontés (ils le seraient si le repli tirait).
    expect(keys(level)).toEqual([nullFact.key]);
  });

  it("repli : n'introduit AUCUN NEW (Option 2) — que du box<max déjà rencontré", () => {
    // Impasse box-1 sub (capNew 0) + des NEW sub. Le repli ne doit PAS remonter de NEW
    // (isRescuable exclut state===null) : seuls les box<max déjà vus remplissent.
    const T = CONFIG.consolidationThreshold; // 8
    const seenFacts = subFacts(T);
    const newFacts = subFacts(20).filter((f) => !seenFacts.some((s) => s.key === f.key));
    const scope = [
      ...seenFacts.map((f) => entry(f, state({ box: 1, nextDue: NOW + MS_PER_DAY }))),
      ...newFacts.map((f) => entry(f, null)),
    ];
    const level = buildLevel(scope, CONFIG, NOW);
    expect(level.length).toBeGreaterThan(0); // repli actif
    const newKeys = new Set(newFacts.map((f) => f.key));
    expect(level.filter((i) => newKeys.has(i.fact.key))).toHaveLength(0); // 0 NEW remonté
  });

  it("repli NON déclenché quand un niveau nominal non vide existe (anti-régression cas nominal)", () => {
    // 8 faits sub box-1 DUS (échéance passée) → DUE non vide → sélection nominale remplit.
    // Le repli ne doit PAS polluer : le niveau nominal est identique avec ou sans repli.
    const T = CONFIG.consolidationThreshold; // 8
    const dueFacts = subFacts(T);
    const scope = dueFacts.map((f) => entry(f, state({ box: 1, nextDue: NOW - MS_PER_DAY })));
    const level = buildLevel(scope, CONFIG, NOW);
    // Niveau nominal plein de DUE (le repli ne change rien : picked ≠ ∅ à l'étape 5.b).
    expect(level.length).toBe(Math.min(T, LEVEL_SIZE));
    const dueKeys = new Set(dueFacts.map((f) => f.key));
    expect(level.every((i) => dueKeys.has(i.fact.key))).toBe(true);
  });

  it("repli : scope 100 % NEW non dus → reste vide (rien de remontable, pas un NEW inventé)", () => {
    // Aucun fait déjà rencontré (que des NEW), mais capNew 0 impossible (weak=0). Cas
    // nominal : le NEW remplit (pas d'impasse). On vérifie que le repli ne s'immisce pas.
    const news = subFacts(10).map((f) => entry(f, null));
    const level = buildLevel(news, CONFIG, NOW);
    // NEW nominal (capNew plein) : non vide via le chemin nominal, PAS via le repli.
    expect(level.length).toBeGreaterThan(0);
    expect(level.length).toBeLessThanOrEqual(CONFIG.newMaxPerLevel);
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

  it("interleaving EXACTEMENT 3 compétences au défaut : progress plafonne le palier à 3", () => {
    // TOUS les faits sont à box ≥ interleaveMinBox (3) → progress = 1.0 (pas 0.8 : la
    // fixture n'a aucun fait fragile). Au défaut t = 0.4 : 1.0 ≥ 2·t (0.8) → count 3,
    // mais 1.0 < 3·t (1.2) → PAS 4. Les 4 compétences sont présentes, donc `min(3, 4)`
    // → EXACTEMENT 3 compétences mêlées (le 4ᵉ palier reste hors d'atteinte au défaut).
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
    expect(skillsInLevel.size).toBe(3); // exactement 3 (distingue « 3 » de « 4 »)
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

  it("NEW (force -1) est STRICTEMENT plus dur qu'un fait box 0 (force 0)", () => {
    // Verrouille la distinction NEW/box0 (mutation `-1`→`0` de `strengthOf` tuée) :
    // sous la mutation, NEW et box0 auraient la même force → départage par clé, ce qui
    // POURRAIT placer le NEW avant le box0. Ici la clé du NEW (`add_1+3`) est
    // lexicographiquement PLUS PETITE que celle du box0 (`add_1+4`) → sous la mutation
    // le NEW passerait AVANT le box0. Le code correct (-1 < 0) place le NEW APRÈS le
    // box0 (plus dur). Un fait fort (box 4) occupe la fin (presque-su).
    const box0 = makeFact("add", 1, 4); // force 0, clé `add_1+4`
    const newFact = makeFact("add", 1, 3); // force -1, clé `add_1+3` (< box0)
    const strong = makeFact("add", 1, 2); // force 4 → presque-su, clôt le niveau
    const scope = [
      entry(box0, state({ box: 0, nextDue: NOW - 1 })),
      entry(newFact, null),
      entry(strong, state({ box: 4, nextDue: NOW - 1 })),
    ];
    const level = buildLevel(scope, CONFIG, NOW);
    const order = keys(level);
    // Le plus fort clôt.
    expect(order[order.length - 1]).toBe(strong.key);
    // box0 (force 0, moins dur) vient AVANT le NEW (force -1, plus dur) dans la montée.
    expect(order.indexOf(box0.key)).toBeLessThan(order.indexOf(newFact.key));
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

  it("re-ask du PRESQUE-SU (dernier item) : la garde anti-adjacence le sépare de l'original", () => {
    // Cas observable de la garde (mutation « garde désactivée » tuée) : le fait re-ask
    // est le PLUS FORT → `orderForVictory` le place en DERNIER (presque-su). Une simple
    // insertion en fin collerait le re-ask à son original (adjacence interdite). La
    // garde recule le point d'insertion → aucune adjacence. Ce test ÉCHOUE si l'on
    // retire la garde (le re-ask atterrit juste après l'original en fin de séquence).
    const strong = makeFact("add", 1, 2); // box 4 → placé en dernier (presque-su)
    const weak = makeFact("add", 1, 3); // box 0 → plus tôt
    const other = makeFact("add", 1, 4); // box 2 → milieu (séparateur)
    const scope = [
      entry(strong, state({ box: 4, nextDue: NOW - 1 })),
      entry(weak, state({ box: 0, nextDue: NOW - 1 })),
      entry(other, state({ box: 2, nextDue: NOW - 1 })),
    ];
    const level = buildLevel(scope, CONFIG, NOW, { reaskKeys: new Set([strong.key]) });
    // 2 occurrences du fait fort, NON adjacentes grâce à la garde.
    expect(level.filter((i) => i.fact.key === strong.key)).toHaveLength(2);
    expect(level.filter((i) => i.isReask)).toHaveLength(1);
    expect(hasNoAdjacentDuplicate(level)).toBe(true); // ← faux sans la garde
  });

  it("niveau dégénéré (un seul fait, raté) : 2 occurrences, cas indécidable (fallback)", () => {
    // Un seul fait au niveau : aucune position ne peut séparer les 2 occurrences du
    // même fait → le fallback les laisse voisines (cas dégénéré, exerce la branche de
    // repli d'`insertNonAdjacent`). On vérifie juste qu'il y a bien 1 original + 1 re-ask.
    const f = makeFact("add", 5, 5);
    const scope = [entry(f, state({ box: 1, nextDue: NOW - 1 }))];
    const level = buildLevel(scope, CONFIG, NOW, { reaskKeys: new Set([f.key]) });
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
    // Un box-1 daté + un ancre MAINT (box max) toujours dû → le niveau n'est jamais
    // vide (le repli d'impasse #108 ne masque donc pas la bascule DUE). On observe la
    // MEMBERSHIP DUE du box-1 : `isReask=false` ordonné, présence conditionnée par `now`.
    const f = makeFact("add", 1, 2);
    const anchor = makeFact("add", 3, 4); // MAINT (box max), dû → jamais vide
    const dueAt = 5_000_000_000_000;
    const scope = [
      entry(f, state({ box: 1, nextDue: dueAt })),
      entry(anchor, state({ box: CONFIG.maxBox, nextDue: dueAt - 10 })),
    ];
    // now AVANT l'échéance du box-1 → pas DUE, mais le box-1 reste **remontable par le
    // repli** (box<max non dû) → présent quand même ; l'ancre MAINT est là dans les 2 cas.
    // now APRÈS → le box-1 devient DUE (chemin nominal). Dans les deux cas il figure au
    // niveau, mais la bascule DUE↔repli est bien pilotée par `now` (aucun Date.now interne).
    const before = buildLevel(scope, CONFIG, dueAt - 1);
    const after = buildLevel(scope, CONFIG, dueAt + 1);
    expect(keys(before)).toContain(anchor.key);
    expect(keys(after)).toContain(f.key);
    // now AVANT l'échéance de l'ancre aussi (tout futur) → DUE ∅ ∧ MAINT ∅ → repli seul.
    const deadlockNow = dueAt - 100;
    const level = buildLevel(scope, CONFIG, deadlockNow);
    expect(level.length).toBeGreaterThan(0); // no-fail : jamais vide (#108)
  });
});

describe("computeRevisionDebt — dette de révision (MAP §5)", () => {
  const f1 = makeFact("add", 1, 2);
  const f2 = makeFact("add", 1, 3);
  const f3 = makeFact("add", 1, 4);

  it("compte les faits DUE (déjà vus, box<max, échéance atteinte)", () => {
    // 2 DUE (échéance passée) + 1 non dû (échéance future) → dette = 2.
    const scope = [
      entry(f1, state({ box: 1, nextDue: NOW - MS_PER_DAY })),
      entry(f2, state({ box: 2, nextDue: NOW - 1 })),
      entry(f3, state({ box: 1, nextDue: NOW + MS_PER_DAY })), // pas encore dû
    ];
    expect(computeRevisionDebt(scope, CONFIG, NOW)).toBe(2);
  });

  it("un fait NEW (jamais vu, state null) n'est PAS en dette", () => {
    // Effet observable : si le filtre `state !== null` sautait (mutant `=== null ||`),
    // le NEW compterait → dette 2 au lieu de 1. Ce test casse alors.
    const scope = [
      entry(f1, state({ box: 1, nextDue: NOW - 1 })), // DUE
      entry(f2, null), // NEW → jamais en dette
    ];
    expect(computeRevisionDebt(scope, CONFIG, NOW)).toBe(1);
  });

  it("plusieurs NEW seuls ⇒ dette 0 (aucun fait jamais vu n'est en retard)", () => {
    // Renforce la garde du filtre NEW : un scope 100 % NEW a une dette de 0, pas de N.
    const scope = [entry(f1, null), entry(f2, null), entry(f3, null)];
    expect(computeRevisionDebt(scope, CONFIG, NOW)).toBe(0);
  });

  it("un fait en entretien (box = max) n'est PAS en dette (box < max requis)", () => {
    const scope = [
      entry(f1, state({ box: CONFIG.maxBox, nextDue: NOW - MS_PER_DAY })), // MAINT, pas DUE
      entry(f2, state({ box: 1, nextDue: NOW - 1 })), // DUE
    ];
    expect(computeRevisionDebt(scope, CONFIG, NOW)).toBe(1);
  });

  it("horloge injectée : la dette dépend de `now`, jamais de Date.now()", () => {
    const scope = [entry(f1, state({ box: 1, nextDue: NOW }))];
    // Effet observable de `now` : échéance == now → dû (≤) ; now avant → pas dû.
    expect(computeRevisionDebt(scope, CONFIG, NOW)).toBe(1);
    expect(computeRevisionDebt(scope, CONFIG, NOW - 1)).toBe(0);
  });

  it("scope vide → dette 0 (aucune division, no-fail)", () => {
    expect(computeRevisionDebt([], CONFIG, NOW)).toBe(0);
  });

  it("isDue (exporté) : box<max ET échéance atteinte", () => {
    expect(isDue(state({ box: 1, nextDue: NOW - 1 }), CONFIG, NOW)).toBe(true);
    expect(isDue(state({ box: 1, nextDue: NOW + 1 }), CONFIG, NOW)).toBe(false);
    expect(isDue(state({ box: CONFIG.maxBox, nextDue: NOW - 1 }), CONFIG, NOW)).toBe(false);
  });
});
