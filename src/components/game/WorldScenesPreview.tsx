"use client";

import { useState } from "react";
import { CURATED_THEMES } from "@/config/worldgen-themes";
import { buildMap } from "@/lib/game/map";
import { worldPreview, worldScenes, worldSceneKind } from "@/strings/world-scenes";
import { usePrefersReducedMotion } from "@/lib/sound/use-prefers-reduced-motion";
import { ForestMap } from "./ForestMap";
import { ForestScene } from "./ForestScene";

/** Explicitly an art preview, never a playable level or a source of catalogue data. */
export function WorldScenesPreview() {
  const [slug, setSlug] = useState("forest");
  const [view, setView] = useState("adventure");
  const [completed, setCompleted] = useState(0);
  const [paused, setPaused] = useState(false);
  const [manualReduced, setReduced] = useState(false);
  const systemReduced = usePrefersReducedMotion();
  const worldIndex = slug === "forest:4" ? 4 : 0;
  const theme = CURATED_THEMES.find((t) => t.slug === slug.split(":")[0])!;
  const world = { ...theme, background: null, teddy: null, tiles: null };
  const copy = worldScenes[worldSceneKind(theme.slug, worldIndex)];
  return (
    <div className="forest world-preview">
      <div className="world-preview-controls">
        <span>{worldPreview.label}</span>
        <label>
          {worldPreview.world}{" "}
          <select value={slug} onChange={(e) => setSlug(e.target.value)}>
            {CURATED_THEMES.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.label}
              </option>
            ))}
            <option value="forest:4">{worldPreview.grove}</option>
          </select>
        </label>
        <label>
          {worldPreview.view}{" "}
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="adventure">{worldPreview.adventure}</option>
            <option value="map">{worldPreview.map}</option>
          </select>
        </label>
        <label>
          {worldPreview.progress}{" "}
          <select value={completed} onChange={(e) => setCompleted(Number(e.target.value))}>
            <option value={0}>{worldPreview.start}</option>
            <option value={5}>{worldPreview.middle}</option>
            <option value={10}>{worldPreview.end}</option>
          </select>
        </label>
        <button type="button" onClick={() => setPaused(!paused)}>
          {paused ? worldPreview.resume : worldPreview.pause}
        </button>
        <button
          type="button"
          aria-pressed={manualReduced || systemReduced}
          onClick={() => setReduced(!manualReduced)}
        >
          {worldPreview.reduced}
        </button>
      </div>
      {view === "map" ? (
        <div inert>
          <ForestMap
            motion={{ paused, reduced: manualReduced || systemReduced }}
            adventure={null}
            map={{
              ...buildMap(
                worldIndex,
                { progress: { starsByLevel: new Map() }, debt: 0 },
                {
                  levelsPerWorld: 10,
                  bossQuestionCount: 13,
                  treasureEvery: 4,
                  revisionDebtThreshold: 12,
                },
              ),
              theme: world,
            }}
          />
        </div>
      ) : (
        <main className="forest forest-adventure" data-world={theme.slug}>
          <ForestScene
            theme={world}
            worldIndex={worldIndex}
            completed={completed}
            total={10}
            phase={completed === 10 ? "finale" : completed ? "question" : "arrival"}
            reduced={manualReduced || systemReduced}
            paused={paused}
            showFriend={false}
          />
          <div className="forest-content">
            <header className="forest-chapter">
              <p className="forest-kicker">{copy.eyebrow}</p>
              <h1>{copy.title}</h1>
            </header>
            <section className="forest-panel forest-story-panel">
              <p>{completed === 10 ? copy.encounter : copy.invitation}</p>
            </section>
          </div>
        </main>
      )}
    </div>
  );
}
