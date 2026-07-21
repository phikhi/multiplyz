"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { strings } from "@/strings";
import { QuestionCard } from "@/components/game/QuestionCard";
import { FeedbackPanel } from "@/components/game/FeedbackPanel";
import { ResultsScreen } from "@/components/game/ResultsScreen";
import { SoundQuickMute } from "@/components/game/SoundQuickMute";
import {
  diagnosticPlanAction,
  finishLevelAction,
  seedDiagnosticAction,
  setChildMusicEnabledAction,
  setChildSoundEnabledAction,
  startLevelAction,
  submitAttemptAction,
} from "@/app/(app)/jouer/actions";
import type { DiagnosticItem } from "@/lib/engine/diagnostic";
import type { RawDiagnosticResponse } from "@/lib/engine/service";
import type { GrantedLegendary } from "@/lib/game/finish-level";
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
import { useIsPhone } from "@/lib/responsive/use-is-phone";
import { SoundProvider, useSound } from "@/lib/sound/SoundProvider";
import { DEFAULT_SOUND_SETTINGS, type SoundSettings } from "@/lib/sound/settings";
import {
  SoundSettingsControlProvider,
  type SoundSettingsControl,
} from "@/lib/sound/sound-settings-control";
import { resolveAnswerSfx } from "@/lib/sound/juice";
import { SOUND_COMBO_THRESHOLD } from "@/lib/sound/config";

/**
 * Orchestrateur client de l'écran de jeu (story #64, gains #126) — PRODUCT §2.2/§1.4,
 * ENGINE §3/§4/§5/§9, ECONOMY §4.1. Enchaîne : chargement → (diagnostic 1ʳᵉ session OU
 * niveau normal) → questions → **résultats (étoiles + pièces gagnées)** → **retour à la
 * carte** (hub, story R1.2 #336 ; PRODUCT §1.3 « Carte → Niveau → Résultats → (niveau
 * suivant ou collection/boutique) », le nœud suivant resurgi sur la carte — jamais un
 * rechargement direct d'un nouveau niveau, cf. `handleResultsContinue`).
 *
 * **Fin de niveau persistée serveur** (story #126, ferme #136) : à la dernière question,
 * les résultats s'affichent **immédiatement** (no-fail, jamais bloquant) avec les étoiles
 * jugées localement, puis `finishLevelAction` **persiste** la progression + **crédite les
 * pièces** (barème versionné ECONOMY, transaction atomique serveur) et l'écran est enrichi
 * du **solde de pièces**. Le client n'envoie **que ses étoiles** (jamais un `world/level_index`,
 * source de vérité serveur SYNC §1). Une erreur réseau ne bloque jamais l'enfant (no-fail).
 *
 * Toute la **logique** (progression, no-fail, comptage 1ʳᵉ réponse, étoiles) vit dans
 * les modules purs `@/lib/game/session` + `@/lib/engine/stars` — ce composant ne fait
 * que dispatcher les événements UI et appeler les server actions (3.7 + #126).
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
  /**
   * **Verrou dur temps d'écran** (DETAILS §3 (Temps d'écran), story 7.8 #229) : `startLevelAction` a refusé
   * l'entrée dans un NOUVEAU niveau (parent l'a activé ET le temps joué aujourd'hui a atteint
   * le seuil ⚙️). Distinct de `"error"` (pas un souci d'auth/réseau) — voix Teddy douce, jamais
   * punitive (COPY §1/§3). La partie qui vient de se terminer n'est jamais remise en cause : on
   * n'atteint cet état QUE via `fetchLevel` (chargement d'un niveau, jamais mid-partie).
   */
  | { readonly kind: "locked" }
  | { readonly kind: "diagnostic-intro"; readonly items: readonly DiagnosticItem[] }
  | {
      readonly kind: "playing";
      readonly game: GameState;
      readonly isDiagnostic: boolean;
      /** ⚙️ seuils étoiles (ENGINE §5/§11) — capturés avec le niveau, jamais lus hors état/props (react-hooks/refs). */
      readonly starThresholds: EngineConfig["starThresholds"];
    }
  /**
   * Résultats de fin de niveau : étoiles (jugées localement, ENGINE §5) + **pièces
   * gagnées** (`coins`, tranchées **serveur** — barème versionné ECONOMY §4.1 —, `null`
   * tant que la fin de niveau n'a pas répondu / a échoué réseau ; no-fail : les résultats
   * s'affichent même sans les pièces). La progression + le crédit sont persistés par
   * `finishLevelAction` (transaction atomique serveur, story #126).
   */
  | {
      readonly kind: "results";
      readonly stars: StarCount;
      readonly coins: number | null;
      /** Légendaire garantie du boss (story 5.6), `null` tant que non reçu / niveau non-boss. */
      readonly legendary: GrantedLegendary | null;
    };

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

