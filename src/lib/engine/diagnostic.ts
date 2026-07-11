/**
 * Diagnostic de départ — amorçage du profil (ENGINE.md §3).
 *
 * À la première ouverture, on pose **~18 calculs déguisés** (« on prépare ta
 * carte ! », **aucun score**) pour situer l'enfant sans l'enfoncer, puis on **amorce
 * les boîtes Leitner** de sa maîtrise à partir de ses réponses. Ce module est **pur**
 * et **déterministe** :
 * - aucune I/O, aucune UI, aucun accès DB / réseau — l'appelant serveur (3.7) pose les
 *   questions renvoyées puis persiste les lignes de maîtrise amorcées ;
 * - **horloge injectée** (`now`, epoch ms) — jamais de `Date.now()` interne (LEARNINGS :
 *   tout comportement temporel se teste avec une horloge injectée) ;
 * - **faits issus du domaine canonique** (`generateFacts`, `facts.ts`/`domain.ts`) — on
 *   ne réinvente **aucune** génération de faits (tous Tier 1 valides par construction) ;
 * - **classement rapide/lent + délais** réutilisent le modèle de maîtrise 3.3
 *   (`isFluent`, `boxDelayMs` de `mastery.ts`) — pas de second barème réinventé ;
 * - toutes les valeurs ⚙️ (taille du diagnostic, seuils adaptatifs) proviennent de la
 *   **config moteur** (3.2, `EngineConfig`) ou de constantes ⚙️ locales commentées.
 *
 * **Séparation nette** (contrat §3) :
 * 1. `selectDiagnostic(config)` — la **liste ordonnée** des ~18 faits à poser, ~4–5 par
 *    compétence, représentatifs des 3 niveaux de difficulté (facile / moyen / difficile) ;
 * 2. `adaptDiagnostic(items, responses, config)` — **adaptatif léger** : au vu des
 *    réponses aux premiers faits d'une compétence, on **n'enfonce pas** (retire les plus
 *    durs si les premiers sont tous ratés) ou on **sonde 1–2 plus durs** (si tous
 *    justes + rapides) ;
 * 3. `seedDiagnosticMastery(responses, config, now)` — **amorçage des boîtes** : chaque
 *    fait répondu produit une ligne de maîtrise (juste + rapide → box 3 ; juste + lent →
 *    box 2 ; faux → box 0) ; un fait **non testé** ne produit **aucune ligne** (nouveau).
 */

import type { EngineConfig } from "../../config/server-config";
import { SKILLS, type Skill } from "./domain";
import { generateFacts, type Fact } from "./facts";
import { boxDelayMs, isFluent, type Attempt, type MasteryState } from "./mastery";

/** Les 3 niveaux de difficulté d'un fait dans le diagnostic (ENGINE §3). */
export type Difficulty = "easy" | "medium" | "hard";

/**
 * Ordre canonique des niveaux, du plus facile au plus dur. Sert à **ordonner** les
 * faits d'une compétence (facile d'abord) et à repérer les « plus durs » pour
 * l'adaptatif. Ordre stable et déterministe.
 */
const DIFFICULTY_ORDER: readonly Difficulty[] = ["easy", "medium", "hard"] as const;

/**
 * Un fait à poser au diagnostic : le fait (issu du domaine canonique) + le **niveau de
 * difficulté** qu'il représente. `selectDiagnostic` renvoie une liste ordonnée de ces
 * items (par compétence, facile → dur).
 */
export interface DiagnosticItem {
  /** Le fait à poser (Tier 1 valide par construction). */
  readonly fact: Fact;
  /** Niveau de difficulté représenté (ENGINE §3 : facile / moyen / difficile). */
  readonly difficulty: Difficulty;
}

/**
 * Une **réponse** de l'enfant à un fait du diagnostic. Réutilise la forme `Attempt` du
 * modèle de maîtrise (compétence + juste/faux + `response_ms`) et ajoute la **clé du
 * fait** répondu (pour amorcer la bonne ligne) ; `isRetry` n'a pas de sens ici (les
 * réponses du diagnostic sont toutes des 1ʳᵉˢ réponses comptées).
 */
