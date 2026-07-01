import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PinPad } from "./PinPad";
import { strings } from "@/strings";

const LABEL = "Ton code secret";

function digitButton(d: string) {
  return screen.getByRole("button", { name: strings.pinPad.digit.replace("{d}", d) });
}

describe("PinPad (pavé partagé, contrôlé)", () => {
  it("expose un groupe nommé + PIN_LENGTH pastilles avec libellé d'état", () => {
    render(<PinPad value="12" onChange={vi.fn()} label={LABEL} />);
    expect(screen.getByRole("group", { name: LABEL })).toBeInTheDocument();

    // 2 saisis, 2 à saisir — état DOUBLÉ d'un libellé (a11y daltonisme).
    expect(
      screen.getByRole("img", { name: strings.pinPad.dotFilled.replace("{n}", "1") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: strings.pinPad.dotEmpty.replace("{n}", "3") }),
    ).toBeInTheDocument();
  });

  it("ajoute un chiffre tant que le pavé n'est pas plein", () => {
    const onChange = vi.fn();
    render(<PinPad value="12" onChange={onChange} label={LABEL} />);
    fireEvent.click(digitButton("3"));
    expect(onChange).toHaveBeenCalledWith("123");
  });

  it("le bouton 0 fonctionne (dernier rang)", () => {
    const onChange = vi.fn();
    render(<PinPad value="" onChange={onChange} label={LABEL} />);
    fireEvent.click(digitButton("0"));
    expect(onChange).toHaveBeenCalledWith("0");
  });

  it("ignore un chiffre quand le pavé est plein (4 chiffres)", () => {
    const onChange = vi.fn();
    render(<PinPad value="1234" onChange={onChange} label={LABEL} />);
    fireEvent.click(digitButton("5"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("efface le dernier chiffre", () => {
    const onChange = vi.fn();
    render(<PinPad value="12" onChange={onChange} label={LABEL} />);
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.backspace }));
    expect(onChange).toHaveBeenCalledWith("1");
  });

  it("ignore l'effacement quand la valeur est vide", () => {
    const onChange = vi.fn();
    render(<PinPad value="" onChange={onChange} label={LABEL} />);
    fireEvent.click(screen.getByRole("button", { name: strings.pinPad.backspace }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
