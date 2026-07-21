import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlayScreen } from "./PlayScreen";
import { strings } from "@/strings";
import {
  diagnosticPlanAction,
  finishLevelAction,
  seedDiagnosticAction,
  setChildMusicEnabledAction,
  setChildSoundEnabledAction,
  startLevelAction,
  submitAttemptAction,
} from "@/app/(app)/jouer/actions";

/** Résultat résolu par `startLevelAction` (pour typer les promesses différées des tests #244). */
type StartLevelResult = Awaited<ReturnType<typeof startLevelAction>>;
/** Résultat résolu par `diagnosticPlanAction` (idem). */
type DiagnosticPlanResult = Awaited<ReturnType<typeof diagnosticPlanAction>>;
import { makeFact } from "@/lib/engine/facts";
import type { LevelQuestion } from "@/lib/engine/service";
import { mockPhone } from "@/lib/responsive/test-support/mock-phone";

// `routerMocks` PARTAGÉ (vi.hoisted, même patron que `soundMocks` ci-dessous) — `useRouter()` est
// appelé par `PlayScreenInner` (§336, `router.push("/carte")`) ; une factory qui recréerait
// `{ push: vi.fn(), refresh: vi.fn() }` À CHAQUE appel donnerait un espion DIFFÉRENT, rendant
// `expect(push).toHaveBeenCalledWith(...)` invérifiable côté test. Une SEULE paire d'espions.
// (« Changer de joueur »/`LogoutButton`, qui appelait aussi `useRouter()`, n'est plus rendu par
// `PlayScreen` depuis la story R1.1 #337 — il vit dans le shell persistant, `AppShell.test.tsx`.)
const routerMocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMocks }));
vi.mock("@/app/(app)/jouer/actions", () => ({
  diagnosticPlanAction: vi.fn(),
  finishLevelAction: vi.fn(),
  seedDiagnosticAction: vi.fn(),
  setChildMusicEnabledAction: vi.fn(),
  setChildSoundEnabledAction: vi.fn(),
  startLevelAction: vi.fn(),
  submitAttemptAction: vi.fn(),
}));

// Moteur son (story 8.4, #257) mocké à la frontière `SoundProvider`/`useSound` : les tests
// PRÉ-EXISTANTS ci-dessous (des dizaines) montent `<PlayScreen />` sans se soucier du son —
// `SoundProvider` devient un simple passthrough (`children`), `useSound` renvoie des espions
// contrôlables. Les NOUVEAUX tests de câblage sonore (fin de fichier) assertent sur ces espions ;
// la logique RÉELLE de résolution (`resolveAnswerSfx`, seuil combo) n'est PAS mockée — seule la
// frontière audio I/O l'est (patron déjà suivi pour `@/lib/db`/actions ailleurs dans ce dépôt).
//
// `soundProviderSettingsSpy` (story 8.6, #282) : capture CHAQUE `settings` reçu par ce passthrough
// — preuve d'INTÉGRATION que l'état `PlayScreen` (mis à jour par le quick-mute enfant, EN SESSION)
// atteint RÉELLEMENT la prop `settings` de `SoundProvider`, SANS navigation/reload. Le câblage
// ENGINE (coupe/relance immédiate) est testé séparément, au niveau unitaire, dans
// `SoundProvider.test.tsx` (ce fichier-ci ne re-teste pas le moteur, seulement le FIL D'EAU
// PlayScreen→SoundProvider).
const soundMocks = vi.hoisted(() => ({
  playSfx: vi.fn(),
  playMusic: vi.fn(),
  stopMusic: vi.fn(),
  soundProviderSettingsSpy: vi.fn(),
}));
vi.mock("@/lib/sound/SoundProvider", () => ({
  SoundProvider: ({
    children,
    settings,
  }: {
    readonly children: React.ReactNode;
    readonly settings: unknown;
  }) => {
    soundMocks.soundProviderSettingsSpy(settings);
    return children;
  },
  useSound: () => soundMocks,
}));

