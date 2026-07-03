"use client";

import type { Skill } from "@/lib/engine/domain";
import { strings } from "@/strings";
import { TenFrame } from "@/components/game/scaffolds/TenFrame";

/**
 * **Dispatcher d'étayage visuel** (épic #4, WIREFRAMES §3d, PRODUCT §2.2).
 *
 * Story #93 = **fondation** : pose le **contrat de props** commun aux 3 étayages
 * concrets (4.2 dix-cases `comp10`, 4.3 droite numérique `add`/`sub`, 4.4 matrice
 * `mult`) et le **slot** monté par `FeedbackPanel` en re-essai. Les représentations
 * concrètes sont des **placeholders** ici — chaque story aval remplace son placeholder
 * sans toucher au dispatch ni au contrat (surfaces symétriques, parallélisables).
 *
 * **Sélection par `skill`** (ENGINE §1 « Étayage par compétence », WIREFRAMES §3d) :
 * un composant d'étayage par compétence connue. Un `skill` **inconnu** (payload
 * inattendu, compétence future non câblée) → **aucun rendu** (`null`), jamais de crash
 * (no-fail, ENGINE §9 : l'absence d'étayage ne bloque jamais le re-essai).
 *
 * **A11y** : le conteneur porte un **label textuel** (`aria-label`, string centralisée)
 * qui décrit la représentation → le visuel est **doublé d'un texte**, jamais porté par
 * la seule couleur/forme (daltonisme, LEARNINGS #23/#36). Les glyphes décoratifs des
 * placeholders sont `aria-hidden` (l'information passe par le label, pas par le dessin).
 * **Aucun contrôle focusable** n'est ajouté (les étayages sont illustratifs, non
 * interactifs — #38 `:focus-visible` n'est pas un blocked-by).
 *
 * **Tokens only** : espacements/rayons/typo/couleurs via `var(--…)` (aucune valeur en
 * dur). La famille `--scaffold-*` (`tokens.css`) porte les tokens sémantiques dédiés à
 * l'étayage ; le thème per-monde (`--world-accent`, épic #5) est **hors scope** et n'est
 * pas câblé ici.
 */
export interface VisualScaffoldProps {
  /**
   * Compétence du fait (ENGINE §1) — **sélectionne** l'étayage. Une valeur hors des 4
   * compétences connues ne rend rien (fallback sûr).
   */
  readonly skill: Skill;
  /**
   * Opérandes du calcul à représenter (`[a]` pour `comp10`, `[a, b]` sinon) — mêmes
   * données que `LevelQuestion.operands` (aucune extension serveur, ENGINE §10).
   */
  readonly operands: readonly number[];
  /**
   * Bonne réponse du fait (déjà révélée par `FeedbackPanel` au-dessus) — fournie aux
   * étayages concrets qui l'illustrent (ex. position sur la droite numérique). La
   * fondation ne l'affiche pas encore ; le contrat la transporte pour 4.2/4.3/4.4.
   */
  readonly correctAnswer: number;
}

/**
 * Props transmises à chaque étayage concret. Identiques à `VisualScaffoldProps` **moins
 * `skill`** (déjà consommé par le dispatch) → contrat symétrique pour 4.2/4.3/4.4.
 */
export type ScaffoldRepresentationProps = Omit<VisualScaffoldProps, "skill">;

/**
 * Placeholder générique de la fondation (#93) : marque la présence du slot d'étayage
 * sans dessiner de représentation concrète (ajoutée en 4.2/4.3/4.4). Le glyphe est
 * **décoratif** (`aria-hidden`) — toute l'information a11y passe par le `aria-label` du
 * conteneur parent. `data-skill` expose la compétence sélectionnée (débogage / E2E),
 * sans texte visible en dur.
 */
function ScaffoldPlaceholder({ skill }: { readonly skill: Skill }) {
  return (
    <div
      aria-hidden="true"
      data-skill={skill}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "var(--scaffold-min-height)",
        color: "var(--scaffold-glyph-color)",
        fontSize: "var(--font-size-2xl)",
      }}
    >
      {"✳"}
    </div>
  );
}

/**
 * Registre **compétence → étayage**. Une entrée par compétence connue (`Record<Skill, …>`
 * → le typage garantit l'exhaustivité : ajouter une compétence au domaine casse la
 * compilation tant que son étayage n'est pas câblé). En 4.2/4.3/4.4, remplacer
 * l'entrée par le composant concret (`TenFrame`/`NumberLine`/`Matrix`).
 */
const SCAFFOLD_BY_SKILL: Record<Skill, (props: ScaffoldRepresentationProps) => React.ReactNode> = {
  comp10: (props) => <TenFrame {...props} />,
  add: () => <ScaffoldPlaceholder skill="add" />,
  sub: () => <ScaffoldPlaceholder skill="sub" />,
  mult: () => <ScaffoldPlaceholder skill="mult" />,
};

/** `true` si `skill` est une clé connue du registre d'étayage (garde de dispatch). */
function isKnownSkill(skill: Skill): skill is keyof typeof SCAFFOLD_BY_SKILL {
  return skill in SCAFFOLD_BY_SKILL;
}

export function VisualScaffold({ skill, operands, correctAnswer }: VisualScaffoldProps) {
  // Compétence inconnue (payload inattendu / compétence future) → aucun rendu, jamais
  // de crash. Garde à effet observable : un test avec un `skill` hors domaine attend
  // `null` (échoue si le fallback saute et qu'un placeholder est rendu à tort).
  if (!isKnownSkill(skill)) {
    return null;
  }

  const render = SCAFFOLD_BY_SKILL[skill];

  return (
    <div
      role="img"
      aria-label={strings.play.scaffold.label}
      data-scaffold={skill}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
        width: "100%",
        maxWidth: "var(--max-width-play)",
        padding: "var(--scaffold-padding)",
        borderRadius: "var(--scaffold-radius)",
        backgroundColor: "var(--scaffold-bg)",
      }}
    >
      {render({ operands, correctAnswer })}
    </div>
  );
}