export interface DiagnosticResponse {
  /** Clé canonique du fait répondu (ex. `mult_6x8`). */
  readonly factKey: string;
  /** Compétence du fait — indexe le seuil de fluence (ENGINE §2). */
  readonly skill: Skill;
  /** Réponse juste ? (« je ne sais pas » = `false`). */
  readonly correct: boolean;
  /** Temps de réponse (ms), de l'affichage à la réponse. */
  readonly responseMs: number;
}

/**
 * Une ligne de maîtrise **amorcée** par le diagnostic : la clé du fait + son état de
 * maîtrise initial (boîte / échéance / compteurs). Miroir pur d'une ligne `mastery`
 * (3.2) que l'appelant serveur persiste. On ne renvoie **que** les faits testés (un
 * fait non testé n'a **pas** de ligne — ENGINE §3 : « nouveau »).
 */
export interface SeededMastery {
  /** Clé canonique du fait amorcé. */
  readonly factKey: string;
  /** État de maîtrise initial (boîte Leitner amorcée + échéance dérivée). */
  readonly state: MasteryState;
}

/**
 * ⚙️ **calibrable** — répartition cible du diagnostic par compétence (ENGINE §3 :
 * « ~4–5 par compétence »). On vise `PER_SKILL_TARGET` faits par compétence ; la
 * `diagnosticSize` de la config (~18) plafonne le total. Défaut **spec-littéral** :
 * `18 / 4 = 4,5` → on prend le plancher `4` comme cible de base et on **répartit le
 * reste** (`18 − 4×4 = 2`) sur les premières compétences → `[5, 5, 4, 4]` (comp10, add
 * = 5 ; sub, mult = 4), soit ~4–5 par compétence, total 18. Vit ici (détail de
 * composition du diagnostic) et non dans `EngineConfig` : à migrer si une story veut le
 * calibrer indépendamment de `diagnosticSize`. Cf. issue `discovered` si rééquilibrage.
 */
export const PER_SKILL_TARGET = 4;

/**
 * ⚙️ **calibrable** — nombre de premiers faits d'une compétence observés par
 * l'adaptatif (ENGINE §3 : « **si les premiers** d'une compétence sont tous ratés / tous
 * justes+rapides »). Défaut `2` (les 2 plus faciles). En dessous de ce nombre de faits
 * testés, l'adaptatif ne se déclenche pas (échantillon insuffisant).
 */
export const ADAPTIVE_PROBE_COUNT = 2;

/**
 * ⚙️ **calibrable** — nombre de faits **plus durs** ajoutés quand les premiers d'une
 * compétence sont tous justes + rapides (ENGINE §3 : « on sonde **1–2 plus durs** »).
 * Défaut `1` (sonde parcimonieuse). Borné par le nombre de faits durs disponibles.
 */
export const ADAPTIVE_DEEPEN_COUNT = 1;

/** Boîte amorcée d'un fait **juste + rapide** au diagnostic (ENGINE §3). */
export const SEED_BOX_FLUENT = 3;
/** Boîte amorcée d'un fait **juste mais lent** au diagnostic (ENGINE §3). */
export const SEED_BOX_SLOW = 2;
/** Boîte amorcée d'un fait **faux / « je ne sais pas »** au diagnostic (ENGINE §3). */
export const SEED_BOX_WRONG = 0;

/**
 * **Score de difficulté** d'un fait, proxy déterministe pour le classer en tiers
 * facile / moyen / difficile (ENGINE §3 : facts « représentatifs » des 3 niveaux).
 * Fonction **totale** sur les 4 compétences (exhaustivité garantie par `Skill`). Le
 * score est une valeur numérique croissante avec la difficulté ressentie chez une
 * enfant CE1→CE2 :
 * - `comp10` (`a + ? = 10`) : plus `a` est loin de 5 (le pivot mémorisé le plus tôt),
 *   plus le complément est dur à retrouver → `|a − 5|` ; tie-break `a` pour un ordre total ;
 * - `add` (`a + b`) : la **somme** (magnitude) domine ; un **passage de la dizaine**
 *   (`a + b > 10` alors qu'aucun opérande ne l'atteint) ajoute une difficulté de retenue ;
 * - `sub` (`a − b`) : la **minuende** (magnitude) domine ; un **emprunt** (`a` a une unité
 *   `< b`, dizaine franchie) ajoute une difficulté ;
 * - `mult` (`a × b`) : le **produit** domine (tables hautes = lacunes visées, ENGINE §1).
 *
 * On suppose des opérandes **canoniques** (triés pour les commutatifs) — cf. `facts.ts`.
 */
