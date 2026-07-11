/**
 * Orchestration serveur du moteur (ENGINE §10, PLAN §Cœur, SYNC §1/§2/§5).
 *
 * Câble le **moteur pur** (`level.ts`, `mastery.ts`, `diagnostic.ts`, `distractors.ts`)
 * à la **persistance** (`persistence.ts`) : c'est ici que vivent l'**état de session**,
 * la **transaction synchrone** (anti-TOCTOU), les **gardes de forme** runtime et
 * l'**idempotence/monotonie**. Les modules purs restent sans I/O ; les server actions
 * (`app/(app)/jouer/actions.ts`) sont des adaptateurs minces au-dessus de ce service.
 *
 * SERVER-ONLY par transitivité (importe la couche DB). Toutes les fonctions prennent la
 * connexion (`AppDatabase`), le `profileId` **de la session** (jamais un profil client),
 * la config moteur et l'horloge `now` **injectée** → testables sur base réelle,
 * déterministes (LEARNINGS #46).
 *
 * **Invariants serveur** (SYNC §1/§2/§5) :
 * - serveur = source de vérité ; toute la logique maîtrise/sélection est ici, pas au client ;
 * - écritures **idempotentes** : rejouer une soumission (même `clientAttemptId`) ne crée
 *   pas de 2ᵉ ligne `attempts` et ne recompte pas `mastery` (SYNC §2) ;
 * - **atomicité** : journal `attempts` + upsert `mastery` dans **UNE** transaction
 *   synchrone better-sqlite3 (`db.transaction((tx) => …)`, callback SANS `await`) →
 *   aucun tour d'event-loop intercalé, check-then-write sérialisé (anti-TOCTOU, #36) ;
 * - **gardes de forme** : les payloads d'un endpoint public ne sont pas garantis au
 *   runtime → `factKey`/`skill`/`responseMs` validés AVANT tout usage/écriture (#36).
 */

import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { mastery, profiles } from "@/lib/db/schema";
import type { EngineConfig } from "@/config/server-config";
import { SKILLS, type Skill } from "./domain";
import { buildLevel, type BuildLevelOptions, type LevelItem } from "./level";
import { applyAttempt, type Attempt, type MasteryState } from "./mastery";
import { chooseFormat, buildQuestionChoices, type QuestionFormat, type Rng } from "./distractors";
import type { Fact } from "./facts";
import {
  recalibrateMastery,
  seedDiagnosticMastery,
  type DiagnosticResponse,
  type RecalibrationInput,
  type RecalibrationUpsert,
  type SeededMastery,
} from "./diagnostic";
import {
  attemptExists,
  insertAttempt,
  loadMasteryState,
  loadScope,
  resolveFact,
  upsertMastery,
  type DbHandle,
} from "./persistence";

// ============================================================================
// Gardes de forme (frontière serveur — payloads non fiables, LEARNINGS #36/#58)
// ============================================================================

/** `true` si `value` est une compétence connue du domaine (garde de forme `skill`). */
function isSkill(value: unknown): value is Skill {
  return typeof value === "string" && (SKILLS as readonly string[]).includes(value);
}

/**
 * `true` si `value` est un `response_ms` **valide** : nombre **fini**, **≥ 0**, entier.
 * Un endpoint public peut envoyer `NaN`/`Infinity`/négatif/non-numérique → sans cette
 * garde, la valeur polluerait `avgResponseMs` (note review PR #78 sur #63, LEARNINGS #36).
 */
function isValidResponseMs(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value)
  );
}

/**
 * Entrée **brute** (non fiable) de soumission d'une réponse. Vient d'un endpoint public
 * → chaque champ est validé au runtime avant usage. `profileId` n'y figure **pas** : il
 * provient **toujours** de la session (jamais du client, SYNC §1 / note sécurité #63).
 */
