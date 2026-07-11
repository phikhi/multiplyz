import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { attempts, mastery, masteryKey, profiles } from "@/lib/db/schema";
import { CONFIG_DEFAULTS, type EngineConfig } from "@/config/server-config";
import { SKILLS } from "./domain";
import { generateFacts, makeFact } from "./facts";
import { loadMasteryState, upsertMastery } from "./persistence";
import { boxDelayMs, type MasteryState } from "./mastery";
import {
  isRecalibrationRequested,
  needsDiagnostic,
  requestRecalibration,
  seedDiagnostic,
  seedRecalibration,
  startLevel,
  submitAttempt,
  type RawDiagnosticResponse,
  type SubmitAttemptInput,
} from "./service";

/**
 * Tests d'intégration de l'orchestration serveur (3.7) sur **base réelle** : transaction
 * synchrone (anti-TOCTOU), idempotence/monotonie (SYNC §2/§5), gardes de forme (#36),
 * scope profil, re-essai non compté, amorçage diagnostic idempotent. Horloge `now` et RNG
 * injectés → déterministe (LEARNINGS #46/aléa).
 */

const config: EngineConfig = CONFIG_DEFAULTS.engine;
let db: AppDatabase;
let profileId: number;

const NOW = Date.UTC(2026, 6, 3, 10, 0, 0);
/** RNG déterministe (identité) : `shuffle` devient une permutation fixe et reproductible. */
const rng = (): number => 0;

function seedProfile(name: string): number {
  return db
    .insert(profiles)
    .values({ name, nameKey: name.toLowerCase(), avatar: "fox", pinHash: "x" })
    .returning({ id: profiles.id })
    .get().id;
}

beforeEach(() => {
  db = createDatabase(":memory:");
  runMigrations(db);
  profileId = seedProfile("Léa");
});

const COMP10_7 = makeFact("comp10", 7, 0);
const MULT_6X8 = makeFact("mult", 6, 8);

/** État de maîtrise DUE (échéance passée) à la boîte voulue — pour composer un niveau. */
function dueState(box: number): MasteryState {
  return {
    box,
    correctCount: 1,
    wrongCount: 0,
    avgResponseMs: 1500,
    lastSeen: NOW - 1,
    nextDue: NOW - 1, // échéance passée → DUE
  };
}

/**
 * Amorce **tous** les faits comp10 comme DUE à la boîte `box`, et laisse les autres
 * compétences NEW → comp10 (fragile si box ≤ 1) devient le périmètre actif et compose
 * le niveau. Utilisé quand on veut un niveau de faits fragiles (QCM).
 */
function seedComp10AllDue(box: number): void {
  for (const fact of generateFacts("comp10")) {
    upsertMastery(db, profileId, fact, dueState(box));
  }
}

/**
 * Amorce **tout le domaine** (toutes compétences) DUE à la boîte `box` → plus aucun
 * fait NEW, tout est dû. Le périmètre actif prend la compétence en tête (comp10) et le
 * niveau est composé de faits à cette boîte (utile pour forcer un format donné).
 */
function seedAllDomainDue(box: number): void {
  for (const skill of SKILLS) {
    for (const fact of generateFacts(skill)) {
      upsertMastery(db, profileId, fact, dueState(box));
    }
  }
}

/** Payload de soumission valide de base (comp10_7 juste + fluent). */
function submitFixture(overrides: Partial<SubmitAttemptInput> = {}): SubmitAttemptInput {
  return {
    factKey: COMP10_7.key,
    skill: "comp10",
    correct: true,
    responseMs: 1200, // ≥ antiMashMs (600) et ≤ fluence comp10 (3000) → fluent → promotion
    ...overrides,
  };
}

