import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import {
  isRecalibrationRequested,
  needsDiagnostic,
  seedDiagnostic,
  seedRecalibration,
  startLevel,
  submitAttempt,
  type SubmitAttemptInput,
} from "@/lib/engine/service";
import { selectDiagnostic } from "@/lib/engine/diagnostic";
import { finishLevel, type FinishLevelResult } from "@/lib/game/finish-level";
import type { RewardBreakdown } from "@/lib/game/reward";
import { getUnlockedWorldCount, resolveCurrentLevelTarget } from "@/lib/game/unlock";
import { evaluateScreenTimeLock } from "@/lib/parent/screen-time-lock";
import { readHouseholdSettings } from "@/lib/parent/settings";
import {
  diagnosticPlanAction,
  finishLevelAction,
  seedDiagnosticAction,
  startLevelAction,
  submitAttemptAction,
  unlockedWorldCountAction,
} from "./actions";

/** Payload de soumission complet (l'action ne fait que le transmettre au service mocké). */
const SUBMIT_INPUT: SubmitAttemptInput = {
  factKey: "comp10_7",
  skill: "comp10",
  correct: true,
  responseMs: 1200,
};

/**
 * Adaptateurs **minces** : on pilote le service (testé sur base réelle isolément) et on
 * vérifie (a) la garde de session enfant (jamais de profil client), (b) le mapping vers
 * une réponse cliente neutre, (c) l'injection horloge/RNG à la frontière.
 */

/** Config de test : seul `starThresholds` est lu directement par l'action (contrat #64). */
const FAKE_CONFIG = { starThresholds: [0.6, 0.85, 1] as const };
/** Config carte de test : `levelsPerWorld` transmis à `finishLevel`/`getUnlockedWorldCount`. */
const FAKE_MAP_CONFIG = { levelsPerWorld: 10, treasureEvery: 4, bossQuestionCount: 13 };
/** Barème ⚙️ de test — transmis à `finishLevel` (source de vérité serveur, ECONOMY §4.1). */
const FAKE_ECONOMY_CONFIG = {
  levelBaseCoins: 10,
  starBonusCoins: 5,
  treasureBonusCoins: 15,
  bossBonusCoins: 50,
};

/** Config régularité de test (story 7.4, ⚙️ transmis à `evaluateScreenTimeLock`). */
const FAKE_REGULARITY_CONFIG = {
  dayTimeZone: "Europe/Paris",
  maxDayAmplitudeMinutes: 240,
  streakBreakGapDays: 2,
  respectWindowMinMinutes: 15,
  respectWindowMaxMinutes: 20,
};
/** Réglages foyer de test (story 7.3) — verrou dur DÉSACTIVÉ par défaut (opt-in). */
const FAKE_HOUSEHOLD_SETTINGS = {
  theme: "system" as const,
  parentWorldValidation: false,
  screenTimeNudgeMinutes: 20,
  screenTimeHardLockEnabled: false,
  screenTimeHardLockMinutes: 45,
};

vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => "DB") }));
vi.mock("@/config/server-config", () => ({
  getEngineConfig: vi.fn(() => FAKE_CONFIG),
  getMapConfig: vi.fn(() => FAKE_MAP_CONFIG),
  getEconomyConfig: vi.fn(() => FAKE_ECONOMY_CONFIG),
  getRegularityConfig: vi.fn(() => FAKE_REGULARITY_CONFIG),
}));
vi.mock("@/lib/engine/service", () => ({
  startLevel: vi.fn(),
  submitAttempt: vi.fn(),
  seedDiagnostic: vi.fn(),
  needsDiagnostic: vi.fn(),
  isRecalibrationRequested: vi.fn(),
  seedRecalibration: vi.fn(),
}));
vi.mock("@/lib/engine/diagnostic", () => ({ selectDiagnostic: vi.fn() }));
vi.mock("@/lib/game/finish-level", () => ({ finishLevel: vi.fn() }));
vi.mock("@/lib/game/unlock", () => ({
  getUnlockedWorldCount: vi.fn(),
  resolveCurrentLevelTarget: vi.fn(),
}));
vi.mock("@/lib/parent/settings", () => ({ readHouseholdSettings: vi.fn() }));
vi.mock("@/lib/parent/screen-time-lock", () => ({ evaluateScreenTimeLock: vi.fn() }));