export interface SubmitAttemptInput {
  /** Clé du fait répondu — validée contre le domaine canonique (`resolveFact`). */
  readonly factKey: unknown;
  /** Compétence déclarée — doit correspondre à celle du fait résolu. */
  readonly skill: unknown;
  /** Réponse juste ? */
  readonly correct: unknown;
  /** Temps de réponse (ms). Fourni par le client mais **borné/validé** ici (#63). */
  readonly responseMs: unknown;
  /** Re-essai (pratique non comptée, ENGINE §9) ? Optionnel (absent ⇒ `false`). */
  readonly isRetry?: unknown;
  /** Id opaque client pour l'idempotence (SYNC §2). Optionnel (absent ⇒ pas de dédoublonnage). */
  readonly clientAttemptId?: unknown;
}

/** Issue d'une soumission (côté service — l'action mappe vers une réponse cliente). */
export type SubmitAttemptResult =
  /** Réponse enregistrée / rejouée : la maîtrise à jour du fait (`null` = re-essai, non compté). */
  | { readonly ok: true; readonly state: MasteryState | null; readonly duplicate: boolean }
  /** Payload invalide (forme/domaine) → refus **propre** (pas un 500). */
  | { readonly ok: false; readonly error: SubmitAttemptError };

/** Motif de refus d'une soumission mal formée (mappé vers une erreur cliente neutre). */
export type SubmitAttemptError = "INVALID_FACT" | "INVALID_SKILL" | "INVALID_RESPONSE_MS";

// ============================================================================
// Démarrer un niveau (ENGINE §4/§6, SYNC §1)
// ============================================================================

/**
 * Une **question** prête à afficher : le fait, son **format** (QCM/pavé selon la boîte,
 * ENGINE §6), les **choix** mélangés si QCM (bonne réponse + 3 distracteurs typiques,
 * ENGINE §6), et le drapeau `isReask` (occurrence non comptée, ENGINE §4/§9). La bonne
 * réponse **n'est pas** exposée séparément (anti-triche : en pavé le client n'a pas la
 * réponse ; en QCM elle est noyée dans `choices`).
 */
export interface LevelQuestion {
  /** Clé canonique du fait (le client la renvoie à la soumission). */
  readonly factKey: string;
  /** Compétence (indexe l'étayage visuel, épic #4). */
  readonly skill: Skill;
  /** Opérandes du calcul à afficher (`[a]` pour comp10, `[a, b]` sinon). */
  readonly operands: readonly number[];
  /** Format d'affichage (ENGINE §6). */
  readonly format: QuestionFormat;
  /** Choix mélangés (QCM uniquement) ; `null` en pavé (rappel libre). */
  readonly choices: readonly number[] | null;
  /** Ré-apparition d'un fait raté (non comptée pour la maîtrise, ENGINE §4/§9). */
  readonly isReask: boolean;
}

/**
 * Un niveau prêt à jouer : ses questions ordonnées (ENGINE §4). ~10 pour un niveau normal,
 * `bossQuestionCount` (~12-15, MAP §6) pour un **boss** — la taille est portée par
 * `BuildLevelOptions.size` (résolu serveur depuis le type de nœud), le modèle de sélection
 * est identique.
 */
export interface Level {
  readonly questions: readonly LevelQuestion[];
}

/**
 * Boîte d'un fait pour choisir son **format** (ENGINE §6) : la boîte persistée si le fait
 * a déjà été vu, sinon la boîte de départ (0 → QCM, soutien fort pour un fait neuf).
 */
function formatBoxOf(state: MasteryState | null): number {
  return state === null ? 0 : state.box;
}

/**
 * Transforme un `LevelItem` (fait + `isReask`) en `LevelQuestion` prête à afficher :
 * choisit le format d'après la boîte persistée, génère les choix mélangés si QCM. Le
 * `rng` injecté rend le mélange déterministe (LEARNINGS aléa/#34).
 */
function toQuestion(item: LevelItem, state: MasteryState | null, rng: Rng): LevelQuestion {
  const format = chooseFormat(formatBoxOf(state));
  return {
    factKey: item.fact.key,
    skill: item.fact.skill,
    operands: item.fact.operands,
    format,
    choices: format === "qcm" ? buildQuestionChoices(item.fact, rng) : null,
    isReask: item.isReask,
  };
}