describe("startLevel", () => {
  it("compose ~10 questions cohérentes avec l'état persisté (DUE)", () => {
    seedComp10AllDue(1);
    const level = startLevel(db, profileId, config, NOW, rng);
    expect(level.questions.length).toBeGreaterThan(0);
    expect(level.questions.length).toBeLessThanOrEqual(12); // ~10 + re-ask éventuels
    // Toutes les questions portent des faits comp10 DUE (périmètre actif = plus faible).
    expect(level.questions.every((q) => q.skill === "comp10")).toBe(true);
  });

  it("lecture seule : aucune écriture au démarrage", () => {
    seedComp10AllDue(1);
    const before = db.select().from(mastery).where(eq(mastery.profileId, profileId)).all();
    startLevel(db, profileId, config, NOW, rng);
    const after = db.select().from(mastery).where(eq(mastery.profileId, profileId)).all();
    expect(after).toEqual(before);
    expect(db.select().from(attempts).all()).toHaveLength(0);
  });

  it("un fait fragile (box ≤ 1) est posé en QCM avec 4 choix mélangés dont la réponse", () => {
    seedComp10AllDue(1);
    const level = startLevel(db, profileId, config, NOW, rng);
    const q = level.questions[0];
    expect(q.format).toBe("qcm");
    expect(q.choices).toHaveLength(4);
    const fact = makeFact(q.skill, q.operands[0], q.operands[1] ?? 0);
    expect(q.choices).toContain(fact.answer);
  });

  it("un fait bien su (box ≥ 2) DUE est posé en pavé (pas de choix)", () => {
    seedAllDomainDue(3); // tout le domaine box 3 DUE → niveau de faits box 3 → pavé
    const level = startLevel(db, profileId, config, NOW, rng);
    expect(level.questions.length).toBeGreaterThan(0);
    // Tous les faits sont à box 3 → toutes les questions en pavé, sans choix.
    expect(level.questions.every((q) => q.format === "pave")).toBe(true);
    expect(level.questions.every((q) => q.choices === null)).toBe(true);
  });

  it("aucune question isReask sans reaskKeys", () => {
    seedComp10AllDue(1);
    const level = startLevel(db, profileId, config, NOW, rng);
    expect(level.questions.every((q) => q.isReask === false)).toBe(true);
  });

  it("un fait NEW (jamais vu) présent dans le niveau est posé en QCM (box 0)", () => {
    // Tout le domaine box 3 DUE SAUF comp10_7 laissé NEW (aucune ligne mastery). comp10
    // reste le périmètre actif (légèrement plus faible) → son fait NEW peut entrer via
    // le cap de nouveaux → format QCM (box 0, `state === null`).
    seedAllDomainDue(3);
    db.delete(mastery)
      .where(eq(mastery.id, masteryKey(profileId, COMP10_7.key)))
      .run();
    const level = startLevel(db, profileId, config, NOW, rng);
    const newQuestion = level.questions.find((q) => q.factKey === COMP10_7.key);
    expect(newQuestion?.format).toBe("qcm");
    expect(newQuestion?.choices).toHaveLength(4);
  });

  it("propage reaskKeys → une occurrence isReask du fait raté", () => {
    seedComp10AllDue(1);
    const level = startLevel(db, profileId, config, NOW, rng, {
      reaskKeys: new Set([COMP10_7.key]),
    });
    const reasks = level.questions.filter((q) => q.isReask);
    expect(reasks).toHaveLength(1);
    expect(reasks[0].factKey).toBe(COMP10_7.key);
  });
});

