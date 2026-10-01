"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { daily } from "@/strings/daily";
import { BRAND_NAME } from "@/config/brand";
import { worldScenes, worldSceneKind } from "@/strings/world-scenes";
import { forest } from "@/strings/forest";
import { strings } from "@/strings";
import { useAdventure } from "@/lib/game/use-adventure";
import { formatEquation } from "@/lib/game/equation";
import { resolveAnswer } from "@/lib/game/answer";
import { usePrefersReducedMotion } from "@/lib/sound/use-prefers-reduced-motion";
import { SoundProvider, useSound } from "@/lib/sound/SoundProvider";
import type { SoundSettings } from "@/lib/sound/settings";
import { setChildSoundEnabledAction } from "@/app/(app)/jouer/actions";
import { ForestScene } from "./ForestScene";
import { ForestQuestion } from "./ForestQuestion";
import { ForestHelp } from "./ForestHelp";
import { CompanionArt } from "./CollectionScreen";
import { companions } from "@/strings/companions";

export function AdventureScreen({
  profileId,
  sound,
  guardianLevelIndex,
}: {
  profileId: number;
  sound: SoundSettings;
  guardianLevelIndex: number;
}) {
  const [settings, setSettings] = useState(sound);
  const toggleSound = () => {
    const enabled = !settings.soundEnabled;
    setSettings({ ...settings, soundEnabled: enabled });
    void setChildSoundEnabledAction(enabled).catch(() => {});
  };
  return (
    <SoundProvider settings={settings}>
      <AdventureInner
        profileId={profileId}
        guardianLevelIndex={guardianLevelIndex}
        soundEnabled={settings.soundEnabled}
        toggleSound={toggleSound}
      />
    </SoundProvider>
  );
}