const profileMock = vi.mocked(getCurrentChildProfileId);
const startLevelMock = vi.mocked(startLevel);
const submitAttemptMock = vi.mocked(submitAttempt);
const seedDiagnosticMock = vi.mocked(seedDiagnostic);
const needsDiagnosticMock = vi.mocked(needsDiagnostic);
const isRecalibrationRequestedMock = vi.mocked(isRecalibrationRequested);
const seedRecalibrationMock = vi.mocked(seedRecalibration);
const selectDiagnosticMock = vi.mocked(selectDiagnostic);
const finishLevelMock = vi.mocked(finishLevel);
const getUnlockedWorldCountMock = vi.mocked(getUnlockedWorldCount);
const resolveTargetMock = vi.mocked(resolveCurrentLevelTarget);
const readHouseholdSettingsMock = vi.mocked(readHouseholdSettings);
const evaluateScreenTimeLockMock = vi.mocked(evaluateScreenTimeLock);

/** Décomposition de gain factice (le service la renvoie ; l'action la transmet au client). */
const FAKE_REWARD: RewardBreakdown = {
  base: 10,
  starBonus: 10,
  treasureBonus: 0,
  bossBonus: 0,
  total: 20,
};
/** Cible résolue **serveur** factice (monde/niveau) — jamais transmise par le client. */
const FAKE_TARGET = { worldIndex: 0, levelIndex: 3 };
/** Légendaire factice (le service la renvoie sur un boss ; l'action la transmet). */
const FAKE_LEGENDARY = {
  characterId: "legendary:0",
  name: "Braisille",
  story: "La gardienne légendaire de ce monde.",
  artRef: "placeholder://legendary/0",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Verrou dur temps d'écran : DÉSACTIVÉ/non bloquant par défaut (opt-in parent, story 7.8) —
  // les tests hors-scope du verrou n'ont pas à le paramétrer explicitement.
  readHouseholdSettingsMock.mockReturnValue(FAKE_HOUSEHOLD_SETTINGS);
  evaluateScreenTimeLockMock.mockReturnValue(false);
  // Recalibrage NON armé par défaut (story 7.6) — les tests hors-scope du recalibrage n'ont pas à
  // le paramétrer ; seuls les tests dédiés l'arment (`isRecalibrationRequestedMock.mockReturnValue`).
  isRecalibrationRequestedMock.mockReturnValue(false);
});

