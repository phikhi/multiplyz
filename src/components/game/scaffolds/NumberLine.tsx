import { strings } from "@/strings";
import type { ScaffoldRepresentationProps } from "@/components/game/scaffolds/VisualScaffold";

/**
 * Étayage **droite numérique** de l'addition et de la soustraction (story #95,
 * ENGINE §1 add/sub dans 20 v1, PRODUCT §3.4, WIREFRAMES §3d). Rendu pour
 * `skill === "add"` ET `skill === "sub"` — **les deux compétences partagent ce
 * composant** (pas de scission) : seul le **sens du saut** change, dérivé de
 * `correctAnswer` vs `operands[0]` (jamais du `skill` en dur — voir plus bas).
 *
 * **Modèle** : `operands = [a, b]`. Départ **`a`**, saut de **`b`** :
 * - addition → saut **avant** (`a + b = correctAnswer`, `correctAnswer > a`) ;
 * - soustraction → saut **arrière** (`a − b = correctAnswer`, `correctAnswer < a`).
 *
 * **Sens dérivé, jamais en dur** : `forward = correctAnswer > a`. Le composant ne
 * lit même pas `skill` (non transmis, cf. `ScaffoldRepresentationProps`) — le sens
 * du saut est une **conséquence arithmétique** des props, pas une branche sur le
 * nom de la compétence (une régression du registre appelant `NumberLine` avec un
 * couple `operands`/`correctAnswer` incohérent resterait quand même correcte
 * visuellement, car dérivée des nombres réels).
 *
 * **Bornes d'affichage ⚙️ calibrable** (ENGINE §1 add/sub dans 20 v1) : la droite
 * affiche `[displayMin, displayMax]`, calculée à partir des 3 points réels du
 * calcul (`a`, `b`, `correctAnswer`) avec une marge fixe `LINE_MARGIN` de chaque
 * côté, puis **clampée** à `[DISPLAY_FLOOR, DISPLAY_CEILING]` (0..20 par défaut —
 * borne raisonnable du domaine v1 add/sub, cf. `src/lib/engine/domain.ts` DOMAIN.add
 * `maxSum=20` / DOMAIN.sub `maxMinuend=20`). Résultat : la droite reste **compacte**
 * autour du calcul affiché (pas une droite 0..20 fixe et clairsemée à chaque fois),
 * tout en ne débordant jamais du domaine pédagogique v1. `LINE_MARGIN`/
 * `DISPLAY_FLOOR`/`DISPLAY_CEILING` sont les 3 constantes ⚙️ à recalibrer au
 * playtest si besoin (élargissement Tier 2, ENGINE §8).
 *
 * **A11y (rétro #94, contrat hérité)** : ce composant est **purement décoratif**
 * (`aria-hidden`, AUCUN `role="img"` propre) — l'unique `role="img"` est le
 * conteneur `VisualScaffold`, dont le nom accessible est dérivé du registre
 * (`label(props)` dans `VisualScaffold.tsx`, différent pour add/sub). Le texte
 * visible sous la droite (« Depuis {a}, on avance/recule de {b} ») + l'icône flèche
 * (`→`/`←`) **doublent** le sens du saut — jamais porté par la seule couleur de
 * l'arc (daltonisme). Graduations contrastées (`--scaffold-line-tick*`, tokens
 * texte sur surface neutre dans les 2 thèmes, jamais `--color-text-inverse` hors
 * fond accent plein — piège #94).
 *
 * **Marqueur de dispatch** (LEARNINGS rétro #93/#94) : `data-scaffold-kind`
 * ET `data-skill` sur le nœud racine — dérivés du registre appelant, gardent le
 * test `it.each(SKILLS)` de `VisualScaffold.test.tsx` à effet observable.
 *
 * **Tokens only** : famille `--scaffold-line-*` (tokens.css), référence des tokens
 * existants (`--color-*`, `--space-*`). S'intègre dans le slot `VisualScaffold`
 * (≤ `--max-width-play`, reflow tél OK, WIREFRAMES §8).
 */

/** Skill des deux compétences qui partagent cette droite (add avance, sub recule). */
type NumberLineSkill = "add" | "sub";

/** Marge ⚙️ affichée de chaque côté des 3 points réels du calcul (a, b, correctAnswer). */
const LINE_MARGIN = 2;
/** Borne basse ⚙️ d'affichage — le domaine v1 add/sub ne descend jamais sous 0. */
const DISPLAY_FLOOR = 0;
/** Borne haute ⚙️ d'affichage — v1 « dans 20 » (ENGINE §1, DOMAIN.add.maxSum/DOMAIN.sub.maxMinuend). */
const DISPLAY_CEILING = 20;

