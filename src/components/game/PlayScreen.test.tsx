import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlayScreen } from "./PlayScreen";
import { strings } from "@/strings";
import {
  diagnosticPlanAction,
  finishLevelAction,
  seedDiagnosticAction,
  startLevelAction,
  submitAttemptAction,
} from "@/app/(app)/jouer/actions";
import { makeFact } from "@/lib/engine/facts";
import type { LevelQuestion } from "@/lib/engine/service";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/login/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/app/(app)/jouer/actions", () => ({
  diagnosticPlanAction: vi.fn(),
  finishLevelAction: vi.fn(),
  seedDiagnosticAction: vi.fn(),
  startLevelAction: vi.fn(),
  submitAttemptAction: vi.fn(),
}));

const diagnosticPlanMock = vi.mocked(diagnosticPlanAction);
const finishLevelActionMock = vi.mocked(finishLevelAction);
const seedDiagnosticMock = vi.mocked(seedDiagnosticAction);
const startLevelMock = vi.mocked(startLevelAction);
const submitAttemptMock = vi.mocked(submitAttemptAction);

const STAR_THRESHOLDS = [0.6, 0.85, 1] as const;

const KNOWN_FACTS = {
  mult_6x8: makeFact("mult", 6, 8),
  "add_3+8": makeFact("add", 3, 8),
  "sub_15-6": makeFact("sub", 15, 6),
} as const;

function question(
  factKey: keyof typeof KNOWN_FACTS,
  format: "qcm" | "pave" = "qcm",
): LevelQuestion {
  const fact = KNOWN_FACTS[factKey];
  return {
    factKey: fact.key,
    skill: fact.skill,
    operands: fact.operands,
    format,
    choices:
      format === "qcm" ? [fact.answer, fact.answer + 1, fact.answer - 1, fact.answer + 2] : null,
    isReask: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  diagnosticPlanMock.mockResolvedValue({ items: [] }); // profil déjà amorcé par défaut
  // Fin de niveau réussie par défaut (avec gain) — les tests qui atteignent l'écran de
  // résultats déclenchent `finishLevelAction` (persistance + crédit). Surchargé au besoin.
  finishLevelActionMock.mockResolvedValue({
    ok: true,
    stars: 0,
    unlockedNextWorld: false,
    reward: { base: 10, starBonus: 0, treasureBonus: 0, bossBonus: 0, total: 10 },
    coins: 10,
    coinsApplied: true,
    legendary: null,
    legendaryAdded: false,
    error: null,
  });
});

describe("PlayScreen — chargement", () => {
  it("affiche l'état de chargement avant toute résolution de plan", () => {
    diagnosticPlanMock.mockReturnValue(new Promise(() => {})); // jamais résolue
    render(<PlayScreen />);
    expect(
      screen.getByRole("heading", { level: 1, name: strings.play.loading }),
    ).toBeInTheDocument();
  });

  it("session invalide (diagnosticPlanAction → items:null) → écran d'erreur avec retry", async () => {
    diagnosticPlanMock.mockResolvedValue({ items: null });
    render(<PlayScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.loadError }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: strings.play.loadErrorRetry })).toBeInTheDocument();
  });

  it("retry après erreur relance le chargement", async () => {
    diagnosticPlanMock.mockResolvedValueOnce({ items: null });
    render(<PlayScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.loadError }),
      ).toBeInTheDocument(),
    );

    diagnosticPlanMock.mockResolvedValueOnce({ items: [] });
    startLevelMock.mockResolvedValueOnce({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    fireEvent.click(screen.getByRole("button", { name: strings.play.loadErrorRetry }));
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
  });

  it("niveau structurellement vide → message dédié (cas défensif ENGINE §4)", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    render(<PlayScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.emptyLevel }),
      ).toBeInTheDocument(),
    );
  });

  it("session invalide au démarrage de niveau (level:null) → écran d'erreur", async () => {
    startLevelMock.mockResolvedValue({
      level: null,
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    render(<PlayScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.loadError }),
      ).toBeInTheDocument(),
    );
  });
});

