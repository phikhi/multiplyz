import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VisualScaffold } from "./VisualScaffold";
import { SKILLS, type Skill } from "@/lib/engine/domain";
import { strings } from "@/strings";

/** Opérandes plausibles par compétence (comp10 = 1 opérande, sinon 2). */
function operandsFor(skill: Skill): readonly number[] {
  return skill === "comp10" ? [3] : [6, 8];
}

/**
 * Bonne réponse **arithmétiquement cohérente** avec `operandsFor(skill)` — requis
 * depuis #95 : `NumberLine` dérive le SENS du saut (avance/recul) de la relation
 * réelle `correctAnswer` vs `operands[0]`, pas du `skill` en dur. Un `correctAnswer`
 * incohérent avec `operands` pour `add`/`sub` ferait dériver `data-skill` du nœud
 * interne vers le mauvais sens (ex. `correctAnswer=4 < a=6` routerait `add` vers un
 * rendu "sub"), cassant la garde de dispatch qui compare skill demandé et rendu.
 */
function correctAnswerFor(skill: Skill): number {
  const [a, b] = operandsFor(skill);
  switch (skill) {
    case "comp10":
      return 10 - a;
    case "add":
      return a + (b ?? 0);
    case "sub":
      return a - (b ?? 0);
    case "mult":
      return a * (b ?? 0);
  }
}

function fill(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, value),
    template,
  );
}

/**
 * Nom accessible attendu du conteneur pour une compétence : `comp10` porte le libellé
 * spécifique dérivé des props (« il manque {n} … »), `add`/`sub` le libellé droite
 * numérique spécifique (« on avance »/« on recule », story #95), `mult` reste le
 * générique (placeholder non câblé) — le registre fournit un libellé accessible par
 * compétence (rétro #94). `operandsFor` fournit `[6, 8]` pour add/sub → `{a}=6, {b}=8`.
 */
function expectedLabel(skill: Skill, correctAnswer: number): string {
  if (skill === "comp10") {
    return strings.play.scaffold.tenFrame.missing.replace("{n}", String(correctAnswer));
  }
  if (skill === "add") {
    return fill(strings.play.scaffold.numberLine.forward, { a: "6", b: "8" });
  }
  if (skill === "sub") {
    return fill(strings.play.scaffold.numberLine.backward, { a: "6", b: "8" });
  }
  return strings.play.scaffold.label;
}