describe("startLevelAction", () => {
  it("non authentifié → { level: null }, starThresholds ⚙️ renvoyé quand même, aucun appel moteur", async () => {
    profileMock.mockResolvedValue(null);
    await expect(startLevelAction()).resolves.toEqual({
      level: null,
      starThresholds: FAKE_CONFIG.starThresholds,
      locked: false,
    });
    expect(startLevelMock).not.toHaveBeenCalled();
    // Le verrou temps d'écran n'a même pas de session à évaluer (garde d'auth en amont).
    expect(readHouseholdSettingsMock).not.toHaveBeenCalled();
    expect(evaluateScreenTimeLockMock).not.toHaveBeenCalled();
  });

  it("authentifié → compose le niveau du profil de session (horloge + RNG injectés) + starThresholds", async () => {
    profileMock.mockResolvedValue(7);
    // Cible résolue serveur = nœud NON-boss (levelIndex 3, treasure d'après la géométrie).
    resolveTargetMock.mockReturnValue(FAKE_TARGET);
    const level = { questions: [] };
    startLevelMock.mockReturnValue(level);
    await expect(startLevelAction()).resolves.toEqual({
      level,
      starThresholds: FAKE_CONFIG.starThresholds,
      locked: false,
    });
    // Profil de session (7), config + db mockés ; now = number, rng = fonction.
    expect(startLevelMock).toHaveBeenCalledTimes(1);
    const [dbArg, profileArg, configArg, nowArg, rngArg] = startLevelMock.mock.calls[0];
    expect(dbArg).toBe("DB");
    expect(profileArg).toBe(7);
    expect(configArg).toBe(FAKE_CONFIG);
    expect(typeof nowArg).toBe("number");
    expect(typeof rngArg).toBe("function");
  });

  // GARDE « nœud NON-boss ⇒ taille normale (LEVEL_SIZE) » (effet observable) : la cible
  // résolue serveur est un nœud non-boss (levelIndex 3 < boss 10 d'après la géométrie
  // FAKE_MAP_CONFIG) → `startLevel` reçoit `{ size: 10 }`. Le type de nœud est dérivé
  // SERVEUR (baseNodeTypeAt réel, jamais mocké), jamais transmis par le client.
  it("nœud NON-boss ⇒ startLevel appelé avec size = LEVEL_SIZE (10), pas la taille boss", async () => {
    profileMock.mockResolvedValue(7);
    resolveTargetMock.mockReturnValue({ worldIndex: 0, levelIndex: 3 }); // treasure, non-boss
    startLevelMock.mockReturnValue({ questions: [] });
    await startLevelAction();
    const options = startLevelMock.mock.calls[0][5];
    expect(options).toEqual({ size: 10 }); // LEVEL_SIZE, jamais bossQuestionCount (13)
    // Cible résolue SERVEUR depuis le profil de session (jamais du client).
    expect(resolveTargetMock).toHaveBeenCalledWith("DB", 7, FAKE_MAP_CONFIG.levelsPerWorld);
  });

  // GARDE « nœud BOSS ⇒ taille plus longue (bossQuestionCount) » (effet observable,
  // mutation-prouvé) : la cible résolue serveur est le boss (levelIndex === levelsPerWorld =
  // 10, dernier nœud d'après la géométrie) → `startLevel` reçoit `{ size: 13 }` (⚙️
  // bossQuestionCount). ROUGE si le boss retombait sur LEVEL_SIZE (le wiring `isBoss` sauté).
  it("nœud BOSS ⇒ startLevel appelé avec size = bossQuestionCount (13), pas LEVEL_SIZE", async () => {
    profileMock.mockResolvedValue(7);
    resolveTargetMock.mockReturnValue({ worldIndex: 0, levelIndex: 10 }); // boss = dernier nœud
    startLevelMock.mockReturnValue({ questions: [] });
    await startLevelAction();
    const options = startLevelMock.mock.calls[0][5];
    expect(options).toEqual({ size: FAKE_MAP_CONFIG.bossQuestionCount }); // 13, PAS 10
  });

  // ── Verrou dur temps d'écran (story 7.8 #229, DETAILS §27) — wiring du call-site ──
  // La borne exacte (seuil atteint bloque, juste sous passe) est mutation-prouvée sur base
  // réelle dans `lib/parent/screen-time-lock.test.ts` ; ici on prouve le CÂBLAGE au call-site :
  // le résultat de `evaluateScreenTimeLock` détermine si `startLevelAction` résout/compose un
  // niveau, et les bons arguments (foyer + config régularité + horloge) lui sont transmis.

  it("verrou ACTIF (evaluateScreenTimeLock→true) ⇒ { level: null, locked: true }, AUCUNE résolution/composition de niveau", async () => {
    profileMock.mockResolvedValue(7);
    evaluateScreenTimeLockMock.mockReturnValue(true);
    await expect(startLevelAction()).resolves.toEqual({
      level: null,
      starThresholds: FAKE_CONFIG.starThresholds,
      locked: true,
    });
    // ROUGE si le court-circuit était retiré : le serveur ne doit jamais résoudre/composer un
    // niveau qu'il s'apprête à refuser (pas de fuite de la géométrie de carte).
    expect(resolveTargetMock).not.toHaveBeenCalled();
    expect(startLevelMock).not.toHaveBeenCalled();
  });

  it("verrou évalué avec le foyer + la config régularité + une horloge (câblage des arguments)", async () => {
    profileMock.mockResolvedValue(7);
    resolveTargetMock.mockReturnValue(FAKE_TARGET);
    startLevelMock.mockReturnValue({ questions: [] });
    await startLevelAction();
    expect(readHouseholdSettingsMock).toHaveBeenCalledWith("DB");
    expect(evaluateScreenTimeLockMock).toHaveBeenCalledTimes(1);
    const [dbArg, profileArg, settingsArg, regularityArg, nowArg] =
      evaluateScreenTimeLockMock.mock.calls[0];
    expect(dbArg).toBe("DB");
    expect(profileArg).toBe(7);
    expect(settingsArg).toBe(FAKE_HOUSEHOLD_SETTINGS);
    expect(regularityArg).toBe(FAKE_REGULARITY_CONFIG);
    expect(typeof nowArg).toBe("number");
  });

  it("verrou INACTIF (défaut) ⇒ le niveau se compose normalement (non-régression du chemin nominal)", async () => {
    profileMock.mockResolvedValue(7);
    resolveTargetMock.mockReturnValue(FAKE_TARGET);
    const level = { questions: [] };
    startLevelMock.mockReturnValue(level);
    await expect(startLevelAction()).resolves.toEqual({
      level,
      starThresholds: FAKE_CONFIG.starThresholds,
      locked: false,
    });
  });
});

