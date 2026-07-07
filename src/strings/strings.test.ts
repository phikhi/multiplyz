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

  it("onboarding.recovery (étape 4, écran parent) = registre neutre/vouvoiement (issue #51)", () => {
    // Alignement sur `strings.recovery` (#2.5, même écran « code parent oublié/
    // secours ») : les DEUX écrans de code de secours sont PARENT → vouvoiement
    // neutre, jamais le tutoiement enfant de Teddy. Garde à effet observable :
    // rougit si `\btu\b`/`\bte\b` réapparaît (régression de registre — la marque
    // RÉELLE de la régression #51 était l'IMPÉRATIF tutoyant « Note »/« note-le »,
    // pas un pronom `tu`/`te` explicite — donc cette garde teste AUSSI l'impératif
    // vouvoyant attendu, seul discriminant qui aurait fait rougir l'ancienne copie).
    const recoveryText =
      `${strings.onboarding.recovery.title} ${strings.onboarding.recovery.intro}`.toLowerCase();
    expect(recoveryText).not.toMatch(/\btu\b/);
    expect(recoveryText).not.toMatch(/\bte\b/);
    // Impératif 2e pers. pluriel (vouvoiement) attendu, jamais le singulier enfant.
    expect(strings.onboarding.recovery.title).toMatch(/\bnotez\b/iu);
    expect(strings.onboarding.recovery.title).not.toMatch(/\bnote\b/iu);
    expect(strings.onboarding.recovery.intro).toMatch(/\bnotez-le\b/iu);
    expect(strings.onboarding.recovery.intro).not.toMatch(/\bnote-le\b/iu);
    expect(strings.onboarding.recovery.intro).toContain("une seule fois");
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

  it("collection = gabarits interpolables + libellés de rareté + posture croissance (story 5.6)", () => {
    // Gabarits singulier/pluriel du compteur.
    expect(strings.collection.count).toContain("{n}");
    expect(strings.collection.countPlural).toContain("{n}");
    // Libellé de carte interpolable (nom + rareté, doublage a11y).
    expect(strings.collection.cardLabel).toContain("{nom}");
    expect(strings.collection.cardLabel).toContain("{rareté}");
    // Les 3 raretés ont un libellé FR (doublage texte a11y).
    expect(Object.keys(strings.collection.rarity).sort()).toEqual(["common", "legendary", "rare"]);
    // Posture croissance : l'état vide encourage (jamais « faux »/« erreur »).
    expect(strings.collection.empty.toLowerCase()).not.toContain("faux");
    expect(strings.collection.empty.toLowerCase()).not.toContain("erreur");
    expect(strings.collection.renameError.toLowerCase()).not.toContain("faux");
  });

  it("collection = banques légendaires déterministes (noms/histoires non vides, alignées)", () => {
    // Les banques ne sont pas vides (le seed déterministe pioche dedans, MAP §6).
    expect(strings.collection.legendaryNames.length).toBeGreaterThan(0);
    expect(strings.collection.legendaryStories.length).toBeGreaterThan(0);
    // Chaque entrée est une chaîne non vide (nom mignon + histoire courte).
    for (const name of strings.collection.legendaryNames) expect(name.length).toBeGreaterThan(0);
    for (const story of strings.collection.legendaryStories)
      expect(story.length).toBeGreaterThan(0);
  });

  it("révélation légendaire (résultats) = gabarit nom interpolable + voix Teddy", () => {
    expect(strings.play.results.legendaryLabel).toContain("{nom}");
    expect(strings.play.results.legendaryTitle.length).toBeGreaterThan(0);
  });

  it("worldgen = banques créatures déterministes non vides (noms mignons + histoires, story 6.3)", () => {
    // Les banques peuplent les 6-8 créatures/monde (ECONOMY §5) — assez de noms pour ne pas
    // réutiliser dans un même monde (jusqu'à 7 œufs = 6-8 − 1 légendaire).
    expect(strings.worldgen.creatureNames.length).toBeGreaterThanOrEqual(7);
    expect(strings.worldgen.creatureStories.length).toBeGreaterThan(0);
    for (const name of strings.worldgen.creatureNames) {
      expect(name.length).toBeGreaterThan(0);
      // Voix douce : jamais de posture négative dans un nom mignon.
      expect(name.toLowerCase()).not.toContain("faux");
    }
    for (const story of strings.worldgen.creatureStories) {
      expect(story.length).toBeGreaterThan(0);
      // Posture croissance (COPY) : pas de « faux »/« erreur » dans une histoire de créature.
      expect(story.toLowerCase()).not.toContain("faux");
      expect(story.toLowerCase()).not.toContain("erreur");
    }
  });
});
