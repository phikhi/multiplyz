/**
 * Helper de test **partagé** (story 8.1 #254) — mock `window.matchMedia` en réassignation
 * BRUTE (pas `vi.spyOn`) pour simuler le breakpoint téléphone (`useIsPhone`). Restauration
 * explicite exigée en `try/finally` par l'appelant (LEARNINGS #186/#193 : `restoreMocks:true`
 * ne rattrape pas une réassignation directe) — même patron que `ThemeToggle.test.tsx`.
 *
 * Retourne la fonction de restauration (jamais auto-restaurée ici : l'appelant contrôle la
 * fenêtre exacte du mock via son propre `try/finally`).
 */
export function mockPhone(matches: boolean): () => void {
  const original = window.matchMedia;
  window.matchMedia = (() => ({
    matches,
    media: "",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
