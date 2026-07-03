import { describe, expect, it } from "vitest";
import { pickVariant } from "./copy-variant";

const VARIANTS = ["a", "b", "c"] as const;

describe("pickVariant", () => {
  it("choisit la variante par rotation seed % length", () => {
    expect(pickVariant(VARIANTS, 0)).toBe("a");
    expect(pickVariant(VARIANTS, 1)).toBe("b");
    expect(pickVariant(VARIANTS, 2)).toBe("c");
    expect(pickVariant(VARIANTS, 3)).toBe("a"); // boucle
  });

  it("est déterministe (même seed → même variante, à répétition)", () => {
    expect(pickVariant(VARIANTS, 5)).toBe(pickVariant(VARIANTS, 5));
  });

  it("gère un seed négatif (modulo sûr, jamais un index hors bornes)", () => {
    expect(pickVariant(VARIANTS, -1)).toBe("c");
    expect(pickVariant(VARIANTS, -3)).toBe("a");
  });

  it("liste à un seul élément renvoie toujours cet élément", () => {
    expect(pickVariant(["seul"], 0)).toBe("seul");
    expect(pickVariant(["seul"], 42)).toBe("seul");
  });
});
