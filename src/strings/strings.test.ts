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

  it("écran de jeu = voix Teddy + déconnexion", () => {
    expect(strings.play.logout.length).toBeGreaterThan(0);
  });

  it("écran de jeu = posture croissance (jamais « faux »/« erreur ») + no-fail", () => {
    const retryTexts = [...strings.play.retry.variants, strings.play.retry.tryAgain];
    for (const text of retryTexts) {
      expect(text.toLowerCase()).not.toContain("faux");
      expect(text.toLowerCase()).not.toContain("erreur");
    }
    // Aucun écran d'échec : "results" couvre 0 à 3 étoiles, jamais un message négatif.
    expect(Object.keys(strings.play.results.byStars).sort()).toEqual(["0", "1", "2", "3"]);
  });

  it("étoiles = gabarits interpolables singulier/pluriel", () => {
    expect(strings.play.results.starsLabel).toContain("{n}");
    expect(strings.play.results.starsLabelPlural).toContain("{n}");
  });

  it("question = énoncés signes clairs interpolables (COPY §6)", () => {
    expect(strings.play.question.equationTwoOperands).toContain("{op}");
    expect(strings.play.question.equationComplement).toContain("{cible}");
  });

  it("récupération = registre parent NEUTRE (pas de tutoiement Teddy)", () => {
    const rec = strings.recovery;
    expect(rec.title.length).toBeGreaterThan(0);
    expect(rec.done.intro).toContain("une seule fois"); // nouveau code affiché une fois
    // Registre neutre (vouvoiement) : pas de tutoiement enfant (« tu »/« te »).
    const parentText = `${rec.intro} ${rec.newPinHint} ${rec.done.intro}`.toLowerCase();
    expect(parentText).not.toMatch(/\btu\b/);
    expect(parentText).not.toMatch(/\bte\b/);
  });

  it("erreurs de récupération = clés RecoveryErrorCode + GENERIC (contrat UI↔serveur)", () => {
    expect(Object.keys(strings.recovery.errors).sort()).toEqual([
      "CODE_INVALID",
      "GENERIC",
      "PARENT_PIN_SAME",
      "PIN_INVALID",
    ]);
    expect(strings.recovery.errors.PARENT_PIN_SAME).toContain("différent");
  });
});
