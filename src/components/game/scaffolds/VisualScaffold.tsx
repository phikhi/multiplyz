"use client";

import type { Skill } from "@/lib/engine/domain";
import { strings } from "@/strings";
import { TenFrame } from "@/components/game/scaffolds/TenFrame";
import { NumberLine, numberLineLabel } from "@/components/game/scaffolds/NumberLine";
import { Matrix, matrixLabel } from "@/components/game/scaffolds/Matrix";

/**
 * **Dispatcher d'étayage visuel** (épic #4, WIREFRAMES §3d, PRODUCT §2.2).
 *
 * Story #93 = **fondation** : a posé le **contrat de props** commun aux 3 étayages
 * concrets (4.2 dix-cases `comp10`, 4.3 droite numérique `add`/`sub`, 4.4 matrice
 * `mult`) et le **slot** monté par `FeedbackPanel` en re-essai. Épic #4 **complet**
 * (4.2/4.3/4.4 mergées) : les 4 compétences sont câblées sur un étayage concret,
 * plus de placeholder générique.
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
 * **Contrat symétrique #94/#95/#96** : chaque entrée du registre fournit `render(props)`
 * (visuel décoratif) **et** `label(props)` (nom accessible dérivé des props). Chaque
 * story a câblé son composant concret + son libellé spécifique via ce même mécanisme,
 * sans jamais réintroduire de `role="img"` dans le composant concret.
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
   * Bonne réponse du fait — fournie aux étayages concrets qui l'illustrent (ex. position
   * sur la droite numérique, cases à compléter de la dix-cases). Depuis l'issue #100
   * (ADR 0007) `FeedbackPanel` révèle le chiffre **en synthèse SOUS** cet étayage (l'étayage
   * fait « voir » le calcul d'abord), plus au-dessus.
   */
  readonly correctAnswer: number;
}

/**
 * Props transmises à chaque étayage concret. Identiques à `VisualScaffoldProps` **moins
 * `skill`** (déjà consommé par le dispatch) → contrat symétrique pour 4.2/4.3/4.4.
 */
export type ScaffoldRepresentationProps = Omit<VisualScaffoldProps, "skill">;

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
 * compilation tant que son étayage n'est pas câblé). Les 4 stories (4.2/4.3/4.4) ont
 * chacune remplacé l'entrée générique par le composant concret
 * (`TenFrame`/`NumberLine`/`Matrix`) **et** son libellé accessible spécifique.
 */
const SCAFFOLD_BY_SKILL: Record<Skill, ScaffoldEntry> = {
  comp10: { render: (props) => <TenFrame {...props} />, label: tenFrameLabel },
  // Story #95 : add ET sub partagent le MÊME composant `NumberLine` (droite
  // numérique, PRODUCT §3.4) — pas de scission. Chaque skill fournit son propre
  // libellé (« on avance » vs « on recule »), dérivé des props par le registre.
  add: {
    render: (props) => <NumberLine {...props} />,
    label: (props) => numberLineLabel("add", props),
  },
  sub: {
    render: (props) => <NumberLine {...props} />,
    label: (props) => numberLineLabel("sub", props),
  },
  // Story #96 : matrice (groupes répétés) — libellé spécifique dérivé des
  // operands (« a paquets de b »), pas le générique (contrat #93/#94).
  mult: { render: (props) => <Matrix {...props} />, label: matrixLabel },
};

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
