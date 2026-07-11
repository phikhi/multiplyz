"use client";

import { useEffect, useState } from "react";

/**
 * Fondation responsive — écran de jeu (story 8.1 #254, WIREFRAMES §8). Un SEUL breakpoint
 * consommé : « téléphone » vs « tablette/desktop » (groupés, disposition actuelle préservée).
 *
 * Le nombre vit **exclusivement** dans `tokens.css` (`--bp-phone`) — jamais dupliqué en dur
 * ici. Les media queries CSS ne peuvent PAS référencer une custom property dans leur condition
 * (`@media (max-width: var(--x))` est invalide CSS), donc ce module consomme le token CÔTÉ JS
 * via `getComputedStyle` à l'exécution réelle plutôt que de recopier le nombre.
 */
const PHONE_BREAKPOINT_TOKEN = "--bp-phone";

/**
 * Sentinelle « ne matche jamais » — utilisée quand aucune valeur de breakpoint n'est disponible
 * (SSR : pas de `window` ; environnement dégradé : `tokens.css` non chargé dans le CSSOM, ex.
 * jsdom où `getPropertyValue` renvoie une chaîne vide). Repli **sûr** : `useIsPhone` retombe alors
 * sur `false` (disposition tablette/desktop = défaut non-pouce, toujours utilisable) SANS jamais
 * fabriquer/dupliquer un nombre de breakpoint (le nombre vit EXCLUSIVEMENT dans `tokens.css`,
 * `--bp-phone` — règle tokens). `0px` n'est PAS le breakpoint : c'est une valeur-sentinelle
 * sémantiquement distincte (« aucune largeur ne matche »), partagée par le chemin SSR ci-dessous.
 * En navigateur réel, `tokens.css` est TOUJOURS chargé (via `globals.css`) → la sentinelle n'est
 * jamais atteinte, la vraie valeur du token est lue.
 */
const NEVER_MATCH_QUERY = "(max-width: 0px)";

/**
 * Construit la requête `matchMedia` du breakpoint téléphone en LISANT la valeur RÉSOLUE de
 * `--bp-phone` sur `document.documentElement` — jamais une valeur dupliquée en dur (règle
 * tokens, CLAUDE.md : « aucune valeur en dur, y compris les breakpoints »). Si la valeur n'est
 * pas résolvable (SSR / CSSOM sans tokens.css), renvoie la sentinelle « ne matche jamais »
 * (`NEVER_MATCH_QUERY`) plutôt qu'un nombre fabriqué → aucun breakpoint dupliqué côté JS.
 */
export function phoneMediaQuery(): string {
  if (typeof window === "undefined") return NEVER_MATCH_QUERY; // SSR : jamais rendu côté serveur (cf. commentaire useIsPhone)
  const resolved = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(PHONE_BREAKPOINT_TOKEN)
    .trim();
  return resolved.length > 0 ? `(max-width: ${resolved})` : NEVER_MATCH_QUERY;
}

/**
 * Valeur initiale de `useIsPhone` — exportée séparément (comme `getInitialTheme` de
 * `ThemeToggle.tsx`) pour rester testable en isolation (SSR, `window` absent) sans dépendre de
 * la machinerie `useState`/React.
 */
export function getInitialIsPhone(): boolean {
  return typeof window === "undefined" ? false : window.matchMedia(phoneMediaQuery()).matches;
}

/**
 * `true` sous le breakpoint téléphone (`--bp-phone`). Consommé uniquement par l'écran de jeu
 * (`QuestionCard`/`FeedbackPanel`/`ActionBar`/`PlayScreen`), qui ne rend **jamais** côté SSR
 * (`PlayScreen` démarre toujours en `{kind:"loading"}` — le fetch du niveau est client-only,
 * `fetchLevel` s'exécute après montage). Lire `window` dans l'état initial ne provoque donc
 * AUCUNE désynchro d'hydratation : il n'existe aucun rendu serveur de ces composants à comparer
 * (cf. `PlayScreen.tsx`, commentaire du `key` distinct par état).
 */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(getInitialIsPhone);

  // Pas de re-sync synchrone ici (`setState` direct en corps d'effet = anti-patron React,
  // `react-hooks/set-state-in-effect`) : `getInitialIsPhone` lit déjà `matchMedia` au 1er rendu
  // (même tick que le montage, aucune staleness réelle à corriger) — l'effet se contente de
  // s'ABONNER aux changements FUTURS (redimensionnement réel après montage), seul rôle légitime
  // d'un effet ici (« subscribe for updates from an external system »).
  useEffect(() => {
    const mql = window.matchMedia(phoneMediaQuery());
    const handler = (event: MediaQueryListEvent) => setIsPhone(event.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isPhone;
}