const diagnosticPlanMock = vi.mocked(diagnosticPlanAction);
const finishLevelActionMock = vi.mocked(finishLevelAction);
const seedDiagnosticMock = vi.mocked(seedDiagnosticAction);
const startLevelMock = vi.mocked(startLevelAction);
const submitAttemptMock = vi.mocked(submitAttemptAction);
const setChildSoundEnabledMock = vi.mocked(setChildSoundEnabledAction);
const setChildMusicEnabledMock = vi.mocked(setChildMusicEnabledAction);

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
  setChildSoundEnabledMock.mockResolvedValue({ ok: true });
  setChildMusicEnabledMock.mockResolvedValue({ ok: true });
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

describe("PlayScreen — verrou dur temps d'écran (story 7.8 #229, DETAILS §3 (Temps d'écran))", () => {
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
    // Sortie possible : changer de joueur — désormais portée par le shell persistant
    // (`AppShell.tsx`, story R1.1 #337), jamais bloquée HORS du jeu (seulement l'entrée en
    // niveau) ; ce n'est plus un bouton local à `PlayScreen`, cf. `AppShell.test.tsx`.
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
//
// NON-VACUOUS (rétro #244) : `PlayScreen` retourne `<StatusMessage/>` depuis plusieurs branches,
// même position/type → sans un `key` DISTINCT par état, React réconcilie la transition en UPDATE
// (même `<h1>` réutilisé) et `focusOnMount` ne se réinvoque JAMAIS → seul l'état loading initial
// serait focalisé, le titre CIBLE ne recevrait pas le focus. Un test qui rend directement l'état
// cible passerait FAUSSEMENT (le même nœud loading reste `activeElement` pendant que son texte
// mute en place). On exerce donc la VRAIE transition `loading → cible` et on DÉPLACE le focus
// (blur) juste avant la transition : sans remount, `focusOnMount` ne re-fire pas → le titre cible
// n'est PAS focalisé → le test ROUGIT. Retirer les `key` de `PlayScreen` fait rougir ces 3 tests.
// ============================================================================
describe("PlayScreen — StatusMessage : focus a11y au montage (#244)", () => {
  it("transition loading → VERROU (locked) : le titre cible reçoit le focus au montage, SANS anneau UA — PRIORITAIRE", async () => {
    let resolveStart!: (value: StartLevelResult) => void;
    startLevelMock.mockReturnValue(
      new Promise<StartLevelResult>((resolve) => {
        resolveStart = resolve;
      }),
    );
    render(<PlayScreen />);
    // L'effet de montage a appelé `startLevelAction` (pending) → l'écran reste `loading`.
    await waitFor(() => expect(startLevelMock).toHaveBeenCalled());
    // Le titre de l'état `loading` a reçu le focus À SON MONTAGE.
    const loadingHeading = screen.getByRole("heading", { level: 1, name: strings.play.loading });
    expect(document.activeElement).toBe(loadingHeading);
    // On DÉPLACE le focus ailleurs : si la transition ne REMONTE pas le titre, `focusOnMount` ne
    // se réinvoque pas → le titre cible ne sera pas focalisé (le test rougira).
    loadingHeading.blur();
    expect(document.activeElement).toBe(document.body);
    // Transition loading → locked (résolution de la promesse différée).
    await act(async () => {
      resolveStart({ level: null, starThresholds: STAR_THRESHOLDS, locked: true });
    });
    const lockedHeading = screen.getByRole("heading", {
      level: 1,
      name: strings.play.screenTimeLocked.title,
    });
    // Focus RÉ-APPLIQUÉ au montage du titre cible (remount forcé par `key`) — ROUGE sans le `key`.
    expect(document.activeElement).toBe(lockedHeading);
    expect(lockedHeading.style.outline).toBe("none");
  });

  it("transition loading → ERREUR : le titre cible reçoit le focus au montage, SANS anneau UA", async () => {
    let resolvePlan!: (value: DiagnosticPlanResult) => void;
    diagnosticPlanMock.mockReturnValue(
      new Promise<DiagnosticPlanResult>((resolve) => {
        resolvePlan = resolve;
      }),
    );
    render(<PlayScreen />);
    await waitFor(() => expect(diagnosticPlanMock).toHaveBeenCalled());
    const loadingHeading = screen.getByRole("heading", { level: 1, name: strings.play.loading });
    expect(document.activeElement).toBe(loadingHeading);
    loadingHeading.blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      resolvePlan({ items: null }); // session invalide → écran d'erreur
    });
    const errorHeading = screen.getByRole("heading", { level: 1, name: strings.play.loadError });
    expect(document.activeElement).toBe(errorHeading);
    expect(errorHeading.style.outline).toBe("none");
  });

  it("transition loading → NIVEAU VIDE : le titre cible reçoit le focus au montage, SANS anneau UA", async () => {
    let resolveStart!: (value: StartLevelResult) => void;
    startLevelMock.mockReturnValue(
      new Promise<StartLevelResult>((resolve) => {
        resolveStart = resolve;
      }),
    );
    render(<PlayScreen />);
    await waitFor(() => expect(startLevelMock).toHaveBeenCalled());
    const loadingHeading = screen.getByRole("heading", { level: 1, name: strings.play.loading });
    expect(document.activeElement).toBe(loadingHeading);
    loadingHeading.blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      resolveStart({ level: { questions: [] }, starThresholds: STAR_THRESHOLDS, locked: false });
    });
    const emptyHeading = screen.getByRole("heading", { level: 1, name: strings.play.emptyLevel });
    expect(document.activeElement).toBe(emptyHeading);
    expect(emptyHeading.style.outline).toBe("none");
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

  it("continuer depuis les résultats → retour à la carte (hub, story R1.2 #336), JAMAIS un rechargement direct de niveau", async () => {
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

    // Défaut B corrigé (R1.2, #336, docs/playthroughs/R0-baseline.md) : avant #336, « Continuer »
    // appelait `retryLoadLevel()` → `fetchLevel()` résolvait `diagnosticPlanAction()` PUIS appelait
    // `startLevelAction` (bouclage /jouer→/jouer, jamais la carte, observé en LIVE sur ~8 cycles).
    const startLevelCallsBeforeContinue = startLevelMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: strings.play.results.continue }));
    // Mutation-preuve PRINCIPALE (positive) : la navigation part vers le hub carte — rougit si
    // `handleResultsContinue` cesse d'appeler `router.push("/carte")` (revert vers retryLoadLevel).
    expect(routerMocks.push).toHaveBeenCalledWith("/carte");
    // Mutation-preuve SECONDAIRE (négative, NON vacuous) : on DRAINE d'abord toute la file
    // asynchrone (une macrotâche `setTimeout(0)` s'ordonnance APRÈS toutes les microtâches en
    // attente → les 2 `await` de `fetchLevel` — `diagnosticPlanAction` puis l'appel à
    // `startLevelAction` — auraient eu le temps de s'exécuter). SOUS UN REVERT vers
    // `retryLoadLevel()`, le compteur `startLevelAction` s'incrémenterait donc ICI → l'assertion
    // ROUGIT (vérifié en révertant `handleResultsContinue` localement). SANS ce drain l'assertion
    // serait VACUOUS (#143/#173) : au tick synchrone le compteur est trivialement inchangé même
    // sous le revert, l'appel ne survenant qu'après 2 microtâches. Le fix #336 (`router.push`) ne
    // charge AUCUN niveau → compteur inchangé (vert).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(startLevelMock.mock.calls.length).toBe(startLevelCallsBeforeContinue);
  });
});

