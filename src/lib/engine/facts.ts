/**
 * Univers des faits — fondation pure du moteur math (ENGINE.md §1).
 *
 * Un **fact** = 1 calcul atomique identifié par une **clé stable canonique**. C'est
 * le vocabulaire dont tout le reste du moteur dépend (maîtrise, composition de
 * niveau, distracteurs) : aucune I/O, aucune UI, 100 % déterministe et testable.
 *
 * **Clé canonique** (ENGINE §1) :
 * - commutatif (`add`, `mult`) → opérandes **triés croissant** dans la clé, donc
 *   `(3,8)` et `(8,3)` donnent la **même** clé (`add_3+8`, `mult_6x8`) ;
 * - non-commutatif (`sub`, `comp10`) → ordre **naturel** conservé (`sub_15-6`) ;
 *   `comp10` n'a qu'un opérande (`comp10_3` = « a=3, complément à 10 »).
 *
 * La **réponse correcte** est calculée à la construction du fact (comp10 =
 * complément à 10 ; add = a+b ; sub = a−b ; mult = a×b).
 */

import { COMP10_TARGET, DOMAIN, SKILLS, type Skill } from "./domain";

export type { Skill };

/**
 * Un fait atomique. `operands` porte 1 valeur pour `comp10` (l'opérande `a`) et 2
 * pour les autres compétences, déjà **canonisées** (triées pour les commutatifs).
 */
export interface Fact {
  /** Clé stable canonique (ex. `add_3+8`, `mult_6x8`, `sub_15-6`, `comp10_3`). */
  readonly key: string;
  /** Compétence du fait (ENGINE §1). */
  readonly skill: Skill;
  /** Opérandes canonisés : `[a]` pour `comp10`, `[a, b]` sinon. */
  readonly operands: readonly number[];
  /** Réponse correcte, calculée selon la compétence. */
  readonly answer: number;
}

/** Séparateur clé `<skill>_<opérandes>` (préfixe de compétence stable). */
const SKILL_SEP = "_";

/**
 * Symbole d'opérateur par compétence, utilisé pour **assembler** et **parser** la
 * partie opérandes de la clé. `comp10` n'a pas d'opérateur binaire (un seul
 * opérande) → chaîne vide, traité à part.
 */
const OPERATOR: Record<Skill, string> = {
  comp10: "",
  add: "+",
  sub: "-",
  mult: "x",
};

/** `true` si la chaîne est l'un des préfixes de compétence connus. */
function isSkill(value: string): value is Skill {
  return (SKILLS as readonly string[]).includes(value);
}

/**
 * Calcule la réponse correcte d'un fait (ENGINE §1). Fonction totale sur les 4
 * compétences (le type `Skill` garantit l'exhaustivité).
 */
function computeAnswer(skill: Skill, a: number, b: number): number {
  switch (skill) {
    case "comp10":
      return COMP10_TARGET - a;
    case "add":
      return a + b;
    case "sub":
      return a - b;
    case "mult":
      return a * b;
  }
}

/**
 * Ordonne deux opérandes selon la commutativité de la compétence : croissant pour
 * les commutatifs (`add`, `mult`) → clé canonique unique quel que soit l'ordre
 * d'entrée ; ordre naturel `[a, b]` sinon (`sub`, `comp10`).
 */
function canonicalOperands(skill: Skill, a: number, b: number): [number, number] {
  const commutative = skill === "add" || skill === "mult";
  // Pour les commutatifs on trie ; sinon on préserve l'ordre saisi.
  return commutative && a > b ? [b, a] : [a, b];
}

/**
 * Construit la **clé canonique** d'un fait (ENGINE §1).
 *
 * @param skill compétence
 * @param a premier opérande (l'unique opérande pour `comp10`)
 * @param b second opérande (**ignoré** pour `comp10` — un seul opérande) ; requis
 *   pour les compétences binaires.
 */
export function factKey(skill: Skill, a: number, b: number): string {
  if (skill === "comp10") {
    // Un seul opérande : `comp10_<a>` (pas d'opérateur binaire).
    return `${skill}${SKILL_SEP}${a}`;
  }
  const [x, y] = canonicalOperands(skill, a, b);
  return `${skill}${SKILL_SEP}${x}${OPERATOR[skill]}${y}`;
}

/**
 * Construit un `Fact` complet (clé canonique + opérandes canonisés + réponse) à
 * partir d'une compétence et de ses opérandes bruts.
 */