/**
 * Point d'entrée public — enveloppe TOUT l'écran de jeu dans `SoundProvider` (story 8.4, #257),
 * monté UNE SEULE fois (mount unique, jamais recréé aux transitions internes `loading ⇄ playing
 * ⇄ results`) pour que la musique de fond survive naturellement aux changements d'écran sans
 * redémarrage parasite — le moteur son vit dans `engineRef` de `SoundProvider`, indépendant du
 * `screen.kind` géré par `PlayScreenInner`. `sound` optionnel (défaut `DEFAULT_SOUND_SETTINGS`) :
 * en production `PlayPage` (serveur) fournit la valeur **initiale** réelle du foyer
 * (`pickSoundSettings(readHouseholdSettings(...))`) ; le défaut ne sert qu'aux tests existants
 * qui montent `<PlayScreen />` sans se soucier du son (LEARNINGS « wiring minimal »).
 *
 * **État EN SESSION (story 8.6, #282)** : `sound` n'est plus qu'une valeur d'AMORÇAGE — `settings`
 * est un `useState` CLIENT (initialisé depuis `sound`) que le quick-mute enfant
 * (`SoundQuickMute`, `SoundSettingsControlProvider` ci-dessous) met à jour OPTIMISTEMENT au clic,
 * SANS reload de `/jouer` (contrairement au contrat 8.4 initial « pas de live-sync, prochain
 * chargement de page », désormais réservé au réglage **parent** via l'écran Réglages — le
 * quick-mute enfant, lui, doit honorer DETAILS §3 « muter VITE »). `settings` redescend à la fois
 * vers `SoundProvider` (moteur — coupe/relance EN SESSION, cf. JSDoc `SoundProvider.tsx`) et vers
 * `SoundSettingsControlProvider` (UI de contrôle, `SoundQuickMute`) — UN SEUL état, deux
 * consommateurs, jamais de doublon. La persistance serveur (`setChildSoundEnabledAction`/
 * `setChildMusicEnabledAction`, narrow, no-PIN) est fire-and-forget (no-fail : une erreur réseau
 * ne bloque jamais l'enfant, l'état optimiste local reste la source d'affichage immédiate).
 */
export function PlayScreen({ sound = DEFAULT_SOUND_SETTINGS }: { readonly sound?: SoundSettings }) {
  const [settings, setSettings] = useState<SoundSettings>(sound);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({ ...prev, soundEnabled: enabled }));
    // Fire-and-forget (no-fail, même patron que `submitAttemptAction`) : l'affichage/l'effet
    // audio EN SESSION ne dépendent QUE de l'état client optimiste ci-dessus, jamais de cette
    // promesse. Persistance narrow — cf. JSDoc `setChildSoundEnabledAction`.
    void setChildSoundEnabledAction(enabled);
  }, []);

  const setMusicEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({ ...prev, musicEnabled: enabled }));
    void setChildMusicEnabledAction(enabled);
  }, []);

  const soundControl = useMemo<SoundSettingsControl>(
    () => ({
      soundEnabled: settings.soundEnabled,
      musicEnabled: settings.musicEnabled,
      setSoundEnabled,
      setMusicEnabled,
    }),
    [settings.soundEnabled, settings.musicEnabled, setSoundEnabled, setMusicEnabled],
  );

  return (
    <SoundSettingsControlProvider value={soundControl}>
      <SoundProvider settings={settings}>
        <PlayScreenInner />
      </SoundProvider>
    </SoundSettingsControlProvider>
  );
}

