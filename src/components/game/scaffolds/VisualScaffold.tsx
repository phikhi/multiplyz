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
 * **A11y — un SEUL `role="img"` labellisé** (rétro #94, consensus Frontend+A11y+PO) :
 * le **conteneur** de dispatch est l'unique `role="img"`, et son `aria-label` est **le
 * libellé accessible spécifique de l'étayage sélectionné**, dérivé des props par le
 * registre (`label(props)`). Les représentations concrètes (`TenFrame`, …) rendent un
 * **visuel purement décoratif** (`aria-hidden`, aucun `role="img"` propre) → jamais de
 * `role="img"` imbriqué (un `role="img"` rend son sous-arbre opaque au lecteur d'écran :
 * un label interne serait avalé et jamais annoncé). Ainsi l'information numérique
 * spécifique (ex. « il manque 6 pour faire 10 » pour `comp10`) **est** le nom accessible
 * annoncé, pas un générique « un petit dessin ». Le visuel reste doublé d'un texte
 * (daltonisme, LEARNINGS #23/#36).
 *
 * **Contrat symétrique #95/#96** : chaque entrée du registre fournit `render(props)`
 * (visuel décoratif) **et** `label(props)` (nom accessible dérivé des props). Une story
 * aval câble son composant concret + son libellé spécifique via ce même mécanisme, sans
 * jamais réintroduire de `role="img"` dans le composant concret. Les placeholders
 * gardent un libellé **générique** via ce même canal.
 *
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
 * conteneur parent (unique `role="img"`). `data-skill` expose la compétence sélectionnée
 * (débogage / E2E), sans texte visible en dur.
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
 * Une entrée du registre d'étayage : `render` produit le **visuel décoratif** (jamais de
 * `role="img"` propre), `label` produit le **nom accessible** dérivé des props, posé par
 * le conteneur sur l'unique `role="img"`. Contrat symétrique #95/#96.
 */
interface ScaffoldEntry {
  readonly render: (props: ScaffoldRepresentationProps) => React.ReactNode;
  readonly label: (props: ScaffoldRepresentationProps) => string;
}

/**
 * Registre **compétence → étayage**. Une entrée par compétence connue (`Record<Skill, …>`
 * → le typage garantit l'exhaustivité : ajouter une compétence au domaine casse la
 * compilation tant que son étayage n'est pas câblé). En 4.2/4.3/4.4, remplacer
 * l'entrée par le composant concret (`TenFrame`/`NumberLine`/`Matrix`) **et** son
 * libellé accessible spécifique. Les placeholders restants gardent le libellé générique.
 */
const SCAFFOLD_BY_SKILL: Record<Skill, ScaffoldEntry> = {
  comp10: { render: (props) => <TenFrame {...props} />, label: tenFrameLabel },
  add: { render: () => <ScaffoldPlaceholder skill="add" />, label: genericLabel },
  sub: { render: () => <ScaffoldPlaceholder skill="sub" />, label: genericLabel },
  mult: { render: () => <ScaffoldPlaceholder skill="mult" />, label: genericLabel },
};

/** Libellé accessible générique (placeholders #95/#96 non encore câblés). */
function genericLabel(): string {
  return strings.play.scaffold.label;
}

/**
 * Libellé accessible spécifique de la dix-cases (`comp10`) : porte l'**info numérique**
 * « il manque {n} pour faire 10 » (`n = correctAnswer = 10 − a`) — c'est CE texte qui
 * est annoncé par le lecteur d'écran (nom du `role="img"` unique), pas le générique.
 */
function tenFrameLabel({ correctAnswer }: ScaffoldRepresentationProps): string {
  return strings.play.scaffold.tenFrame.missing.replace("{n}", String(correctAnswer));
}

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

  const entry = SCAFFOLD_BY_SKILL[skill];
  const representationProps: ScaffoldRepresentationProps = { operands, correctAnswer };

  return (
    <div
      role="img"
      aria-label={entry.label(representationProps)}
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
      {entry.render(representationProps)}
    </div>
  );
}