function difficultyScore(fact: Fact): number {
  switch (fact.skill) {
    case "comp10": {
      const [a] = fact.operands;
      // Distance au pivot 5 : `a=5` (comp = 5) le plus facile, `a=1`/`a=9` les plus durs.
      // Tie-break `a/10` (< 1) pour départager `|a−5|` égaux (ex. a=4 vs a=6) → ordre total.
      return Math.abs(a - 5) + a / 10;
    }
    case "add": {
      const [a, b] = fact.operands;
      // Magnitude (somme) + bonus de retenue si la dizaine est franchie par l'addition
      // (aucun opérande ne vaut déjà 10 mais la somme dépasse 10).
      const carry = a < 10 && b < 10 && a + b > 10 ? 1 : 0;
      return a + b + carry;
    }
    case "sub": {
      const [a, b] = fact.operands;
      // Magnitude (minuende) + bonus d'emprunt si l'unité de la minuende est < subtrahende
      // (emprunt sur la dizaine) — vrai marqueur de difficulté CE1 (ex. 12−5, 15−7).
      const borrow = a % 10 < b ? 1 : 0;
      return a + borrow;
    }
    case "mult": {
      const [a, b] = fact.operands;
      // Produit : tables hautes (7×8, 9×6…) = les lacunes visées (ENGINE §1).
      return a * b;
    }
  }
}

/**
 * Classe les faits d'**une** compétence en 3 **tiers de difficulté** de tailles quasi
 * égales (terciles par score croissant). Renvoie exactement 3 listes ordonnées
 * `[easy, medium, hard]`, du plus facile au plus dur, chacune triée par score puis par
 * clé (tie-break total → déterministe). Une compétence à moins de 3 faits laisse
 * certains tiers **vides** (cas dégénéré borné défensivement, jamais d'accès hors liste).
 */
function tiersFor(skill: Skill): Record<Difficulty, Fact[]> {
  const facts = [...generateFacts(skill)].sort((a, b) => {
    const sa = difficultyScore(a);
    const sb = difficultyScore(b);
    // Score croissant (facile d'abord) ; tie-break clé canonique pour un ordre total
    // (deux faits distincts ont des clés distinctes → pas de branche d'égalité morte).
    return sa !== sb ? sa - sb : a.key < b.key ? -1 : 1;
  });
  const n = facts.length;
  // Bornes de terciles : easy = [0, third), medium = [third, 2·third), hard = [2·third, n).
  // `Math.floor(n/3)` répartit le reste vers le tier `hard` (le plus grand des trois).
  const third = Math.floor(n / 3);
  return {
    easy: facts.slice(0, third),
    medium: facts.slice(third, 2 * third),
    hard: facts.slice(2 * third),
  };
}

/**
 * Choisit `target` faits **représentatifs** des 3 tiers de difficulté d'une compétence
 * (ENGINE §3 : facts représentatifs facile/moyen/difficile). On **répartit** la cible
 * sur les 3 tiers en tourniquet (easy → medium → hard → easy…) pour couvrir chaque
 * niveau, en prenant dans chaque tier le fait le plus **central** encore disponible
 * (représentatif du tier, pas son bord). Renvoie des `DiagnosticItem` ordonnés
 * **facile → dur** (l'ordre de pose du diagnostic, §3). Déterministe.
 */
