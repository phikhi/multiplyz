"use client";

import { useSyncExternalStore } from "react";

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
 * Valeur « réelle » d'`isPhone`, lue depuis `window.matchMedia` — exportée séparément (comme
 * `getInitialTheme` de `ThemeToggle.tsx`) pour rester testable en isolation (SSR, `window`
 * absent) sans dépendre de la machinerie React. Sert de `getSnapshot` CLIENT à
 * `useSyncExternalStore` ci-dessous (fix #305) : jamais appelée côté SSR par React (le 3ᵉ
 * argument `getServerSnapshot` couvre ce cas), donc jamais de branche `typeof window` à
 * l'intérieur — seul le repli explicite ci-dessous documente le cas SSR pour les appels directs
 * (tests en isolation).
 */
export function getInitialIsPhone(): boolean {
  return typeof window === "undefined" ? false : window.matchMedia(phoneMediaQuery()).matches;
}

/**
 * S'abonne aux changements RÉELS du breakpoint téléphone (redimensionnement/rotation) — le
 * `subscribe` de `useSyncExternalStore`. React ne l'appelle **jamais** côté SSR (uniquement
 * après l'hydratation, côté client), donc `window` y existe toujours.
 */
function subscribe(onStoreChange: () => void): () => void {
  const mql = window.matchMedia(phoneMediaQuery());
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

/**
 * Snapshot SSR — TOUJOURS `false` (jamais une lecture de `window`, absent côté serveur). C'est
 * la valeur que React utilise pour le rendu serveur ET pour le 1ᵉʳ rendu client à l'hydratation
 * (cf. JSDoc `useIsPhone`) : les deux sont ainsi **identiques par construction**.
 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * `true` sous le breakpoint téléphone (`--bp-phone`). Consommé par l'écran de jeu
 * (`QuestionCard`/`FeedbackPanel`/`ActionBar`/`PlayScreen`) ET par l'écran carte (`MapScreen`).
 *
 * **Déterminisme SSR = 1ᵉʳ rendu client (fix #305, rétro « hydration mismatch React sur
 * /carte »)** : implémenté via `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`
 * — le patron REACT OFFICIEL pour une valeur externe lue depuis `window`, indisponible côté SSR
 * (cf. https://react.dev/reference/react/useSyncExternalStore#adding-support-for-server-rendering).
 * `getServerSnapshot` fournit la valeur utilisée pour le rendu serveur **ET** pour le 1ᵉʳ rendu
 * client à l'hydratation (`false`, TOUJOURS) — HTML serveur et 1ᵉʳ commit client sont donc
 * **identiques par construction**, quel que soit le consommateur. React re-synchronise ensuite
 * silencieusement vers la vraie valeur (`getSnapshot`) juste après le commit, sans jamais
 * comparer/avertir d'un mismatch — ce mécanisme est **intégré à React lui-même** (pas un
 * `useState`+`useEffect` maison), donc immun à la fois au bug #305 et au lint
 * `react-hooks/set-state-in-effect`.
 *
 * Avant ce fix, l'état initial appelait `getInitialIsPhone()` (lecture SYNCHRONE de
 * `window.matchMedia`) directement dans l'initialiseur paresseux d'un `useState`. Cette lecture
 * s'exécutait AUSSI lors du 1ᵉʳ rendu CLIENT (l'hydratation) — un contexte où `window` existe
 * déjà, contrairement au SSR. Dès que le viewport réel passait sous `--bp-phone`, la valeur y
 * divergeait de celle du SSR (`false`) : pour un flag consommé dans un style rendu par
 * `MapScreen` **dans tous ses états** (y compris `loading`, lui-même SSR'd — contrairement à
 * `QuestionCard`/`ActionBar`/`PlayScreen`, qui ne montent jamais avant la fin d'un fetch
 * client-only et n'exposaient donc aucun rendu SSR à comparer), ceci produisait un mismatch
 * d'hydratation React 100 % reproductible sur `/carte` sous ce breakpoint. L'ancienne hypothèse
 * documentée ici (« aucun rendu SSR à comparer ») décrivait un invariant *propre à chaque
 * appelant*, pas une garantie du hook — donc pas sûre pour un futur/autre consommateur. Ce fix
 * rend `useIsPhone` sûr PAR CONSTRUCTION, sans dépendre de cette hypothèse fragile.
 */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, getInitialIsPhone, getServerSnapshot);
}