function AdventureInner({
  profileId,
  soundEnabled,
  toggleSound,
  guardianLevelIndex,
}: {
  profileId: number;
  soundEnabled: boolean;
  toggleSound(): void;
  guardianLevelIndex: number;
}) {
  const {
    adventure: a,
    error,
    sending,
    storageWarning,
    dispatch,
    retry,
    refresh,
  } = useAdventure(profileId);
  const paused = a?.paused === true;
  const diagnostic = a?.diagnostic;
  const { replace } = useRouter();
  useEffect(() => {
    if (error === "LOCKED") replace("/repos");
  }, [error, replace]);
  const [manualReduced, setManualReduced] = useState(false);
  const systemReduced = usePrefersReducedMotion();
  const dialog = useRef<HTMLDialogElement>(null);
  const pauseButton = useRef<HTMLButtonElement>(null);
  const { playSfx } = useSound();
  const previousRevision = useRef<string | null>(null);
  const phase = a?.phase ?? "arrival";
  const question = a?.game.current.question;
  const completed = a
    ? a.game.finished
      ? a.game.questions.length
      : a.game.currentIndex + (phase === "feedback" ? 1 : 0)
    : 0;
  const total = a?.game.questions.length ?? 10;
  const reduced = systemReduced || manualReduced;
  const disabled = sending || error !== null;
  const legendary = a?.result?.legendary;
  const meeting = Boolean(legendary && (phase === "finale" || phase === "results"));
  const sceneKind = worldSceneKind(a?.worldTheme?.slug, a?.worldIndex);
  const scenery = worldScenes[sceneKind];
  const guardian = a?.levelIndex === guardianLevelIndex;

  useEffect(() => {
    const id = a ? `${a.id}:${a.revision}` : null;
    if (id !== previousRevision.current && phase === "feedback") playSfx("correct");
    previousRevision.current = id;
  }, [a, phase, playSfx]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("teddy:reduced") === "true";
      queueMicrotask(() => setManualReduced(saved));
    } catch {
      /* device preference */
    }
  }, []);
  useEffect(() => {
    if (paused) dialog.current?.showModal();
    else if (dialog.current?.open) {
      dialog.current.close();
      pauseButton.current?.focus();
    }
  }, [paused]);
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.repeat) {
        event.preventDefault();
        if (!disabled) dispatch(paused ? "resume" : "pause");
      }
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [disabled, dispatch, paused]);

  function toggleReduced() {
    setManualReduced(!manualReduced);
    try {
      localStorage.setItem("teddy:reduced", String(!manualReduced));
    } catch {
      /* device preference */
    }
  }
  return (
    <main
      className="forest forest-adventure"
      data-world={a?.worldTheme?.slug}
      data-phase={phase}
      data-reduced={reduced}
      data-revision={a?.revision}
    >
      <ForestScene
        theme={a?.worldTheme}
        worldIndex={a?.worldIndex}
        completed={completed}
        total={total}
        phase={phase === "question" ? "question" : phase === "reveal" ? "help" : phase}
        paused={paused || sending || error !== null}
        reduced={reduced}
        showFriend={!meeting && sceneKind === "forest"}
      />
      <header className="forest-hud">
        <Link href="/carte" className="forest-brand">
          {BRAND_NAME}
          <span aria-hidden="true">{forest.light}</span>
        </Link>
        <div
          className="forest-progress"
          aria-label={
            diagnostic
              ? daily.diagnosticProgress(completed, total)
              : forest.lights(completed, total)
          }
          role="status"
        >
          <span className="forest-lights" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <i key={i} data-lit={i < completed} />
            ))}
          </span>
          <span>
            {diagnostic
              ? daily.diagnosticProgress(completed, total)
              : forest.lights(completed, total)}
          </span>
        </div>
        <div className="forest-comfort">
          <button onClick={toggleSound} aria-pressed={soundEnabled}>
            {soundEnabled ? forest.soundOn : forest.soundOff}
          </button>
          <button ref={pauseButton} disabled={disabled || !a} onClick={() => dispatch("pause")}>
            {forest.pause}
            <kbd>{"Esc"}</kbd>
          </button>
        </div>
      </header>
      <div className={`forest-content ${meeting ? "companion-encounter" : ""}`} inert={paused}>
        {(phase === "arrival" || phase === "finale" || phase === "results") && (
          <div className="forest-chapter">
            <p className="forest-kicker">
              {diagnostic
                ? diagnostic.recalibration
                  ? daily.recalibrationEyebrow
                  : daily.diagnosticEyebrow
                : a
                  ? `${forest.world(a.worldIndex + 1)} · ${forest.step(a.levelIndex + 1)}`
                  : scenery.eyebrow}
            </p>
            <h1>
              {meeting
                ? companions.meetTitle
                : phase === "arrival"
                  ? diagnostic
                    ? daily.diagnosticTitle
                    : guardian
                      ? scenery.guardian
                      : scenery.title
                  : diagnostic
                    ? daily.diagnosticDone
                    : scenery.finale}
            </h1>
          </div>
        )}
        <section
          className={`forest-panel ${phase === "arrival" || phase === "finale" ? "forest-story-panel" : ""}`}
          aria-busy={sending}
        >
          {!a ? (
            <>
              <h2>
                {error === "LOCKED"
                  ? strings.play.screenTimeLocked.title
                  : error === "EMPTY"
                    ? strings.play.emptyLevel
                    : error === "UNAUTHENTICATED"
                      ? forest.authError
                      : error
                        ? forest.loadError
                        : forest.loading}
              </h2>
              {error === "LOCKED" ? (
                <p>{strings.play.screenTimeLocked.hint}</p>
              ) : error === "UNAUTHENTICATED" ? (
                <Link className="forest-primary" href="/">
                  {forest.login}
                </Link>
              ) : (
                error && (
                  <button
                    className="forest-primary"
                    onClick={
                      error === "INVALID" || error === "STALE" ? refresh : () => void retry()
                    }
                  >
                    {error === "INVALID" || error === "STALE"
                      ? forest.refresh
                      : forest.retryNetwork}
                  </button>
                )
              )}
            </>
          ) : phase === "arrival" ? (
            <>
              <p className="forest-kicker">{forest.teddy}</p>
              <p>
                {diagnostic
                  ? diagnostic.recalibration
                    ? daily.recalibrationHint
                    : daily.diagnosticIntro
                  : guardian
                    ? forest.guardianIntro
                    : scenery.invitation}
              </p>
              <button
                className="forest-primary"
                disabled={disabled}
                onClick={() => dispatch("begin")}
              >
                {diagnostic ? daily.diagnosticBegin : forest.begin}
                <span aria-hidden="true">{forest.arrow}</span>
              </button>
            </>
          ) : phase === "question" && question ? (
            <ForestQuestion
              key={`${a.id}:${a.revision}`}
              question={question}
              draftKey={`teddy:draft:${profileId}:${a.id}:${a.revision}`}
              retrying={a.game.current.isRetrying}
              paused={paused}
              disabled={disabled}
              onAnswer={(value, responseMs) => dispatch("answer", { value, responseMs })}
            />
          ) : (phase === "help" || phase === "reveal") && question ? (
            <ForestHelp
              key={`${a.id}:${a.game.currentIndex}`}
              question={question}
              revealed={phase === "reveal"}
              disabled={disabled}
              onReveal={() => dispatch("reveal")}
              onRetry={() => dispatch("retry")}
            />
          ) : phase === "feedback" && question ? (
            <div key={`${a.id}:${a.revision}`}>
              <h2
                tabIndex={-1}
                ref={(node) => {
                  node?.focus();
                }}
              >
                {a.game.current.isRetrying ? forest.accompanied : forest.correct}
              </h2>
              <p>{forest.feedback}</p>
              <p className="forest-help-result">
                {formatEquation(question.skill, question.operands).replace(
                  "?",
                  String(resolveAnswer(question.factKey)),
                )}
              </p>
              <button
                className="forest-primary"
                disabled={disabled}
                onClick={() => dispatch("next")}
              >
                {forest.next}
                <span aria-hidden="true">{forest.arrow}</span>
              </button>
            </div>
          ) : phase === "finale" && diagnostic ? (
            <div>
              <h2 tabIndex={-1} ref={(node) => node?.focus()}>
                {daily.diagnosticDone}
              </h2>
              <p>{daily.diagnosticDoneHint}</p>
              <button
                className="forest-primary"
                disabled={disabled}
                onClick={() => dispatch("close")}
              >
                {daily.diagnosticMap}
              </button>
            </div>
          ) : phase === "finale" ? (
            <div>
              <p className="forest-kicker">{forest.teddy}</p>
              <h2
                tabIndex={-1}
                ref={(node) => {
                  node?.focus();
                }}
              >
                {a.result?.legendary?.name ?? forest.welcome}
              </h2>
              <p>{a.result?.legendary?.story ?? scenery.encounter}</p>
              {a.result?.legendary && (
                <p>{a.result.legendaryAdded ? companions.added : companions.reunited}</p>
              )}
              <button
                className="forest-primary"
                disabled={disabled}
                onClick={() => dispatch("results")}
              >
                {forest.results}
                <span aria-hidden="true">{forest.arrow}</span>
              </button>
            </div>
          ) : phase === "results" && a.result ? (
            <div>
              <p className="forest-kicker">{forest.results}</p>
              <h2
                tabIndex={-1}
                ref={(node) => {
                  node?.focus();
                }}
              >
                {forest.resultTitle}
              </h2>
              <p className="forest-stars" aria-label={forest.stars(a.result.stars)}>
                <span aria-hidden="true">
                  {forest.star.repeat(a.result.stars)}
                  {forest.emptyStar.repeat(3 - a.result.stars)}
                </span>
              </p>
              <div className="forest-rewards">
                <p>
                  <strong>{a.result.coinsApplied ? `+${a.result.reward.total}` : 0}</strong>
                  {forest.earned}
                </p>
                <p>
                  <strong>{a.result.balance.coins}</strong>
                  {forest.balance}
                </p>
              </div>
              {!a.result.coinsApplied && <p>{forest.alreadyEarned}</p>}
              <p className="forest-saved">{forest.saved}</p>
              {legendary && (
                <div className="companion-result-links">
                  <p>{companions.nextWorld}</p>
                  <button
                    className="forest-secondary"
                    disabled={disabled}
                    onClick={() => dispatch("close", { destination: "companion" })}
                  >
                    {companions.visit}
                  </button>
                </div>
              )}
              <button
                className="forest-primary"
                disabled={disabled}
                onClick={() => dispatch("close")}
              >
                {forest.returnMap}
                <span aria-hidden="true">{forest.arrow}</span>
              </button>
            </div>
          ) : null}
        </section>
        {meeting && legendary && (
          <figure className="companion-encounter-art">
            <CompanionArt
              artRef={legendary.artRef}
              name={legendary.name}
              dataAsset="forest-legendary"
            />
            <figcaption>
              <span className="forest-kicker">{companions.meetKicker}</span>
              <strong>{legendary.name}</strong>
            </figcaption>
          </figure>
        )}
        {a && (error || sending || storageWarning) && (
          <div className="forest-network" role="status">
            {error ? (
              <>
                <p>
                  {error === "NETWORK"
                    ? forest.pending
                    : error === "UNAUTHENTICATED"
                      ? forest.authError
                      : forest.sessionChanged}
                </p>
                {error === "UNAUTHENTICATED" ? (
                  <Link href="/">{forest.login}</Link>
                ) : (
                  <button
                    className="forest-secondary"
                    onClick={error === "NETWORK" ? () => void retry() : refresh}
                  >
                    {error === "NETWORK" ? forest.retryNetwork : forest.refresh}
                  </button>
                )}
              </>
            ) : (
              <p>{storageWarning ? forest.storageError : forest.sending}</p>
            )}
          </div>
        )}
      </div>
      <footer className="forest-foot">
        <span>{scenery.title}</span>
        <span>{forest.keys}</span>
      </footer>
      <dialog
        ref={dialog}
        className="forest-pause"
        onCancel={(event) => {
          event.preventDefault();
          if (!disabled) dispatch("resume");
        }}
      >
        <p className="forest-kicker">{forest.teddy}</p>
        <h2>{forest.pauseTitle}</h2>
        <p>{disabled ? daily.pauseSaving : forest.pauseHint}</p>
        {error && (
          <div role="status">
            <p>
              {error === "NETWORK"
                ? forest.pending
                : error === "UNAUTHENTICATED"
                  ? forest.authError
                  : forest.sessionChanged}
            </p>
            {error === "UNAUTHENTICATED" ? (
              <Link href="/">{forest.login}</Link>
            ) : (
              <button
                className="forest-secondary"
                onClick={error === "NETWORK" ? () => void retry() : refresh}
              >
                {error === "NETWORK" ? forest.retryNetwork : forest.refresh}
              </button>
            )}
          </div>
        )}
        <button className="forest-primary" disabled={disabled} onClick={() => dispatch("resume")}>
          {forest.resumePlay}
        </button>
        <button className="forest-secondary" aria-pressed={reduced} onClick={toggleReduced}>
          {forest.reduced}
        </button>
        {!disabled && (
          <Link href="/repos" className="forest-help-link">
            {daily.stop}
          </Link>
        )}
      </dialog>
    </main>
  );
}
