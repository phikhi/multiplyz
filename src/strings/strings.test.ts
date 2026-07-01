import { describe, expect, it } from "vitest";
import { fr } from "./fr";
import { LOCALE, strings } from "./index";
import { AVATARS } from "@/config/avatars";

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

  it("fournit le message offline mid-session (voix Teddy, cf. COPY.md §3)", () => {
    expect(strings.pwa.offline).toContain("réseau");
  });

  it("fournit le message cold-start offline (SYNC.md §3 «Démarrage sans réseau»)", () => {
    expect(strings.pwa.coldStart).toContain("internet");
    expect(strings.pwa.coldStart).toContain("jouer");
  });

  it("expose les libellés a11y du pavé PIN (gabarits interpolables)", () => {
    expect(strings.pinPad.digit).toContain("{d}");
    expect(strings.pinPad.dotFilled).toContain("{n}");
    expect(strings.pinPad.dotEmpty).toContain("{n}");
    expect(strings.pinPad.backspace.length).toBeGreaterThan(0);
  });

  it("onboarding enfant = voix Teddy (tutoiement), parent = registre neutre", () => {
    // Étapes enfant : Teddy se présente, tutoie.
    expect(strings.onboarding.profile.title).toContain("Teddy");
    expect(strings.onboarding.childPin.hint).toContain("chiffres");
    // Étape parent : gabarit prénom interpolable, pas d'enfantillage.
    expect(strings.onboarding.parentPin.method).toContain("{prénom}");
    // Registre parent NEUTRE (COPY.md §5) : pas de tutoiement dans la méthode.
    expect(strings.onboarding.parentPin.method).not.toMatch(/\bte\b/);
  });

  it("chaque portrait AVATARS possède un libellé a11y lisible (invariant)", () => {
    const names = strings.onboarding.profile.avatarNames as Record<string, string>;
    for (const avatar of AVATARS) {
      expect(names[avatar.id]).toBeTruthy();
    }
    expect(strings.onboarding.profile.avatarOption).toContain("{nom}");
  });

  it("code de secours = affiché une seule fois (registre neutre)", () => {
    expect(strings.onboarding.recovery.intro).toContain("une seule fois");
  });

  it("erreurs onboarding = posture croissance (jamais « faux »)", () => {
    const messages = Object.values(strings.onboarding.errors);
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.toLowerCase()).not.toContain("faux");
      expect(message.toLowerCase()).not.toContain("erreur");
    }
    // Clés = codes de la server action (contrat UI ↔ serveur).
    expect(strings.onboarding.errors.PARENT_PIN_SAME).toContain("différent");
  });

  it("connexion = gabarits prénom interpolables + erreur générique no-shame", () => {
    expect(strings.login.profileOption).toContain("{prénom}");
    expect(strings.login.pinTitle).toContain("{prénom}");
    // Message d'échec générique (anti-énumération) : jamais « faux »/« erreur ».
    expect(strings.login.error.toLowerCase()).not.toContain("faux");
    expect(strings.login.error.toLowerCase()).not.toContain("erreur");
    expect(strings.login.error.toLowerCase()).not.toContain("inexistant");
  });

  it("écran de jeu placeholder = voix Teddy + déconnexion", () => {
    expect(strings.play.greeting.length).toBeGreaterThan(0);
    expect(strings.play.logout.length).toBeGreaterThan(0);
  });
});
