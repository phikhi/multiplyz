"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { strings } from "@/strings";
import { LogoutButton } from "@/components/LogoutButton";
import { QuestionCard } from "@/components/game/QuestionCard";
import { FeedbackPanel } from "@/components/game/FeedbackPanel";
import { ResultsScreen } from "@/components/game/ResultsScreen";
import {
  diagnosticPlanAction,
  seedDiagnosticAction,
  startLevelAction,
  submitAttemptAction,
} from "@/app/(app)/jouer/actions";
import type { DiagnosticItem } from "@/lib/engine/diagnostic";
import type { RawDiagnosticResponse } from "@/lib/engine/service";
import type { EngineConfig } from "@/config/server-config";
import { diagnosticToQuestions } from "@/lib/game/diagnostic-questions";
import { resolveAnswer } from "@/lib/game/answer";
import { computeAccuracy, computeStars, type StarCount } from "@/lib/engine/stars";
import {
  advance,
  applyAnswer,
  beginRetry,
  buildSubmission,
  initGameState,
  type GameState,
} from "@/lib/game/session";

/**
 * Orchestrateur client de l'écran de jeu **nu** (story #64) — PRODUCT §2.2/§1.4,
 * ENGINE §3/§4/§5/§9. Enchaîne : chargement → (diagnostic 1ʳᵉ session OU niveau
 * normal) → questions → résultats (étoiles) → niveau suivant. Aucun habillage visuel
 * (étayages, animations, récompenses éco = épic #4/#5, hors scope).
 *
 * Toute la **logique** (progression, no-fail, comptage 1ʳᵉ réponse, étoiles) vit dans
 * les modules purs `@/lib/game/session` + `@/lib/engine/stars` — ce composant ne fait
 * que dispatcher les événements UI et appeler les server actions (3.7).
 *
 * **Temps mesuré en silence** (ENGINE §9) : `performance.now()` à chaque transition,
 * jamais affiché à l'enfant. La soumission au serveur est **fire-and-forget** côté
 * rendu (le client juge localement via `resolveAnswer`, cf. module — le serveur reste
 * la source de vérité de la **maîtrise persistée**, SYNC §1 ; une erreur réseau ne
 * bloque jamais le jeu, no-fail).
 */

/** Étape affichée par l'orchestrateur (état de plus haut niveau que `GameState`). */
type ScreenState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  /** Niveau structurellement vide (défensif, ENGINE §4 — cf. brief #64). */
  | { readonly kind: "empty" }
  | { readonly kind: "diagnostic-intro"; readonly items: readonly DiagnosticItem[] }
  | {
      readonly kind: "playing";
      readonly game: GameState;
      readonly isDiagnostic: boolean;
      /** ⚙️ seuils étoiles (ENGINE §5/§11) — capturés avec le niveau, jamais lus hors état/props (react-hooks/refs). */
      readonly starThresholds: EngineConfig["starThresholds"];
    }
  | { readonly kind: "results"; readonly stars: StarCount };

/** Accumulateur des réponses au diagnostic (ENGINE §3) — vidé à chaque amorçage réussi. */
function useDiagnosticResponses() {
  const ref = useRef<RawDiagnosticResponse[]>([]);
  const push = useCallback((response: RawDiagnosticResponse) => {
    ref.current.push(response);
  }, []);
  const drain = useCallback((): RawDiagnosticResponse[] => {
    const collected = ref.current;
    ref.current = [];
    return collected;
  }, []);
  return { push, drain };
}

/**
 * Seuils étoiles ⚙️ de repli (ENGINE §5/§11), utilisés le temps très bref où l'écran
 * diagnostic (qui ne calcule jamais de résultat en étoiles) n'a pas encore reçu la
 * valeur serveur de `startLevelAction` — jamais affichés à l'enfant (contrat interne).
 */
const FALLBACK_STAR_THRESHOLDS: EngineConfig["starThresholds"] = [0.6, 0.85, 1];