// Le describe « déconnexion accessible à tout écran » (bouton visible sur diagnostic/question)
// a été RETIRÉ (story R1.1 #337) : « Changer de joueur » n'est plus rendu PAR `PlayScreen` —
// il vit dans le shell persistant (`AppShell.tsx`, `(app)/layout.tsx`), monté une seule fois
// au-dessus de TOUTES les routes `(app)` indépendamment de l'état interne de `PlayScreen`.
// Couverture équivalente : `AppShell.test.tsx` (le bouton est toujours rendu par le shell).

describe("PlayScreen — responsive (story 8.1 #254, WIREFRAMES §8)", () => {
  it("padding-bottom standard tablette/desktop (défaut, pas de régression)", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    expect(screen.getByRole("main").style.paddingBottom).toBe("var(--space-6)");
  });

  it("réserve l'espace de l'ActionBar (padding-bottom) sous --bp-phone (non-occlusion #170/#190)", async () => {
    const restore = mockPhone(true);
    try {
      startLevelMock.mockResolvedValue({
        level: { questions: [question("mult_6x8")] },
        starThresholds: STAR_THRESHOLDS,
        locked: false,
      });
      render(<PlayScreen />);
      await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
      // Garde à effet observable : si la réserve d'espace saute (retirée/mutée), le contenu
      // jouable ne serait plus protégé de l'occlusion par la barre fixe (#170/#190).
      expect(screen.getByRole("main").style.paddingBottom).toBe(
        "calc(var(--space-6) + var(--play-action-bar-height))",
      );
    } finally {
      restore();
    }
  });
});