function selectForSkill(skill: Skill, target: number): DiagnosticItem[] {
  const tiers = tiersFor(skill);
  // Curseurs de prise **centrale** par tier : on prend au milieu puis on s'écarte, pour
  // un fait représentatif (ni le plus facile ni le plus dur du tier). File d'indices
  // pré-calculée depuis le centre → déterministe, aucune mutation de `tiers`.
  const order: Record<Difficulty, number[]> = {
    easy: centralOrder(tiers.easy.length),
    medium: centralOrder(tiers.medium.length),
    hard: centralOrder(tiers.hard.length),
  };
  const cursor: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };

  const picked: DiagnosticItem[] = [];
  // Tourniquet sur les 3 tiers : on tourne tant qu'on n'a pas la cible ET qu'au moins
  // un tier a encore un fait à donner. `guard` majore les tours (3 tiers × cible) → pas
  // de boucle infinie même si tous les tiers se vident avant la cible (compétence rare).
  let guard = 0;
  const maxRounds = target * DIFFICULTY_ORDER.length;
  while (picked.length < target && guard < maxRounds) {
    const difficulty = DIFFICULTY_ORDER[guard % DIFFICULTY_ORDER.length];
    const tier = tiers[difficulty];
    const idxQueue = order[difficulty];
    if (cursor[difficulty] < idxQueue.length) {
      const factIndex = idxQueue[cursor[difficulty]];
      cursor[difficulty] += 1;
      picked.push({ fact: tier[factIndex], difficulty });
    }
    guard += 1;
  }

  // Ordonner facile → dur (ordre de pose §3) ; tie-break clé pour un ordre total stable.
  return picked.sort((a, b) => {
    const da = DIFFICULTY_ORDER.indexOf(a.difficulty);
    const db = DIFFICULTY_ORDER.indexOf(b.difficulty);
    return da !== db ? da - db : a.fact.key < b.fact.key ? -1 : 1;
  });
}

/**
 * Ordre de prise **central-d'abord** des indices `0..length−1` : centre, puis un pas à
 * droite, un pas à gauche, en s'écartant. Ex. `length=5` → `[2, 3, 1, 4, 0]`. Sert à
 * prendre le fait **représentatif** (central) d'un tier avant ses bords. `length=0` →
 * liste vide (tier vide, cas dégénéré). Déterministe, pur.
 */
function centralOrder(length: number): number[] {
  const indices: number[] = [];
  const mid = Math.floor(length / 2);
  // Alterne autour du centre : offset 0 (centre), +1, −1, +2, −2… en restant dans [0, length).
  for (let offset = 0; indices.length < length; offset++) {
    const right = mid + offset;
    const left = mid - offset;
    if (offset === 0) {
      indices.push(mid);
    } else {
      // Droite d'abord (le centre penche vers le haut du tier), puis gauche. Chaque côté
      // n'est ajouté que s'il tombe dans les bornes → jamais deux fois le même indice.
      if (right < length) indices.push(right);
      if (left >= 0) indices.push(left);
    }
  }
  return indices;
}

/**
 * Répartition **par compétence** de la taille du diagnostic (⚙️ ~18, ENGINE §3). Vise
 * `PER_SKILL_TARGET` par compétence, puis **distribue le reste** de `diagnosticSize`
 * (au-delà de `PER_SKILL_TARGET × nb compétences`) une unité à la fois sur les premières
 * compétences (ordre canonique) → chaque compétence a **~4–5** faits, total = `size`.
 *
 * La config est un **contrat brut** (LEARNINGS #58) : on **clampe** `diagnosticSize`
 * dans `[nb compétences, PER_SKILL_TARGET+1 par compétence]` avant de répartir — jamais
 * moins d'1 fait par compétence, jamais plus de `PER_SKILL_TARGET+1` (garde le « ~4–5 »
 * même si `ENGINE_DIAGNOSTIC_SIZE` est incohérent).
 */
function perSkillCounts(config: EngineConfig): Record<Skill, number> {
  const skillCount = SKILLS.length;
  // Clamp de la taille : au moins 1 par compétence, au plus (target+1) par compétence.
  const minSize = skillCount;
  const maxSize = (PER_SKILL_TARGET + 1) * skillCount;
  const size = Math.min(Math.max(config.diagnosticSize, minSize), maxSize);

  // Base = plancher par compétence (au plus PER_SKILL_TARGET), puis on répartit le reste.
  const base = Math.min(PER_SKILL_TARGET, Math.floor(size / skillCount));
  const counts = {} as Record<Skill, number>;
  for (const skill of SKILLS) {
    counts[skill] = base;
  }
  // Reste à distribuer (une unité par compétence, ordre canonique, cap à target+1).
  let remainder = size - base * skillCount;
  for (const skill of SKILLS) {
    if (remainder <= 0) break;
    if (counts[skill] < PER_SKILL_TARGET + 1) {
      counts[skill] += 1;
      remainder -= 1;
    }
  }
  return counts;
}