describe("submitAttempt — gardes de forme + domaine (#36)", () => {
  it("refuse un factKey non-string (INVALID_FACT)", () => {
    const res = submitAttempt(db, profileId, submitFixture({ factKey: 42 }), config, NOW);
    expect(res).toEqual({ ok: false, error: "INVALID_FACT" });
    expect(db.select().from(attempts).all()).toHaveLength(0);
  });

  it("refuse une clé hors domaine / corrompue (INVALID_FACT)", () => {
    const res = submitAttempt(db, profileId, submitFixture({ factKey: "mult_0x5" }), config, NOW);
    expect(res).toEqual({ ok: false, error: "INVALID_FACT" });
  });

  it("refuse un skill invalide (INVALID_SKILL)", () => {
    const res = submitAttempt(db, profileId, submitFixture({ skill: "divide" }), config, NOW);
    expect(res).toEqual({ ok: false, error: "INVALID_SKILL" });
  });

  it("refuse un skill valide mais incohérent avec le fait (INVALID_SKILL)", () => {
    const res = submitAttempt(db, profileId, submitFixture({ skill: "add" }), config, NOW);
    expect(res).toEqual({ ok: false, error: "INVALID_SKILL" });
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["négatif", -1],
    ["non entier", 12.5],
    ["non numérique", "1200"],
  ])("refuse un responseMs %s (INVALID_RESPONSE_MS)", (_label, value) => {
    const res = submitAttempt(db, profileId, submitFixture({ responseMs: value }), config, NOW);
    expect(res).toEqual({ ok: false, error: "INVALID_RESPONSE_MS" });
    // Aucune écriture sur payload invalide (pas de pollution avgResponseMs).
    expect(db.select().from(attempts).all()).toHaveLength(0);
    expect(db.select().from(mastery).all()).toHaveLength(0);
  });

  it("accepte responseMs = 0 (borne inclusive ≥ 0, réponse instantanée)", () => {
    // Borne exacte : `>= 0` (pas `> 0`). 0 est un instant valide (anti-mash le gère en
    // aval, pas la garde de forme). Kill du mutant `>= 0` → `> 0`.
    const res = submitAttempt(db, profileId, submitFixture({ responseMs: 0 }), config, NOW);
    expect(res.ok).toBe(true);
    expect(db.select().from(attempts).all()[0].responseMs).toBe(0);
  });

  it("un `correct` non strictement `true` (truthy) est compté FAUX (=== true)", () => {
    // Garde stricte : `input.correct === true`. Un `1`/`"yes"` (truthy mais non booléen)
    // ne doit PAS compter juste (kill du mutant `=== true` → truthy). Réponse fausse →
    // rétrograde/wrongCount, jamais promotion.
    const res = submitAttempt(
      db,
      profileId,
      { ...submitFixture(), correct: 1 } as never,
      config,
      NOW,
    );
    if (!res.ok) throw new Error("unreachable");
    expect(res.state?.correctCount).toBe(0);
    expect(res.state?.wrongCount).toBe(1);
    expect(db.select().from(attempts).all()[0].correct).toBe(false);
  });

  it("un `isRetry` non strictement `true` (truthy) est traité comme NON-retry (=== true)", () => {
    // Miroir de la garde `correct` : `input.isRetry === true`. Un `1` (truthy mais non
    // booléen) ne doit PAS compter comme re-essai → la réponse EST comptée (attempts +1
    // ET mastery upserté). Kill du mutant `=== true` → `Boolean(...)` (Boolean(1)=true
    // traiterait `1` comme un re-essai non compté → aucune ligne mastery, effet observable).
    const res = submitAttempt(
      db,
      profileId,
      { ...submitFixture(), isRetry: 1 } as never,
      config,
      NOW,
    );
    if (!res.ok) throw new Error("unreachable");
    // NON-retry → réponse comptée : mastery amorcée (juste+rapide → box 1), pas `null`.
    expect(res.state?.box).toBe(1);
    expect(res.state?.correctCount).toBe(1);
    // La ligne attempts est journalisée avec is_retry=0 (garde stricte, pas de re-essai).
    const attemptRows = db.select().from(attempts).all();
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0].isRetry).toBe(false);
    // Et une ligne mastery a bien été upsertée (aucun no-op de re-essai).
    expect(db.select().from(mastery).all()).toHaveLength(1);
  });
});