describe("VisualScaffold — dispatch par compétence (ENGINE §1, WIREFRAMES §3d)", () => {
  // Paramétré sur TOUTES les compétences du domaine (LEARNINGS #59 : un lookup par clé
  // n'est pas couvert par le simple 100 % — tester chaque clé). Chaque compétence connue
  // rend le conteneur d'étayage labellisé et expose sa compétence via `data-scaffold`.
  it.each(SKILLS)("rend l'étayage labellisé pour skill=%s", (skill) => {
    const correctAnswer = correctAnswerFor(skill);
    const { container } = render(
      <VisualScaffold skill={skill} operands={operandsFor(skill)} correctAnswer={correctAnswer} />,
    );
    const scaffold = screen.getByRole("img", { name: expectedLabel(skill, correctAnswer) });
    expect(scaffold).toBeInTheDocument();
    // Effet observable du dispatch : la compétence sélectionnée est portée par le
    // conteneur ET par le nœud interne (échoue si le dispatch route mal la clé).
    expect(scaffold).toHaveAttribute("data-scaffold", skill);
    expect(container.querySelector(`[data-skill="${skill}"]`)).not.toBeNull();
  });

  it.each(["comp10", "add", "sub"] as const)(
    "un seul role='img' par étayage (jamais imbriqué — rétro #94 FIX, skill=%s)",
    (skill) => {
      // Garde anti-imbrication à effet observable : si un composant concret
      // (`TenFrame`/`NumberLine`) réintroduisait un `role='img'` propre, le
      // sous-arbre deviendrait opaque au lecteur d'écran et son libellé serait
      // avalé. Exercé sur les 3 représentations concrètes câblées à ce jour.
      const { container } = render(
        <VisualScaffold skill={skill} operands={operandsFor(skill)} correctAnswer={7} />,
      );
      expect(container.querySelectorAll('[role="img"]')).toHaveLength(1);
    },
  );

  it("comp10 → le nom accessible porte l'info numérique (« il manque {n} … »)", () => {
    // Effet observable : si le registre retombait sur le libellé générique pour comp10,
    // ce nom accessible perdrait le nombre manquant → rouge.
    render(<VisualScaffold skill="comp10" operands={[3]} correctAnswer={7} />);
    const expected = strings.play.scaffold.tenFrame.missing.replace("{n}", "7");
    expect(screen.getByRole("img")).toHaveAccessibleName(expected);
    // Ce n'est PAS le libellé générique (garde anti-régression du canal a11y).
    expect(screen.getByRole("img")).not.toHaveAccessibleName(strings.play.scaffold.label);
  });

  it("un skill inconnu ne rend RIEN (fallback sûr, pas de crash — no-fail)", () => {
    // `skill` est typé `Skill` ; on force une valeur hors domaine pour exercer la garde
    // runtime (payload inattendu / compétence future non câblée). Effet observable :
    // aucun conteneur d'étayage n'est rendu (échoue si le fallback `null` est retiré et
    // qu'un placeholder est rendu à tort).
    const { container } = render(
      <VisualScaffold
        skill={"division" as unknown as Skill}
        operands={[10, 2]}
        correctAnswer={5}
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("VisualScaffold — a11y (le visuel est doublé d'un texte)", () => {
  it("porte un label textuel centralisé pour un placeholder (jamais couleur/forme seule)", () => {
    // `mult` reste sur `ScaffoldPlaceholder` (#96 non câblé) → libellé générique.
    render(<VisualScaffold skill="mult" operands={[7, 5]} correctAnswer={35} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(strings.play.scaffold.label);
  });

  it("le glyphe décoratif du placeholder est aria-hidden (info portée par le label)", () => {
    // `comp10`/`add`/`sub` sont désormais câblés (`TenFrame`/`NumberLine`,
    // représentations concrètes) — ce test vise le contrat générique du
    // **placeholder** (#96 non câblé encore), donc utilise `mult`.
    const { container } = render(
      <VisualScaffold skill="mult" operands={[6, 8]} correctAnswer={48} />,
    );
    // Le dessin décoratif ne doit pas être annoncé deux fois (le label suffit).
    expect(container.querySelector('[data-skill="mult"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("add/sub → le nom accessible porte l'info numérique, DIFFÉRENTE entre les deux sens (story #95)", () => {
    // Effet observable : si le registre retombait sur le même libellé pour add et
    // sub (ou sur le générique), cette assertion rougirait — le sens du saut doit
    // être porté par le nom accessible du role="img" unique, pas seulement le visuel.
    // Mêmes operands [8, 6] pour les deux sens, TOUS DEUX dans le domaine v1 (ENGINE
    // §1) : add → 8+6=14 (somme ≤ 20), sub → 8−6=2 (b ≤ a, résultat ≥ 0).
    render(<VisualScaffold skill="add" operands={[8, 6]} correctAnswer={14} />);
    const addLabel = screen.getByRole("img").getAttribute("aria-label");
    expect(addLabel).not.toBe(strings.play.scaffold.label);

    const { container } = render(
      <VisualScaffold skill="sub" operands={[8, 6]} correctAnswer={2} />,
    );
    const subImg = container.querySelector('[role="img"]');
    const subLabel = subImg?.getAttribute("aria-label");
    expect(subLabel).not.toBe(strings.play.scaffold.label);
    expect(subLabel).not.toBe(addLabel);
  });

  it("n'ajoute AUCUN contrôle focusable (étayage illustratif, #38 non blocked-by)", () => {
    const { container } = render(
      <VisualScaffold skill="sub" operands={[9, 4]} correctAnswer={5} />,
    );
    // Aucun bouton/lien/input/tabindex → l'étayage ne capte jamais le focus clavier.
    expect(container.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
  });
});
