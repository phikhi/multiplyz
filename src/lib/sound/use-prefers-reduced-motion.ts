"use client";

import { useEffect, useState } from "react";

/**
 * Hook `prefers-reduced-motion` (story 8.4, #257, AC #3 — DESIGN_TOKENS.md:32, tokens.css:617).
 * Même patron que `@/lib/responsive/use-is-phone` (état initial lu directement, l'effet ne fait
 * que s'ABONNER aux changements FUTURS — pas de re-sync synchrone dans le corps de l'effet,
 * `react-hooks/set-state-in-effect`). Contrairement au breakpoint téléphone, ce média-feature
 * n'est PAS un token `tokens.css` (longueur calibrable) : c'est un feature média système, la
 * requête est un littéral CSS standard (`prefers-reduced-motion`), rien à dupliquer/résoudre.
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Valeur initiale — exportée séparément (patron `getInitialIsPhone`) pour rester testable en
 * isolation. SSR (`window` absent) → `false` (repli sûr, aucun juice atténué par défaut avant
 * hydratation ; ce hook n'est de toute façon consommé que côté client, `SoundProvider.tsx`).
 */
export function getInitialPrefersReducedMotion(): boolean {
  return typeof window === "undefined" ? false : window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** `true` sous `prefers-reduced-motion: reduce` — consommé par `SoundProvider` (atténuation SFX). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(getInitialPrefersReducedMotion);

  useEffect(() => {
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const handler = (event: MediaQueryListEvent) => setReduced(event.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}