describe("PlayScreen — son : SFX bonne réponse/combo + musique de fond (story 8.4, #257 AC #1)", () => {
  it("démarre la musique de fond à l'entrée en jeu, l'arrête en sortant vers les résultats", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 1 });
    const fact68 = makeFact("mult", 6, 8);

    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    expect(soundMocks.playMusic).toHaveBeenCalledWith("play");
    expect(soundMocks.stopMusic).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(fact68.answer)),
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));

    // Quitte "playing" (démontage de `PlayingGame`) → la musique s'arrête (cleanup d'effet).
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: strings.play.results.title }),
      ).toBeInTheDocument(),
    );
    expect(soundMocks.stopMusic).toHaveBeenCalledTimes(1);
  });

  it("MUTATION-PROOF (AC #1) : 1ʳᵉ bonne réponse (sous le seuil combo) → SFX 'correct', jamais 'combo'", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8"), question("add_3+8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 1 });
    const fact68 = makeFact("mult", 6, 8);

    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(fact68.answer)),
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    expect(soundMocks.playSfx).toHaveBeenCalledWith("correct");
    expect(soundMocks.playSfx).not.toHaveBeenCalledWith("combo");
  });

  it("MUTATION-PROOF (garde no-fail) : 1ʳᵉ tentative FAUSSE → AUCUN SFX (re-essai proposé, jamais de son négatif/sanction)", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 0 });
    const fact68 = makeFact("mult", 6, 8);
    const wrongChoice = [fact68.answer + 1, fact68.answer - 1, fact68.answer + 2].find(
      (v) => v !== fact68.answer,
    )!;

    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    // Musique de fond mise à part (appelée au montage), aucun SFX ne doit avoir joué avant
    // la réponse — on isole donc le mock playSfx spécifiquement.
    soundMocks.playSfx.mockClear();
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
    expect(soundMocks.playSfx).not.toHaveBeenCalled();
  });

  it("MUTATION-PROOF (seuil combo #1) : 3 bonnes réponses consécutives EN 1ʳᵉ TENTATIVE → SFX 'combo' à la 3ᵉ (⚙️ SOUND_COMBO_THRESHOLD)", async () => {
    startLevelMock.mockResolvedValue({
      level: {
        questions: [question("mult_6x8"), question("add_3+8"), question("sub_15-6")],
      },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 1 });
    const facts = [makeFact("mult", 6, 8), makeFact("add", 3, 8), makeFact("sub", 15, 6)];
    const questionTexts = ["6 × 8 = ?", "3 + 8 = ?", "15 − 6 = ?"];

    render(<PlayScreen />);
    for (let i = 0; i < facts.length; i++) {
      await waitFor(() => expect(screen.getByText(questionTexts[i])).toBeInTheDocument());
      fireEvent.click(
        screen.getByRole("button", {
          name: strings.play.question.choiceOption.replace("{n}", String(facts[i].answer)),
        }),
      );
      await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
      if (i < facts.length - 1) {
        fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));
      }
    }

    const sfxCalls = soundMocks.playSfx.mock.calls.map((call) => call[0]);
    // 2 premières bonnes réponses sous le seuil (⚙️=3) → "correct" ; la 3ᵉ franchit le seuil → "combo".
    expect(sfxCalls).toEqual(["correct", "correct", "combo"]);
  });

  it("comportement bout-en-bout : une série cassée par un re-essai NE rejoue PAS 'combo' — retombe à 'correct'. Épinglé par le SCOPE phase='retry' (remet comboRef à 0 AVANT le re-essai) + la garde isRetrying ENSEMBLE, PAS la garde en isolation — celle-ci est mutation-prouvée au niveau unitaire (juice.test.ts, #206/#164)", async () => {
    startLevelMock.mockResolvedValue({
      level: {
        questions: [
          question("mult_6x8"),
          question("add_3+8"),
          question("sub_15-6"),
          question("mult_6x8", "pave"),
        ],
      },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 1 });
    const facts = [makeFact("mult", 6, 8), makeFact("add", 3, 8), makeFact("sub", 15, 6)];
    const questionTexts = ["6 × 8 = ?", "3 + 8 = ?", "15 − 6 = ?"];

    render(<PlayScreen />);
    // 3 bonnes réponses consécutives → série au seuil (dernier SFX = "combo").
    for (let i = 0; i < facts.length; i++) {
      await waitFor(() => expect(screen.getByText(questionTexts[i])).toBeInTheDocument());
      fireEvent.click(
        screen.getByRole("button", {
          name: strings.play.question.choiceOption.replace("{n}", String(facts[i].answer)),
        }),
      );
      await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: strings.play.correct.next }));
    }
    soundMocks.playSfx.mockClear();

    // 4e question (pavé, même fait 6×8) : réponse FAUSSE puis re-essai JUSTE.
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    const fact68 = makeFact("mult", 6, 8);
    for (const d of String(fact68.answer + 1)) {
      fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", d) }));
    }
    fireEvent.click(screen.getByRole("button", { name: strings.play.question.submit }));
    await waitFor(() =>
      expect(
        screen.getByText(strings.play.retry.answerReveal.replace("{n}", String(fact68.answer))),
      ).toBeInTheDocument(),
    );
    expect(soundMocks.playSfx).not.toHaveBeenCalled(); // 1re tentative fausse → aucun son (déjà couvert ci-dessus, re-vérifié en contexte série).
    fireEvent.click(screen.getByRole("button", { name: strings.play.retry.tryAgain }));

    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    for (const d of String(fact68.answer)) {
      fireEvent.click(screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", d) }));
    }
    fireEvent.click(screen.getByRole("button", { name: strings.play.question.submit }));
    await waitFor(() => expect(soundMocks.playSfx).toHaveBeenCalled());

    // Comportement bout-en-bout : la série ne rejoue PAS "combo" après un re-essai. NB (honnêteté
    // #164/#206) : ce qui épingle ici le résultat, c'est le SCOPE `phase="retry"` — il a DÉJÀ remis
    // `comboRef` à 0 (`PlayScreen.tsx`) AVANT ce re-essai, donc `comboCountBefore=0` et la branche de
    // repli sort "correct" que la garde `isRetrying` soit présente OU mutée (QA #289 : muter
    // `juice.ts:48-50` laisse ce test VERT). La garde `isRetrying` en ISOLATION est mutation-prouvée
    // au niveau unitaire (`juice.test.ts` — « MUTATION-PROOF (garde isRetrying) »), jamais ici.
    expect(soundMocks.playSfx).toHaveBeenCalledWith("correct");
    expect(soundMocks.playSfx).not.toHaveBeenCalledWith("combo");
  });
});

