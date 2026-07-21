"use client";

import { useSyncExternalStore } from "react";

/**
 * Hook `prefers-reduced-motion` (story 8.4, #257, AC #3 — DESIGN_TOKENS.md:32, tokens.css:617).
 * Ce média-feature n'est **PAS** un token `tokens.css` (longueur calibrable) : c'est un feature
 * média système, la requête est un littéral CSS standard (`prefers-reduced-motion`), rien à
 * dupliquer/résoudre.
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Valeur « réelle » lue depuis `window.matchMedia` — exportée séparément (patron `getInitialIsPhone`
 * de `use-is-phone.ts`) pour rester testable en isolation (SSR, `window` absent) sans dépendre de la
 * machinerie React. Sert de `getSnapshot` CLIENT à `useSyncExternalStore` ci-dessous (fix #305,
 * anti-patron hydratation préventif #353) : React ne l'appelle **jamais** côté SSR (le 3ᵉ argument
 * `getServerSnapshot` couvre ce cas), donc la branche `typeof window` ne documente que le cas des
 * appels directs (tests en isolation). SSR → `false` (repli sûr, aucun juice atténué par défaut).
 */
export function getInitialPrefersReducedMotion(): boolean {
  return typeof window === "undefined" ? false : window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * S'abonne aux changements RÉELS du média-feature (`change` du `MediaQueryList`) — le `subscribe`
 * de `useSyncExternalStore`. React ne l'appelle **jamais** côté SSR (uniquement après
 * l'hydratation, côté client), donc `window` y existe toujours.
 */
function subscribe(onStoreChange: () => void): () => void {
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

/**
 * Snapshot SSR — TOUJOURS `false` (jamais une lecture de `window`, absent côté serveur). C'est la
 * valeur que React utilise pour le rendu serveur ET pour le 1ᵉʳ rendu client à l'hydratation : les
 * deux sont ainsi **identiques par construction** (cf. JSDoc `usePrefersReducedMotion`).
 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * `true` sous `prefers-reduced-motion: reduce` — consommé par `SoundProvider` (atténuation SFX).
 *
 * **Déterminisme SSR = 1ᵉʳ rendu client (fix #305 appliqué préventivement, #353)** : implémenté via
 * `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` — le patron REACT OFFICIEL pour
 * une valeur externe lue depuis `window`, indisponible côté SSR
 * (https://react.dev/reference/react/useSyncExternalStore#adding-support-for-server-rendering).
 * `getServerSnapshot` fournit la valeur du rendu serveur **ET** du 1ᵉʳ rendu client d'hydratation
 * (`false`, TOUJOURS) → HTML serveur et 1ᵉʳ commit client sont **identiques par construction**, quel
 * que soit le consommateur. React re-synchronise ensuite silencieusement vers la vraie valeur juste
 * après le commit — ce mécanisme est **intégré à React** (pas un `useState`+`useEffect` maison), donc
 * immun à la fois au bug d'hydratation #305 et au lint `react-hooks/set-state-in-effect`.
 *
 * **Anti-patron corrigé (#353, jumeau de #305)** : avant ce fix, l'état initial appelait
 * `getInitialPrefersReducedMotion()` (lecture SYNCHRONE de `window.matchMedia`) dans l'initialiseur
 * paresseux d'un `useState`. Cette lecture s'exécutait AUSSI au 1ᵉʳ rendu CLIENT (l'hydratation) — un
 * contexte où `window` existe déjà, contrairement au SSR — donc pouvait diverger de la valeur SSR
 * (`false`). C'était **sûr aujourd'hui** uniquement parce que le seul consommateur (`SoundProvider`)
 * n'expose cette valeur qu'à de la LOGIQUE AUDIO (`reducedMotionRef`, jamais rendue au DOM → aucune
 * divergence observable). Ce fix rend le hook sûr PAR CONSTRUCTION, sans dépendre de cette hypothèse
 * fragile propre à l'appelant courant (exactement la leçon #305 : ne pas s'appuyer sur un invariant
 * du consommateur qu'un futur consommateur — qui rendrait la valeur au DOM — casserait silencieusement).
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getInitialPrefersReducedMotion, getServerSnapshot);
}