/**
 * **Démarre un niveau** pour le profil de la session (ENGINE §4/§6, SYNC §1) : lit l'état
 * `mastery` persisté → `buildLevel` (3.4) → attache format + distracteurs (3.5). Renvoie
 * les questions **cohérentes avec l'état persisté** (~10 pour un niveau normal, la taille
 * `options.size` — `bossQuestionCount` — pour un **boss**, MAP §6). Lecture seule (aucune
 * écriture au démarrage : la maîtrise ne bouge qu'à la soumission d'une réponse).
 *
 * @param db connexion applicative (source de vérité serveur).
 * @param profileId profil **de la session** (jamais un profil client).
 * @param config config moteur ⚙️ (3.2).
 * @param now instant serveur injecté (epoch ms) — base des échéances DUE/MAINT.
 * @param rng RNG injecté pour le mélange des choix QCM (déterministe en test).
 * @param options `rotation` (rotation douce) + `reaskKeys` (re-ask) + `size` (boss ⇒
 *   `bossQuestionCount`, résolu **serveur** depuis le type de nœud), injectés (3.4).
 */
export function startLevel(
  db: AppDatabase,
  profileId: number,
  config: EngineConfig,
  now: number,
  rng: Rng,
  options: BuildLevelOptions = {},
): Level {
  const scope = loadScope(db, profileId);
  const items = buildLevel(scope, config, now, options);
  // Index de l'état par clé pour choisir le format sans re-requêter (scope déjà chargé).
  // Tout fait d'un `LevelItem` provient de `scope` (buildLevel ne renvoie que des faits
  // du périmètre) → sa clé est **toujours** présente dans la map (invariant). L'assertion
  // non-null `!` reflète cet invariant sans introduire une branche de repli morte
  // (`?? null`) impossible à atteindre sous gate 100 % (LEARNINGS #75/#78).
  const stateByKey = new Map<string, MasteryState | null>();
  for (const entry of scope) {
    stateByKey.set(entry.fact.key, entry.state);
  }
  const questions = items.map((item) => toQuestion(item, stateByKey.get(item.fact.key)!, rng));
  return { questions };
}

// ============================================================================
// Soumettre une réponse (ENGINE §2/§9/§10, SYNC §2/§5)
// ============================================================================

/**
 * **Soumet une réponse** pour le profil de la session (ENGINE §2/§9/§10, SYNC §2).
 *
 * Étapes :
 * 1. **gardes de forme + domaine** (payload public non fiable, #36) : `factKey` résolu
 *    contre le domaine canonique (`resolveFact` → rejette une clé forgée/hors-Tier1,
 *    note sécurité #63), `skill` cohérent avec le fait, `responseMs` fini/entier/≥0 ;
 * 2. **transaction SYNCHRONE** better-sqlite3 (`db.transaction`, callback sans `await`,
 *    anti-TOCTOU #36) : garde d'idempotence (`attemptExists`) → si déjà enregistrée
 *    (même `clientAttemptId`), **no-op** (aucune 2ᵉ mutation, SYNC §2/§5) ; sinon journal
 *    `attempts` (1 ligne) + `applyAttempt` (3.3, 1ʳᵉ réponse seule comptée) + upsert
 *    `mastery`.
 *
 * Le hachage/validation lourds sont faits **AVANT** la transaction (ici il n'y en a pas
 * d'async → la validation est purement synchrone, mais on garde la discipline : rien
 * d'`await` dans le callback). `now` (epoch ms) injecté = horloge **serveur** (le
 * `response_ms` du client est validé/borné, jamais le `created_at`).
 */