describe("submitAttempt — écriture atomique (attempts + mastery)", () => {
  it("journalise 1 ligne attempts ET upsert mastery (1ʳᵉ réponse juste+rapide → box 1)", () => {
    const res = submitAttempt(db, profileId, submitFixture(), config, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.duplicate).toBe(false);
    expect(res.state?.box).toBe(1); // box 0 → +1 (promotion, fluent)

    const attemptRows = db.select().from(attempts).where(eq(attempts.profileId, profileId)).all();
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0]).toMatchObject({ factId: COMP10_7.key, correct: true, isRetry: false });

    const state = loadMasteryState(db, profileId, COMP10_7.key);
    expect(state).toMatchObject({ box: 1, correctCount: 1, wrongCount: 0, avgResponseMs: 1200 });
    expect(state?.lastSeen).toBe(NOW);
  });

  it("une réponse fausse rétrograde (box max(0, 0−2) = 0) et incrémente wrongCount", () => {
    // D'abord monter à box 2, puis répondre faux → box 0.
    submitAttempt(db, profileId, submitFixture({ clientAttemptId: "a" }), config, NOW);
    submitAttempt(db, profileId, submitFixture({ clientAttemptId: "b" }), config, NOW);
    expect(loadMasteryState(db, profileId, COMP10_7.key)?.box).toBe(2);

    const res = submitAttempt(
      db,
      profileId,
      submitFixture({ correct: false, clientAttemptId: "c" }),
      config,
      NOW,
    );
    if (!res.ok) throw new Error("unreachable");
    expect(res.state?.box).toBe(0);
    expect(res.state?.wrongCount).toBe(1);
  });

  it("un anti-mash (juste mais < 600 ms) ne promeut pas (box inchangée)", () => {
    const res = submitAttempt(db, profileId, submitFixture({ responseMs: 300 }), config, NOW);
    if (!res.ok) throw new Error("unreachable");
    expect(res.state?.box).toBe(0); // pas de promotion (anti-mash), mais compté juste
    expect(res.state?.correctCount).toBe(1);
  });
});

describe("submitAttempt — re-essai non compté (ENGINE §9)", () => {
  it("journalise attempts (is_retry=1) mais ne touche PAS mastery", () => {
    const res = submitAttempt(
      db,
      profileId,
      submitFixture({ isRetry: true, clientAttemptId: "r1" }),
      config,
      NOW,
    );
    if (!res.ok) throw new Error("unreachable");
    expect(res.state).toBeNull(); // fait jamais compté → pas de ligne mastery
    expect(res.duplicate).toBe(false);

    const attemptRows = db.select().from(attempts).all();
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0].isRetry).toBe(true);
    // Aucune ligne mastery créée par un re-essai.
    expect(db.select().from(mastery).all()).toHaveLength(0);
  });

  it("un re-essai sur un fait déjà amorcé renvoie l'état courant sans le muter", () => {
    submitAttempt(db, profileId, submitFixture({ clientAttemptId: "first" }), config, NOW);
    const before = loadMasteryState(db, profileId, COMP10_7.key);

    const res = submitAttempt(
      db,
      profileId,
      submitFixture({ isRetry: true, correct: false, clientAttemptId: "retry" }),
      config,
      NOW,
    );
    if (!res.ok) throw new Error("unreachable");
    expect(res.state).toEqual(before); // maîtrise strictement inchangée
    expect(loadMasteryState(db, profileId, COMP10_7.key)).toEqual(before);
  });
});

describe("submitAttempt — idempotence / monotonie (SYNC §2/§5)", () => {
  it("rejouer le même clientAttemptId ne double NI attempts NI mastery", () => {
    const payload = submitFixture({ clientAttemptId: "dup-1" });

    const first = submitAttempt(db, profileId, payload, config, NOW);
    if (!first.ok) throw new Error("unreachable");
    expect(first.duplicate).toBe(false);
    expect(first.state?.box).toBe(1);
    expect(first.state?.correctCount).toBe(1);

    // Rejeu réseau (même id) → no-op, état inchangé.
    const replay = submitAttempt(db, profileId, payload, config, NOW);
    if (!replay.ok) throw new Error("unreachable");
    expect(replay.duplicate).toBe(true);
    expect(replay.state?.box).toBe(1);
    expect(replay.state?.correctCount).toBe(1); // PAS 2 → pas de double comptage

    expect(db.select().from(attempts).all()).toHaveLength(1);
    const state = loadMasteryState(db, profileId, COMP10_7.key);
    expect(state?.correctCount).toBe(1);
  });

  it("deux clientAttemptId distincts comptent tous deux (pas de faux dédoublonnage)", () => {
    submitAttempt(db, profileId, submitFixture({ clientAttemptId: "x1" }), config, NOW);
    submitAttempt(db, profileId, submitFixture({ clientAttemptId: "x2" }), config, NOW);
    expect(db.select().from(attempts).all()).toHaveLength(2);
    expect(loadMasteryState(db, profileId, COMP10_7.key)?.correctCount).toBe(2);
  });

  it("sans clientAttemptId, chaque soumission compte (aucune idempotence sans id)", () => {
    submitAttempt(db, profileId, submitFixture(), config, NOW);
    submitAttempt(db, profileId, submitFixture(), config, NOW);
    expect(db.select().from(attempts).all()).toHaveLength(2);
    expect(loadMasteryState(db, profileId, COMP10_7.key)?.correctCount).toBe(2);
  });

  it("l'idempotence est scopée au profil (même id, autre profil compte)", () => {
    const other = seedProfile("Tom");
    submitAttempt(db, profileId, submitFixture({ clientAttemptId: "shared" }), config, NOW);
    const res = submitAttempt(db, other, submitFixture({ clientAttemptId: "shared" }), config, NOW);
    if (!res.ok) throw new Error("unreachable");
    expect(res.duplicate).toBe(false); // id partagé mais profil différent
    expect(loadMasteryState(db, other, COMP10_7.key)?.correctCount).toBe(1);
  });
});

