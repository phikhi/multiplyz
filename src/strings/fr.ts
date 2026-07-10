/**
 * Table de chaînes FR — source unique de vérité (zéro texte en dur).
 *
 * Voix de Teddy (cf. COPY.md). v1 = FR uniquement, mais la structure est prête
 * pour l'i18n (cf. DETAILS.md §5). Les épics suivants ajoutent leurs clés ici ;
 * aucun littéral visible ne doit vivre dans les composants.
 */
export const fr = {
  meta: {
    /** Description (onglet navigateur / SEO) — registre neutre. */
    description: "Apprends les maths en t'amusant avec Teddy, ton copain d'aventure.",
  },
  app: {
    /** Écran de démarrage (placeholder — UI réelle en #11). */
    booting: "L'application démarre.",
  },
  pwa: {
    /**
     * Message perte de réseau MID-SESSION (cf. COPY.md §3, SYNC.md §3).
     * Réseau coupé pendant la session — posture douce, reprise implicite.
     */
    offline: "Oups, plus de réseau — on reprend dès que ça revient 🌐",
    /**
     * Message COLD-START hors-ligne (cf. SYNC.md §3 «Démarrage sans réseau»).
     * Démarrage alors que la connexion est déjà absente — invite à se connecter.
     */
    coldStart: "Connecte-toi à internet pour jouer 🌐",
  },
  /**
   * Pavé PIN partagé (composant `PinPad`, réutilisé par la connexion #2.3).
   * Libellés d'accessibilité : chaque cible annonce son rôle (lecteur d'écran).
   */
  pinPad: {
    /** Gabarit ARIA d'une pastille remplie (`{n}` = position, 1-indexée). */
    dotFilled: "Chiffre {n} saisi",
    /** Gabarit ARIA d'une pastille vide. */
    dotEmpty: "Chiffre {n} à saisir",
    /** Gabarit ARIA d'un bouton chiffre (`{d}` = chiffre). */
    digit: "Chiffre {d}",
    /** Bouton d'effacement du dernier chiffre. */
    backspace: "Effacer le dernier chiffre",
  },
  /**
   * Onboarding 1er usage (AUTH.md §2, PRODUCT.md §1.1). Étapes enfant = voix de
   * Teddy (tutoiement, posture croissance) ; étape parent = registre **neutre**
   * (COPY.md §5). `{prénom}` interpolé à l'exécution.
   */
  onboarding: {
    /** Étape 1 — présentation du profil (voix Teddy). */
    profile: {
      title: "Bienvenue ! Moi, c'est Teddy 🧸",
      intro: "On prépare ton aventure tous les deux ?",
      nameLabel: "Comment tu t'appelles ?",
      namePlaceholder: "Ton prénom",
      avatarLabel: "Choisis ton portrait",
      /** Gabarit ARIA d'un portrait (`{nom}` = libellé lisible du portrait). */
      avatarOption: "Portrait {nom}",
      /** Libellés FR des portraits (clé = `AvatarOption.id`) — a11y lisible. */
      avatarNames: {
        fox: "renard",
        rabbit: "lapin",
        panda: "panda",
        cat: "chat",
        frog: "grenouille",
        owl: "chouette",
        penguin: "manchot",
        unicorn: "licorne",
      },
    },
    /** Étape 2 — code secret enfant (voix Teddy). */
    childPin: {
      title: "Choisis ton code secret 🔑",
      hint: "4 chiffres, rien qu'à toi. Garde-le bien !",
    },
    /** Étape 3 — code parent (registre neutre, COPY.md §5). */
    parentPin: {
      title: "Un code pour le parent",
      hint: "4 chiffres, différent de celui de l'enfant.",
      method:
        "Cet espace montre les progrès de {prénom} : de courtes séances, on revoit en douceur ce qui coince, sans jamais parler d'échec.",
    },
    /**
     * Étape 4 — code de secours (affiché une seule fois). Écran **parent**
     * (comme la récupération #2.5, `strings.recovery`) → registre **neutre /
     * vouvoiement** (COPY.md §5, PAS la voix tutoyante de Teddy) — aligné (issue
     * #51) sur `strings.recovery.done.intro` (même contrat : code affiché une
     * seule fois, noté maintenant).
     */
    recovery: {
      title: "Notez ce code de secours",
      intro:
        "Il permet de réinitialiser le code parent s'il est oublié. Il ne s'affiche qu'une seule fois — notez-le maintenant.",
      done: "C'est noté, continuer",
    },
    /** Écran final (voix Teddy). */
    ready: {
      title: "Ton aventure est prête ! 🎉",
      cta: "On y va !",
    },
    /** Navigation entre étapes. */
    nav: {
      next: "Continuer",
      back: "Retour",
      create: "C'est parti !",
      creating: "Un instant…",
    },
    /**
     * Messages d'erreur (posture croissance : jamais « faux »/« erreur »).
     * Clés = codes renvoyés par la server action (`OnboardingErrorCode`).
     */
    errors: {
      NAME_INVALID: "Ton prénom, c'est entre 1 et 20 lettres.",
      AVATAR_INVALID: "Choisis un portrait pour continuer.",
      PIN_INVALID: "Le code, c'est 4 chiffres.",
      PARENT_PIN_SAME: "Le code du parent doit être différent de celui de l'enfant.",
      NAME_TAKEN: "Ce prénom est déjà pris — choisis-en un autre.",
      GENERIC: "Oups, ça n'a pas marché. On réessaie ?",
    },
  },
  /**
   * Connexion (AUTH.md §2, WIREFRAMES §1). Sélecteur de profil + pavé PIN, voix
   * de Teddy (tutoiement, no-shame). `{prénom}` interpolé à l'exécution. Le
   * message d'erreur est **générique** (anti-énumération, AUTH.md §4) : jamais
   * « profil inexistant » vs « PIN faux ».
   */
  login: {
    /** Titre du sélecteur (WIREFRAMES §1a). */
    title: "Qui joue aujourd'hui ?",
    /** Gabarit ARIA d'une carte de profil (`{prénom}` = prénom du profil). */
    profileOption: "Jouer avec {prénom}",
    /** Titre du pavé PIN, personnalisé (WIREFRAMES §1b). */
    pinTitle: "Salut {prénom} ! Ton code 🔑",
    /** Libellé accessible du groupe pavé PIN. */
    pinLabel: "Ton code secret",
    /** Bouton retour vers la liste des profils. */
    back: "Choisir un autre profil",
    /** Vérification en cours (après saisie complète). */
    checking: "Un instant…",
    /** Échec **générique** (mauvais code OU profil inconnu) — no-shame. */
    error: "Oups, on réessaie ?",
  },
  /**
   * Écran de jeu **nu** (story #64, ENGINE §5/§9, PRODUCT §2.2, COPY §3). Voix de
   * Teddy, tutoiement. Accessible uniquement avec une session enfant valide.
   * Habillage visuel (étayages, animations) = hors scope (épic #4).
   */
  play: {
    /** Déconnexion (formulé pour un enfant : « changer de joueur »). */
    logout: "Changer de joueur",
    /** Chargement du niveau (lecture serveur avant affichage de la 1re question). */
    loading: "Je prépare tes calculs…",
    /** Erreur générique de chargement (session expirée / réseau) — posture douce. */
    loadError: "Oups, ça n'a pas marché. On réessaie ?",
    loadErrorRetry: "Réessayer",
    /** Cas défensif « niveau vide » (structurellement improbable, ENGINE §4). */
    emptyLevel: "Pas de calcul à te proposer pour l'instant — reviens un peu plus tard !",
    /**
     * **Verrou dur temps d'écran** (DETAILS §27, story 7.8 #229 — garde-fou bien-être **opt-in
     * parent**, jamais punitif). Affiché quand `startLevelAction` refuse l'entrée dans un
     * NOUVEAU niveau (seuil quotidien ⚙️ atteint) — la partie qui vient de se terminer n'est
     * jamais remise en cause (no-fail, ENGINE §9). Voix de Teddy, tutoiement, posture croissance
     * (jamais « faux »/« erreur ») — même famille que le nudge de fin de session (COPY §3
     * « Reviens demain, je t'attends 🌙🍯 »), texte **distinct** car ce n'est pas un rappel mais
     * un arrêt du jour (pas de bouton « Réessayer » : rejouer ne change rien avant demain).
     */
    screenTimeLocked: {
      title: "On reprend demain ! 🌙",
      hint: "Tu as bien joué aujourd'hui. Je garde un poisson au miel pour toi, à demain ! 🍯",
    },
    /** Diagnostic de départ (déguisé, ENGINE §3, COPY §3 : cadre sans pression). */
    diagnostic: {
      intro: "On commence par un petit défi pour préparer ta carte !",
      hint: "Pas de stress, montre-moi juste ce que tu sais 😊",
    },
    /** Question (WIREFRAMES §3a/§3b). `{a}`/`{b}` = opérandes interpolés. */
    question: {
      /** Gabarit à 2 opérandes (add/sub/mult) : `6 × 8 = ?`. */
      equationTwoOperands: "{a} {op} {b} = ?",
      /** Gabarit à 1 opérande (compléments à 10) : `3 + ? = 10`. */
      equationComplement: "{a} + ? = {cible}",
      /** Libellé accessible du groupe de choix QCM. */
      choicesLabel: "Choisis la bonne réponse",
      /** Libellé accessible du pavé de saisie libre. */
      inputLabel: "Ta réponse",
      /** Bouton de validation du pavé. */
      submit: "Valider",
      /** Bouton « je ne sais pas » (ENGINE §9 : indice sans pénalité). */
      dontKnow: "Je ne sais pas",
      /** Libellé ARIA d'un bouton-réponse QCM (`{n}` = valeur proposée). */
      choiceOption: "Réponse {n}",
      /** Libellé de la barre de progression (`{n}`/`{total}` = position). */
      progress: "Question {n} sur {total}",
    },
    /** Feedback juste (variantes, voix Teddy — COPY §3 « Bonne réponse »). */
    correct: {
      variants: ["Bravo !", "Dans le mille !", "Trop forte !", "Et hop !", "Génial, continue !"],
      next: "Continuer",
    },
    /** Feedback « pas encore » (ENGINE §9 no-fail — jamais « faux », COPY §3). */
    retry: {
      variants: [
        "Oups, presque ! Regarde…",
        "Pas encore — on essaie ensemble ?",
        "Hé, j'ai failli me tromper aussi ! Regarde :",
        "T'inquiète, je te montre le truc :",
      ],
      /**
       * Révélation numérique de la bonne réponse en **synthèse APRÈS l'étayage visuel**
       * (issue #100 : l'étayage fait « voir » le calcul d'abord, le chiffre conclut).
       * Se lit comme une conclusion, pas comme la réponse jetée en tête (`{n}` = valeur).
       */
      answerReveal: "Et voilà, ça fait {n} !",
      tryAgain: "Je réessaie",
    },
    /**
     * Étayage visuel du re-essai (WIREFRAMES §3d, PRODUCT §2.2, épic #4 — COMPLET,
     * 4.2/4.3/4.4 mergées). Voix de Teddy, tutoiement. Chaque étayage concret
     * (dix-cases, droite numérique, matrice) porte son **propre** libellé
     * accessible spécifique dérivé des props (rétro #94 : jamais de `role="img"`
     * imbriqué, le nom accessible EST l'info numérique, pas un générique).
     *
     * **Nit review #112** : l'ancienne clé `label` (libellé générique du
     * placeholder de fondation #93, avant que 4.2/4.3/4.4 câblent un étayage
     * concret par compétence) a été **retirée** — plus aucun code prod ne la
     * référence depuis l'épic #4 complet (elle ne servait plus qu'à des
     * assertions négatives de tests, remplacées par une constante locale dédiée).
     */
    scaffold: {
      /**
       * Étayage dix-cases des compléments à 10 (story #94, ENGINE §1 `a + ? = 10`,
       * PRODUCT §3.4, WIREFRAMES §3d). Voix de Teddy, tutoiement — `missing` porte
       * l'info numérique et sert **à la fois** de texte visible (sous la grille) ET de
       * **nom accessible** de l'unique `role="img"` du conteneur (rétro #94 : pas de
       * `role="img"` imbriqué ; a11y jamais couleur/forme seule, daltonisme).
       */
      tenFrame: {
        /** Phrase-clé de la découverte (`{n}` = 10 − a, cases à compléter). */
        missing: "Il manque {n} pour faire 10",
      },
      /**
       * Étayage droite numérique de l'addition/soustraction (story #95, ENGINE §1
       * add/sub dans 20, PRODUCT §3.4, WIREFRAMES §3d). Voix de Teddy, tutoiement —
       * `{a}`/`{b}` = opérandes du calcul. Sert **à la fois** de texte visible (sous
       * la droite, doublé de l'icône flèche) ET de **nom accessible** (via le
       * registre `label(props)`, rétro #94 : pas de `role="img"` imbriqué). Le sens
       * du saut (avance/recul) N'EST JAMAIS porté par la seule couleur — texte +
       * icône (a11y daltonisme).
       */
      numberLine: {
        /** Addition : saut **avant** depuis `a` de `b` (`{a}`/`{b}` = opérandes). */
        forward: "Depuis {a}, on avance de {b}",
        /** Soustraction : saut **arrière** depuis `a` de `b`. */
        backward: "Depuis {a}, on recule de {b}",
      },
      /**
       * Étayage matrice de la multiplication (story #96, ENGINE §1 `a × b`,
       * PRODUCT §3.4 « groupes répétés / matrice », WIREFRAMES §3d). Voix de Teddy,
       * tutoiement — `{a}`/`{b}` = opérandes du calcul (`a` paquets de `b`). Sert **à
       * la fois** de texte visible (sous la grille) ET de **nom accessible** de
       * l'unique `role="img"` du conteneur (registre `label(props)`, rétro #94 : pas
       * de `role="img"` imbriqué). Le regroupement (paquets) n'est jamais porté par
       * la seule couleur — séparation spatiale/bordure entre paquets (a11y daltonisme).
       */
      matrix: {
        /** `{a}` = nombre de paquets (lignes), `{b}` = taille d'un paquet (points/ligne). */
        label: "{a} paquets de {b}",
      },
    },
    /** Résultats de fin de niveau (WIREFRAMES §4, ENGINE §5 : jamais d'échec, ECONOMY §4.1). */
    results: {
      title: "Niveau bouclé ! 🎉",
      /** Libellé accessible du total d'étoiles (`{n}` = 0 à 3). */
      starsLabel: "{n} étoile sur 3",
      starsLabelPlural: "{n} étoiles sur 3",
      /** Encouragement selon le nombre d'étoiles (clé = nombre, ENGINE §5). */
      byStars: {
        0: "Bien joué, on avance !",
        1: "Bien joué, on avance !",
        2: "Super, presque parfait !",
        3: "Trois étoiles ?! Une championne ! 🌟",
      },
      /**
       * Pièces gagnées (ECONOMY §4.1, gains #126) — voix de Teddy, tutoiement.
       * `{n}` = nombre de pièces créditées ce niveau (base + bonus étoiles + trésor).
       * Singulier/pluriel (1 pièce vs N pièces). Sert **à la fois** de texte visible ET de
       * nom accessible de la ligne de pièces (`role="img"`), doublage a11y (jamais la seule
       * icône 🪙, daltonisme).
       */
      coins: "Tu gagnes {n} pièce 🪙",
      coinsPlural: "Tu gagnes {n} pièces 🪙",
      /**
       * Révélation de la **créature légendaire** gagnée au boss (story 5.6, MAP §6, COPY §3
       * « déblocage créature »). Voix de Teddy, intrépide/joyeuse. `legendaryTitle` = annonce
       * visible ; `legendaryLabel` = nom accessible complet (`{nom}` interpolé) — doublage a11y.
       */
      legendaryTitle: "Créature légendaire !",
      legendaryLabel: "Créature légendaire gagnée : {nom} 🌟",
      continue: "Continuer",
    },
  },
  /**
   * Écran **carte du monde** (story #125, WIREFRAMES §2, PRODUCT §2.1, MAP §2/§4/§5).
   * Chemin de nœuds « Candy Crush » du monde courant (déblocage linéaire). Voix de
   * Teddy, tutoiement (écran enfant). Chaque type/état de nœud est doublé d'un texte
   * (a11y daltonisme, jamais couleur/forme seule) — ces libellés sont le nom
   * accessible des nœuds (`role="link"`/`role="img"`).
   */
  map: {
    /**
     * Titre **thématisé** de l'écran (`{n}` = numéro du monde 1-based, `{theme}` = thème du monde
     * généré/socle) — câblage carte↔monde (story 6.7, WIREFRAMES §2 « Monde 3 · La Forêt »). Le
     * thème per-monde **atteint l'enfant** dans le titre (texte, jamais occulté). Un monde résolu
     * porte **toujours** un thème (généré ou socle) → titre toujours thématisé (pas de variante
     * « Monde {n} » nue : supprimée, plus aucun consommateur — strings centralisées, zéro texte mort).
     */
    titleThemed: "Monde {n} · {theme}",
    /** Libellé accessible du nœud courant — invite à jouer, point de reprise. */
    nodeCurrent: "Nœud {n} sur {total} — à toi de jouer !",
    /** Libellé accessible d'un nœud terminé (`{stars}` = 0 à 3, rejoue possible). */
    nodeCompleted: "Nœud {n} sur {total} — terminé, {stars}",
    /** Libellé accessible d'un nœud verrouillé (pas encore jouable). */
    nodeLocked: "Nœud {n} sur {total} — pas encore débloqué",
    /** Libellé du nombre d'étoiles d'un nœud terminé (`{n}` = 0 à 3, MAP §4). */
    starsLabel: "{n} étoile sur 3",
    starsLabelPlural: "{n} étoiles sur 3",
    /** Libellé de type accolé au nœud (doublage texte, a11y) — MAP §2. */
    type: {
      normal: "Niveau",
      revision: "Révision",
      treasure: "Trésor",
      boss: "Boss",
    },
    /** États de chargement / erreur de l'écran (mêmes postures que `play`). */
    loading: "Je prépare ta carte…",
    loadError: "Oups, ça n'a pas marché. On réessaie ?",
    loadErrorRetry: "Réessayer",
    /**
     * Message **doux voix de Teddy** quand le monde n'est pas encore prêt (socle de secours non
     * disponible — `SocleUnavailableError`, story 6.7). C'est l'état « **Monde en préparation** » de
     * COPY §91 → libellé **canonique verbatim** (1ère personne, voix Teddy) — **jamais** l'erreur
     * technique brute à l'enfant. Verbatim pour ne pas dériver la promesse faite à l'enfant.
     */
    worldUnavailable: "Je prépare un nouveau monde… 2 secondes !",
  },
  /**
   * Écran **Collection (Pokédex)** (story 5.6, WIREFRAMES §5, PRODUCT §2.3, ECONOMY
   * §3.2/§3.3). Écran **enfant** → voix de Teddy, tutoiement. Créatures possédées (nom +
   * histoire) + **renommage** libre. Chaque rareté est doublée d'un **texte** (a11y
   * daltonisme, jamais couleur/forme seule).
   */
  collection: {
    /** Titre de l'écran (WIREFRAMES §5a). */
    title: "Ma collection 🐾",
    /** Compteur possédées (`{n}` = nombre de créatures dans la collection). */
    count: "{n} créature",
    countPlural: "{n} créatures",
    /** État vide (aucune créature encore — pas encore de boss battu, posture douce). */
    empty:
      "Pas encore d'ami dans ta collection — bats un boss pour gagner ta 1ʳᵉ créature légendaire ! 🌟",
    /** Libellés FR des raretés (doublage texte de la rareté, a11y) — clé = `Rarity`. */
    rarity: {
      common: "commune",
      rare: "rare",
      legendary: "légendaire",
    },
    /** Libellé accessible d'une carte de créature (`{nom}` + `{rareté}`). */
    cardLabel: "{nom} — créature {rareté}",
    /** Bouton « renommer » (WIREFRAMES §5b). */
    rename: "Renommer",
    /** Libellé du champ de renommage. */
    renameLabel: "Nouveau nom",
    /** Validation du renommage. */
    renameSubmit: "Enregistrer",
    /** Annuler le renommage. */
    renameCancel: "Annuler",
    /** Enregistrement en cours. */
    renaming: "Un instant…",
    /** Erreur de renommage (posture douce, jamais « erreur »). */
    renameError: "Oups, ce nom ne marche pas. Essaie un nom entre 1 et 20 lettres.",
    /** États de chargement / erreur de l'écran (mêmes postures que `play`/`map`). */
    loading: "Je prépare ta collection…",
    loadError: "Oups, ça n'a pas marché. On réessaie ?",
    loadErrorRetry: "Réessayer",
    /** Retour à la carte (hub, WIREFRAMES §2). */
    back: "Retour à la carte",
    /**
     * **Noms par défaut** des légendaires (placeholder — l'art réel + les vraies
     * créatures arrivent à l'épic #6, WORLDGEN). Piochés **déterministe** par
     * `world_index` (MAP §6) → même monde ⇒ même nom. Voix douce/mignonne (COPY §5,
     * « noms par défaut mignons »). L'enfant peut renommer.
     */
    legendaryNames: ["Braisille", "Aquagon", "Sylvelune", "Astrogriffe", "Ombreneige", "Solflamme"],
    /**
     * **Histoires** par défaut des légendaires (beats courts, COPY §4 — placeholder
     * épic #6). Piochées **déterministe** par `world_index` (même ordre que
     * `legendaryNames`). 1 phrase mignonne, illustrable plus tard.
     */
    legendaryStories: [
      "La gardienne légendaire de ce monde — elle veillait sur le boss.",
      "Une créature rare des profondeurs, enfin libre grâce à toi.",
      "Elle dormait au sommet du monde en attendant une championne.",
      "Née d'une étoile filante, elle a choisi de te suivre.",
      "Un esprit de givre au grand cœur, timide mais fidèle.",
      "Le soleil de ce monde a pris vie pour te remercier.",
    ],
  },
  /**
   * Récupération du code parent via code de secours (AUTH.md §5). Écran
   * **parent** → registre **neutre/vouvoiement** (COPY.md §5, pas la voix de
   * Teddy). Message d'échec du code **générique** (rate-limité, AUTH.md §4).
   */
  recovery: {
    /** Étape 1 — saisie du code de secours. */
    title: "Code parent oublié",
    intro:
      "Saisissez le code de secours noté lors de la configuration pour définir un nouveau code parent.",
    codeLabel: "Code de secours",
    codePlaceholder: "8 caractères",
    verify: "Vérifier",
    verifying: "Vérification…",
    /** Étape 2 — nouveau PIN parent (pavé partagé). */
    newPinTitle: "Nouveau code parent",
    newPinHint: "4 chiffres, différent du code de l'enfant.",
    /** Libellé accessible du groupe pavé PIN. */
    pinLabel: "Nouveau code parent",
    submit: "Enregistrer",
    submitting: "Enregistrement…",
    back: "Retour",
    /** Étape 3 — nouveau code de secours régénéré, affiché une seule fois. */
    done: {
      title: "Code parent mis à jour",
      intro: "Voici un nouveau code de secours. Notez-le : il ne sera affiché qu'une seule fois.",
      cta: "Terminé",
    },
    /**
     * Erreurs (clés = `RecoveryErrorCode` + repli réseau `GENERIC`). Registre
     * neutre, factuel. `CODE_INVALID` reste **générique** (code faux OU backoff).
     */
    errors: {
      CODE_INVALID: "Code de secours incorrect.",
      PIN_INVALID: "Le code parent doit faire 4 chiffres.",
      PARENT_PIN_SAME: "Le code parent doit être différent de celui de l'enfant.",
      GENERIC: "Une erreur est survenue. Réessayez.",
    },
  },
  /**
   * **Espace parent** (épic #7, story 7.1 — AUTH.md §2 «espace parent», WIREFRAMES §1a/§7,
   * PRODUCT.md écran 7). Écran **parent** → registre **NEUTRE / vouvoiement** (COPY.md §5, PAS
   * la voix tutoyante de Teddy). L'entrée du sélecteur + le pavé PIN parent + le stub du
   * tableau de bord. Message d'échec **générique** (anti-énumération, AUTH.md §4). Le vrai
   * tableau de bord (justesse/compétences/temps) arrive en story 7.7.
   */
  parent: {
    /**
     * Entrée discrète « 🔒 Parent » du sélecteur de profil (WIREFRAMES §1a, coin bas). Le
     * cadenas 🔒 est un glyphe **décoratif** (aria-hidden) → `entry` = texte visible,
     * `entryLabel` = nom accessible complet annoncé au lecteur d'écran. Registre neutre.
     */
    entry: "Parent",
    /** Nom accessible de l'entrée (le 🔒 décoratif ne porte pas d'info a11y). */
    entryLabel: "Espace parent",
    /** Titre du pavé PIN parent (registre neutre/vouvoiement, COPY §5). */
    pinTitle: "Espace parent",
    /** Consigne du pavé PIN parent (vouvoiement). */
    pinHint: "Saisissez le code parent pour continuer.",
    /** Libellé accessible du groupe pavé PIN parent. */
    pinLabel: "Code parent",
    /** Vérification en cours (après saisie complète du code). */
    checking: "Vérification…",
    /** Échec **générique** (code faux OU backoff, indiscernables) — anti-énumération, neutre. */
    error: "Code incorrect. Réessayez.",
    /** Lien « code parent oublié » → `/parent/recuperation` (flow #2.5, AUTH §5). */
    forgot: "Code parent oublié",
    /** Retour au sélecteur de profil (annule la saisie du code parent). */
    back: "Retour",
    /**
     * **Tableau de bord** de l'espace parent (story 7.7, WIREFRAMES §7, PLAN §Espace parent).
     * Assemble les agrégats read-only de 7.2 (`stats.ts` : justesse/rapidité/maîtrise/à-revoir)
     * et 7.4 (`regularity.ts` : jours joués/temps/série/respect) + la progression (monde/niveau/
     * créatures, 7.7). Registre **neutre/vouvoiement** (COPY §5, pas Teddy), zéro texte en dur.
     */
    dashboard: {
      /** Bandeau de l'espace parent (WIREFRAMES §7 en-tête, h1 — inchangé depuis 7.1). */
      title: "Espace parent",
      /** Sous-titre nominatif (gabarit prénom) — écho littéral de COPY §5 « Progression de {prénom} ». */
      subtitle: "Progression de {prénom}",
      /** Bandeau du jour (minutes + niveaux touchés aujourd'hui) + série. Gabarits SINGULIER/
       * PLURIEL séparés (français : 0 ET 1 → singulier, ≥2 → pluriel — même règle que
       * `collection.count`/`countPlural`, `CollectionScreen.tsx`) : sélection au call-site via
       * `pluralize()` (`dashboard-format.ts`), jamais un gabarit unique figé au pluriel. */
      today: {
        /** Résumé du jour, niveau au SINGULIER (0 ou 1 niveau, WIREFRAMES §7 « Aujourd'hui : 18 min · 3 niveaux »). */
        summary: "Aujourd'hui : {min} min · {n} niveau",
        /** Résumé du jour, niveaux au PLURIEL (≥2). */
        summaryPlural: "Aujourd'hui : {min} min · {n} niveaux",
        /** Repli minutes seules (progression indisponible, `SocleUnavailableError` — jamais
         * affirmer un compte de niveaux qu'on n'a pas pu calculer). */
        minutesOnly: "Aujourd'hui : {min} min",
        /** Repli quand l'enfant n'a pas encore joué aujourd'hui (no-fail, jamais un 0 min sec). */
        notPlayed: "Pas encore joué aujourd'hui.",
        /** Série de jours consécutifs, SINGULIER (0 ou 1 jour, WIREFRAMES §7 « Série : 🔥 5 jours »). */
        streak: "Série : {n} jour",
        /** Série de jours consécutifs, PLURIEL (≥2). */
        streakPlural: "Série : {n} jours",
        /** Repli quand aucune série n'est en cours (currentStreakDays = 0, no-fail). */
        noStreak: "Pas de série en cours.",
      },
      /** Justesse (semaine) + tendance + détail par compétence (WIREFRAMES §7). */
      accuracy: {
        heading: "Justesse (semaine)",
        /** Repli neutre quand aucune 1ʳᵉ réponse n'est comptée cette fenêtre (no-fail). */
        empty: "Pas encore de données cette semaine.",
        /** Valeur affichée (gabarit pourcentage entier, aussi réutilisé par les barres par compétence). */
        value: "{pct} %",
        /** Delta signé (gabarit `{delta}` déjà signé, ex. « +5 »), affiché seulement si non-`null`. */
        delta: "{delta} % vs la semaine précédente",
        /** Tendance + delta composés en UNE phrase (mot + parenthèse), jamais de ponctuation
         * assemblée en dur dans le composant. */
        trendWithDelta: "{trend} ({delta})",
        /** Légende du détail par compétence (barres). */
        bySkillHeading: "Par compétence",
        /** Nom accessible d'UNE barre de compétence (`role="img"`, gabarits skill+valeur — même
         * patron que les étayages `role="img"` à nom accessible complet, ex. `TenFrame`). */
        skillBarLabel: "{skill} : {value}",
        /** Mots de tendance — orientés SUR LE POURCENTAGE (intuitif : monte = progression). */
        trend: {
          improving: "en progression",
          regressing: "en baisse",
          stable: "stable",
        },
      },
      /** Libellés des 4 compétences (WIREFRAMES §7, ordre canonique `SKILLS`). */
      skills: {
        comp10: "Compléments",
        add: "Addition",
        sub: "Soustraction",
        mult: "Multiplication",
      },
      /** Rapidité moyenne + tendance (WIREFRAMES §7 « Rapidité moyenne : 3,2 s ▼ (mieux) »). */
      speed: {
        heading: "Rapidité moyenne",
        empty: "Pas encore de données.",
        /** Valeur affichée (gabarit secondes, virgule française — cf. `dashboard-format.ts`). */
        value: "{s} s",
        /** Mots de tendance — orientés SUR L'ENFANT (plus rapide/lente), PAS sur le nombre brut
         * de ms (« en baisse » serait ambigu : un temps qui baisse est une AMÉLIORATION). */
        trend: {
          improving: "plus rapide",
          regressing: "plus lente",
          stable: "stable",
        },
      },
      /** Carte de maîtrise (heatmap maîtrisé/en cours/à renforcer, PLAN §Espace parent). */
      mastery: {
        heading: "Carte de maîtrise",
        mastered: "Maîtrisé",
        inProgress: "En cours",
        weak: "À renforcer",
      },
      /** Liste « à revoir » (top calculs ratés/lents, WIREFRAMES §7). */
      review: {
        heading: "À revoir",
        /** Posture croissance : jamais un manque, une réussite (no-fail). */
        empty: "Rien à revoir pour le moment.",
      },
      /** Régularité (jours joués, série record, respect de la fenêtre saine, PLAN §Espace parent). */
      regularity: {
        heading: "Régularité",
        /** Respect de la fenêtre saine — mot DOUBLE l'icône (a11y daltonisme), jamais la couleur seule. */
        respect: {
          under: "En dessous de la fenêtre recommandée",
          within: "Dans la fenêtre recommandée",
          over: "Au-dessus de la fenêtre recommandée",
        },
        /** Clarifie que la fenêtre est un repère pédagogique FIXE (gabarits bornes ⚙️), distinct
         * du réglage de temps d'écran configurable du foyer (7.3/7.8, note PO story 7.4). */
        respectHint: "Repère indicatif ({min}-{max} min), distinct du réglage de temps d'écran.",
        /** Total de jours joués, SINGULIER (0 ou 1 jour — le participe accorde aussi). */
        daysPlayed: "{n} jour joué au total",
        /** Total de jours joués, PLURIEL (≥2). */
        daysPlayedPlural: "{n} jours joués au total",
        /** Meilleure série de l'historique, SINGULIER (0 ou 1 jour). */
        recordStreak: "Record : {n} jour",
        /** Meilleure série de l'historique, PLURIEL (≥2). */
        recordStreakPlural: "Record : {n} jours",
        /** Légende accessible du graphique minutes/jour (consommée en `role="img"` sur le
         * conteneur du graphique — jamais un token/string déclaré sans consommateur DOM, #125). */
        chartLabel: "Minutes jouées par jour (7 derniers jours)",
        /** Repli textuel quand trop peu de jours pour un graphique lisible (< 2 jours ou toutes
         * les minutes à 0) — remplace le graphique plutôt qu'un trait quasi-invisible « cassé ». */
        chartEmpty: "Pas encore assez de jours pour afficher un graphique.",
      },
      /** Progression (monde/niveau, créatures débloquées, PLAN §Espace parent). */
      progression: {
        heading: "Progression",
        /** Monde courant (gabarit nombre 1-based). */
        world: "Monde {n}",
        /** Niveaux terminés du monde courant, total au SINGULIER (gabarits complétés/total). */
        levels: "{completed} / {total} niveau",
        /** Niveaux terminés du monde courant, total au PLURIEL (≥2 — cas pratique courant, le
         * monde compte `levelsPerWorld + 1 ≥ 2` niveaux, mais scindé pour la cohérence). */
        levelsPlural: "{completed} / {total} niveaux",
        /** Créatures débloquées, SINGULIER (0 ou 1 — le participe accorde aussi). */
        creatures: "{n} créature débloquée",
        /** Créatures débloquées, PLURIEL (≥2). */
        creaturesPlural: "{n} créatures débloquées",
        /** Repli si le socle de secours n'est pas amorcé (`SocleUnavailableError`, cf. carte 6.7). */
        unavailable: "Progression indisponible pour le moment.",
      },
      /** Lien vers l'écran « Gérer les profils » (story 7.5, DETAILS §3). */
      manageLink: "Gérer les profils",
      /** Lien vers l'écran « Réglages » (story 7.3, DETAILS §3). */
      settingsLink: "Réglages",
      /** Bouton de sortie (✕ du wireframe §7) → révoque la session parent, retour au sélecteur. */
      exit: "Quitter l'espace parent",
    },
    /**
     * Écran **« Gérer les profils »** (story 7.5, DETAILS §3 : renommer / réinitialiser le PIN
     * enfant / supprimer = purge). Registre **neutre/vouvoiement** (COPY §5, pas la voix de Teddy).
     * Le gabarit `{prénom}` est interpolé côté composant. Aucun texte en dur ailleurs.
     */
    manage: {
      /** Titre de l'écran (h1). */
      title: "Gérer les profils",
      /** Consigne neutre sous le titre. */
      intro: "Renommez un profil, réinitialisez son code enfant ou supprimez-le.",
      /** Retour vers le tableau de bord parent. */
      back: "Retour au tableau de bord",
      /** Badge du profil propriétaire (porte l'accès parent). */
      ownerBadge: "Compte parent",
      /** Explication : le compte parent ne peut pas être supprimé (garde OWNER_UNDELETABLE). */
      ownerHint: "Ce profil détient l'accès parent : il ne peut pas être supprimé.",
      /** Libellé accessible d'une carte de profil (gabarit prénom). */
      profileLabel: "Profil de {prénom}",
      /** Renommage d'un profil. */
      rename: {
        /** Bouton ouvrant l'édition du prénom. */
        action: "Renommer",
        /** Libellé du champ (gabarit prénom courant). */
        label: "Nouveau prénom de {prénom}",
        /** Placeholder du champ prénom. */
        placeholder: "Prénom",
        /** Valider le nouveau prénom. */
        save: "Enregistrer",
        /** Annuler l'édition. */
        cancel: "Annuler",
        /** Confirmation neutre après renommage. */
        success: "Profil renommé.",
      },
      /** Réinitialisation du PIN enfant (AUTH §5). */
      resetPin: {
        /** Bouton ouvrant la réinitialisation du code. */
        action: "Réinitialiser le code",
        /** Titre du panneau de réinitialisation (gabarit prénom). */
        title: "Nouveau code de {prénom}",
        /** Consigne : nouveau code à 4 chiffres (gabarit prénom). */
        hint: "Choisissez un nouveau code à 4 chiffres pour {prénom}.",
        /** Libellé accessible du pavé PIN de réinitialisation. */
        label: "Nouveau code enfant",
        /** Valider le nouveau code. */
        save: "Enregistrer le code",
        /** Annuler la réinitialisation. */
        cancel: "Annuler",
        /** Confirmation neutre après réinitialisation. */
        success: "Code enfant réinitialisé.",
      },
      /** Suppression d'un profil = purge (action destructive → confirmation). */
      delete: {
        /** Bouton ouvrant la confirmation de suppression. */
        action: "Supprimer",
        /** Titre de la confirmation (gabarit prénom). */
        confirmTitle: "Supprimer le profil de {prénom} ?",
        /** Corps de la confirmation : purge irréversible (gabarit prénom). */
        confirmBody:
          "Toutes les données de {prénom} (progrès, collection, pièces) seront " +
          "définitivement effacées. Cette action est irréversible.",
        /** Confirmer la suppression définitive. */
        confirm: "Supprimer définitivement",
        /** Annuler la suppression. */
        cancel: "Annuler",
        /** Confirmation neutre après suppression. */
        success: "Profil supprimé.",
      },
      /** Messages d'erreur (mappés depuis `ProfileManagementError` + repli). */
      errors: {
        NAME_INVALID: "Ce prénom n'est pas valide.",
        NAME_TAKEN: "Ce prénom est déjà utilisé.",
        PIN_INVALID: "Le code doit contenir 4 chiffres.",
        PARENT_PIN_SAME: "Le code enfant doit être différent du code parent.",
        PROFILE_NOT_FOUND: "Ce profil est introuvable.",
        OWNER_UNDELETABLE: "Le compte parent ne peut pas être supprimé.",
        UNAUTHORIZED: "Votre session parent a expiré. Reconnectez-vous.",
        GENERIC: "Une erreur est survenue. Réessayez.",
      },
    },
    /**
     * Écran **« Réglages »** (story 7.3, DETAILS §3/§25-32 liste VERROUILLÉE, PRODUCT §1.4,
     * WIREFRAMES §7). Registre **neutre/vouvoiement** (COPY §5, pas la voix de Teddy). Le gabarit
     * `{min}` (minutes) est interpolé côté composant. Aucun texte en dur ailleurs.
     */
    settings: {
      /** Titre de l'écran (h1). */
      title: "Réglages",
      /** Consigne neutre sous le titre. */
      intro: "Personnalisez l'apparence et fixez des limites de temps.",
      /** Retour vers le tableau de bord parent. */
      back: "Retour au tableau de bord",
      /** Confirmation neutre après enregistrement d'un réglage (auto-save). */
      saved: "Réglage enregistré.",
      /** **Thème** (DETAILS §3 « Thème clair/sombre »). */
      theme: {
        /** Légende du groupe (fieldset). */
        legend: "Thème",
        /** Consigne neutre du groupe. */
        hint: "Choisissez l'apparence de l'application.",
        /** Option « système » (suit le réglage de l'appareil, aucune surcharge). */
        system: "Système",
        /** Option « clair » (force le thème clair). */
        light: "Clair",
        /** Option « sombre » (force le thème sombre). */
        dark: "Sombre",
      },
      /** **Validation des mondes** (DETAILS §30, WORLDGEN §6). */
      worlds: {
        /** Légende du groupe. */
        legend: "Validation des mondes",
        /** Consigne neutre : que fait le réglage. */
        hint: "Choisissez si les nouveaux mondes s'affichent automatiquement ou après votre approbation.",
        /** Option « auto » (le monde s'affiche dès qu'il est prêt). */
        auto: "Automatique",
        /** Option « approbation parent » (le monde attend votre validation). */
        parent: "Votre approbation",
      },
      /** **Temps d'écran** (DETAILS §27) — nudge doux + verrou dur optionnel. */
      screenTime: {
        /** Légende du groupe. */
        legend: "Temps d'écran",
        /** Libellé du réglage de pause suggérée (nudge doux). */
        nudgeLabel: "Pause suggérée après",
        /**
         * Consigne du nudge. **Copy « bientôt »** (idiome de `language.hint`) toujours de mise :
         * le réglage est **STOCKÉ seulement** — le nudge doux reste un axe **distinct** du verrou
         * dur (story 7.8 #229 AC 2, « ne pas les coupler ») et son enforcement runtime (bandeau/
         * rappel in-app) n'a **pas** de story planifiée. Ne PAS affirmer un effet actif tant que ce
         * câblage n'existe pas (sinon fausse promesse au parent).
         */
        nudgeHint: "Bientôt : une invitation douce à faire une pause, sans jamais bloquer.",
        /** Libellé accessible d'une durée en minutes (gabarit). */
        minutesOption: "{min} minutes",
        /** Libellé du toggle du verrou dur optionnel. */
        hardLockToggle: "Limite quotidienne",
        /**
         * Consigne du verrou dur. **Texte final** (story 7.8 #229 : enforcement câblé côté jeu
         * enfant — `evaluateScreenTimeLock`, `app/(app)/jouer/actions.ts`) — écho **fidèle**
         * DETAILS §27 (« l'app se verrouille en douceur jusqu'au lendemain »). Remplace le
         * précédent « Bientôt » (7.3, réglage alors seulement stocké, jamais enforcé) : ce
         * réglage AGIT désormais réellement sur le jeu de l'enfant, la copie doit le refléter au
         * présent — un « Bientôt » resté ici après 7.8 mentirait au parent (CLAUDE.md, tell
         * commentaire↔code).
         */
        hardLockHint:
          "Au-delà de cette limite, l'application se verrouille en douceur jusqu'au lendemain.",
        /** Libellé du réglage de seuil du verrou dur. */
        hardLockLabel: "Limite par jour",
      },
      /** **Langue** (FR seule, grisée — DETAILS §5, future i18n). */
      language: {
        /** Légende du groupe. */
        legend: "Langue",
        /** Valeur affichée (français). */
        value: "Français",
        /** Consigne : d'autres langues plus tard (grisé). */
        hint: "D'autres langues arriveront plus tard.",
      },
      /** Messages d'erreur (mappés depuis `SettingsValidationError` + session + repli). */
      errors: {
        THEME_INVALID: "Ce thème n'est pas valide.",
        NUDGE_OUT_OF_RANGE: "Cette durée de pause n'est pas valide.",
        HARD_LOCK_OUT_OF_RANGE: "Cette limite quotidienne n'est pas valide.",
        UNAUTHORIZED: "Votre session parent a expiré. Reconnectez-vous.",
        GENERIC: "Une erreur est survenue. Réessayez.",
      },
    },
  },
  /**
   * **Copy du générateur de mondes** (WORLDGEN §4, story 6.3, épic #6). Banques de **noms
   * par défaut** et d'**histoires** (beats courts, COPY §4) piochées **déterministe** par seed
   * lors de la génération d'une créature **non légendaire** (commune/rare) — la légendaire garde
   * ses propres banques (`collection.legendaryNames`/`legendaryStories`, MAP §6). Voix douce et
   * mignonne (COPY §5 « noms par défaut mignons ») ; l'enfant peut renommer (PRODUCT §2.3).
   *
   * Séparées de `collection` (qui porte les **légendaires**) : ces banques peuplent les
   * **6-8 créatures/monde** (ECONOMY §5) — plus de noms/histoires pour éviter les collisions
   * dans un même monde (sélection sans réutilisation, cf. `generate-world.ts`).
   */
  worldgen: {
    /**
     * **Noms par défaut** des créatures non légendaires (voix douce, COPY §5). Assez pour
     * peupler jusqu'à 7 créatures/monde (6-8 − 1 légendaire) sans réutiliser un nom dans le
     * même monde. Piochés **déterministe** par seed → même monde ⇒ mêmes noms.
     */
    creatureNames: [
      "Bulle",
      "Câlin",
      "Pompon",
      "Guimauve",
      "Praline",
      "Nougat",
      "Pistache",
      "Coquillette",
      "Myrtille",
      "Réglisse",
      "Framboise",
      "Chamallow",
      "Croquette",
      "Berlingot",
      "Caramel",
      "Noisette",
    ],
    /**
     * **Histoires** par défaut des créatures non légendaires (1 phrase mignonne, beats courts
     * COPY §4). Voix de Teddy, tutoiement, posture croissance. Piochées **déterministe** par
     * seed (même banque, index dérivé) → même monde ⇒ mêmes histoires.
     */
    creatureStories: [
      "Un petit copain tout rond qui adore les câlins — Teddy dit qu'il ronronne comme un pot de miel.",
      "Timide au début, mais dès qu'il te connaît, il ne te lâche plus d'une semelle.",
      "Il collectionne les jolis cailloux brillants et t'en offre un quand tu réussis.",
      "Toujours de bonne humeur, il fait des galipettes pour te faire rire.",
      "Il dormait bien caché dans ce monde en t'attendant, toi précisément.",
      "Un cœur gros comme ça : il partage tout, même son goûter préféré.",
      "Curieux de tout, il te suit partout pour découvrir de nouvelles aventures.",
      "Un vrai petit soleil — quand il sourit, tout le monde sourit avec lui.",
    ],
  },
} as const;

export type Strings = typeof fr;