export function submitAttempt(
  db: AppDatabase,
  profileId: number,
  input: SubmitAttemptInput,
  config: EngineConfig,
  now: number,
): SubmitAttemptResult {
  // 1. Gardes de forme + domaine (avant toute écriture, #36).
  if (typeof input.factKey !== "string") {
    return { ok: false, error: "INVALID_FACT" };
  }
  const fact = resolveFact(input.factKey);
  if (fact === null) {
    return { ok: false, error: "INVALID_FACT" };
  }
  // Le `skill` déclaré doit être valide ET correspondre au fait résolu (pas de
  // désynchro clé↔compétence qui fausserait le seuil de fluence indexé par skill).
  if (!isSkill(input.skill) || input.skill !== fact.skill) {
    return { ok: false, error: "INVALID_SKILL" };
  }
  if (!isValidResponseMs(input.responseMs)) {
    return { ok: false, error: "INVALID_RESPONSE_MS" };
  }
  // Capturer les champs **narrowés** dans des locaux : le narrowing d'un guard sur un
  // champ `unknown` est perdu à l'intérieur du callback de transaction (closure).
  const responseMs = input.responseMs;
  const correct = input.correct === true;
  const isRetry = input.isRetry === true;
  const clientAttemptId = typeof input.clientAttemptId === "string" ? input.clientAttemptId : null;

  const attempt: Attempt = {
    skill: fact.skill,
    correct,
    responseMs,
    isRetry,
  };

  // 2. Écriture atomique : transaction SYNCHRONE (callback sans await → sérialisation,
  //    anti-TOCTOU #36). Idempotence (SYNC §2) : rejeu du même clientAttemptId = no-op.
  return db.transaction((tx): SubmitAttemptResult => {
    if (attemptExists(tx, profileId, clientAttemptId)) {
      // Déjà enregistrée (rejeu réseau) → aucune 2ᵉ mutation. On renvoie l'état
      // **actuel** persisté du fait (idempotent, monotone : la maîtrise ne bouge pas).
      const current = loadMasteryState(tx, profileId, fact.key);
      return { ok: true, state: current, duplicate: true };
    }

    // Journal append-only (1 ligne / réponse, ENGINE §10) — porte l'id client + now serveur.
    insertAttempt(
      tx,
      profileId,
      {
        factId: fact.key,
        skill: fact.skill,
        correct,
        responseMs,
        isRetry,
        clientAttemptId,
      },
      new Date(now),
    );

    // Re-essai = pratique non comptée (ENGINE §9) : `applyAttempt` renvoie l'état
    // inchangé → aucun upsert `mastery`, mais la ligne `attempts` (isRetry=1) reste
    // journalisée (matière de l'espace parent).
    if (isRetry) {
      const current = loadMasteryState(tx, profileId, fact.key);
      return { ok: true, state: current, duplicate: false };
    }

    // 1ʳᵉ réponse comptée : transition Leitner + fluence (3.3), puis upsert `mastery`.
    const current = loadMasteryState(tx, profileId, fact.key);
    const nextState = applyAttempt(current, attempt, config, now);
    // `applyAttempt` ne renvoie `null` que sur un re-essai (traité au-dessus) → ici
    // `nextState` est toujours non-null. On upsert l'état calculé.
    upsertMastery(tx, profileId, fact, nextState as MasteryState);
    return { ok: true, state: nextState, duplicate: false };
  });
}

// ============================================================================
// Diagnostic de départ (ENGINE §3, 1ʳᵉ session)
// ============================================================================

/**
 * `true` si le profil **n'a encore aucune** ligne `mastery` — proxy de « 1ʳᵉ session »
 * (le diagnostic n'amorce qu'un profil vierge, ENGINE §3). Lecture seule.
 */
export function needsDiagnostic(db: AppDatabase, profileId: number): boolean {
  const scope = loadScope(db, profileId);
  return scope.every((entry) => entry.state === null);
}

/**
 * Une réponse **brute** (non fiable) au diagnostic (endpoint public). Validée au runtime
 * (forme + domaine) avant amorçage. Miroir non-typé de `DiagnosticResponse`.
 */
export interface RawDiagnosticResponse {
  readonly factKey: unknown;
  readonly skill: unknown;
  readonly correct: unknown;
  readonly responseMs: unknown;
}

/**
 * Valide + normalise une réponse brute de diagnostic → `DiagnosticResponse` typée, ou
 * `null` si mal formée / hors-domaine (garde de forme frontière, #36). La clé est
 * résolue contre le domaine canonique (`resolveFact`) et le `skill` doit correspondre.
 */
function normalizeDiagnosticResponse(raw: RawDiagnosticResponse): DiagnosticResponse | null {
  if (typeof raw.factKey !== "string") {
    return null;
  }
  const fact = resolveFact(raw.factKey);
  if (fact === null) {
    return null;
  }
  if (!isSkill(raw.skill) || raw.skill !== fact.skill) {
    return null;
  }
  if (!isValidResponseMs(raw.responseMs)) {
    return null;
  }
  return {
    factKey: fact.key,
    skill: fact.skill,
    correct: raw.correct === true,
    responseMs: raw.responseMs,
  };
}

