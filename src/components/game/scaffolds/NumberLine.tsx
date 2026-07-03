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
 * **Saut rendu visuellement** (BLOQUANT game-design, AC #1 « droite numérique **avec
 * saut** ») : un **arc courbe** (façon manuel scolaire) est tracé au-dessus de la
 * ligne, de la graduation de départ (`a`) à celle d'arrivée (`correctAnswer`), avec
 * une **pointe de flèche** à la destination orientée dans le sens du saut (avance →
 * droite, recul → gauche). L'enfant **voit** le bond (amplitude + sens), pas
 * seulement sa description. L'arc est un overlay SVG positionné sur le même modèle de
 * coordonnées que les graduations (fraction `(v − min)/(max − min)`) → alignement
 * exact départ/arrivée, sans perturber la layout flex responsive (`overflow-x:auto`).
 *
 * **A11y (rétro #94, contrat hérité)** : ce composant est **purement décoratif**
 * (`aria-hidden`, AUCUN `role="img"` propre) — l'unique `role="img"` est le
 * conteneur `VisualScaffold`, dont le nom accessible est dérivé du registre
 * (`label(props)` dans `VisualScaffold.tsx`, différent pour add/sub). L'arc SVG lui
 * aussi `aria-hidden`. Le sens du saut est porté par **TROIS canaux** (jamais couleur
 * seule, daltonisme) : le texte visible (« Depuis {a}, on avance/recule de {b} »),
 * l'icône flèche (`→`/`←`), ET l'orientation de l'arc/pointe sur la ligne.
 * Graduations et arc contrastés (`--scaffold-line-*`, ≥ 3:1 sur la surface neutre
 * dans les 2 thèmes — WCAG 1.4.11, jamais `--color-text-inverse` hors fond accent
 * plein — piège #94).
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

/** Largeur ⚙️ mini d'une colonne de graduation (lisibilité ; scroll horizontal au-delà). */
const MIN_TICK_COL = "var(--space-6)"; /* 32px — cible ≥ largeur d'un chiffre confortable */

/**
 * Position horizontale (fraction 0..1) d'une valeur sur la droite affichée `[min, max]`.
 * `max > min` est **toujours** garanti par `displayBounds` : `LINE_MARGIN ≥ 1` élargit
 * l'intervalle de chaque côté avant le clamp `[0, 20]`, et aucun couple de bornes
 * clampées ne dégénère (min point = max point = 0 → `[0, 2]` ; = 20 → `[18, 20]`) →
 * pas de garde anti-division-par-zéro (branche morte évitée, cf. LEARNINGS #62).
 */
function fractionOf(value: number, min: number, max: number): number {
  return (value - min) / (max - min);
}

/**
 * Une graduation de la droite, **positionnée en absolu** à sa fraction horizontale
 * (même modèle de coordonnées que l'arc de saut → alignement exact). Départ (`a`) et
 * arrivée (`correctAnswer`) = pastilles ; intermédiaires = petits traits + chiffre.
 */
function Tick({
  value,
  frac,
  kind,
}: {
  readonly value: number;
  readonly frac: number;
  readonly kind: "start" | "end" | "intermediate";
}) {
  const isPoint = kind !== "intermediate";
  const isStart = kind === "start";
  return (
    <div
      style={{
        position: "absolute",
        left: `${frac * 100}%`,
        bottom: 0,
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-1)",
      }}
    >
      {isPoint ? (
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
      ) : (
        <span
          style={{
            width: "2px",
            height: "var(--space-3)",
            backgroundColor: "var(--scaffold-line-tick)",
          }}
        />
      )}
      <span
        style={{
          fontFamily: isPoint ? "var(--font-family-numeric)" : "var(--font-family-body)",
          fontSize: isPoint ? "var(--font-size-sm)" : "var(--font-size-xs)",
          fontWeight: isPoint ? "var(--font-weight-semibold)" : "var(--font-weight-normal)",
          color: isPoint
            ? isStart
              ? "var(--scaffold-line-start-glyph)"
              : "var(--scaffold-line-end-glyph)"
            : "var(--scaffold-line-tick-label)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * **Arc du saut** — overlay SVG tracé de la graduation de départ (`a`) à celle
 * d'arrivée (`correctAnswer`), avec une pointe de flèche à la destination orientée
 * dans le sens du saut (avance → droite, recul → gauche). `preserveAspectRatio="none"`
 * + `viewBox` 0..100 en x → l'abscisse de l'arc = la fraction × 100, exactement comme
 * les graduations (alignement départ/arrivée garanti). Décoratif (`aria-hidden` porté
 * par la racine). `data-jump` + `data-jump-direction` = marqueurs observables (garde
 * game-design : l'arc existe ET son orientation dérive du sens du saut).
 */
function JumpArc({
  startFrac,
  endFrac,
  forward,
}: {
  readonly startFrac: number;
  readonly endFrac: number;
  readonly forward: boolean;
}) {
  const x1 = startFrac * 100;
  const x2 = endFrac * 100;
  // Baseline en bas du viewBox (la ligne), arc bombé vers le haut ; pointe à l'arrivée.
  const baseY = 92;
  const peakY = 18;
  const controlX = (x1 + x2) / 2;
  const arrow = 5; // demi-largeur de la pointe (unités viewBox)
  // Direction de la pointe : vers l'arrivée. La branche de la flèche est orientée selon
  // le SENS du saut (forward → pointe vers la droite, backward → vers la gauche).
  const dir = forward ? 1 : -1;
  return (
    <svg
      data-jump="true"
      data-jump-direction={forward ? "forward" : "backward"}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <path
        d={`M ${x1} ${baseY} Q ${controlX} ${peakY} ${x2} ${baseY}`}
        fill="none"
        stroke="var(--scaffold-line-jump-arc)"
        strokeWidth={2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Pointe de flèche à l'arrivée, ouverte dans le sens du saut. */}
      <path
        d={`M ${x2} ${baseY} l ${dir * arrow} ${-arrow} M ${x2} ${baseY} l ${dir * arrow} ${arrow}`}
        fill="none"
        stroke="var(--scaffold-line-jump-arc)"
        strokeWidth={2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
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
      {/* Fenêtre à scroll horizontal (WIREFRAMES §8, reflow tél) : la piste garde une
          largeur mini par graduation, la fenêtre défile si l'écran est trop étroit. */}
      <div style={{ width: "100%", overflowX: "auto" }}>
        <div
          style={{
            position: "relative",
            width: "100%",
            minWidth: `calc(${values.length} * ${MIN_TICK_COL})`,
            height: "var(--space-9)", // 96px — place pour l'arc au-dessus + pastilles + chiffres
            borderBottom: "2px solid var(--scaffold-line-track)",
          }}
        >
          <JumpArc
            startFrac={fractionOf(a, min, max)}
            endFrac={fractionOf(correctAnswer, min, max)}
            forward={forward}
          />
          {values.map((value) => (
            <Tick
              key={value}
              value={value}
              frac={fractionOf(value, min, max)}
              kind={value === a ? "start" : value === correctAnswer ? "end" : "intermediate"}
            />
          ))}
        </div>
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