describe("PlayScreen — quick-mute enfant NO-PIN in-game (story 8.6, #282, DETAILS §3, ADR 0017)", () => {
  const sq = strings.play.soundQuickMute;

  it("visible PENDANT une question (écran « in-game »)", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    expect(screen.getByRole("switch", { name: sq.soundOn })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: sq.musicOn })).toBeInTheDocument();
    // « Changer de joueur » n'est plus rendu par `PlayScreen` (story R1.1 #337) — il vit
    // dans le shell persistant au-dessus, cf. `AppShell.test.tsx`.
  });

  it("reflète l'état INITIAL fourni par le serveur (`sound` prop, pas un défaut figé)", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    render(<PlayScreen sound={{ soundEnabled: false, musicEnabled: true, volume: 40 }} />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    expect(screen.getByRole("switch", { name: sq.soundOff })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("switch", { name: sq.musicOn })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("MUTATION-PROOF (in-session live-sync, AC #282) : clique Son → l'UI bascule IMMÉDIATEMENT ET `SoundProvider` reçoit le settings mis à jour SANS remount/reload", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    render(<PlayScreen sound={{ soundEnabled: true, musicEnabled: true, volume: 70 }} />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());

    const callsBefore = soundMocks.soundProviderSettingsSpy.mock.calls.length;
    fireEvent.click(screen.getByRole("switch", { name: sq.soundOn }));

    // (a) L'UI reflète le nouvel état SANS attendre de round-trip réseau.
    expect(screen.getByRole("switch", { name: sq.soundOff })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    // (b) `SoundProvider` (le moteur) est RE-RENDU avec un `settings.soundEnabled` À JOUR — preuve
    // que `PlayScreen` fait bien VARIER son état (pas une prop figée passée une seule fois au
    // montage). Si `PlayScreen` régressait vers une valeur statique, ce spy ne recevrait JAMAIS
    // `soundEnabled: false` — ce test rougirait.
    expect(soundMocks.soundProviderSettingsSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    const lastCall =
      soundMocks.soundProviderSettingsSpy.mock.calls[
        soundMocks.soundProviderSettingsSpy.mock.calls.length - 1
      ];
    expect(lastCall[0]).toEqual({ soundEnabled: false, musicEnabled: true, volume: 70 });

    // (c) Persistance serveur narrow — fire-and-forget, no-fail (jamais bloquant pour l'affichage).
    await waitFor(() => expect(setChildSoundEnabledMock).toHaveBeenCalledWith(false));
  });

  it("MUTATION-PROOF : clique Musique bascule INDÉPENDAMMENT de Son (settings.soundEnabled inchangé) + persiste narrow", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    render(<PlayScreen sound={{ soundEnabled: true, musicEnabled: true, volume: 70 }} />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("switch", { name: sq.musicOn }));

    expect(screen.getByRole("switch", { name: sq.musicOff })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    // Son INCHANGÉ (toujours ON) — les 2 contrôles sont indépendants.
    expect(screen.getByRole("switch", { name: sq.soundOn })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await waitFor(() => expect(setChildMusicEnabledMock).toHaveBeenCalledWith(false));
    expect(setChildSoundEnabledMock).not.toHaveBeenCalled();
  });

  it("NO-PIN : aucune navigation/prompt PIN n'apparaît au clic — reste sur l'écran de jeu", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch", { name: sq.soundOn }));
    // Toujours sur l'écran de jeu (la question reste affichée) — aucun pavé PIN n'apparaît (un
    // pavé PIN afficherait des boutons "Chiffre {d}", jamais présents sur `/jouer`).
    expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: strings.pinPad.digit.replace("{d}", "0") }),
    ).not.toBeInTheDocument();
  });

  it("reste visible pendant le FEEDBACK (branche non-« asking ») — pas seulement pendant la question", async () => {
    startLevelMock.mockResolvedValue({
      level: { questions: [question("mult_6x8")] },
      starThresholds: STAR_THRESHOLDS,
      locked: false,
    });
    submitAttemptMock.mockResolvedValue({ ok: true, box: 1 });
    const fact68 = makeFact("mult", 6, 8);
    render(<PlayScreen />);
    await waitFor(() => expect(screen.getByText("6 × 8 = ?")).toBeInTheDocument());
    fireEvent.click(
      screen.getByRole("button", {
        name: strings.play.question.choiceOption.replace("{n}", String(fact68.answer)),
      }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("switch", { name: sq.soundOn })).toBeInTheDocument();
  });
});