function PlayScreenInner() {
  const router = useRouter();
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
    if (result.locked) {
      // Verrou dur temps d'écran (story 7.8) : distinct de l'écran d'erreur — voix Teddy
      // douce, jamais punitive. Vérifié AVANT `level === null` (les deux cas renvoient
      // `level: null`, mais `locked` discrimine sans ambiguïté lequel des deux écrans afficher).
      setScreen({ kind: "locked" });
      return;
    }
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

  /**
   * « Continuer » depuis les résultats (WIREFRAMES §4) — retour RÉEL au hub **carte** (story
   * R1.2, #336 : corrige le défaut B du baseline `docs/playthroughs/R0-baseline.md` où
   * l'ancien `retryLoadLevel()` rebouclait DIRECTEMENT sur un nouveau niveau, sans jamais
   * repasser par la carte — vérifié en LIVE sur ~8 cycles, l'URL ne changeait jamais de
   * `/jouer`). L'enfant revit désormais le monde/Teddy/sa progression à chaque cycle
   * (PRODUCT §1.3 « Carte → Niveau → Résultats → (niveau suivant ou collection/boutique) » ;
   * WIREFRAMES §4 « Continuer » → nœud suivant, resurgi sur la carte — valeur centrale de
   * l'épic R1 #180). Le prochain nœud recommandé reste résolu **côté serveur** au chargement
   * de `/carte` (ENGINE §3/§4 via `currentMapAction`/`loadCurrentWorldMap`) — jamais
   * recalculé ni transmis ici (SYNC §1).
   */
  const handleResultsContinue = useCallback(() => {
    router.push("/carte");
  }, [router]);

  // `key` DISTINCT par état (#244) : `PlayScreen` retourne `<StatusMessage/>` depuis PLUSIEURS
  // branches, même position/type → sans `key`, React réconcilie une transition (ex. loading→locked)
  // comme une **UPDATE** (même Fiber, même nœud `<h1>` réutilisé) et le ref-callback `focusOnMount`
  // ne se réinvoque JAMAIS sur le nœud cible → seul l'état initial recevrait un vrai `.focus()`. Un
  // `key` distinct force un **REMOUNT** à chaque transition → le `<h1>` de l'état cible est un nouveau
  // nœud → `focusOnMount` fire dessus (annonce SR de la nouvelle étape plein-écran). Verrou = prioritaire.
  if (screen.kind === "loading") {
    return <StatusMessage key="loading" text={strings.play.loading} />;
  }

  if (screen.kind === "error") {
    return (
      <StatusMessage key="error" text={strings.play.loadError}>
        <ActionButton label={strings.play.loadErrorRetry} onClick={retryLoadLevel} />
      </StatusMessage>
    );
  }

  if (screen.kind === "empty") {
    return <StatusMessage key="empty" text={strings.play.emptyLevel} />;
  }

  if (screen.kind === "locked") {
    // Verrou dur temps d'écran (DETAILS §3 (Temps d'écran), story 7.8) : écran plein, PAS un overlay
    // superposé (même patron que "error"/"empty"/"loading" — StatusMessage remplace tout
    // l'écran, aucun élément positionné/empilé à garder contre l'occlusion, #170/#190).
    // Aucun bouton « Réessayer » (rejouer ne changerait rien avant demain) — seule sortie :
    // changer de joueur, désormais toujours accessible via le shell persistant
    // (`AppShell.tsx`, story R1.1 #337), pas un bouton local à cet écran.
    return (
      <StatusMessage
        key="locked"
        text={strings.play.screenTimeLocked.title}
        hint={strings.play.screenTimeLocked.hint}
      />
    );
  }

  if (screen.kind === "diagnostic-intro") {
    return (
      <StatusMessage
        key="diagnostic-intro"
        text={strings.play.diagnostic.intro}
        hint={strings.play.diagnostic.hint}
      >
        <ActionButton
          label={strings.play.correct.next}
          onClick={() => startDiagnostic(screen.items)}
        />
      </StatusMessage>
    );
  }

  if (screen.kind === "results") {
    return (
      <ResultsScreen
        stars={screen.stars}
        coins={screen.coins}
        legendary={screen.legendary}
        onContinue={handleResultsContinue}
      />
    );
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
  // Réserve l'espace de l'`ActionBar` fixe bas de zone pouce sur téléphone (story 8.1 #254) :
  // évite que le contenu jouable se retrouve occlus derrière la barre fixe (#170/#190), prouvé
  // par la garde E2E boundingClientRect (jamais une marge seulement raisonnée, #190).
  const isPhone = useIsPhone();
  const { playSfx, playMusic, stopMusic } = useSound();
  // Série de bonnes réponses consécutives EN 1ʳᵉ TENTATIVE (story 8.4, #257, AC #1 — "combo si
  // série", PRODUCT.md:60). `useRef` (pas `useState`) : ne pilote AUCUN rendu, seulement l'effet
  // sonore ci-dessous — remis à 0 naturellement à chaque remontage de `PlayingGame` (nouveau
  // niveau, `PlayScreen` retraverse toujours "loading" entre 2 niveaux).
  const comboRef = useRef(0);

  // Musique de fond pendant une partie active (AC #1) — démarre au montage, s'arrête au
  // démontage RÉEL (changement d'écran `playing → results`/`loading`, patron « subscribe to an
  // external system », même famille que `useIsPhone`). `playMusic`/`stopMusic` sont des
  // références STABLES (`SoundProvider`, deps vides) — sûres en deps sans reruns parasites.
  useEffect(() => {
    playMusic("play");
    return () => stopMusic();
  }, [playMusic, stopMusic]);

  // SFX de réponse (bonne réponse / combo) — réagit à la TRANSITION de `phase`/`isRetrying`,
  // jamais un effet mount-only (STACK-TRAP #244) : `game` (tout l'objet, deps exhaustives —
  // `react-hooks/exhaustive-deps` n'accepte pas un chemin `game.current.X` profond comme deps
  // partielles) change de référence à CHAQUE transition (nouvel objet immuable,
  // `applyAnswer`/`advance`/`beginRetry`), donc l'effet se ré-exécute fidèlement à chaque
  // passage — y compris `"asking"` (nouvelle question OU montage initial), volontairement
  // ignoré (aucun son au moment où la question s'affiche, seulement à sa résolution) : l'early
  // return rend les ré-exécutions sur un `game` qui ne change QUE de question (jamais sans
  // passer par `"asking"`) inoffensives.
  useEffect(() => {
    const phase = game.current.phase;
    if (phase === "asking") return;
    const resolution = resolveAnswerSfx(
      comboRef.current,
      phase,
      game.current.isRetrying,
      SOUND_COMBO_THRESHOLD,
    );
    comboRef.current = resolution.comboCount;
    if (resolution.sfx !== null) {
      playSfx(resolution.sfx);
    }
  }, [game, playSfx]);

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
    // Étoiles **jugées localement** (ENGINE §5 : justesse de la 1ʳᵉ réponse déjà connue
    // côté client) → affichage **immédiat** des résultats (no-fail, jamais bloquant).
    const accuracy = computeAccuracy(next.firstCorrectCount, next.questions.length);
    const stars = computeStars(accuracy, starThresholds);
    onResults({ kind: "results", stars, coins: null, legendary: null });
    // Fin de niveau **persistée serveur** (source de vérité, story #126, ferme #136) :
    // progression + crédit de pièces + ledger (+ légendaire du boss, story 5.6) dans une
    // transaction atomique. Le client n'envoie **que ses étoiles** (jamais un `world/level_index`,
    // SYNC §1) ; le serveur résout la cible + tranche le barème (ECONOMY §4.1) + ajoute la
    // légendaire garantie si c'était le boss (MAP §6). On enrichit ensuite l'écran résultats avec
    // les **pièces gagnées** (solde serveur) et la **légendaire** éventuelle. Une erreur réseau ne
    // bloque jamais l'enfant (no-fail) : les résultats restent affichés sans les pièces.
    void (async () => {
      const result = await finishLevelAction(stars);
      if (result.ok) {
        onResults({ kind: "results", stars, coins: result.coins, legendary: result.legendary });
      }
    })();
  }, [game, isDiagnostic, onDiagnosticFinished, onResults, starThresholds]);

  return (
    <main
      className="bg-bg text-text"
      style={{
        // Shell persistant EN FLUX au-dessus (story R1.1 #337, `(app)/layout.tsx`) : réserve sa
        // propre hauteur (`--app-shell-height`) hors de ce `<main>` — jamais `100dvh` brut (sinon
        // le centrage `justifyContent:"center"` décale le contenu encore PLUS bas). Ce calcul
        // n'est FIDÈLE que parce qu'`AppShell` reste RÉELLEMENT sur UNE ligne à `--app-shell-height`
        // à TOUTE largeur (icône SEULE, jamais de libellé visible sur ⚙️/👤, cf. `AppShell.tsx`) —
        // un bandeau qui passerait à la ligne (texte visible trop large sur 375px) rendrait CE
        // token FAUX (hauteur réelle > déclarée) et rognerait la marge sous la barre d'action fixe
        // calibrée au pouce (story 8.1 #254) : régression mesurée puis corrigée à la source.
        minHeight: "calc(100dvh - var(--app-shell-height))",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-6)",
        padding: "var(--space-6)",
        paddingBottom: isPhone
          ? "calc(var(--space-6) + var(--play-action-bar-height))"
          : "var(--space-6)",
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
          skill={game.current.question.skill}
          operands={game.current.question.operands}
          variantSeed={game.currentIndex}
          onContinue={handleContinue}
          onRetry={handleRetry}
        />
      )}
      {/* Quick-mute enfant NO-PIN (story 8.6, #282, DETAILS §3) — placement « in-game » : SEUL
          écran où `SoundQuickMute` est monté (musique de fond EN BOUCLE + SFX joués ICI, cf.
          `useEffect(playMusic("play"))` ci-dessous ; `ResultsScreen` ne joue qu'un SFX ponctuel au
          montage — déjà terminé avant qu'un clic n'ait pu l'atteindre, donc scope volontairement
          resserré à cet écran). Rendu EN FLUX (non-occlusion structurelle) — « Changer de joueur »
          n'est plus un bouton local ici : il vit dans le shell persistant (`AppShell.tsx`, story
          R1.1 #337), toujours accessible au-dessus de cet écran. */}
      <SoundQuickMute />
    </main>
  );
}

