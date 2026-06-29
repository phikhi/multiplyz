import { describe, expect, it } from "vitest";
import { fr } from "./fr";
import { LOCALE, strings } from "./index";

describe("strings (i18n FR)", () => {
  it("expose la locale FR", () => {
    expect(LOCALE).toBe("fr");
  });

  it("pointe vers la table FR centralisée", () => {
    expect(strings).toBe(fr);
  });

  it("fournit les chaînes de la coquille app (voix de Teddy)", () => {
    expect(strings.app.booting).toBe("L'application démarre.");
    expect(strings.meta.description).toContain("Teddy");
  });

  it("fournit le message offline (voix Teddy, cf. COPY.md §3)", () => {
    expect(strings.pwa.offline).toContain("réseau");
    expect(strings.pwa.offlineRole).toBe("Connexion perdue");
  });
});