describe("needsDiagnostic", () => {
  it("true pour un profil vierge (aucune ligne mastery)", () => {
    expect(needsDiagnostic(db, profileId)).toBe(true);
  });

  it("false dès qu'une ligne mastery existe", () => {
    submitAttempt(db, profileId, submitFixture({ clientAttemptId: "seed" }), config, NOW);
    expect(needsDiagnostic(db, profileId)).toBe(false);
  });
});

describe("seedDiagnostic (ENGINE §3)", () => {
  const responses: RawDiagnosticResponse[] = [
    { factKey: COMP10_7.key, skill: "comp10", correct: true, responseMs: 800 }, // fluent → box 3
    { factKey: MULT_6X8.key, skill: "mult", correct: false, responseMs: 6000 }, // faux → box 0
  ];

  it("amorce les lignes mastery d'un profil vierge (box 3 / box 0)", () => {
    const seeded = seedDiagnostic(db, profileId, responses, config, NOW);
    expect(seeded).toHaveLength(2);
    expect(loadMasteryState(db, profileId, COMP10_7.key)?.box).toBe(3);
    expect(loadMasteryState(db, profileId, MULT_6X8.key)?.box).toBe(0);
  });

  it("ignore une réponse mal formée / hors domaine (garde de forme #36)", () => {
    const seeded = seedDiagnostic(
      db,
      profileId,
      [
        { factKey: COMP10_7.key, skill: "comp10", correct: true, responseMs: 800 },
        { factKey: "mult_0x5", skill: "mult", correct: true, responseMs: 800 }, // hors domaine
        { factKey: MULT_6X8.key, skill: "add", correct: true, responseMs: 800 }, // skill≠fact
        { factKey: 999, skill: "comp10", correct: true, responseMs: 800 }, // factKey non-string
        { factKey: COMP10_7.key, skill: "comp10", correct: true, responseMs: Number.NaN }, // ms invalide
      ],
      config,
      NOW,
    );
    // Seule la 1ʳᵉ réponse (comp10_7) est valide.
    expect(seeded).toHaveLength(1);
    expect(seeded[0].factKey).toBe(COMP10_7.key);
  });

  it("est idempotent : un rejeu sur profil déjà amorcé est un no-op (pas de double)", () => {
    seedDiagnostic(db, profileId, responses, config, NOW);
    const before = db.select().from(mastery).where(eq(mastery.profileId, profileId)).all();

    const replay = seedDiagnostic(db, profileId, responses, config, NOW);
    expect(replay).toHaveLength(0); // aucune ligne ré-amorcée

    const after = db.select().from(mastery).where(eq(mastery.profileId, profileId)).all();
    expect(after).toHaveLength(before.length); // pas de doublon / de mutation
    expect(after).toEqual(before);
  });

  it("n'amorce rien si aucune réponse valide (profil reste vierge)", () => {
    const seeded = seedDiagnostic(
      db,
      profileId,
      [{ factKey: "garbage", skill: "comp10", correct: true, responseMs: 800 }],
      config,
      NOW,
    );
    expect(seeded).toHaveLength(0);
    expect(needsDiagnostic(db, profileId)).toBe(true);
  });
});

