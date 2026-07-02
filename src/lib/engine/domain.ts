/**
 * Bornes de domaine du moteur math (ENGINE.md §1 — Univers des faits, Tier 1 v1).
 *
 * Source **unique** des paramètres ⚙️ qui cadrent la génération des faits : aucune
 * valeur en dur éparpillée dans `facts.ts`. Ces bornes sont des **réglages de
 * playtest** (marqués ⚙️ dans ENGINE) — les centraliser ici permet de les ajuster
 * sans toucher à la logique de génération.
 *
 * Périmètre = **Tier 1 uniquement** (ENGINE §1). L'échelle Tier 2/3 (add/sous dans
 * 100, mult 2 chiffres, ENGINE §8) reste **hors story** : on laisse la porte ouverte
 * (chaque compétence a ses bornes explicites) sans l'implémenter.
 */

/** Les 4 compétences du moteur (ENGINE §1). `comp10` = compléments à 10. */
export type Skill = "comp10" | "add" | "sub" | "mult";

/**
 * Toutes les compétences, dans l'ordre canonique du contrat (ENGINE §1). Sert de
 * source unique pour itérer sur l'univers complet des faits sans les oublier.
 */
export const SKILLS: readonly Skill[] = ["comp10", "add", "sub", "mult"] as const;

/**
 * Cible des compléments à 10 (ENGINE §1 : `a + ? = 10`). Fixe le total des
 * compléments : `réponse = COMP10_TARGET − a`.
 */
export const COMP10_TARGET = 10;

/**
 * Bornes ⚙️ de la génération Tier 1, par compétence (ENGINE §1).
 *
 * - `comp10` : `a + ? = 10`, `a ∈ 1..9` → ~9 faits (a=0 et a=10 exclus : le
 *   complément serait 10 ou 0, sans intérêt pédagogique).
 * - `add` : `a + b`, `a,b ∈ 1..10`, somme `≤ 20` (v1 « dans 20 », ENGINE §0/§8) →
 *   ~55 faits une fois la clé canonique triée dédoublonnée.
 * - `sub` : `a − b`, minuende `a ∈ 1..SUB_MAX_MINUEND`, `b ∈ 1..a` (résultat ≥ 0,
 *   pas de soustraction triviale par 0). `SUB_MAX_MINUEND` est la borne ⚙️ « a ≤ 20 »
 *   d'ENGINE §1 — le v1 reste « dans 20 ».
 * - `mult` : `a × b`, `a,b ∈ 1..10` → ~55 faits une fois la clé triée dédoublonnée.
 */
export const DOMAIN = {
  comp10: {
    /** Plus petit opérande `a` (a=0 exclu : complément = 10, trivial). */
    minOperand: 1,
    /** Plus grand opérande `a` (a=10 exclu : complément = 0, trivial). */
    maxOperand: 9,
  },
  add: {
    /** Plus petit opérande (a,b ≥ 1 : pas d'addition avec 0). */
    minOperand: 1,
    /** Plus grand opérande (a,b ≤ 10). */
    maxOperand: 10,
    /** Somme maximale admise (v1 « dans 20 », ENGINE §0/§8). */
    maxSum: 20,
  },
  sub: {
    /** Plus petite minuende `a` (a ≥ 1). */
    minMinuend: 1,
    /** Plus grande minuende `a` — borne ⚙️ « a ≤ 20 » (ENGINE §1, v1 « dans 20 »). */
    maxMinuend: 20,
    /** Plus petit subtrahende `b` (b ≥ 1 : pas de soustraction par 0). */
    minSubtrahend: 1,
  },
  mult: {
    /** Plus petit opérande (a,b ≥ 1 : pas de multiplication par 0). */
    minOperand: 1,
    /** Plus grand opérande (a,b ≤ 10). */
    maxOperand: 10,
  },
} as const;
