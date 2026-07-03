import { strings } from "@/strings";
import type { ScaffoldRepresentationProps } from "@/components/game/scaffolds/VisualScaffold";

/**
 * Étayage **matrice** de la multiplication (story #96, ENGINE §1 `a × b`,
 * PRODUCT §3.4 « groupes répétés / matrice », WIREFRAMES §3d). Rendu pour
 * `skill === "mult"` : `operands = [a, b]` → **`a` paquets de `b` points**
 * (ex. 6×8 = 6 lignes de 8), illustrant les **groupes répétés** (pas juste une
 * grille `a×b` uniforme).
 *
 * **Regroupement VISUELLEMENT ÉVIDENT (feed-forward game-design, rétro #95)** :
 * un étayage visuel doit **dessiner** le modèle, pas seulement l'énoncer. Chaque
 * **paquet** (ligne) est un conteneur bordé, fond distinct de la surface neutre du
 * panneau, séparé du paquet suivant par une **gouttière** — le regroupement
 * spatial/bordure est le canal PRIMAIRE (jamais la seule couleur des points,
 * a11y daltonisme). Le label « {a} paquets de {b} » double ce canal en texte.
 *
 * **Lignes/colonnes dérivées des `operands`, jamais en dur** : `a = operands[0]`
 * (nombre de paquets = lignes), `b = operands[1]` (points par paquet = colonnes).
 *
 * **Grande matrice sans débordement** (AC : 9×10 reste lisible/scrollable) :
 * chaque ligne-paquet est une piste `overflow-x: auto` indépendante (jamais le
 * `body`) — un paquet de 10 points garde une largeur mini par point (lisibilité),
 * la fenêtre défile horizontalement si l'écran est trop étroit (WIREFRAMES §8,
 * reflow tél, même pattern que `NumberLine` #95).
 *
 * **A11y (contrat hérité rétro #94/#95, STRICT)** : ce composant est **purement
 * décoratif** (`aria-hidden`, AUCUN `role="img"` propre) — l'unique `role="img"`
 * est le conteneur `VisualScaffold`, dont le nom accessible est dérivé du
 * registre (`matrixLabel(props)` = « {a} paquets de {b} »). Un `role="img"`
 * imbriqué rendrait le sous-arbre opaque et avalerait ce libellé (piège #94).
 *
 * **Marqueur de dispatch** (LEARNINGS rétro #93/#94) : `data-scaffold-kind`
 * ET `data-skill="mult"` sur le nœud racine — dérivés du registre appelant,
 * gardent le test `it.each(SKILLS)` de `VisualScaffold.test.tsx` à effet
 * observable.
 *
 * **Tokens only** : famille `--scaffold-matrix-*` (tokens.css), référence des
 * tokens existants (`--color-*`, `--space-*`, `--border-radius-*`) — aucune
 * valeur en dur. Le point contraste ≥ 3:1 (WCAG 1.4.11, élément non-texte) sur
 * le fond du paquet dans les 2 thèmes (jamais `--color-text-inverse` hors fond
 * accent plein — piège #94/#104 récurrent).
 */

const DOT_GLYPH = "●";

/** Largeur ⚙️ mini d'une colonne de point (lisibilité ; scroll horizontal au-delà). */
const MIN_DOT_COL = "var(--space-6)"; /* 32px */

function fill(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, value),
    template,
  );
}

/**
 * Libellé accessible spécifique de la matrice (registre #93, contrat #96).
 * `{a}` = nombre de paquets (`operands[0]`), `{b}` = taille d'un paquet
 * (`operands[1]`) — dérivés des `operands`, jamais en dur.
 */
export function matrixLabel({ operands }: ScaffoldRepresentationProps): string {
  const [a, b] = operands;
  return fill(strings.play.scaffold.matrix.label, { a: String(a), b: String(b) });
}

/**
 * Un **paquet** (ligne) : conteneur bordé + fond distinct de la surface neutre du
 * panneau, contenant `size` points. Le regroupement est porté par CE conteneur
 * (bordure/fond/gouttière), pas seulement par l'alignement des points.
 */
function PacketRow({ size }: { readonly size: number }) {
  const dots = Array.from({ length: size }, (_, index) => index);
  return (
    <div
      data-scaffold-packet="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--scaffold-matrix-dot-gap)",
        backgroundColor: "var(--scaffold-matrix-row-bg)",
        border: "1px solid var(--scaffold-matrix-row-border)",
        borderRadius: "var(--scaffold-matrix-row-radius)",
        padding: "var(--space-2)",
        minWidth: `calc(${size} * ${MIN_DOT_COL})`,
      }}
    >
      {dots.map((index) => (
        // Positions fixes au sein d'un paquet (l'index EST la position canonique,
        // aucune identité propre aux points — clé stable par construction, même
        // pattern que TenFrame/NumberLine).
        <span
          key={index}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "var(--scaffold-matrix-dot-size)",
            height: "var(--scaffold-matrix-dot-size)",
            color: "var(--scaffold-matrix-dot-color)",
            fontSize: "var(--font-size-md)",
            lineHeight: 1,
          }}
        >
          {DOT_GLYPH}
        </span>
      ))}
    </div>
  );
}

export function Matrix({ operands, correctAnswer: _correctAnswer }: ScaffoldRepresentationProps) {
  const [a, b] = operands;
  // Lignes/colonnes DÉRIVÉES des operands (jamais en dur) : a paquets, b points/paquet.
  const rows = Array.from({ length: a }, (_, index) => index);
  const label = matrixLabel({ operands, correctAnswer: _correctAnswer });

  return (
    <div
      data-scaffold-kind="matrix"
      data-skill="mult"
      aria-hidden="true"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
        width: "100%",
      }}
    >
      {/* Fenêtre à scroll horizontal maîtrisée SUR CE conteneur (jamais le body,
          WIREFRAMES §8 reflow tél) : une grande matrice (ex. 9×10) garde ses paquets
          lisibles (largeur mini par point), la fenêtre défile si l'écran est trop
          étroit — même pattern que NumberLine (#95). */}
      <div style={{ width: "100%", overflowX: "auto" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--scaffold-matrix-row-gap)",
            width: "fit-content",
            minWidth: "100%",
          }}
        >
          {rows.map((index) => (
            // Chaque paquet est une entité structurelle distincte (pas une simple
            // rangée de grille uniforme) — l'index EST la position canonique du
            // paquet (a paquets identiques en taille, aucune identité propre).
            <PacketRow key={index} size={b} />
          ))}
        </div>
      </div>
      <p
        style={{
          fontFamily: "var(--font-family-body)",
          fontSize: "var(--font-size-base)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--color-text-primary)",
          margin: 0,
          textAlign: "center",
        }}
      >
        {label}
      </p>
    </div>
  );
}