// ============================================================================
// Recalibrage — drapeau + fusion MONOTONE du re-diagnostic (ENGINE §3, ADR 0016, #237 Option A)
// ============================================================================

/** Réponse brute de re-diagnostic juste + RAPIDE (fluente) sur comp10_7 → sonde box 3. */
const FLUENT_COMP10_7: RawDiagnosticResponse = {
  factKey: COMP10_7.key,
  skill: "comp10",
  correct: true,
  responseMs: 1_200, // ≥ antiMash (600) et ≤ fluence comp10 (3000) → fluent → SEED_BOX_FLUENT (3)
};

describe("isRecalibrationRequested / requestRecalibration (drapeau, ADR 0016)", () => {
  it("drapeau à false par défaut (profil neuf)", () => {
    expect(isRecalibrationRequested(db, profileId)).toBe(false);
  });

  it("requestRecalibration ARME le drapeau (true)", () => {
    requestRecalibration(db, profileId);
    expect(isRecalibrationRequested(db, profileId)).toBe(true);
  });

  it("idempotent : (ré)armer un drapeau déjà armé reste sûr (une seule ligne profil)", () => {
    requestRecalibration(db, profileId);
    requestRecalibration(db, profileId);
    expect(isRecalibrationRequested(db, profileId)).toBe(true);
    expect(db.select().from(profiles).all()).toHaveLength(1);
  });

  it("n'écrit QUE le drapeau (jamais `mastery`/`attempts`) : la maîtrise ne bouge pas à l'armement", () => {
    upsertMastery(db, profileId, COMP10_7, dueState(1));
    const before = db.select().from(mastery).where(eq(mastery.profileId, profileId)).all();
    requestRecalibration(db, profileId);
    expect(db.select().from(mastery).where(eq(mastery.profileId, profileId)).all()).toEqual(before);
    expect(db.select().from(attempts).where(eq(attempts.profileId, profileId)).all()).toHaveLength(
      0,
    );
  });
});

