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

/** Parse une chaîne d'entier non signé strict → `number`, ou `null` si invalide. */
function parseUint(raw: string): number | null {
  return UINT.test(raw) ? Number(raw) : null;
}

/**
 * Reconstruit un `Fact` depuis sa clé canonique. **Robuste** : toute clé malformée
 * (préfixe inconnu, opérateur absent, opérande non numérique, opérandes non
 * canoniques…) renvoie `null` de façon **déterministe** — jamais d'exception non
 * typée. Le contrôle de canonicité garantit que `parseFactKey(factKey(...))` est un
 * aller-retour fidèle et qu'une clé « équivalente non triée » (`add_8+3`) est rejetée.
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
    // Opérande absent/non numérique → clé invalide.
    return a === null ? null : makeFact(prefix, a, 0);
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
  // Canonicité : la clé re-générée depuis (a, b) doit être identique à l'entrée —
  // rejette une clé commutative non triée (`add_8+3`) et toute variante non
  // canonique, garantissant une clé ↔ fait bijective.
  const fact = makeFact(prefix, a, b);
  return fact.key === key ? fact : null;
}

/** Génère l'univers `comp10` Tier 1 : `a + ? = 10`, `a ∈ 1..9` (ENGINE §1, ~9). */
function generateComp10(): Fact[] {
  const facts: Fact[] = [];
  for (let a = DOMAIN.comp10.minOperand; a <= DOMAIN.comp10.maxOperand; a++) {
    facts.push(makeFact("comp10", a, 0));
  }
  return facts;
}

/**
 * Génère l'univers `add` Tier 1 : `a + b`, `a,b ∈ 1..10`, somme `≤ 20` (ENGINE §1).
 * `b` part de `a` (paires triées) → aucun doublon de clé canonique dès la source.
 */
function generateAdd(): Fact[] {
  const facts: Fact[] = [];
  const { minOperand, maxOperand, maxSum } = DOMAIN.add;
  for (let a = minOperand; a <= maxOperand; a++) {
    for (let b = a; b <= maxOperand; b++) {
      // Cap de somme (v1 « dans 20 ») : on saute les paires trop grandes.
      if (a + b <= maxSum) {
        facts.push(makeFact("add", a, b));
      }
    }
  }
  return facts;
}

/**
 * Génère l'univers `sub` Tier 1 : `a − b`, minuende `a ∈ 1..maxMinuend`, `b ∈ 1..a`
 * (résultat ≥ 0). Non-commutatif → ordre naturel, pas de dédoublonnage nécessaire.
 */
function generateSub(): Fact[] {
  const facts: Fact[] = [];
  const { minMinuend, maxMinuend, minSubtrahend } = DOMAIN.sub;
  for (let a = minMinuend; a <= maxMinuend; a++) {
    for (let b = minSubtrahend; b <= a; b++) {
      facts.push(makeFact("sub", a, b));
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
      facts.push(makeFact("mult", a, b));
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