export function PlayScreen() {
  const [screen, setScreen] = useState<ScreenState>({ kind: "loading" });
  const [starThresholds, setStarThresholds] = useState(FALLBACK_STAR_THRESHOLDS);
  const diagnosticResponses = useDiagnosticResponses();

  // Fetch **pur** (aucun `setState` synchrone en tête) : appelable directement depuis
  // l'effet de montage (react-hooks/set-state-in-effect) — l'état initial est déjà
  // `{ kind: "loading" }`, un retry explicite (bouton) passe par `retryLoadLevel` qui
  // repositionne `loading` avant de rappeler ce fetch.
  const fetchLevel = useCallback(async () => {
    const plan = await diagnosticPlanAction();
    if (plan.items === null) {
      setScreen({ kind: "error" });
      return;
    }
    if (plan.items.length > 0) {
      setScreen({ kind: "diagnostic-intro", items: plan.items });
      return;
    }
    const result = await startLevelAction();
    setStarThresholds(result.starThresholds);
    if (result.level === null) {
      setScreen({ kind: "error" });
      return;
    }
    if (result.level.questions.length === 0) {
      setScreen({ kind: "empty" });
      return;
    }
    setScreen({
      kind: "playing",
      game: initGameState(result.level.questions, performance.now()),
      isDiagnostic: false,
      starThresholds: result.starThresholds,
    });
  }, []);

  /** Retry explicite (bouton « Réessayer » / enchaînement niveau suivant) : re-montre le chargement. */
  const retryLoadLevel = useCallback(() => {
    setScreen({ kind: "loading" });
    void fetchLevel();
  }, [fetchLevel]);

  useEffect(() => {
    // Différé en microtâche : `fetchLevel` ne pose son 1er `setState` qu'après son
    // 1er `await` (server action) — mais l'analyse statique du lint ne le distingue
    // pas d'un appel synchrone (react-hooks/set-state-in-effect). Le déféré via
    // `.then()` casse la chaîne d'appel synchrone vue par la règle, sans changer le
    // comportement (le fetch part toujours au montage, un seul microtask plus tard).
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void fetchLevel();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchLevel]);

  const startDiagnostic = useCallback(
    (items: readonly DiagnosticItem[]) => {
      // RNG de production non déterministe (mélange des choix QCM) — cohérent avec le
      // service serveur (`Math.random` injecté à la frontière, `actions.ts`).
      const questions = diagnosticToQuestions(items, Math.random);
      setScreen({
        kind: "playing",
        game: initGameState(questions, performance.now()),
        isDiagnostic: true,
        // Jamais consommé (le diagnostic ne calcule pas d'étoiles) — champ requis par
        // le contrat `ScreenState` unifié avec le niveau normal.
        starThresholds,
      });
    },
    [starThresholds],
  );

  const finishDiagnostic = useCallback(() => {
    // Montre le chargement immédiatement (fin de la dernière question du diagnostic),
    // puis amorce la maîtrise + enchaîne sur le 1er niveau — effet de bord isolé,
    // asynchrone, déclenché depuis un simple événement UI (bouton « Continuer »).
    setScreen({ kind: "loading" });
    void (async () => {
      const responses = diagnosticResponses.drain();
      await seedDiagnosticAction(responses);
      await fetchLevel();
    })();
  }, [diagnosticResponses, fetchLevel]);

  const handleResultsContinue = useCallback(() => {
    retryLoadLevel();
  }, [retryLoadLevel]);

  if (screen.kind === "loading") {
    return <StatusMessage text={strings.play.loading} />;
  }

  if (screen.kind === "error") {
    return (
      <StatusMessage text={strings.play.loadError}>
        <ActionButton label={strings.play.loadErrorRetry} onClick={retryLoadLevel} />
      </StatusMessage>
    );
  }

  if (screen.kind === "empty") {
    return <StatusMessage text={strings.play.emptyLevel} />;
  }

  if (screen.kind === "diagnostic-intro") {
    return (
      <StatusMessage text={strings.play.diagnostic.intro} hint={strings.play.diagnostic.hint}>
        <ActionButton
          label={strings.play.correct.next}
          onClick={() => startDiagnostic(screen.items)}
        />
      </StatusMessage>
    );
  }

  if (screen.kind === "results") {
    return <ResultsScreen stars={screen.stars} onContinue={handleResultsContinue} />;
  }

  return (
    <PlayingGame
      initialGame={screen.game}
      isDiagnostic={screen.isDiagnostic}
      diagnosticResponses={diagnosticResponses}
      starThresholds={screen.starThresholds}
      onDiagnosticFinished={finishDiagnostic}
      onResults={setScreen}
    />
  );
}

/**
 * Sous-arbre d'une partie en cours (question par question, ENGINE §4/§9). Reçoit
 * `game` **déjà connu non-nul** (le parent ne monte ce composant que depuis
 * `screen.kind === "playing"`) — possède son propre `useState<GameState>` local, donc
 * ses handlers n'ont **jamais** besoin de re-vérifier un état extérieur (pas de
 * branche défensive `prev.kind !== "playing"` à la fois inatteignable par l'UI et
 * pourtant exigée par le typage d'un reducer plus large, cf. rétro #64).
 */