describe("seedRecalibration — fusion MONOTONE (ADR 0016, #237 Option A)", () => {
  it("MONOTONE : un fait box 4 re-sondé juste+rapide (box 3) reste box 4 (JAMAIS rétrograde)", () => {
    upsertMastery(db, profileId, COMP10_7, dueState(4));
    requestRecalibration(db, profileId);
    // Même une réponse PARFAITE (fluente, box 3) ne peut pas abaisser une boîte 4 acquise.
    const written = seedRecalibration(db, profileId, [FLUENT_COMP10_7], config, NOW);
    expect(written).toHaveLength(0); // « keep » → aucune écriture
    expect(loadMasteryState(db, profileId, COMP10_7.key)?.box).toBe(4);
  });

  it("RAISE : un fait sous-amorcé (box 1) re-sondé juste+rapide → RELEVÉ à 3, échéance recalculée, dernière-vue = now, COMPTEURS INCHANGÉS", () => {
    const before: MasteryState = {
      box: 1,
      correctCount: 3,
      wrongCount: 2,
      avgResponseMs: 2_100,
      lastSeen: NOW - 5,
      nextDue: NOW - 5,
    };
    upsertMastery(db, profileId, COMP10_7, before);
    requestRecalibration(db, profileId);
    const written = seedRecalibration(db, profileId, [FLUENT_COMP10_7], config, NOW);
    expect(written).toHaveLength(1);
    const after = loadMasteryState(db, profileId, COMP10_7.key);
    expect(after?.box).toBe(3);
    expect(after?.nextDue).toBe(NOW + boxDelayMs(3, config)); // échéance recalculée sur la boîte relevée
    expect(after?.lastSeen).toBe(NOW);
    // La sonde de calibrage ne pollue PAS la justesse/rapidité rapportées (agrégats parent dérivent
    // d'`attempts`, ADR 0012/0014) : compteurs + moyenne de fluence STRICTEMENT préservés.
    expect(after?.correctCount).toBe(3);
    expect(after?.wrongCount).toBe(2);
    expect(after?.avgResponseMs).toBe(2_100);
  });

  it("CREATE : un fait JAMAIS amorcé re-sondé juste+rapide → ligne créée box 3 (comme l'amorçage initial)", () => {
    requestRecalibration(db, profileId);
    seedRecalibration(
      db,
      profileId,
      [{ factKey: MULT_6X8.key, skill: "mult", correct: true, responseMs: 1_200 }],
      config,
      NOW,
    );
    const after = loadMasteryState(db, profileId, MULT_6X8.key);
    expect(after?.box).toBe(3);
    expect(after?.correctCount).toBe(1);
    expect(after?.wrongCount).toBe(0);
  });

  it("les faits NON re-sondés sont INCHANGÉS (byte-for-byte)", () => {
    upsertMastery(db, profileId, COMP10_7, dueState(1));
    const untouched = makeFact("comp10", 3, 0);
    upsertMastery(db, profileId, untouched, dueState(4));
    const beforeUntouched = loadMasteryState(db, profileId, untouched.key);
    requestRecalibration(db, profileId);
    seedRecalibration(db, profileId, [FLUENT_COMP10_7], config, NOW);
    expect(loadMasteryState(db, profileId, untouched.key)).toEqual(beforeUntouched);
  });

  it("N'ÉCRIT JAMAIS `attempts` (sonde hors comptage de justesse — PARITÉ avec le diagnostic initial)", () => {
    upsertMastery(db, profileId, COMP10_7, dueState(1));
    requestRecalibration(db, profileId);
    seedRecalibration(db, profileId, [FLUENT_COMP10_7], config, NOW);
    expect(db.select().from(attempts).where(eq(attempts.profileId, profileId)).all()).toHaveLength(
      0,
    );
    // Parité : le diagnostic INITIAL n'écrit pas `attempts` non plus (même contrat de sonde).
    const other = seedProfile("Zoé");
    seedDiagnostic(db, other, [FLUENT_COMP10_7], config, NOW);
    expect(db.select().from(attempts).where(eq(attempts.profileId, other)).all()).toHaveLength(0);
  });

  it("cycle du drapeau : armé par requestRecalibration → EFFACÉ après un re-seed réussi", () => {
    upsertMastery(db, profileId, COMP10_7, dueState(1));
    expect(isRecalibrationRequested(db, profileId)).toBe(false);
    requestRecalibration(db, profileId);
    expect(isRecalibrationRequested(db, profileId)).toBe(true);
    seedRecalibration(db, profileId, [FLUENT_COMP10_7], config, NOW);
    expect(isRecalibrationRequested(db, profileId)).toBe(false); // demande consommée
  });

  it("GARDE ARMÉ : NON armé → no-op STRICT (aucune écriture, la maîtrise ne bouge pas)", () => {
    upsertMastery(db, profileId, COMP10_7, dueState(1)); // box 1
    // PAS de requestRecalibration → drapeau false.
    const before = db.select().from(mastery).where(eq(mastery.profileId, profileId)).all();
    const written = seedRecalibration(db, profileId, [FLUENT_COMP10_7], config, NOW);
    expect(written).toHaveLength(0);
    expect(db.select().from(mastery).where(eq(mastery.profileId, profileId)).all()).toEqual(before);
    // Le fait box 1 N'EST PAS relevé : la garde armé bloque. Mutation de la garde (retrait de la
    // condition `if (!isRecalibrationRequested(tx, …)) return []`) → le fait passerait à box 3 → ROUGE.
    expect(loadMasteryState(db, profileId, COMP10_7.key)?.box).toBe(1);
  });

  it("un 2ᵉ re-seed (drapeau déjà consommé) est un no-op : ne rétrograde pas ce que le 1ᵉʳ a relevé", () => {
    upsertMastery(db, profileId, COMP10_7, dueState(1));
    requestRecalibration(db, profileId);
    seedRecalibration(db, profileId, [FLUENT_COMP10_7], config, NOW);
    expect(loadMasteryState(db, profileId, COMP10_7.key)?.box).toBe(3);
    // 2ᵉ re-seed SANS ré-armer : drapeau consommé → no-op (n'écrase pas, ne re-relève pas).
    const written2 = seedRecalibration(
      db,
      profileId,
      [{ factKey: COMP10_7.key, skill: "comp10", correct: false, responseMs: 5_000 }],
      config,
      NOW,
    );
    expect(written2).toHaveLength(0);
    expect(loadMasteryState(db, profileId, COMP10_7.key)?.box).toBe(3); // pas rétrogradé
  });

  it("réponse forgée / hors-domaine → ignorée (garde de forme #36), le reste est fusionné", () => {
    upsertMastery(db, profileId, COMP10_7, dueState(1));
    requestRecalibration(db, profileId);
    const written = seedRecalibration(
      db,
      profileId,
      [{ factKey: "garbage", skill: "comp10", correct: true, responseMs: 1_200 }, FLUENT_COMP10_7],
      config,
      NOW,
    );
    // La clé forgée est écartée ; seul comp10_7 est relevé (box 1 → 3).
    expect(written).toHaveLength(1);
    expect(loadMasteryState(db, profileId, COMP10_7.key)?.box).toBe(3);
  });

  // GARDE ROLLBACK / ATOMICITÉ (≥ 2 écritures : upsert mastery PUIS effacement du drapeau) —
  // règle #122. On induit la panne à la **2ᵉ écriture GARDÉE** (l'UPDATE d'effacement du drapeau),
  // APRÈS la 1ʳᵉ écriture (upsert mastery box 1→3), via un TRIGGER `BEFORE UPDATE ON profiles` qui
  // `RAISE(ABORT)`. Le SELECT du garde armé (lecture `recalibration_requested`) N'est PAS affecté
  // (trigger BEFORE UPDATE seulement) → il ne court-circuite PAS avant la 1ʳᵉ écriture (jamais une
  // lecture en amont, règle #122). Le drapeau est armé AVANT la création du trigger (l'armement est
  // lui-même un UPDATE profiles). Ordre observé :
  //   1. upsert mastery (box 1 → 3) réussit          ← 1ʳᵉ écriture
  //   2. UPDATE profiles (drapeau → false) LÈVE (trigger) ← 2ᵉ écriture GARDÉE
  //   ⇒ ROLLBACK : la maîtrise reste box 1, le drapeau reste armé (jamais consommé à moitié).
  // PREUVE : retirer le wrapper `db.transaction` de `seedRecalibration` casse PRÉCISÉMENT ce test
  // (l'upsert box 3 persisterait malgré l'échec de l'effacement du drapeau). Vérifié par mutation.
  it("ROLLBACK : panne de l'effacement du drapeau (2ᵉ écriture) ⇒ maîtrise relevée ANNULÉE + drapeau reste armé", () => {
    upsertMastery(db, profileId, COMP10_7, dueState(1)); // box 1
    requestRecalibration(db, profileId); // armer AVANT le trigger (l'armement est un UPDATE profiles)
    db.run(
      sql`CREATE TRIGGER block_profiles_update BEFORE UPDATE ON profiles BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    );

    expect(() => seedRecalibration(db, profileId, [FLUENT_COMP10_7], config, NOW)).toThrow();

    db.run(sql`DROP TRIGGER block_profiles_update;`);
    // ROLLBACK PROUVÉ : la maîtrise relevée est annulée (box reste 1 — assertion PINNING de la
    // transaction) ET le drapeau reste ARMÉ (demande jamais consommée à moitié).
    expect(loadMasteryState(db, profileId, COMP10_7.key)?.box).toBe(1);
    expect(isRecalibrationRequested(db, profileId)).toBe(true);
  });

  it("CONTRÔLE : sans panne, le même re-seed relève bien la maîtrise (box 3) ET efface le drapeau", () => {
    upsertMastery(db, profileId, COMP10_7, dueState(1));
    requestRecalibration(db, profileId);
    seedRecalibration(db, profileId, [FLUENT_COMP10_7], config, NOW);
    expect(loadMasteryState(db, profileId, COMP10_7.key)?.box).toBe(3);
    expect(isRecalibrationRequested(db, profileId)).toBe(false);
  });
});