describe("PlayScreen — verrou dur temps d'écran (story 7.8 #229, DETAILS §27)", () => {
  // `level: null` est renvoyé à la fois par le refus d'auth ET par le verrou — la garde
  // discrimine sur `locked`, jamais sur `level === null` seul (les deux tests ci-dessus/dessous
  // prouvent les DEUX branches restent distinctes : rouge si `locked` était ignoré).
  it("verrou ACTIF (locked:true) → écran de blocage dédié, voix Teddy, DISTINCT de l'écran d'erreur", async () => {
    startLevelMock.mockResolvedValue({
      level: null,
      starThresholds: STAR_THRESHOLDS,
      locked: true,
    });
    render(<PlayScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.screenTimeLocked.title }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(strings.play.screenTimeLocked.hint)).toBeInTheDocument();
    // JAMAIS l'écran d'erreur générique (deux causes distinctes, deux écrans distincts).
    expect(
      screen.queryByRole("heading", { level: 1, name: strings.play.loadError }),
    ).not.toBeInTheDocument();
    // Aucun bouton « Réessayer » : rejouer ne change rien avant demain (pas un souci réseau).
    expect(
      screen.queryByRole("button", { name: strings.play.loadErrorRetry }),
    ).not.toBeInTheDocument();
    // Sortie possible : changer de joueur (jamais bloqué HORS du jeu, seulement l'entrée en niveau).
    expect(screen.getByRole("button", { name: strings.play.logout })).toBeInTheDocument();
  });

  it("verrou INACTIF (locked:false, level:null) → reste l'écran d'erreur générique (non-régression)", async () => {
    startLevelMock.mockResolvedValue({
      level: null,
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    render(<PlayScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.loadError }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { level: 1, name: strings.play.screenTimeLocked.title }),
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// StatusMessage — focus a11y au montage (#244, patron ResultsScreen.tsx/LEARNINGS #36). Chaque
// état plein-écran remplace le précédent SANS changement de route (aucune annonce SR native) →
// le titre doit recevoir le focus PROGRAMMATIQUEMENT. `locked` est PRIORITAIRE (empêche l'entrée
// en jeu, story 7.8). `outline:"none"` documenté (STACK-TRAP #222) : focus hors ordre clavier
// (tabIndex=-1) → l'anneau UA natif serait un artefact sans valeur a11y ici.
// ============================================================================
describe("PlayScreen — StatusMessage : focus a11y au montage (#244)", () => {
  it("écran verrou (locked) → focus déplacé sur le titre, SANS anneau UA — écran PRIORITAIRE", async () => {
    startLevelMock.mockResolvedValue({
      level: null,
      starThresholds: STAR_THRESHOLDS,
      locked: true,
    });
    render(<PlayScreen />);
    const heading = await screen.findByRole("heading", {
      level: 1,
      name: strings.play.screenTimeLocked.title,
    });
    expect(document.activeElement).toBe(heading);
    expect(heading.style.outline).toBe("none");
  });

  it("écran d'erreur → focus déplacé sur le titre, SANS anneau UA", async () => {
    diagnosticPlanMock.mockResolvedValue({ items: null });
    render(<PlayScreen />);
    const heading = await screen.findByRole("heading", { level: 1, name: strings.play.loadError });
    expect(document.activeElement).toBe(heading);
    expect(heading.style.outline).toBe("none");
  });

  it("niveau vide → focus déplacé sur le titre, SANS anneau UA", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    render(<PlayScreen />);
    const heading = await screen.findByRole("heading", {
      level: 1,
      name: strings.play.emptyLevel,
    });
    expect(document.activeElement).toBe(heading);
    expect(heading.style.outline).toBe("none");
  });
});

describe("PlayScreen — diagnostic de départ (ENGINE §3, 1re session)", () => {
  it("profil vierge → écran d'intro diagnostic (aucun score)", async () => {
    const items = [{ fact: makeFact("mult", 6, 8), difficulty: "easy" as const }];
    diagnosticPlanMock.mockResolvedValue({ items });
    render(<PlayScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.diagnostic.intro }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(strings.play.diagnostic.hint)).toBeInTheDocument();
  });

  it("démarre le diagnostic (QCM systématique) puis amorce la maîtrise à la fin", async () => {
    const items = [{ fact: makeFact("mult", 6, 8), difficulty: "easy" as const }];
    // 1er appel (profil vierge) → plan non vide ; après amorçage, le profil n'est plus
    // vierge → 2e appel (rechargement post-diagnostic) doit renvoyer un plan vide pour
    // enchaîner sur `startLevelAction` (mêmes garanties que le service réel).
    diagnosticPlanMock.mockResolvedValueOnce({ items }).mockResolvedValue({ items: [] });
    seedDiagnosticMock.mockResolvedValue({ ok: true, seededCount: 1 });
    startLevelMock.mockResolvedValue({
      level: { questions: [question("add_3+8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });

    render(<PlayScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.diagnostic.intro }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));

    // Question de diagnostic affichée (QCM, ENGINE §6 fait neuf → QCM).
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    const fact = makeFact("mult", 6, 8);
    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(fact.answer)),
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));

    // Dernière (seule) question du diagnostic → amorçage puis chargement du 1er niveau.
    await waitFor(() => expect(seedDiagnosticMock).toHaveBeenCalledTimes(1));
    expect(seedDiagnosticMock.mock.calls[0][0]).toEqual([
      { factKey: fact.key, skill: fact.skill, correct: true, responseMs: expect.any(Number) },
    ]);
    // Le diagnostic n'appelle jamais submitAttemptAction (amorçage dédié, pas la maîtrise du niveau).
    expect(submitAttemptMock).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByText("3 + 8 = ?")).toBeInTheDocument());
  });

  it("« je ne sais pas » pendant le diagnostic → accumulé comme faux, jamais submitAttemptAction", async () => {
    const items = [{ fact: makeFact("mult", 6, 8), difficulty: "easy" as const }];
    diagnosticPlanMock.mockResolvedValueOnce({ items }).mockResolvedValue({ items: [] });
    seedDiagnosticMock.mockResolvedValue({ ok: true, seededCount: 1 });
    startLevelMock.mockResolvedValue({
      level: { questions: [question("add_3+8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });

    render(<PlayScreen />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.diagnostic.intro }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));

    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: strings.play.question.dontKnow }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: strings.play.retry.tryAgain }));

    const fact = makeFact("mult", 6, 8);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(fact.answer)),
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));

    await waitFor(() => expect(seedDiagnosticMock).toHaveBeenCalledTimes(1));
    // Les 2 réponses (« je ne sais pas » puis le re-essai juste) sont **toutes deux**
    // envoyées — le dédoublonnage par clé (dernière réponse gagne) vit côté service
    // (`seedDiagnosticMastery`, ENGINE §3), pas ici. Le client ne fait qu'accumuler.
    expect(seedDiagnosticMock.mock.calls[0][0]).toEqual([
      { factKey: fact.key, skill: fact.skill, correct: false, responseMs: expect.any(Number) },
      { factKey: fact.key, skill: fact.skill, correct: true, responseMs: expect.any(Number) },
    ]);
    expect(submitAttemptMock).not.toHaveBeenCalled();
  });
});

