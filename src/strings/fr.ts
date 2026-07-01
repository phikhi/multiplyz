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
    /** Étape 4 — code de secours (affiché une seule fois, registre neutre). */
    recovery: {
      title: "Note ce code de secours",
      intro:
        "Il permet de réinitialiser le code parent s'il est oublié. On ne l'affiche qu'une seule fois — note-le maintenant.",
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
   * Écran de jeu (placeholder protégé #2.3 — l'écran réel arrive épic #3+). Voix
   * de Teddy. Accessible uniquement avec une session enfant valide.
   */
  play: {
    /** Accueil après connexion réussie. */
    greeting: "Te voilà ! Ton aventure arrive très bientôt 🎉",
    /** Déconnexion (formulé pour un enfant : « changer de joueur »). */
    logout: "Changer de joueur",
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
} as const;

export type Strings = typeof fr;
