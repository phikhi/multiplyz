/**
 * Sélection **déterministe** d'une variante de copy (COPY §1 : « varier les
 * formulations » pour éviter l'effet robot). Le choix est piloté par un `seed` entier
 * injecté (ex. l'index de la question dans le niveau) plutôt que `Math.random()` —
 * reproductible en test, aucune branche probabiliste sous gate coverage 100 %
 * (LEARNINGS aléa/#34/#61).
 */

/**
 * Choisit une variante dans `variants` (non vide) selon `seed` (entier ≥ 0, ex. l'index
 * de question) — rotation simple `seed % length`. `variants` vide n'est **jamais**
 * fourni (contrat interne : les tables de `strings.play.*.variants` sont statiques et
 * non vides) — cf. l'appelant (`FeedbackPanel`).
 */
export function pickVariant(variants: readonly string[], seed: number): string {
  const index = ((seed % variants.length) + variants.length) % variants.length;
  return variants[index];
}