describe("submitAttemptAction", () => {
  it("non authentifié → { ok: false, box: null }, aucune écriture", async () => {
    profileMock.mockResolvedValue(null);
    await expect(submitAttemptAction(SUBMIT_INPUT)).resolves.toEqual({
      ok: false,
      box: null,
    });
    expect(submitAttemptMock).not.toHaveBeenCalled();
  });

  it("payload invalide → { ok: false, box: null } (mappe le refus service)", async () => {
    profileMock.mockResolvedValue(7);
    submitAttemptMock.mockReturnValue({ ok: false, error: "INVALID_FACT" });
    await expect(submitAttemptAction({ ...SUBMIT_INPUT, factKey: 1 })).resolves.toEqual({
      ok: false,
      box: null,
    });
  });

  it("succès → { ok: true, box } depuis l'état renvoyé par le service", async () => {
    profileMock.mockResolvedValue(7);
    submitAttemptMock.mockReturnValue({
      ok: true,
      duplicate: false,
      state: {
        box: 2,
        correctCount: 1,
        wrongCount: 0,
        avgResponseMs: 1000,
        lastSeen: 1,
        nextDue: 2,
      },
    });
    await expect(submitAttemptAction(SUBMIT_INPUT)).resolves.toEqual({
      ok: true,
      box: 2,
    });
    // Le profil vient de la session (7), pas du payload.
    expect(submitAttemptMock.mock.calls[0][1]).toBe(7);
  });

  it("re-essai (state null) → { ok: true, box: null }", async () => {
    profileMock.mockResolvedValue(7);
    submitAttemptMock.mockReturnValue({ ok: true, duplicate: false, state: null });
    await expect(submitAttemptAction(SUBMIT_INPUT)).resolves.toEqual({
      ok: true,
      box: null,
    });
  });
});

describe("diagnosticPlanAction", () => {
  it("non authentifié → { items: null }", async () => {
    profileMock.mockResolvedValue(null);
    await expect(diagnosticPlanAction()).resolves.toEqual({ items: null });
    expect(needsDiagnosticMock).not.toHaveBeenCalled();
  });

  it("profil déjà amorcé ET recalibrage NON armé → { items: [] } (pas de re-diagnostic)", async () => {
    profileMock.mockResolvedValue(7);
    needsDiagnosticMock.mockReturnValue(false);
    isRecalibrationRequestedMock.mockReturnValue(false);
    await expect(diagnosticPlanAction()).resolves.toEqual({ items: [] });
    expect(selectDiagnosticMock).not.toHaveBeenCalled();
  });

  it("profil vierge → renvoie le plan de sélection", async () => {
    profileMock.mockResolvedValue(7);
    needsDiagnosticMock.mockReturnValue(true);
    const items = [{ fact: { key: "comp10_7" }, difficulty: "easy" }] as never;
    selectDiagnosticMock.mockReturnValue(items);
    await expect(diagnosticPlanAction()).resolves.toEqual({ items });
  });

  it("profil amorcé MAIS recalibrage ARMÉ (7.6) → renvoie le plan (re-présente le diagnostic)", async () => {
    profileMock.mockResolvedValue(7);
    needsDiagnosticMock.mockReturnValue(false); // mastery non vide
    isRecalibrationRequestedMock.mockReturnValue(true); // parent a demandé un recalibrage
    const items = [{ fact: { key: "comp10_7" }, difficulty: "easy" }] as never;
    selectDiagnosticMock.mockReturnValue(items);
    await expect(diagnosticPlanAction()).resolves.toEqual({ items });
  });
});