function PlayingGame({
  initialGame,
  isDiagnostic,
  diagnosticResponses,
  starThresholds,
  onDiagnosticFinished,
  onResults,
}: {
  readonly initialGame: GameState;
  readonly isDiagnostic: boolean;
  readonly diagnosticResponses: ReturnType<typeof useDiagnosticResponses>;
  readonly starThresholds: EngineConfig["starThresholds"];
  readonly onDiagnosticFinished: () => void;
  readonly onResults: (screen: ScreenState) => void;
}) {
  const [game, setGame] = useState(initialGame);

  const judge = useCallback(
    (factKey: string, value: number): boolean => value === resolveAnswer(factKey),
    [],
  );

  const submitJudged = useCallback(
    (correct: boolean, currentGame: GameState, now: number) => {
      const submission = buildSubmission(currentGame, { correct }, now);
      if (isDiagnostic) {
        diagnosticResponses.push({
          factKey: submission.factKey,
          skill: submission.skill,
          correct: submission.correct,
          responseMs: submission.responseMs,
        });
      } else {
        // Fire-and-forget : l'enfant voit le feedback immédiatement (jugement local,
        // ENGINE §9) ; le serveur reste la source de vérité de la maîtrise persistée
        // (SYNC §1). Une erreur réseau n'y bloque jamais l'affichage (no-fail).
        void submitAttemptAction(submission);
      }
    },
    [isDiagnostic, diagnosticResponses],
  );

  const handleAnswer = useCallback(
    (value: number) => {
      const now = performance.now();
      const correct = judge(game.current.question.factKey, value);
      submitJudged(correct, game, now);
      setGame(applyAnswer(game, { correct }));
    },
    [game, judge, submitJudged],
  );

  // « Je ne sais pas » (ENGINE §9) : toujours compté comme faux, sans pénalité —
  // aucune valeur ne peut légitimement représenter « pas de réponse », donc on
  // n'appelle pas `handleAnswer` (qui exige une valeur candidate) : on rejoue le même
  // jugement (`correct: false`) directement via ce chemin dédié.
  const handleDontKnow = useCallback(() => {
    const now = performance.now();
    submitJudged(false, game, now);
    setGame(applyAnswer(game, { correct: false }));
  }, [game, submitJudged]);

  const handleRetry = useCallback(() => {
    setGame((prev) => beginRetry(prev, performance.now()));
  }, []);

  const handleContinue = useCallback(() => {
    const next = advance(game, performance.now());
    if (!next.finished) {
      setGame(next);
      return;
    }
    if (isDiagnostic) {
      // Chargement asynchrone du niveau suivant délégué au parent (effet de bord isolé) —
      // l'écran affiché passe en `loading` pendant l'amorçage + le fetch.
      onDiagnosticFinished();
      return;
    }
    const accuracy = computeAccuracy(next.firstCorrectCount, next.questions.length);
    onResults({ kind: "results", stars: computeStars(accuracy, starThresholds) });
  }, [game, isDiagnostic, onDiagnosticFinished, onResults, starThresholds]);

  return (
    <main
      className="bg-bg text-text"
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-6)",
        padding: "var(--space-6)",
      }}
    >
      {game.current.phase === "asking" ? (
        <QuestionCard
          question={game.current.question}
          questionNumber={game.currentIndex + 1}
          totalQuestions={game.questions.length}
          onAnswer={handleAnswer}
          onDontKnow={handleDontKnow}
        />
      ) : (
        <FeedbackPanel
          phase={game.current.phase}
          correctAnswer={resolveAnswer(game.current.question.factKey)}
          variantSeed={game.currentIndex}
          onContinue={handleContinue}
          onRetry={handleRetry}
        />
      )}
      <LogoutButton />
    </main>
  );
}

/** Écran de statut minimal (chargement / erreur / niveau vide / intro diagnostic). */
function StatusMessage({
  text,
  hint,
  children,
}: {
  readonly text: string;
  readonly hint?: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <main
      className="bg-bg text-text"
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
        padding: "var(--space-6)",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-family-display)",
          fontSize: "var(--font-size-xl)",
          fontWeight: "var(--font-weight-bold)",
          color: "var(--color-text-primary)",
          margin: 0,
        }}
      >
        {text}
      </h1>
      {hint !== undefined && (
        <p
          style={{
            fontFamily: "var(--font-family-body)",
            fontSize: "var(--font-size-base)",
            color: "var(--color-text-secondary)",
            margin: 0,
          }}
        >
          {hint}
        </p>
      )}
      {children}
      <LogoutButton />
    </main>
  );
}

function ActionButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: "var(--tap-target-min)",
        padding: "var(--space-3) var(--space-6)",
        fontFamily: "var(--font-family-display)",
        fontSize: "var(--font-size-md)",
        fontWeight: "var(--font-weight-bold)",
        color: "var(--color-text-inverse)",
        backgroundColor: "var(--color-accent-primary)",
        border: "none",
        borderRadius: "var(--border-radius-full)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
