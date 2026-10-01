"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { CurrentWorldMap } from "@/lib/game/world-theme";
import type { Adventure } from "@/lib/game/adventure-types";
import { daily } from "@/strings/daily";
import { forest } from "@/strings/forest";
import { worldScenes, worldSceneKind } from "@/strings/world-scenes";
import { ForestScene } from "./ForestScene";
import { usePrefersReducedMotion } from "@/lib/sound/use-prefers-reduced-motion";

export function ForestMap({
  map,
  adventure,
  motion,
}: {
  map: CurrentWorldMap;
  adventure: Adventure | null;
  motion?: { paused: boolean; reduced: boolean };
}) {
  const reduced = usePrefersReducedMotion();
  const active = adventure && adventure.phase !== "closed" ? adventure : null;
  const scenery = worldScenes[worldSceneKind(map.theme.slug, map.worldIndex)];
  const mission = active?.worldTheme
    ? worldScenes[worldSceneKind(active.worldTheme.slug, active.worldIndex)]
    : scenery;
  const current = map.nodes.find((node) => node.status === "current");
  const completed = map.nodes.filter((node) => node.status === "completed").length;
  const points = map.nodes.map((_, i) => ({
    x: 6 + (i / (map.nodes.length - 1)) * 88,
    y: 51 + Math.sin(i * 0.82) * 23,
  }));
  return (
    <main className="forest forest-map" data-world={map.theme.slug}>
      <ForestScene
        theme={map.theme}
        worldIndex={map.worldIndex}
        phase="question"
        completed={0}
        total={10}
        paused={motion?.paused ?? false}
        reduced={reduced || motion?.reduced === true}
      />
      <div className="forest-map-content">
        <header className="forest-map-heading">
          <p className="forest-kicker">{`${forest.world(map.worldIndex + 1)} · ${forest.mapEyebrow}`}</p>
          <h1>
            {map.worldIndex === 0 && map.theme.slug === "forest"
              ? forest.mapTitle
              : map.theme.label}
          </h1>
          <p>{scenery.mapIntro}</p>
        </header>
        <div className="forest-map-stage">
          <svg
            className="forest-map-path"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} />
          </svg>
          <ol aria-label={forest.mapPath} className="forest-map-nodes">
            {map.nodes.map((node, i) => {
              const isCurrent = node.status === "current";
              const done = node.status === "completed";
              const title = node.type === "boss" ? scenery.guardian : forest.step(i + 1);
              return (
                <li
                  key={node.index}
                  style={
                    {
                      "--node-x": `${points[i].x}%`,
                      "--node-y": `${points[i].y}%`,
                    } as CSSProperties
                  }
                  data-status={node.status}
                >
                  {isCurrent ? (
                    <Link
                      href="/jouer"
                      aria-current="step"
                      aria-label={`${title} · ${forest.current}`}
                      className="forest-node"
                    >
                      <span>{i + 1}</span>
                    </Link>
                  ) : (
                    <div
                      className="forest-node"
                      aria-label={`${title} · ${done ? forest.completed : forest.locked}`}
                    >
                      <span>
                        {done ? forest.check : node.type === "boss" ? forest.guardianSymbol : i + 1}
                      </span>
                    </div>
                  )}
                  <span className="forest-node-caption">
                    {isCurrent
                      ? forest.current
                      : node.type === "boss"
                        ? forest.guardianStep
                        : title}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="forest-map-bottom">
          <section className="forest-mission">
            <p className="forest-kicker">
              {active?.diagnostic
                ? active.diagnostic.recalibration
                  ? daily.recalibrationEyebrow
                  : daily.diagnosticEyebrow
                : forest.step((active?.levelIndex ?? current?.index ?? 0) + 1)}
            </p>
            <h2>{active?.diagnostic ? daily.diagnosticTitle : mission.title}</h2>
            <p>{active ? forest.pauseHint : mission.invitation}</p>
            <Link href="/jouer" className="forest-primary">
              {active?.result ? forest.resumeResult : active ? forest.resume : forest.continue}
              <span aria-hidden="true">{forest.arrow}</span>
            </Link>
            <small>{forest.lights(completed, map.nodes.length)}</small>
          </section>
          <aside className="forest-guardian">
            <span aria-hidden="true">{forest.guardianSymbol}</span>
            <h2>{scenery.guardian}</h2>
            <p>{forest.guardianHint}</p>
            <nav>
              <Link href="/collection">{forest.collection}</Link>
              <Link href="/boutique">{forest.shop}</Link>
            </nav>
          </aside>
        </div>
      </div>
    </main>
  );
}
