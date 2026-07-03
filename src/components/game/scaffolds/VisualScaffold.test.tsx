import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VisualScaffold } from "./VisualScaffold";
import { SKILLS, type Skill } from "@/lib/engine/domain";
import { strings } from "@/strings";

/** Opérandes plausibles par compétence (comp10 = 1 opérande, sinon 2). */
function operandsFor(skill: Skill): readonly number[] {
  return skill === "comp10" ? [3] : [6, 8];
}

describe("VisualScaffold — dispatch par compétence (ENGINE §1, WIREFRAMES §3d)", () => {
  // Paramétré sur TOUTES les compétences du domaine (LEARNINGS #59 : un lookup par clé
  // n'est pas couvert par le simple 100 % — tester chaque clé). Chaque compétence connue
  // rend le conteneur d'étayage labellisé et expose sa compétence via `data-scaffold`.
  it.each(SKILLS)("rend l'étayage labellisé pour skill=%s", (skill) => {
    const { container } = render(
      <VisualScaffold skill={skill} operands={operandsFor(skill)} correctAnswer={4} />,
    );
    const scaffold = screen.getByRole("img", { name: strings.play.scaffold.label });
    expect(scaffold).toBeInTheDocument();
    // Effet observable du dispatch : la compétence sélectionnée est portée par le
    // conteneur ET par le placeholder interne (échoue si le dispatch route mal la clé).
    expect(scaffold).toHaveAttribute("data-scaffold", skill);
    expect(container.querySelector(`[data-skill="${skill}"]`)).not.toBeNull();
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
    expect(
      screen.queryByRole("img", { name: strings.play.scaffold.label }),
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("VisualScaffold — a11y (le visuel est doublé d'un texte)", () => {
  it("porte un label textuel centralisé (jamais couleur/forme seule)", () => {
    render(<VisualScaffold skill="add" operands={[7, 5]} correctAnswer={12} />);
    // Le label vient des strings centralisées (zéro texte en dur, voix de Teddy).
    expect(screen.getByRole("img")).toHaveAccessibleName(strings.play.scaffold.label);
  });

  it("le glyphe décoratif du placeholder est aria-hidden (info portée par le label)", () => {
    // `comp10` est désormais câblé sur `TenFrame` (#94, représentation concrète) —
    // ce test vise le contrat générique du **placeholder** (#95/#96 non câblés
    // encore), donc utilise `mult` qui reste sur `ScaffoldPlaceholder`.
    const { container } = render(
      <VisualScaffold skill="mult" operands={[6, 8]} correctAnswer={48} />,
    );
    // Le dessin décoratif ne doit pas être annoncé deux fois (le label suffit).
    expect(container.querySelector('[data-skill="mult"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("n'ajoute AUCUN contrôle focusable (étayage illustratif, #38 non blocked-by)", () => {
    const { container } = render(
      <VisualScaffold skill="sub" operands={[9, 4]} correctAnswer={5} />,
    );
    // Aucun bouton/lien/input/tabindex → l'étayage ne capte jamais le focus clavier.
    expect(container.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
  });
});