export function makeFact(skill: Skill, a: number, b: number): Fact {
  if (skill === "comp10") {
    return {
      key: factKey(skill, a, b),
      skill,
      operands: [a],
      answer: computeAnswer(skill, a, b),
    };
  }
  const [x, y] = canonicalOperands(skill, a, b);
  return {
    key: factKey(skill, x, y),
    skill,
    operands: [x, y],
    answer: computeAnswer(skill, x, y),
  };
}

/** Motif d'un entier non signé (opérande). Rejette signe, décimale, vide. */
const UINT = /^\d+$/;

/**
 * Parse une chaîne d'entier non signé strict → `number`, ou `null` si invalide. Le
 * motif rejette signe/décimale/vide ; `Number.isSafeInteger` rejette en plus les
 * entiers > 2^53 qui perdraient en précision et **corrompraient silencieusement le
 * round-trip** (ex. `comp10_9007199254741000`).
 */
function parseUint(raw: string): number | null {
  if (!UINT.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * `true` si les opérandes **canonisés** d'un fait tombent dans les bornes Tier 1
 * d'ENGINE §1 (`DOMAIN[skill]`). Source **unique** des bornes de domaine, partagée
 * par la génération (`generate*`) et la désérialisation (`parseFactKey`) → aucune
 * divergence possible entre « ce qu'on génère » et « ce qu'on accepte à la relecture ».
 *
 * On suppose des opérandes déjà canoniques : `[a]` pour `comp10`, `[a, b]` **triés**
 * pour les commutatifs, ordre naturel pour `sub`. Fonction totale sur les 4 compétences.
 */
function isFactInDomain(skill: Skill, operands: readonly number[]): boolean {
  switch (skill) {
    case "comp10": {
      const [a] = operands;
      return a >= DOMAIN.comp10.minOperand && a <= DOMAIN.comp10.maxOperand;
    }
    case "add": {
      const [a, b] = operands;
      // a ≤ b garanti par la canonisation. Ordre des tests choisi pour que chaque
      // côté de chaque `&&` soit atteignable via `parseFactKey` (pas de branche
      // morte sous gate 100 %) : borne min de a, puis cap de somme (faux dès qu'un
      // opérande est grand, ex. `add_1+30`), puis borne max de b (faux avec somme
      // OK, ex. `add_2+11`).
      return a >= DOMAIN.add.minOperand && a + b <= DOMAIN.add.maxSum && b <= DOMAIN.add.maxOperand;
    }
    case "sub": {
      const [a, b] = operands;
      // Ordre naturel : minuende bornée, subtrahende ∈ [min..a] (résultat ≥ 0).
      return (
        a >= DOMAIN.sub.minMinuend &&
        a <= DOMAIN.sub.maxMinuend &&
        b >= DOMAIN.sub.minSubtrahend &&
        b <= a
      );
    }
    case "mult": {
      const [a, b] = operands;
      // a ≤ b garanti par la canonisation → borner a (min) et b (max).
      return a >= DOMAIN.mult.minOperand && b <= DOMAIN.mult.maxOperand;
    }
  }
}

/**
 * Reconstruit + **valide** un `Fact` candidat : on rejette (→ `null`) sauf si (a) sa
 * clé re-générée est **identique** à l'entrée (canonicité stricte : forme, absence de
 * zéros de tête, tri des commutatifs) ET (b) ses opérandes tombent dans les bornes
 * Tier 1 (`isFactInDomain`). Garantit `parseFactKey(factKey(...))` bijectif et rejette
 * toute clé hors-domaine relue de la DB (ENGINE §10).
 */
function acceptFact(fact: Fact, key: string): Fact | null {
  return fact.key === key && isFactInDomain(fact.skill, fact.operands) ? fact : null;
}

/**
 * Reconstruit un `Fact` depuis sa clé canonique. **Robuste** : toute clé invalide
 * (préfixe inconnu, opérateur absent, opérande non numérique/non sûr, opérandes non
 * canoniques, **hors bornes Tier 1**) renvoie `null` de façon **déterministe** —
 * jamais d'exception non typée. Le contrôle canonicité + domaine garantit que la clé
 * relue est un vrai fait Tier 1 : `attempts.fact_id`/`mastery.fact_id` (ENGINE §10)
 * ne peuvent pas ressusciter une clé corrompue (`comp10_007`, `comp10_999`) ou
 * hors-domaine (`sub_3-15`, `mult_0x5`) en réponse absurde.
 */
export function parseFactKey(key: string): Fact | null {
  const sepIndex = key.indexOf(SKILL_SEP);
  // Pas de séparateur → clé sans partie opérandes, malformée.
  if (sepIndex === -1) {
    return null;
  }
  const prefix = key.slice(0, sepIndex);
  const rest = key.slice(sepIndex + 1);
  if (!isSkill(prefix)) {
    return null;
  }

  if (prefix === "comp10") {
    const a = parseUint(rest);
    // Opérande absent/non numérique → clé invalide ; sinon même garde
    // canonicité+domaine que les binaires (rejette `comp10_007`, `comp10_999`).
    return a === null ? null : acceptFact(makeFact(prefix, a, 0), key);
  }

  const parts = rest.split(OPERATOR[prefix]);
  // Une clé binaire a exactement 2 opérandes autour de l'opérateur.
  if (parts.length !== 2) {
    return null;
  }
  const a = parseUint(parts[0]);
  const b = parseUint(parts[1]);
  if (a === null || b === null) {
    return null;
  }
  return acceptFact(makeFact(prefix, a, b), key);
}

/**
 * Retient un fait candidat dans l'univers **uniquement** s'il est dans le domaine
 * Tier 1 (`isFactInDomain`) — même prédicat que `parseFactKey`, donc génération et
 * relecture ne peuvent pas diverger.
 */
function pushIfInDomain(facts: Fact[], skill: Skill, a: number, b: number): void {
  const fact = makeFact(skill, a, b);
  if (isFactInDomain(fact.skill, fact.operands)) {
    facts.push(fact);
  }
}

/** Génère l'univers `comp10` Tier 1 : `a + ? = 10`, `a ∈ 1..9` (ENGINE §1, ~9). */
function generateComp10(): Fact[] {
  const facts: Fact[] = [];
  for (let a = DOMAIN.comp10.minOperand; a <= DOMAIN.comp10.maxOperand; a++) {
    pushIfInDomain(facts, "comp10", a, 0);
  }
  return facts;
}

/**
 * Génère l'univers `add` Tier 1 : `a + b`, `a,b ∈ 1..10`, somme `≤ 20` (ENGINE §1).
 * `b` part de `a` (paires triées) → aucun doublon de clé canonique dès la source ; le
 * cap de somme (v1 « dans 20 ») est appliqué par `isFactInDomain`.
 */
function generateAdd(): Fact[] {
  const facts: Fact[] = [];
  const { minOperand, maxOperand } = DOMAIN.add;
  for (let a = minOperand; a <= maxOperand; a++) {
    for (let b = a; b <= maxOperand; b++) {
      pushIfInDomain(facts, "add", a, b);
    }
  }
  return facts;
}

/**
 * Génère l'univers `sub` Tier 1 : `a − b`, minuende `a ∈ 1..maxMinuend`, `b ∈ 1..a`
 * (résultat ≥ 0). Non-commutatif → ordre naturel, pas de dédoublonnage nécessaire ;
 * la contrainte `b ≤ a` est appliquée par `isFactInDomain`.
 */
function generateSub(): Fact[] {
  const facts: Fact[] = [];
  const { minMinuend, maxMinuend, minSubtrahend } = DOMAIN.sub;
  for (let a = minMinuend; a <= maxMinuend; a++) {
    for (let b = minSubtrahend; b <= a; b++) {
      pushIfInDomain(facts, "sub", a, b);
    }
  }
  return facts;
}

/**
 * Génère l'univers `mult` Tier 1 : `a × b`, `a,b ∈ 1..10` (ENGINE §1, ~55).
 * `b` part de `a` (paires triées) → aucun doublon de clé canonique dès la source.
 */
function generateMult(): Fact[] {
  const facts: Fact[] = [];
  const { minOperand, maxOperand } = DOMAIN.mult;
  for (let a = minOperand; a <= maxOperand; a++) {
    for (let b = a; b <= maxOperand; b++) {
      pushIfInDomain(facts, "mult", a, b);
    }
  }
  return facts;
}

/**
 * Génère l'univers Tier 1 d'**une** compétence (ENGINE §1). Fonction totale sur les
 * 4 compétences (exhaustivité garantie par le type `Skill`).
 */
export function generateFacts(skill: Skill): Fact[] {
  switch (skill) {
    case "comp10":
      return generateComp10();
    case "add":
      return generateAdd();
    case "sub":
      return generateSub();
    case "mult":
      return generateMult();
  }
}

/**
 * Génère l'univers Tier 1 **complet** (toutes compétences concaténées). Chaque clé
 * est unique par construction (paires triées côté commutatifs, ordre naturel sinon,
 * préfixe de compétence distinct).
 */
export function generateAllFacts(): Fact[] {
  return SKILLS.flatMap((skill) => generateFacts(skill));
}