describe("seedDiagnosticAction", () => {
  it("non authentifié → { ok: false, seededCount: 0 }", async () => {
    profileMock.mockResolvedValue(null);
    await expect(seedDiagnosticAction([])).resolves.toEqual({ ok: false, seededCount: 0 });
    expect(seedDiagnosticMock).not.toHaveBeenCalled();
  });

  it("NON armé → amorçage initial (seedDiagnostic), renvoie le nombre de lignes amorcées", async () => {
    profileMock.mockResolvedValue(7);
    isRecalibrationRequestedMock.mockReturnValue(false);
    seedDiagnosticMock.mockReturnValue([
      { factKey: "comp10_7", state: {} as never },
      { factKey: "mult_6x8", state: {} as never },
    ]);
    await expect(seedDiagnosticAction([])).resolves.toEqual({ ok: true, seededCount: 2 });
    expect(seedDiagnosticMock.mock.calls[0][1]).toBe(7); // profil de session
    expect(seedRecalibrationMock).not.toHaveBeenCalled(); // routage : pas la branche recalibrage
  });

  it("recalibrage ARMÉ (7.6) → ROUTE vers seedRecalibration (fusion monotone), PAS seedDiagnostic", async () => {
    profileMock.mockResolvedValue(7);
    isRecalibrationRequestedMock.mockReturnValue(true);
    seedRecalibrationMock.mockReturnValue([
      { factKey: "comp10_7", action: "raise", state: {} as never },
    ]);
    await expect(seedDiagnosticAction([])).resolves.toEqual({ ok: true, seededCount: 1 });
    expect(seedRecalibrationMock.mock.calls[0][1]).toBe(7); // profil de session
    // Routage mutation-prouvé : la branche armée n'appelle JAMAIS l'amorçage initial (n'écraserait
    // pas la maîtrise). Retirer le routage `isRecalibrationRequested ? … : …` → seedDiagnostic appelé.
    expect(seedDiagnosticMock).not.toHaveBeenCalled();
  });
});

