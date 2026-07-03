/**
 * Mise en forme **pure** de l'énoncé d'une question (COPY §6 : « signes math clairs »,
 * ex. `6 × 8`, `7 + 5`, `12 − 4`, `? + 3 = 10`). Aucune I/O, aucun JSX — construit une
 * chaîne déjà interpolée depuis les gabarits centralisés (`strings.play.question`),
 * zéro texte en dur dans le composant (règle CLAUDE.md « strings centralisées »).
 */

import type { Skill } from "@/lib/engine/domain";
import { COMP10_TARGET } from "@/lib/engine/domain";
import { strings } from "@/strings";

/** Signe mathématique affiché par compétence (COPY §6 : signes clairs, pas de mot). */
const OPERATOR_SYMBOL: Record<Exclude<Skill, "comp10">, string> = {
  add: "+",
  sub: "−", // moins typographique (COPY §6 : "12 − 4"), distinct du trait d'union.
  mult: "×", // signe multiplié (COPY §6 : "6 × 8"), distinct de x/X.
};

/** Remplace un jeton `{x}` par sa valeur (même micro-interpolation que `PinPad`). */
function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

/**
 * Construit l'énoncé affiché (COPY §6) à partir des `operands` d'une `LevelQuestion`
 * (3.7) : `6 × 8 = ?` pour add/sub/mult, `3 + ? = 10` pour les compléments à 10 (le
 * **1er** opérande est connu, l'inconnue est le complément — jamais la cible).
 */
export function formatEquation(skill: Skill, operands: readonly number[]): string {
  if (skill === "comp10") {
    const [a] = operands;
    return fill(
      fill(strings.play.question.equationComplement, "{a}", String(a)),
      "{cible}",
      String(COMP10_TARGET),
    );
  }
  const [a, b] = operands;
  const withA = fill(strings.play.question.equationTwoOperands, "{a}", String(a));
  const withOp = fill(withA, "{op}", OPERATOR_SYMBOL[skill]);
  return fill(withOp, "{b}", String(b));
}
