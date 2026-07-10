/**
 * Mise en forme **pure** des valeurs affichées par le tableau de bord parent (story 7.7,
 * WIREFRAMES §7). Aucune I/O, aucun JSX — transforme des nombres bruts (ratios `[0,1]`, ms)
 * en chaînes/nombres à interpoler dans les gabarits centralisés (`strings.parent.dashboard`),
 * même discipline que `game/equation.ts` (`formatEquation`) : zéro texte en dur dans le
 * composant, zéro logique de formatage éparpillée.
 */

/** Justesse/ratio `[0,1]` → pourcentage ENTIER arrondi (ex. `0.823` → `82`). */
export function toPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

/**
 * Temps de réponse (ms) → secondes, 1 décimale, **virgule française** (COPY §6 : signes/
 * nombres localisés, ex. WIREFRAMES §7 « 3,2 s »). `Intl` serait plus lourd pour un seul
 * séparateur décimal — remplacement direct du point, déterministe.
 */
export function toSecondsFr(ms: number): string {
  return (ms / 1000).toFixed(1).replace(".", ",");
}

/**
 * Delta signé en **points de pourcentage entiers**, ex. `0.05` → `"+5"`, `-0.03` → `"−3"`,
 * `0` → `"0"`. Signe **typographique MOINS** (`−`, U+2212 — cohérent avec COPY §6 « 12 − 4 »),
 * jamais le trait d'union ASCII. Toujours appelé sur un `delta` non-`null` (le composant
 * appelant filtre déjà `Trend.delta === null` avant d'invoquer ce formateur).
 */
export function signedPercentPoints(delta: number): string {
  const points = Math.round(delta * 100);
  if (points > 0) return `+${points}`;
  if (points < 0) return `−${Math.abs(points)}`;
  return "0";
}