describe("PlayScreen — niveau normal, QCM, no-fail (ENGINE §9)", () => {
  it("réponse juste → feedback positif puis continue vers la question suivante", async () => {
    const fact68 = makeFact("mult", 6, 8);
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8"), question("add_3+8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 1 });

    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());

    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(fact68.answer)),
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(submitAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({ factKey: fact68.key, correct: true, isRetry: false }),
    );

    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));
    await waitFor(() => expect(screen.getByText("3 + 8 = ?")).toBeInTheDocument());
  });

  it("réponse fausse → re-essai proposé (bonne réponse montrée), puis avance après re-essai", async () => {
    const fact68 = makeFact("mult", 6, 8);
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 0 });

    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());

    // Choisit un distracteur (≠ bonne réponse).
    const wrongChoice = [fact68.answer + 1, fact68.answer - 1, fact68.answer + 2].find(
      (v) => v !== fact68.answer,
    )!;
    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(wrongChoice)),
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(strings.play.retry.answerReveal.replace("{n}", String(fact68.answer))),
      ).toBeInTheDocument(),
    );
    expect(submitAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({ correct: false, isRetry: false }),
    );

    // Re-essai : même clientAttemptId, isRetry=true à la prochaine soumission.
    fireEvent.click(screen.getByRole("button", { name: strings.play.retry.tryAgain }));
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());

    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(fact68.answer)),
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(submitAttemptMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ factKey: fact68.key, correct: true, isRetry: true }),
    );

    // Fin de niveau (unique question) → résultats (0 % de 1re-réponse-juste → 0 étoile).
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.results.title }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(strings.play.results.byStars[0])).toBeInTheDocument();
  });

  it("« je ne sais pas » compte comme faux, sans pénalité (ENGINE §9)", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 0 });

    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: strings.play.question.dontKnow }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(submitAttemptMock).toHaveBeenCalledWith(expect.objectContaining({ correct: false }));
  });
});

