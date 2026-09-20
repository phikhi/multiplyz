"use client";
import type { ReactNode } from "react";
import { ForestScene } from "./game/ForestScene";
import { usePrefersReducedMotion } from "@/lib/sound/use-prefers-reduced-motion";
import { daily } from "@/strings/daily";
import { BRAND_NAME } from "@/config/brand";

export function ForestHome({
  children,
  first = false,
  quiet = false,
}: {
  children: ReactNode;
  first?: boolean;
  quiet?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="forest forest-home daily-home">
      <ForestScene phase="arrival" completed={0} total={10} paused={false} reduced={reduced} />
      <header className="daily-brand">{BRAND_NAME}</header>
      {!quiet && (
        <aside className="daily-welcome">
          <p className="forest-kicker">{daily.eyebrow}</p>
          <h2>{first ? daily.first : daily.welcome}</h2>
          <p>{first ? daily.firstHint : daily.invitation}</p>
        </aside>
      )}
      {children}
    </div>
  );
}