/**
 * **Amorce la maîtrise** du profil de la session à partir des réponses du diagnostic
 * (ENGINE §3, 1ʳᵉ session, SYNC §1). Valide chaque réponse (forme + domaine, #36), calcule
 * les lignes amorcées (`seedDiagnosticMastery`, 3.6 : juste+rapide → box 3, etc.), puis
 * **upsert** chaque ligne dans **UNE** transaction synchrone (atomicité, anti-TOCTOU #36).
 *
 * **Idempotent** : l'amorçage n'écrit que sur un profil **vierge** (`needsDiagnostic`) ;
 * un rejeu (diagnostic déjà amorcé) est un **no-op** → la maîtrise ne double jamais.
 *
 * @returns les lignes de maîtrise **effectivement** amorcées (vide si profil déjà amorcé
 *   ou aucune réponse valide). `now` (epoch ms) injecté = horloge serveur.
 */
export function seedDiagnostic(
  db: AppDatabase,
  profileId: number,
  rawResponses: readonly RawDiagnosticResponse[],
  config: EngineConfig,
  now: number,
): SeededMastery[] {
  // Valider AVANT la transaction (aucun async, mais on garde le lourd hors du callback).
  const responses: DiagnosticResponse[] = [];
  for (const raw of rawResponses) {
    const normalized = normalizeDiagnosticResponse(raw);
    if (normalized !== null) {
      responses.push(normalized);
    }
  }
  const seeded = seedDiagnosticMastery(responses, config, now);

  return db.transaction((tx): SeededMastery[] => {
    // Idempotence : n'amorcer qu'un profil vierge (aucune ligne mastery). Un rejeu
    // sur un profil déjà amorcé = no-op (la maîtrise ne double jamais, SYNC §5).
    const alreadySeeded = tx
      .select({ id: mastery.id })
      .from(mastery)
      .where(eq(mastery.profileId, profileId))
      .limit(1)
      .get();
    if (alreadySeeded !== undefined) {
      return [];
    }
    for (const row of seeded) {
      // La clé a été validée par `resolveFact` → `parseFactKey` re-résout un fait canonique.
      const fact = resolveFact(row.factKey) as Fact;
      upsertMastery(tx, profileId, fact, row.state);
    }
    return seeded;
  });
}

// ============================================================================
// Recalibrage — re-diagnostic MONOTONE déclenché par le parent (ENGINE §3, ADR 0016)
// ============================================================================

/**
 * `true` si le profil porte un **drapeau de recalibrage armé** (`profiles.recalibration_requested`)
 * — le parent a demandé de relancer le mini-diagnostic (story 7.6, ADR 0016). Lecture seule.
 * Consommée par le gate côté enfant (`diagnosticPlanAction`) pour re-présenter le diagnostic MÊME
 * quand `mastery` est non vide, et par `seedRecalibration` comme garde armé (anti-TOCTOU). Accepte
 * un handle DB **ou** un handle de transaction (réutilisable dans la transaction de re-seed).
 */
export function isRecalibrationRequested(db: DbHandle, profileId: number): boolean {
  const row = db
    .select({ flag: profiles.recalibrationRequested })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1)
    .get();
  return row?.flag === true;
}

/**
 * **Arme** le drapeau de recalibrage du profil (déclencheur parent, story 7.6, ADR 0016) :
 * `profiles.recalibration_requested := true`. À la prochaine partie, l'enfant re-joue le
 * mini-diagnostic (gate `diagnosticPlanAction`), puis la fusion monotone consomme + efface le
 * drapeau (`seedRecalibration`). **Idempotent** : (ré)armer un drapeau déjà armé est sûr (armer × N
 * = armé) — aucun état partiel possible (écriture **unique**, donc pas de transaction/test de
 * rollback : serait vacuous, rétro #124). Écrit **uniquement** `profiles` (jamais `mastery`/
 * `attempts`) : la maîtrise ne bouge pas tant que l'enfant n'a pas re-joué le diagnostic.
 */