describe("PlayScreen — niveau normal, format pavé", () => {
  it("saisie pavé jugée localement (juste) puis feedback positif", async () => {
    const factAdd = makeFact("add", 3, 8);
    startLevelMock.mockResolvedValue({
      level: { questions: [question("add_3+8", "pave")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 3 });

    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("3 + 8 = ?")).toBeInTheDocument());

    for (const d of String(factAdd.answer)) {
      fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", d) }));
    }
    fireEvent.click(screen.getByRole("button", { name: strings.play.question.submit }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(submitAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({ factKey: factAdd.key, correct: true }),
    );
  });
});

describe("PlayScreen — fin de niveau et étoiles (ENGINE §5)", () => {
  it("100 % de justesse 1re réponse → 3 étoiles, jamais d'écran d'échec", async () => {
    const fact68 = makeFact("mult", 6, 8);
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 1 });

    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(fact68.answer)),
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.results.title }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(strings.play.results.byStars[3])).toBeInTheDocument();
  });

  // GARDE CÂBLAGE #136 (effet observable) : à la fin d'un niveau, `finishLevelAction` est
  // appelée avec les **étoiles jugées localement** (le client n'envoie QUE ses étoiles,
  // jamais un world/level_index — SYNC §1) → persistance + crédit serveur. Rouge si le
  // câblage sautait (l'ancien #64 n'appelait AUCUNE action de fin de niveau).
  it("CÂBLAGE #136 : fin de niveau ⇒ finishLevelAction(stars) appelée + pièces gagnées affichées", async () => {
    const fact68 = makeFact("mult", 6, 8);
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 1 });
    // Le serveur tranche le gain (base + étoiles) → solde 25 pièces (barème mocké).
    finishLevelActionMock.mockResolvedValue({
      ok: true,
      stars: 3,
      unlockedNextWorld: false,
      reward: { base: 10, starBonus: 15, treasureBonus: 0, bossBonus: 0, total: 25 },
      coins: 25,
      coinsApplied: true,
      legendary: null,
      legendaryAdded: false,
      error: null,
    });

    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(fact68.answer)),
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));

    // La fin de niveau est persistée serveur avec les étoiles jugées localement (3★).
    await waitFor(() => expect(finishLevelActionMock).toHaveBeenCalledWith(3));
    // Les pièces gagnées (solde serveur) s'affichent sur l'écran de résultats.
    await waitFor(() =>
      expect(
        screen.getByRole("img", {
          name: strings.play.results.coinsPlural.replace("{n}", "25"),
        }),
      ).toBeInTheDocument(),
    );
  });

  // GARDE NO-FAIL (effet observable) : si `finishLevelAction` échoue (erreur réseau/refus),
  // l'écran de résultats reste affiché **sans les pièces** (jamais bloquant, PRODUCT §2.2).
  it("NO-FAIL : échec de finishLevelAction ⇒ résultats affichés SANS pièces (jamais bloquant)", async () => {
    const fact68 = makeFact("mult", 6, 8);
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 1 });
    finishLevelActionMock.mockResolvedValue({
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

    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(fact68.answer)),
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));

    // Les résultats s'affichent (étoiles), le câblage a bien tenté la persistance...
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.results.title }),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(finishLevelActionMock).toHaveBeenCalledWith(3));
    // ...mais AUCUNE ligne de pièces (l'échec serveur ne bloque pas, no-fail).
    expect(screen.queryByText(/pièce/u)).not.toBeInTheDocument();
  });

  it("continuer depuis les résultats recharge un niveau (ou re-diagnostique)", async () => {
    const fact68 = makeFact("mult", 6, 8);
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 1 });

    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(fact68.answer)),
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.results.title }),
      ).toBeInTheDocument(),
    );

    startLevelMock.mockResolvedValue({
      level: { questions: [question("add_3+8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    fireEvent.click(screen.getByRole("button", { name: strings.play.results.continue }));
    await waitFor(() => expect(screen.getByText("3 + 8 = ?")).toBeInTheDocument());
  });
});

describe("PlayScreen — déconnexion accessible à tout écran", () => {
  it("le bouton de déconnexion est visible sur l'écran de diagnostic", async () => {
    diagnosticPlanMock.mockResolvedValue({
      items: [{ fact: makeFact("mult", 6, 8), difficulty: "easy" as const }],
    });
    render(<PlayScreen />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: strings.play.logout })).toBeInTheDocument(),
    );
  });

  it("le bouton de déconnexion est visible pendant une question", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    render(<PlayScreen />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: strings.play.logout })).toBeInTheDocument(),
    );
  });
});