/**
 * **Sélectionne le diagnostic de départ** (ENGINE §3) : ~`diagnosticSize` faits (⚙️
 * ~18), **~4–5 par compétence**, représentatifs des 3 niveaux de difficulté (facile /
 * moyen / difficile), tous des faits **valides du domaine Tier 1** (issus de
 * `generateFacts` — aucune génération réinventée). Ordonnés par compétence (ordre
 * canonique §1) et, dans chaque compétence, **facile → dur** (ordre de pose §3).
 *
 * Fonction **pure et déterministe** : mêmes entrées → même liste (aucun aléa).
 *
 * @param config config moteur ⚙️ (3.2) — fournit `diagnosticSize`.
 * @returns la liste ordonnée des faits à poser (avec leur niveau de difficulté).
 */
export function selectDiagnostic(config: EngineConfig): DiagnosticItem[] {
  const counts = perSkillCounts(config);
  return SKILLS.flatMap((skill) => selectForSkill(skill, counts[skill]));
}

/**
 * **Adaptatif léger** (ENGINE §3) : ajuste le plan de sondage d'une compétence au vu des
 * réponses à ses **premiers** faits (les plus faciles, `ADAPTIVE_PROBE_COUNT`).
 *
 * - **premiers tous ratés** → on **n'enfonce pas** : les faits **plus durs** encore non
 *   posés de cette compétence sont **retirés** du plan (amorcer bas, ne pas décourager) ;
 * - **premiers tous justes + rapides** → on **sonde 1–2 plus durs** (`ADAPTIVE_DEEPEN_COUNT`)
 *   parmi les faits durs de la compétence non déjà dans le plan (probe de plafond).
 *
 * Renvoie le **nouveau plan** (liste ordonnée facile → dur par compétence). Pur et
 * déterministe : dépend seulement de `items`, `responses` et `config`. L'appelant
 * serveur (3.7) pose les items de base, observe les réponses, puis ré-appelle pour
 * obtenir le plan ajusté (les faits ajoutés sont posés à leur tour).
 *
 * @param items plan courant (typiquement la sortie de `selectDiagnostic`).
 * @param responses réponses déjà obtenues (clé + juste/faux + `response_ms`).
 * @param config config moteur ⚙️ (3.2) — seuils de fluence / anti-mash.
 */
export function adaptDiagnostic(
  items: readonly DiagnosticItem[],
  responses: readonly DiagnosticResponse[],
  config: EngineConfig,
): DiagnosticItem[] {
  const byKey = new Map(responses.map((r) => [r.factKey, r]));
  const result: DiagnosticItem[] = [];

  for (const skill of SKILLS) {
    const skillItems = items.filter((item) => item.fact.skill === skill);
    // Réponses aux `ADAPTIVE_PROBE_COUNT` premiers faits (facile d'abord) déjà posés.
    const firstAnswered = skillItems
      .map((item) => byKey.get(item.fact.key))
      .filter((r): r is DiagnosticResponse => r !== undefined)
      .slice(0, ADAPTIVE_PROBE_COUNT);

    // Échantillon insuffisant (< ADAPTIVE_PROBE_COUNT réponses) → aucun ajustement.
    if (firstAnswered.length < ADAPTIVE_PROBE_COUNT) {
      result.push(...skillItems);
      continue;
    }

    const allWrong = firstAnswered.every((r) => !r.correct);
    const allFluent = firstAnswered.every((r) => isFluent(toAttempt(r), config));

    if (allWrong) {
      // Ne pas enfoncer : retirer les faits DURS encore NON répondus (amorcer bas).
      result.push(
        ...skillItems.filter((item) => item.difficulty !== "hard" || byKey.has(item.fact.key)),
      );
    } else if (allFluent) {
      // Sonder plus dur : ajouter jusqu'à ADAPTIVE_DEEPEN_COUNT faits durs non déjà présents.
      result.push(...skillItems, ...deeperProbes(skill, skillItems));
    } else {
      // Ni tous ratés ni tous fluents → plan inchangé pour cette compétence.
      result.push(...skillItems);
    }
  }

  return result;
}

