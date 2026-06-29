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
} as const;

export type Strings = typeof fr;
