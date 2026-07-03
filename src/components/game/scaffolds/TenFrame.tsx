import { strings } from "@/strings";
import type { ScaffoldRepresentationProps } from "@/components/game/scaffolds/VisualScaffold";

/**
 * Étayage **dix-cases** des compléments à 10 (story #94, ENGINE §1 `a + ? = 10`,
 * `a ∈ 1..9`, PRODUCT §3.4, WIREFRAMES §3d). Rendu pour `skill === "comp10"` :
 * `a` cases **remplies** (`operands[0]`) + `10 − a` cases **à compléter**, dans une
 * grille canonique 5×2 (dix-cases classique de la pédagogie CE1/CE2).
 *
 * **Domaine** : `a ∈ 1..9` (ENGINE §1) — la fondation #93 fournit `operands`/
 * `correctAnswer` déjà validés côté serveur (ENGINE §10, aucune extension ici).
 * Total = **10 cases** systématiquement (`filled + empty === 10`), déterministe
 * pour toute valeur de `a` dans le domaine.
 *
 * **A11y (WIREFRAMES §3d, CLAUDE.md a11y, rétro #94)** : remplies vs vides distinguées
 * **par motif ET couleur** (jamais couleur seule, daltonisme) — glyphe plein (`●`) sur
 * fond accent pour les cases remplies, glyphe contour (`○`) sur fond neutre bordé en
 * pointillés pour les cases vides. **Le glyphe de chaque état a une couleur qui
 * contraste sur SON fond** (rempli → `--scaffold-cell-filled-glyph` sur l'accent ;
 * vide → `--scaffold-cell-empty-glyph`, un token texte visible sur la surface neutre
 * dans les 2 thèmes) — le motif reste lisible, pas porté par la seule bordure.
 *
 * **Rendu purement décoratif (`aria-hidden`)** : ce composant NE porte PAS de
 * `role="img"` propre — l'unique `role="img"` est le conteneur `VisualScaffold`, dont
 * le nom accessible est « il manque {n} pour faire 10 » (dérivé du registre). Un
 * `role="img"` imbriqué rendrait le sous-arbre opaque et avalerait ce libellé. Le
 * visuel est donc `aria-hidden` ; l'info numérique est portée par le nom accessible du
 * conteneur. Le texte « il manque {n} … » reste **visible** (bénéfice voyants) sous la
 * grille — non annoncé deux fois car il vit dans le sous-arbre `aria-hidden`.
 *
 * **Marqueur de dispatch (LEARNINGS rétro #93/#97)** : porte `data-scaffold-kind`
 * ET `data-skill="comp10"` sur son nœud racine — dérivé du registre, garde le test
 * de dispatch de `VisualScaffold.test.tsx` à effet observable (un dispatch cassé
 * routant vers le mauvais composant fait rougir l'assertion `data-skill`).
 *
 * **Tokens only** : famille `--scaffold-cell-*` (tokens.css), référence des tokens
 * existants (`--color-*`, `--space-*`, `--border-radius-*`) — aucune valeur en dur.
 * S'intègre dans le slot `VisualScaffold` (≤ `--max-width-play`).
 */

/** Nombre total de cases d'une dix-cases (constante du modèle, jamais en dur). */
const TOTAL_CELLS = 10;
/** Colonnes de la grille canonique (2 rangées de 5, dix-cases classique). */
const GRID_COLUMNS = 5;

const FILLED_GLYPH = "●";
const EMPTY_GLYPH = "○";

function fill(template: string, token: string, value: string): string {
  return template.replace(token, value);
}

/**
 * Une case de la grille — remplie (`filled`) ou à compléter. Distinction **motif +
 * couleur** : le glyphe de chaque état porte une couleur qui contraste sur SON fond
 * (rétro #94 FIX contraste : un token unique pour les 2 états rendait le `○` vide
 * invisible sur la surface neutre en light ET dark).
 */
function Cell({ filled }: { readonly filled: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "var(--scaffold-cell-size)",
        height: "var(--scaffold-cell-size)",
        borderRadius: "var(--scaffold-cell-radius)",
        backgroundColor: filled
          ? "var(--scaffold-cell-filled-bg)"
          : "var(--scaffold-cell-empty-bg)",
        border: filled
          ? "2px solid var(--scaffold-cell-filled-border)"
          : "2px dashed var(--scaffold-cell-empty-border)",
        color: filled ? "var(--scaffold-cell-filled-glyph)" : "var(--scaffold-cell-empty-glyph)",
        fontSize: "var(--font-size-md)",
        lineHeight: 1,
      }}
    >
      {filled ? FILLED_GLYPH : EMPTY_GLYPH}
    </span>
  );
}

export function TenFrame({ operands, correctAnswer }: ScaffoldRepresentationProps) {
  const filledCount = operands[0];
  const emptyCount = correctAnswer;
  const cells = Array.from({ length: TOTAL_CELLS }, (_, index) => index < filledCount);

  return (
    <div
      data-scaffold-kind="ten-frame"
      data-skill="comp10"
      aria-hidden="true"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_COLUMNS}, var(--scaffold-cell-size))`,
          gap: "var(--scaffold-cell-gap)",
        }}
      >
        {cells.map((filled, index) => (
          // Grille de positions fixes (dix-cases) : l'index EST la position canonique,
          // aucune identité propre aux cellules — clé stable par construction.
          <Cell key={index} filled={filled} />
        ))}
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
        {fill(strings.play.scaffold.tenFrame.missing, "{n}", String(emptyCount))}
      </p>
    </div>
  );
}