/**
 * Faits **plus durs** à ajouter quand une compétence est maîtrisée sur ses premiers
 * faits (ENGINE §3 : « sonder 1–2 plus durs »). Prend jusqu'à `ADAPTIVE_DEEPEN_COUNT`
 * faits du tier `hard`, **du plus dur vers le moins dur** (score décroissant), en
 * excluant ceux déjà présents dans le plan. Renvoie des `DiagnosticItem` de difficulté
 * `hard`. Déterministe.
 */
function deeperProbes(skill: Skill, existing: readonly DiagnosticItem[]): DiagnosticItem[] {
  const present = new Set(existing.map((item) => item.fact.key));
  // `tiersFor(...).hard` est déjà trié **croissant** (score puis clé, ordre total et
  // déterministe). Le plafond de difficulté est donc en **fin** de liste : on filtre les
  // faits déjà présents puis on **inverse** → « plus dur d'abord » sans réintroduire un
  // comparateur (donc aucune branche de tie-break redondante à couvrir). Pur, stable.
  const candidates = tiersFor(skill).hard.filter((fact) => !present.has(fact.key));
  candidates.reverse();
  return candidates
    .slice(0, ADAPTIVE_DEEPEN_COUNT)
    .map((fact) => ({ fact, difficulty: "hard" as const }));
}

/** Adapte une réponse de diagnostic en `Attempt` du modèle de maîtrise (réutilisation). */
function toAttempt(response: DiagnosticResponse): Attempt {
  return { skill: response.skill, correct: response.correct, responseMs: response.responseMs };
}

/**
 * Boîte Leitner amorcée d'un fait selon sa réponse (ENGINE §3). Réutilise le classement
 * **rapide/lent** du modèle de maîtrise (`isFluent` : seuils par compétence + anti-mash)
 * — pas de barème réinventé.
 *
 * - **juste + rapide** (fluent) → `SEED_BOX_FLUENT` (box 3) ;
 * - **juste mais lent** → `SEED_BOX_SLOW` (box 2) ;
 * - **faux / « je ne sais pas »** → `SEED_BOX_WRONG` (box 0).
 *
 * Une réponse **très rapide** (`< antiMashMs`) n'est **pas** comptée fluente (anti-mash,
 * ENGINE §9) → elle retombe sur « juste mais lent » (box 2), jamais box 3.
 */
function seedBox(response: DiagnosticResponse, config: EngineConfig): number {
  if (!response.correct) {
    return SEED_BOX_WRONG;
  }
  return isFluent(toAttempt(response), config) ? SEED_BOX_FLUENT : SEED_BOX_SLOW;
}

/**
 * **Amorce les lignes de maîtrise** à partir des réponses du diagnostic (ENGINE §3).
 * Pour **chaque** fait répondu, produit une ligne de maîtrise initiale :
 * - boîte amorcée selon la réponse (`seedBox` : 3 fluent / 2 lent / 0 faux) ;
 * - `next_due = now + délai(box)` avec le **même** barème Leitner que les transitions
 *   (`boxDelayMs`, `mastery.ts`) — pas de délai ad hoc ;
 * - compteurs initialisés (1 juste **ou** 1 faux), `avg_response_ms = response_ms`,
 *   `last_seen = now`.
 *
 * Un fait **non testé** ne figure **pas** dans le résultat (ENGINE §3 : « non testé →
 * pas de ligne » = nouveau, introduit plus tard selon le rythme). Les doublons de clé
 * (même fait répondu deux fois, ex. après un ajout adaptatif re-posant un fait) sont
 * dédoublonnés : la **dernière** réponse pour une clé gagne (état le plus récent).
 *
 * Fonction **pure et déterministe** ; **aucun score** n'est produit (la copy vit en 3.8).
 *
 * @param responses réponses de l'enfant au diagnostic (clé + juste/faux + `response_ms`).
 * @param config config moteur ⚙️ (3.2) — seuils de fluence / anti-mash / délais Leitner.
 * @param now instant courant **injecté** (epoch ms) — base de `last_seen` / `next_due`.
 * @returns une ligne de maîtrise amorcée par fait **testé** (ordre = 1ʳᵉ apparition).
 */