describe("finishLevelAction", () => {
  /** Membre « succès » du résultat service (branche `ok: true`). */
  type FinishSuccess = Extract<FinishLevelResult, { ok: true }>;

  /** Résultat succès factice du service (avec gains) — surchargeable par test. */
  function successResult(overrides: Partial<FinishSuccess> = {}): FinishSuccess {
    return {
      ok: true,
      stars: 2,
      unlockedNextWorld: false,
      reward: FAKE_REWARD,
      balance: { coins: 20, shards: 0 },
      coinsApplied: true,
      legendary: null,
      legendaryAdded: false,
      ...overrides,
    };
  }

  it("non authentifié → { ok: false, error: UNAUTHENTICATED }, aucune résolution ni écriture", async () => {
    profileMock.mockResolvedValue(null);
    await expect(finishLevelAction(2)).resolves.toEqual({
      ok: false,
      stars: null,
      unlockedNextWorld: false,
      reward: null,
      coins: null,
      coinsApplied: false,
      legendary: null,
      legendaryAdded: false,
      error: "UNAUTHENTICATED",
    });
    expect(resolveTargetMock).not.toHaveBeenCalled();
    expect(finishLevelMock).not.toHaveBeenCalled();
  });

  it("refus service → { ok: false, error } (mappe le refus, pas de 500, tous gains à null)", async () => {
    profileMock.mockResolvedValue(7);
    resolveTargetMock.mockReturnValue(FAKE_TARGET);
    finishLevelMock.mockReturnValue({ ok: false, error: "LEVEL_LOCKED" });
    await expect(finishLevelAction(2)).resolves.toEqual({
      ok: false,
      stars: null,
      unlockedNextWorld: false,
      reward: null,
      coins: null,
      coinsApplied: false,
      legendary: null,
      legendaryAdded: false,
      error: "LEVEL_LOCKED",
    });
  });

  it("succès non-boss → gains renvoyés ; CIBLE résolue SERVEUR (jamais du client) + barème + Date injectés", async () => {
    profileMock.mockResolvedValue(7);
    resolveTargetMock.mockReturnValue(FAKE_TARGET);
    finishLevelMock.mockReturnValue(successResult());
    // Le client n'envoie QUE ses étoiles (jamais un world/level_index, SYNC §1).
    await expect(finishLevelAction(2)).resolves.toEqual({
      ok: true,
      stars: 2,
      unlockedNextWorld: false,
      reward: FAKE_REWARD,
      coins: 20,
      coinsApplied: true,
      legendary: null,
      legendaryAdded: false,
      error: null,
    });
    // La cible est résolue serveur depuis le profil de session + levelsPerWorld.
    expect(resolveTargetMock).toHaveBeenCalledTimes(1);
    const [tDb, tProfile, tLevels] = resolveTargetMock.mock.calls[0];
    expect(tDb).toBe("DB");
    expect(tProfile).toBe(7);
    expect(tLevels).toBe(FAKE_MAP_CONFIG.levelsPerWorld);
    // `finishLevel` reçoit la cible résolue serveur + les étoiles du client + les 2 configs.
    expect(finishLevelMock).toHaveBeenCalledTimes(1);
    const [dbArg, profileArg, inputArg, mapArg, ecoArg, nowArg] = finishLevelMock.mock.calls[0];
    expect(dbArg).toBe("DB");
    expect(profileArg).toBe(7); // profil de session, jamais du client
    expect(inputArg).toEqual({ worldIndex: 0, levelIndex: 3, stars: 2 }); // cible serveur + étoiles client
    expect(mapArg).toBe(FAKE_MAP_CONFIG);
    expect(ecoArg).toBe(FAKE_ECONOMY_CONFIG);
    expect(nowArg).toBeInstanceOf(Date);
  });

  it("succès boss → { unlockedNextWorld: true } + légendaire surfacée (story 5.6)", async () => {
    profileMock.mockResolvedValue(7);
    resolveTargetMock.mockReturnValue({ worldIndex: 0, levelIndex: 10 });
    finishLevelMock.mockReturnValue(
      successResult({
        stars: 1,
        unlockedNextWorld: true,
        reward: FAKE_REWARD,
        legendary: FAKE_LEGENDARY,
        legendaryAdded: true,
      }),
    );
    const res = await finishLevelAction(1);
    expect(res.ok).toBe(true);
    expect(res.unlockedNextWorld).toBe(true);
    expect(res.coins).toBe(20);
    // La légendaire garantie du boss est transmise au client (nom + histoire + art placeholder).
    expect(res.legendary).toEqual(FAKE_LEGENDARY);
    expect(res.legendaryAdded).toBe(true);
  });

  it("rejeu (coinsApplied false) → solde inchangé renvoyé, coinsApplied false (idempotence exposée)", async () => {
    profileMock.mockResolvedValue(7);
    resolveTargetMock.mockReturnValue(FAKE_TARGET);
    finishLevelMock.mockReturnValue(
      successResult({ coinsApplied: false, balance: { coins: 20, shards: 0 } }),
    );
    const res = await finishLevelAction(2);
    expect(res.coinsApplied).toBe(false);
    expect(res.coins).toBe(20); // solde inchangé (pas de double crédit)
  });
});

describe("unlockedWorldCountAction", () => {
  it("non authentifié → { count: null }, aucune lecture", async () => {
    profileMock.mockResolvedValue(null);
    await expect(unlockedWorldCountAction()).resolves.toEqual({ count: null });
    expect(getUnlockedWorldCountMock).not.toHaveBeenCalled();
  });

  it("authentifié → nombre de mondes débloqués (profil de session + levelsPerWorld de la config)", async () => {
    profileMock.mockResolvedValue(7);
    getUnlockedWorldCountMock.mockReturnValue(3);
    await expect(unlockedWorldCountAction()).resolves.toEqual({ count: 3 });
    expect(getUnlockedWorldCountMock).toHaveBeenCalledTimes(1);
    const [dbArg, profileArg, levelsArg] = getUnlockedWorldCountMock.mock.calls[0];
    expect(dbArg).toBe("DB");
    expect(profileArg).toBe(7);
    expect(levelsArg).toBe(FAKE_MAP_CONFIG.levelsPerWorld);
  });
});