export function requestRecalibration(db: DbHandle, profileId: number): void {
  db.update(profiles).set({ recalibrationRequested: true }).where(eq(profiles.id, profileId)).run();
}

/**
 * **Applique la fusion MONOTONE** d'un re-diagnostic pour le profil de session (ENGINE §3, ADR
 * 0016, Option A du drift #237). Valide chaque réponse (forme + domaine, #36, **même** normalisation
 * que le diagnostic initial), puis, dans **UNE** transaction synchrone (atomicité, anti-TOCTOU #36) :
 *
 * 1. **garde « armé »** : ne recalibre QUE si `recalibration_requested` est vrai (sinon **no-op**
 *    strict — re-soumettre un re-diagnostic hors demande ne touche **rien**) ;
 * 2. **fusion max-merge** (`recalibrateMastery`) : chaque fait re-sondé est **créé** (jamais amorcé)
 *    ou **relevé** si sa boîte sondée est plus haute — **jamais** rétrogradé (invariant monotone
 *    ENGINE §2). Un fait dont la boîte courante est ≥ la sondée n'est **pas** écrit (spacing préservé) ;
 * 3. **effacement du drapeau** (`recalibration_requested := false`) dans la **MÊME** transaction que
 *    les upserts de maîtrise → la demande est consommée **exactement une fois** (atomique).
 *
 * **N'écrit QUE `mastery` + le drapeau `profiles`** — **jamais** `attempts` (la sonde de calibrage
 * est hors comptage de justesse, exactement comme le diagnostic initial, ADR 0012/0014). Idempotent
 * de fait : le drapeau effacé rend un rejeu **no-op** (garde armé).
 *
 * @returns les écritures **effectivement** appliquées (create/raise) ; vide si non armé ou si tous
 *   les faits re-sondés sont déjà à une boîte ≥ (aucun relèvement). `now` (epoch ms) injecté = horloge serveur.
 */
export function seedRecalibration(
  db: AppDatabase,
  profileId: number,
  rawResponses: readonly RawDiagnosticResponse[],
  config: EngineConfig,
  now: number,
): RecalibrationUpsert[] {
  // Valider AVANT la transaction (garde de forme frontière #36) — réutilise la normalisation du
  // diagnostic initial (résolution domaine + skill cohérent + response_ms fini/entier/≥0).
  const responses: DiagnosticResponse[] = [];
  for (const raw of rawResponses) {
    const normalized = normalizeDiagnosticResponse(raw);
    if (normalized !== null) {
      responses.push(normalized);
    }
  }

  return db.transaction((tx): RecalibrationUpsert[] => {
    // 1. Garde « armé » (anti-TOCTOU) : hors demande parent → aucune écriture (no-op strict).
    if (!isRecalibrationRequested(tx, profileId)) {
      return [];
    }

    // 2. Fusion MONOTONE : lire l'état courant de chaque fait re-sondé (DANS la transaction,
    //    APRÈS la garde armé, AVANT toute écriture), puis calculer les écritures create/raise.
    const inputs: RecalibrationInput[] = responses.map((response) => ({
      response,
      current: loadMasteryState(tx, profileId, response.factKey),
    }));
    const upserts = recalibrateMastery(inputs, config, now);

    // 1ʳᵉˢ écriture(s) : upsert des lignes relevées/créées (jamais une boîte plus basse, monotone).
    for (const upsert of upserts) {
      const fact = resolveFact(upsert.factKey) as Fact;
      upsertMastery(tx, profileId, fact, upsert.state);
    }

    // 3. 2ᵉ écriture (garde d'atomicité, ADR 0016) : effacer le drapeau dans la MÊME transaction.
    //    Si CETTE écriture échoue, TOUTE la fusion ci-dessus est annulée (ROLLBACK) : ni maîtrise
    //    relevée, ni drapeau effacé — aucun état partiel (la demande n'est jamais « à moitié » consommée).
    tx.update(profiles)
      .set({ recalibrationRequested: false })
      .where(eq(profiles.id, profileId))
      .run();

    return upserts;
  });
}
