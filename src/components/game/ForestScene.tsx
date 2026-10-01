"use client";

import { useEffect, useRef, useState } from "react";
import type { WorldTheme } from "@/lib/game/world-theme";
import { WORLD_ASSET_BASE } from "@/lib/game/world-theme";
import { worldSceneKind, worldSceneStatus } from "@/strings/world-scenes";
import { AssetImage } from "@/components/media/AssetImage";

export interface ForestState {
  completed: number;
  total: number;
  phase: string;
  paused: boolean;
  reduced: boolean;
  showFriend?: boolean;
  theme?: WorldTheme;
  worldIndex?: number;
}
interface ForestHandle {
  setState(state: ForestState): void;
  dispose(): void;
}

/** One read-only scene API for every world; no progression or asset generation here. */
export function ForestScene(state: ForestState) {
  const root = useRef<HTMLDivElement>(null);
  const scene = useRef<ForestHandle | null>(null);
  const latest = useRef(state);
  const [failed, setFailed] = useState(false);
  const kind = worldSceneKind(state.theme?.slug, state.worldIndex);
  const worldIndex = state.worldIndex ?? 0;
  const background = state.theme?.background;
  const backgroundRef = background?.startsWith(WORLD_ASSET_BASE)
    ? background.slice(WORLD_ASSET_BASE.length)
    : null;
  useEffect(() => {
    let reduced = state.reduced;
    try {
      reduced ||= localStorage.getItem("teddy:reduced") === "true";
    } catch {
      /* device preference unavailable */
    }
    latest.current = { ...state, reduced };
    scene.current?.setState(latest.current);
  }, [state]);
  useEffect(() => {
    let cancelled = false;
    const element = root.current;
    const modulePath = "/forest/world.js";
    function unavailable() {
      if (cancelled) return;
      scene.current?.dispose();
      scene.current = null;
      if (!cancelled) setFailed(true);
    }
    element?.addEventListener("webglcontextlost", unavailable, true);
    void import(/* webpackIgnore: true */ modulePath)
      .then(
        (module: {
          createTeddyForest(
            root: HTMLElement,
            options: { kind: string; worldIndex: number },
          ): ForestHandle;
        }) => {
          if (cancelled || !root.current) return;
          setFailed(false);
          scene.current = module.createTeddyForest(root.current, { kind, worldIndex });
          scene.current.setState(latest.current);
        },
      )
      .catch(unavailable);
    return () => {
      cancelled = true;
      element?.removeEventListener("webglcontextlost", unavailable, true);
      scene.current?.dispose();
      scene.current = null;
    };
  }, [kind, worldIndex]);
  return (
    <div ref={root} className="forest-renderer" data-biome={kind} aria-hidden="true">
      <div className="world-backdrop">
        <AssetImage
          key={backgroundRef}
          assetRef={backgroundRef}
          alt=""
          width="100%"
          dataAsset="world-backdrop"
          decorative
          fallback={null}
        />
      </div>
      <div className="tp-scene">
        <div className="tp-world" />
        <div className="forest-vignette" />
      </div>
      <div className="tp-loading" hidden={failed}>
        {worldSceneStatus.loading}
      </div>
      {failed && <p className="forest-fallback">{worldSceneStatus.fallback}</p>}
    </div>
  );
}
