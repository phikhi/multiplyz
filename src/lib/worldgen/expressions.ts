/**
 * **Model sheet d'expressions Teddy** (WORLDGEN §8, story 6.2) — le lot des 5 expressions
 * générées au Stage A et réutilisées comme **sprites de réaction** en jeu (double usage,
 * WORLDGEN §8 ; COPY §3 réactions).
 *
 * Slugs **centralisés** (CLAUDE.md « strings centralisées, zéro texte en dur ») : source
 * unique de la liste + de la nuance de prompt de chaque expression. Ordre = ordre canonique
 * WORLDGEN §8 (« neutre · content · oups · acclame · intrépide »).
 *
 * Slugs ASCII (`intrepide` sans accent) : clé technique stable pour l'`id` d'asset de
 * référence (`teddy:expression:<slug>`) et le nom de fichier — la **voix** française
 * (accentuée, tutoiement Teddy) vit dans la couche copy en jeu, pas dans la clé d'asset.
 */

/** Une expression du model sheet : slug technique + nuance de prompt (mimique) + libellé. */
export interface TeddyExpression {
  /** Slug technique ASCII stable (clé d'asset + nom de fichier). */
  readonly slug: string;
  /**
   * Nuance de mimique injectée dans le prompt Teddy (après le gabarit ART §5). En anglais
   * (meilleur ancrage du modèle, ART §5). Décrit **l'expression faciale**, pas l'accessoire.
   */
  readonly promptMood: string;
  /** Contexte d'usage en jeu (COPY §3) — documentaire, non injecté au modèle. */
  readonly usage: string;
}

/**
 * Les 5 expressions du model sheet, dans l'ordre canonique WORLDGEN §8. `as const` → tuple
 * figé (garde la longueur = 5 au type + à l'exécution).
 */
export const TEDDY_EXPRESSIONS = [
  {
    slug: "neutre",
    promptMood: "calm neutral friendly expression, relaxed soft smile",
    usage: "état de repos / accueil (COPY §3)",
  },
  {
    slug: "content",
    promptMood: "happy proud cheerful expression, big joyful smile, sparkling eyes",
    usage: "bonne réponse / réussite (COPY §3 « Bravo ! »)",
  },
  {
    slug: "oups",
    promptMood: "gentle apologetic 'oops' expression, soft sympathetic look, no sadness",
    usage: "réponse à retravailler (COPY §3 « Oups, presque ! », jamais « faux »)",
  },
  {
    slug: "acclame",
    promptMood: "excited celebrating cheering expression, arms up, festive joy",
    usage: "fin de niveau / étoiles (COPY §3 « Niveau bouclé ! 🎉 »)",
  },
  {
    slug: "intrepide",
    promptMood: "brave adventurous determined expression, confident grin, ready to go",
    usage: "boss de monde (COPY §3 « Accroche-toi, on fonce ! 💪 »)",
  },
] as const satisfies readonly TeddyExpression[];

/** Nombre d'expressions du model sheet (WORLDGEN §8 = 5). */
export const EXPRESSION_COUNT = TEDDY_EXPRESSIONS.length;