export function seedDiagnosticMastery(
  responses: readonly DiagnosticResponse[],
  config: EngineConfig,
  now: number,
): SeededMastery[] {
  // Dédoublonnage par clé : la dernière réponse gagne, mais on garde l'ordre de 1ʳᵉ
  // apparition (stable, déterministe). Map JS conserve l'ordre d'insertion des clés.
  const latest = new Map<string, DiagnosticResponse>();
  for (const response of responses) {
    latest.set(response.factKey, response);
  }

  const seeded: SeededMastery[] = [];
  for (const [factKey, response] of latest) {
    seeded.push({ factKey, state: seedMasteryRow(response, config, now) });
  }
  return seeded;
}

/**
 * **Ligne de maîtrise amorcée** pour une réponse (ENGINE §3, amorçage INITIAL) : boîte selon
 * `seedBox` (3 fluent / 2 lent / 0 faux), `next_due = now + délai(box)` avec le **même** barème
 * Leitner que les transitions (`boxDelayMs`), compteurs initialisés (1 juste **ou** 1 faux),
 * `avg_response_ms = response_ms`, `last_seen = now`. Fonction **pure** — source **unique** de la
 * forme « ligne amorcée » : réutilisée par `seedDiagnosticMastery` (diagnostic initial) ET par
 * `recalibrateMastery` (cas « fait jamais amorcé » du re-diagnostic) → la création est **par
 * construction identique** à l'amorçage initial (aucune divergence à maintenir, ADR 0016).
 */
function seedMasteryRow(
  response: DiagnosticResponse,
  config: EngineConfig,
  now: number,
): MasteryState {
  const box = seedBox(response, config);
  return {
    box,
    correctCount: response.correct ? 1 : 0,
    wrongCount: response.correct ? 0 : 1,
    avgResponseMs: response.responseMs,
    lastSeen: now,
    nextDue: now + boxDelayMs(box, config),
  };
}

// ============================================================================
// Recalibrage — re-diagnostic MONOTONE (max-merge), ADR 0016 / issue #237 (Option A)
// ============================================================================

/**
 * Nature d'une écriture produite par le re-diagnostic monotone (observabilité + tests) :
 * - `"create"` : le fait n'avait **aucune** ligne de maîtrise → on la crée exactement comme
 *   l'amorçage initial (`seedMasteryRow`) ;
 * - `"raise"` : le fait avait une boîte **plus basse** que celle sondée → on **relève** la boîte.
 *
 * Un fait dont la boîte courante est **≥** celle sondée ne produit **aucune** écriture (« keep »,
 * jamais rétrogradé) → il n'apparaît **pas** dans la sortie (invariant monotone, cf. `RecalibrationUpsert`).
 */
export type RecalibrationAction = "create" | "raise";

/**
 * Entrée du re-diagnostic pour **un** fait : la réponse de l'enfant + l'**état de maîtrise
 * courant** de ce fait (`null` si jamais amorcé). L'appelant serveur (`seedRecalibration`) lit
 * l'état courant depuis la base ; la fonction reste **pure** (aucune I/O).
 */
export interface RecalibrationInput {
  /** Réponse de l'enfant au fait re-sondé (clé + juste/faux + `response_ms`). */
  readonly response: DiagnosticResponse;
  /** État de maîtrise **courant** du fait (`null` = jamais amorcé → sera créé). */
  readonly current: MasteryState | null;
}

/**
 * Une **écriture** à appliquer suite au re-diagnostic monotone : la clé, la nature (`create`/
 * `raise`) et l'état de maîtrise à **upserter**. Un fait « keep » (boîte courante ≥ sondée)
 * **n'apparaît pas** dans la liste → aucune écriture, aucune perturbation de l'espacement.
 */
export interface RecalibrationUpsert {
  /** Clé canonique du fait. */
  readonly factKey: string;
  /** Nature de l'écriture (création vs relèvement). */
  readonly action: RecalibrationAction;
  /** État de maîtrise à persister (monotone : jamais une boîte plus basse que la courante). */
  readonly state: MasteryState;
}

