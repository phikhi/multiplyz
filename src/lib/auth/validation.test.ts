import { describe, expect, it } from "vitest";
import {
  NAME_MAX_LENGTH,
  PIN_LENGTH,
  isValidName,
  isValidPin,
  parentPinDiffersFromChild,
  sanitizeName,
} from "./validation";

describe("isValidPin", () => {
  it("accepte exactement 4 chiffres", () => {
    expect(isValidPin("0000")).toBe(true);
    expect(isValidPin("4821")).toBe(true);
  });

  it("rejette une longueur ≠ 4", () => {
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("")).toBe(false);
  });

  it("rejette les caractères non numériques", () => {
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("abcd")).toBe(false);
    expect(isValidPin(" 123")).toBe(false);
  });

  it("PIN_LENGTH reste 4 (constante verrouillée)", () => {
    expect(PIN_LENGTH).toBe(4);
  });
});

describe("parentPinDiffersFromChild", () => {
  it("true quand les PIN diffèrent", () => {
    expect(parentPinDiffersFromChild("1234", "5678")).toBe(true);
  });

  it("false quand les PIN sont identiques (règle AUTH §4)", () => {
    expect(parentPinDiffersFromChild("1234", "1234")).toBe(false);
  });
});

describe("sanitizeName", () => {
  it("retire les espaces de bord", () => {
    expect(sanitizeName("  Lina  ")).toBe("Lina");
  });

  it("compacte les espaces internes", () => {
    expect(sanitizeName("Jean   Luc")).toBe("Jean Luc");
  });
});

describe("isValidName", () => {
  it("accepte un prénom normal", () => {
    expect(isValidName("Lina")).toBe(true);
  });

  it("rejette le vide / uniquement des espaces", () => {
    expect(isValidName("")).toBe(false);
    expect(isValidName("   ")).toBe(false);
  });

  it("rejette au-delà de la borne max", () => {
    expect(isValidName("x".repeat(NAME_MAX_LENGTH + 1))).toBe(false);
  });

  it("accepte pile la borne max (après normalisation)", () => {
    expect(isValidName("x".repeat(NAME_MAX_LENGTH))).toBe(true);
  });
});
