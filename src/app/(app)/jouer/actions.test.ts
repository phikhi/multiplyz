import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import {
  needsDiagnostic,
  seedDiagnostic,
  startLevel,
  submitAttempt,
  type SubmitAttemptInput,
} from "@/lib/engine/service";
import { selectDiagnostic } from "@/lib/engine/diagnostic";
import {
  diagnosticPlanAction,
  seedDiagnosticAction,
  startLevelAction,
  submitAttemptAction,
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

vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => "DB") }));
vi.mock("@/config/server-config", () => ({ getEngineConfig: vi.fn(() => FAKE_CONFIG) }));
vi.mock("@/lib/engine/service", () => ({
  startLevel: vi.fn(),
  submitAttempt: vi.fn(),
  seedDiagnostic: vi.fn(),
  needsDiagnostic: vi.fn(),
}));
vi.mock("@/lib/engine/diagnostic", () => ({ selectDiagnostic: vi.fn() }));

const profileMock = vi.mocked(getCurrentChildProfileId);
const startLevelMock = vi.mocked(startLevel);
const submitAttemptMock = vi.mocked(submitAttempt);
const seedDiagnosticMock = vi.mocked(seedDiagnostic);
const needsDiagnosticMock = vi.mocked(needsDiagnostic);
const selectDiagnosticMock = vi.mocked(selectDiagnostic);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startLevelAction", () => {
  it("non authentifié → { level: null }, starThresholds ⚙️ renvoyé quand même, aucun appel moteur", async () => {
    profileMock.mockResolvedValue(null);
    await expect(startLevelAction()).resolves.toEqual({
      level: null,
      starThresholds: FAKE_CONFIG.starThresholds,
    });
    expect(startLevelMock).not.toHaveBeenCalled();
  });

  it("authentifié → compose le niveau du profil de session (horloge + RNG injectés) + starThresholds", async () => {
    profileMock.mockResolvedValue(7);
    const level = { questions: [] };
    startLevelMock.mockReturnValue(level);
    await expect(startLevelAction()).resolves.toEqual({
      level,
      starThresholds: FAKE_CONFIG.starThresholds,
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

  it("profil déjà amorcé → { items: [] } (pas de re-diagnostic)", async () => {
    profileMock.mockResolvedValue(7);
    needsDiagnosticMock.mockReturnValue(false);
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
});

describe("seedDiagnosticAction", () => {
  it("non authentifié → { ok: false, seededCount: 0 }", async () => {
    profileMock.mockResolvedValue(null);
    await expect(seedDiagnosticAction([])).resolves.toEqual({ ok: false, seededCount: 0 });
    expect(seedDiagnosticMock).not.toHaveBeenCalled();
  });

  it("authentifié → amorce et renvoie le nombre de lignes amorcées", async () => {
    profileMock.mockResolvedValue(7);
    seedDiagnosticMock.mockReturnValue([
      { factKey: "comp10_7", state: {} as never },
      { factKey: "mult_6x8", state: {} as never },
    ]);
    await expect(seedDiagnosticAction([])).resolves.toEqual({ ok: true, seededCount: 2 });
    expect(seedDiagnosticMock.mock.calls[0][1]).toBe(7); // profil de session
  });
});