/**
 * **Fusion MONOTONE (max-merge)** des réponses d'un re-diagnostic avec l'état de maîtrise courant
 * (ADR 0016, Option A du drift #237). **Respecte l'invariant verrouillé « progression monotone,
 * jamais de régression »** (ENGINE §2, PRODUCT :38) : le recalibrage ne peut que **relever** un
 * fait sous-amorcé ou **créer** un fait neuf — **jamais** rétrograder une boîte acquise. La
 * correction VERS LE BAS (enfant surestimé) reste gérée par le rétrograde Leitner normal (`−demoteBoxes`
 * sur faux, ENGINE §2) pendant le jeu, **pas** par le recalibrage.
 *
 * Pour **chaque** fait re-sondé (`seed = seedBox(response)` : 3 fluent / 2 lent / 0 faux, **même**
 * classement `isFluent` que l'amorçage — pas de barème réinventé) :
 * - **aucune ligne courante** (jamais amorcé) → **CREATE** : ligne identique à l'amorçage initial
 *   (`seedMasteryRow`, box = seed, compteurs 1, `avg = response_ms`, `next_due = now + délai(seed)`) ;
 * - **ligne courante, `seed > box_courant`** → **RAISE** : `box := seed`, `next_due := now +
 *   délai(seed)`, `last_seen := now`. Les **compteurs** (`correctCount`/`wrongCount`) et
 *   `avg_response_ms` sont **INCHANGÉS** — la sonde de calibrage ne doit **pas** polluer la justesse/
 *   fluence rapportées (les agrégats parent dérivent du vrai jeu, `attempts`, ADR 0012/0014) ;
 * - **ligne courante, `seed ≤ box_courant`** → **AUCUNE écriture** (« keep ») : jamais de
 *   rétrograde, jamais de perturbation de l'espacement d'un fait déjà mieux placé.
 *
 * Un fait **non re-sondé** (absent des `inputs`) est **inchangé** (l'appelant ne lui construit
 * aucune entrée). Fonction **pure et déterministe** ; **aucun score** produit (copy en 3.8).
 * Dédoublonnage par clé (dernière entrée gagne), ordre de 1ʳᵉ apparition préservé — comme
 * `seedDiagnosticMastery`.
 *
 * @param inputs une entrée par fait re-sondé (réponse + état courant).
 * @param config config moteur ⚙️ — seuils de fluence / anti-mash / délais Leitner.
 * @param now instant courant **injecté** (epoch ms) — base de `last_seen` / `next_due`.
 * @returns les **écritures** (create/raise) à appliquer ; les « keep » en sont **absents**.
 */
export function recalibrateMastery(
  inputs: readonly RecalibrationInput[],
  config: EngineConfig,
  now: number,
): RecalibrationUpsert[] {
  // Dédoublonnage par clé (dernière entrée gagne, ordre de 1ʳᵉ apparition), parité avec
  // `seedDiagnosticMastery`. La Map JS conserve l'ordre d'insertion des clés.
  const latest = new Map<string, RecalibrationInput>();
  for (const input of inputs) {
    latest.set(input.response.factKey, input);
  }

  const upserts: RecalibrationUpsert[] = [];
  for (const [factKey, { response, current }] of latest) {
    if (current === null) {
      // Fait jamais amorcé → création identique à l'amorçage initial (0 → seed, monotone).
      upserts.push({ factKey, action: "create", state: seedMasteryRow(response, config, now) });
      continue;
    }
    const seed = seedBox(response, config);
    // GARDE MONOTONE : ne RELEVER que si la sonde place le fait STRICTEMENT plus haut que sa
    // boîte courante. `seed ≤ box_courant` → « keep » (aucune écriture) : jamais de rétrograde
    // (invariant ENGINE §2), jamais de perturbation de l'espacement d'un fait déjà mieux placé.
    if (seed > current.box) {
      upserts.push({
        factKey,
        action: "raise",
        // Boîte relevée + échéance recalculée + dernière-vue rafraîchie ; compteurs et fluence
        // moyenne **préservés** (la sonde ne pollue pas la justesse/rapidité rapportées).
        state: {
          ...current,
          box: seed,
          nextDue: now + boxDelayMs(seed, config),
          lastSeen: now,
        },
      });
    }
  }
  return upserts;
}