/**
 * Écran de statut minimal (chargement / erreur / niveau vide / verrou temps d'écran / intro
 * diagnostic). **Focus a11y** (#244, patron `ResultsScreen.tsx`/LEARNINGS #36) : chaque état
 * remplace l'écran plein-écran précédent SANS annonce SR native (pas de changement de route) —
 * le titre doit donc recevoir le focus au montage. Le ref-callback `focusOnMount` appelle
 * `.focus()` **au MONTAGE du nœud** `<h1>` ; ce montage n'a lieu à chaque transition QUE parce
 * que l'appelant (`PlayScreen`) pose un **`key` distinct par état** sur chaque `<StatusMessage/>`
 * → React REMONTE le composant (nouveau nœud `<h1>`) à chaque changement d'état, au lieu de le
 * réutiliser en UPDATE (auquel cas le ref-callback ne se réinvoquerait pas et seul l'état initial
 * serait focalisé — cf. commentaire du `key` côté `PlayScreen`). Prioritaire pour `locked` (verrou
 * dur temps d'écran, story 7.8) qui empêche l'entrée en jeu. `outline:"none"` **documenté**
 * (STACK-TRAP #222) : focus hors ordre clavier (`tabIndex={-1}`) → l'anneau UA serait un artefact
 * sans valeur a11y ici.
 */
function StatusMessage({
  text,
  hint,
  children,
}: {
  readonly text: string;
  readonly hint?: string;
  readonly children?: React.ReactNode;
}) {
  const focusOnMount = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);

  return (
    <main
      className="bg-bg text-text"
      style={{
        // Shell persistant EN FLUX au-dessus (story R1.1 #337, `(app)/layout.tsx`) : réserve sa
        // propre hauteur (`--app-shell-height`) hors de ce `<main>` — jamais `100dvh` brut, même
        // rationale/garde que `PlayingGame` ci-dessus (cf. son commentaire détaillé).
        minHeight: "calc(100dvh - var(--app-shell-height))",
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
        ref={focusOnMount}
        tabIndex={-1}
        style={{
          fontFamily: "var(--font-family-display)",
          fontSize: "var(--font-size-xl)",
          fontWeight: "var(--font-weight-bold)",
          color: "var(--color-text-primary)",
          margin: 0,
          outline: "none",
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
      {/* « Changer de joueur » n'est plus rendu ici : le shell persistant (`AppShell.tsx`, story
          R1.1 #337) le porte au-dessus de CET écran, sur TOUS les états de `PlayScreen`. */}
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
      className="mz-focusable"
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
