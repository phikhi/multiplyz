import { describe, expect, it } from "vitest";
import {
  NAME_MAX_LENGTH,
  PIN_LENGTH,
  RECOVERY_CODE_LENGTH,
  isValidName,
  isValidPin,
  isValidRecoveryCodeFormat,
  nameKey,
  parentPinDiffersFromChild,
  sanitizeName,
  sanitizeRecoveryCode,
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

describe("nameKey (clé d'unicité insensible à la casse Unicode — #37)", () => {
  it("minuscule + trim + espaces compactés (comme sanitizeName)", () => {
    expect(nameKey("  Lina  ")).toBe("lina");
    expect(nameKey("Jean   Luc")).toBe("jean luc");
  });

  it("insensible à la casse ACCENTUÉE (le vrai bug #37 : lower() SQLite ASCII-only)", () => {
    // "Élodie" et "élodie" doivent produire la MÊME clé → doublon détecté.
    expect(nameKey("Élodie")).toBe(nameKey("élodie"));
    expect(nameKey("Élodie")).toBe("élodie");
    // Autres capitales accentuées courantes (français).
    expect(nameKey("Ève")).toBe(nameKey("ève"));
    expect(nameKey("Chloé")).toBe(nameKey("CHLOÉ"));
  });

  it("normalisation Unicode NFC : forme précomposée == forme décomposée", () => {
    const combiningAcute = String.fromCharCode(0x0301); // accent aigu combinant
    const precompose = "Élodie"; // 'É' précomposé (U+00C9) + "lodie"
    const decompose = `E${combiningAcute}lodie`; // 'E' + accent combinant + "lodie"
    expect(precompose).not.toBe(decompose); // codepoints bruts différents
    expect([...precompose].length).not.toBe([...decompose].length); // 6 vs 7 codepoints
    expect(nameKey(precompose)).toBe(nameKey(decompose)); // même clé après NFC
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

  it("normalise AVANT de mesurer la borne (espaces de bord ignorés)", () => {
    // 20 'x' entourés d'espaces → trim ramène à 20 → valide.
    expect(isValidName(`   ${"x".repeat(NAME_MAX_LENGTH)}   `)).toBe(true);
  });

  it("compacte les espaces internes AVANT de mesurer (peut faire passer)", () => {
    // 20 'x' + espaces multiples + 'y' : longueur brute 24, compactée à 22 → rejeté.
    expect(isValidName(`${"x".repeat(NAME_MAX_LENGTH)}   y`)).toBe(false);
    // Mais 19 'x' + espaces multiples + 'y' : compacté à "xx...x y" = 21 → rejeté aussi.
    expect(isValidName(`${"x".repeat(19)}   y`)).toBe(false);
    // 18 'x' + espaces + 'y' → compacté "xx...x y" = 20 → accepté.
    expect(isValidName(`${"x".repeat(18)}   y`)).toBe(true);
  });
});

describe("sanitizeRecoveryCode", () => {
  it("met en majuscules et retire espaces/tirets (saisie parent libre)", () => {
    expect(sanitizeRecoveryCode(" ab2-cd 3k ")).toBe("AB2CD3K");
  });
});

describe("isValidRecoveryCodeFormat", () => {
  it("accepte 8 caractères de l'alphabet lisible (après normalisation)", () => {
    expect(isValidRecoveryCodeFormat("abcd2345")).toBe(true);
    expect(isValidRecoveryCodeFormat(" ABCD-2345 ")).toBe(true); // 8 après retrait du tiret/espaces
  });

  it("rejette une mauvaise longueur", () => {
    expect(isValidRecoveryCodeFormat("ABC234")).toBe(false);
    expect(isValidRecoveryCodeFormat("ABCD23456")).toBe(false);
  });

  it("rejette un caractère ambigu hors alphabet (0/1/I/L/O)", () => {
    expect(isValidRecoveryCodeFormat("ABCD2340")).toBe(false); // '0' interdit
  });

  it("RECOVERY_CODE_LENGTH reste 8 (constante verrouillée AUTH §5)", () => {
    expect(RECOVERY_CODE_LENGTH).toBe(8);
  });
});
