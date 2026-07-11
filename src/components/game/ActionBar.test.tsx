import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActionBar } from "./ActionBar";
import { mockPhone } from "@/lib/responsive/test-support/mock-phone";

function renderBar() {
  return render(
    <ActionBar>
      <button type="button">Action</button>
    </ActionBar>,
  );
}

describe("ActionBar — tablette/desktop (défaut, disposition actuelle préservée, AC story 8.1)", () => {
  it("n'ajoute AUCUNE boîte (display:contents) — jamais position fixe hors téléphone", () => {
    renderBar();
    const button = screen.getByRole("button", { name: "Action" });
    const wrapper = button.parentElement;
    expect(wrapper).not.toBeNull();
    // Garde à effet observable : si `display:contents` saute (retiré/muté), le wrapper
    // deviendrait une boîte mesurable — cette assertion échouerait.
    expect(wrapper!.style.display).toBe("contents");
    expect(wrapper!.style.position).toBe("");
  });
});

describe("ActionBar — téléphone (useIsPhone → true, --bp-phone)", () => {
  it("passe en position fixe bas de viewport (zone pouce, WIREFRAMES §8)", () => {
    const restore = mockPhone(true);
    try {
      renderBar();
      const button = screen.getByRole("button", { name: "Action" });
      const wrapper = button.parentElement;
      expect(wrapper).not.toBeNull();
      // Garde à effet observable : si la branche téléphone est retirée/mutée, ces valeurs
      // retomberaient sur le wrapper `display:contents` (ci-dessus) et l'assertion échouerait.
      expect(wrapper!.style.position).toBe("fixed");
      expect(wrapper!.style.bottom).toBe("0px");
      expect(wrapper!.style.left).toBe("0px");
      expect(wrapper!.style.right).toBe("0px");
      expect(wrapper!.style.display).toBe("flex");
    } finally {
      restore();
    }
  });
});