function fill(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, value),
    template,
  );
}

/**
 * Bornes d'affichage `[min, max]` de la droite — dérivées des 3 points réels du
 * calcul (jamais en dur), avec une marge `LINE_MARGIN`, clampées au domaine v1
 * `[DISPLAY_FLOOR, DISPLAY_CEILING]` (ENGINE §1). Garde à effet observable : un
 * calcul proche des bords (`a` ou `correctAnswer` proche de 0 ou 20) ne fait
 * jamais déborder l'affichage hors du domaine v1.
 */
function displayBounds(points: readonly number[]): { readonly min: number; readonly max: number } {
  const lowest = Math.min(...points) - LINE_MARGIN;
  const highest = Math.max(...points) + LINE_MARGIN;
  return {
    min: Math.max(DISPLAY_FLOOR, lowest),
    max: Math.min(DISPLAY_CEILING, highest),
  };
}

/**
 * Libellé accessible spécifique de la droite numérique (registre #93, contrat #95).
 * Ne consomme que `operands` — le sens (avance/recul) est déjà tranché par le
 * `skill` fourni par le registre appelant (une entrée par sens, `VisualScaffold.tsx`).
 */
export function numberLineLabel(
  skill: NumberLineSkill,
  { operands }: ScaffoldRepresentationProps,
): string {
  const [a, b] = operands;
  const template =
    skill === "add"
      ? strings.play.scaffold.numberLine.forward
      : strings.play.scaffold.numberLine.backward;
  return fill(template, { a: String(a), b: String(b) });
}

/** Une graduation de la droite (départ, arrivée, ou intermédiaire). */
function Tick({
  value,
  kind,
}: {
  readonly value: number;
  readonly kind: "start" | "end" | "intermediate";
}) {
  if (kind === "intermediate") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-1)",
        }}
      >
        <span
          style={{
            width: "2px",
            height: "var(--space-3)",
            backgroundColor: "var(--scaffold-line-tick)",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-family-body)",
            fontSize: "var(--font-size-xs)",
            color: "var(--scaffold-line-tick-label)",
          }}
        >
          {value}
        </span>
      </div>
    );
  }

  const isStart = kind === "start";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-1)",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "var(--scaffold-line-point-size)",
          height: "var(--scaffold-line-point-size)",
          borderRadius: "var(--border-radius-full)",
          backgroundColor: isStart
            ? "var(--scaffold-line-start-bg)"
            : "var(--scaffold-line-end-bg)",
          border: `2px solid ${isStart ? "var(--scaffold-line-start-border)" : "var(--scaffold-line-end-border)"}`,
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-family-numeric)",
          fontSize: "var(--font-size-sm)",
          fontWeight: "var(--font-weight-semibold)",
          color: isStart ? "var(--scaffold-line-start-glyph)" : "var(--scaffold-line-end-glyph)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function NumberLine({ operands, correctAnswer }: ScaffoldRepresentationProps) {
  const [a, b] = operands;
  // Sens dérivé de l'arithmétique réelle, jamais du nom de la compétence : addition
  // avance (correctAnswer > a), soustraction recule (correctAnswer < a).
  const forward = correctAnswer > a;
  const skill: NumberLineSkill = forward ? "add" : "sub";
  const { min, max } = displayBounds([a, b, correctAnswer]);
  const values = Array.from({ length: max - min + 1 }, (_, index) => min + index);

  const text = numberLineLabel(skill, { operands, correctAnswer });

  return (
    <div
      data-scaffold-kind="number-line"
      data-skill={skill}
      aria-hidden="true"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-3)",
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          width: "100%",
          overflowX: "auto",
          paddingBottom: "var(--space-1)",
          borderBottom: "2px solid var(--scaffold-line-track)",
        }}
      >
        {values.map((value) => (
          <Tick
            key={value}
            value={value}
            kind={value === a ? "start" : value === correctAnswer ? "end" : "intermediate"}
          />
        ))}
      </div>
      <p
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          fontFamily: "var(--font-family-body)",
          fontSize: "var(--font-size-base)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--color-text-primary)",
          margin: 0,
          textAlign: "center",
        }}
      >
        <span style={{ color: "var(--scaffold-line-jump-arc)" }}>{forward ? "→" : "←"}</span>
        {text}
      </p>
    </div>
  );
}
