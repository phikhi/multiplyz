import "server-only";
import { and, count, eq, gte, lt, inArray, sql } from "drizzle-orm";
import { getWorldGenConfig, type WorldGenConfig } from "@/config/server-config";
import { CURATED_THEMES, type CuratedTheme } from "@/config/worldgen-themes";
import type { AppDatabase } from "@/lib/db";
import { jobs, progress, worlds, type JobStatus } from "@/lib/db/schema";
import { generateWorld, ESTIMATED_EUR_PER_IMAGE, type GeneratedWorld } from "./generate-world";

/**
 * **Worker daemon — logique cœur** (WORLDGEN §2/§3, story 6.4, épic #6). Consommé par un
 * process daemon **séparé** géré par Forge (STACK.md ; le wiring process = gate-déploiement
 * différé #47/#9 — hors scope ici). Ce module ne contient que la **logique testable** :
 *
 * 1. `ensureBuffer` — maintient `bufferAhead` mondes d'avance sur le `world_index` courant
 *    (dérivé de `progress`) : chaque monde manquant de la fenêtre est **enqueue** (job
 *    `generate_world` `pending`), sous garde de **plafond budgétaire mensuel** (WORLDGEN §2).
 * 2. `processNextJob` — prend un job `pending` → `running` → appelle le générateur (6.3,
 *    **injecté/mockable** → zéro appel réseau réel en CI) → insère le monde `buffered` → job
 *    `done`. Sur échec : `attempts += 1` + `last_error` ; après `maxRetries` → `failed`.
 * 3. **Reprise après crash** : un job `running` **orphelin** (worker mort avant `done`) est
 *    remis `pending` au boot (`recoverStaleJobs`) → re-tentable, sans perte ni double.
 *
 * **Budget ⚙️ qui AGIT** (le cœur de 6.4, rétro #155) : 6.1/6.3 ont **posé** `monthlyBudgetEur`
 * et **rapporté** le coût sans rien enforcer ; 6.4 le **consomme**. La dépense du mois courant
 * est **dérivée des données existantes** (`worlds.createdAt` du mois × coût estimé/monde) —
 * **aucun** changement de contrat data (pas de colonne/table de coût ajoutée). Avant d'enqueue
 * un monde, si `dépense + coût_prochain > plafond` → on **cesse d'enqueue** (garde à effet
 * observable, mutation-prouvée).
 *
 * **Idempotence** (#82/#144) : re-jouer un job (même `world_index`) ne crée **jamais** un 2ᵉ
 * monde au même index (`worlds.world_index` UNIQUE + upsert `onConflictDoNothing` côté 6.3).
 * `ensureBuffer` n'enqueue pas deux fois le même index (monde déjà présent OU job actif en file).
 *
 * **SERVER-ONLY** (importe la couche DB + le générateur). `now`/générateur **injectés** (horloge
 * serveur + zéro I/O réseau en test, LEARNINGS #46).
 */

/** Statuts de job considérés **actifs** (déjà en file / en cours) — un monde à cet index est déjà pris en charge. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["pending", "running"] as const;

/** Type de job de génération de monde (WORLDGEN §3). Extensible (Stage A/B, QA). */
export const GENERATE_WORLD_JOB = "generate_world" as const;

/**
 * **Nombre d'images payantes par monde** (WORLDGEN §2 « ~10-12 images/monde » : fond + tuiles +
 * variante Teddy + 6-8 créatures + 1 légendaire). ⚙️ d'**estimation de coût** (pas d'enforcement
 * fin) : sert à borner **à l'avance** la dépense mensuelle sans générer. On retient la **borne
 * haute** → estimation **prudente** (surestime plutôt que sous-estime, pour ne jamais dépasser le
 * plafond). Le générateur produit `fond + tuiles + Teddy` (3 non-créature) + `eggPool` œufs + 1
 * légendaire, avec `eggPool + 1 = total ∈ [minTotal, maxTotal]` → borne haute d'images = 3 + `maxTotal`.
 */
export const MAX_PAID_IMAGES_PER_WORLD = 3 + 8;

/** Coût **estimé prudent** d'un monde en euros (borne haute d'images × coût/image, WORLDGEN §2). */
export const ESTIMATED_EUR_PER_WORLD = MAX_PAID_IMAGES_PER_WORLD * ESTIMATED_EUR_PER_IMAGE;

/**
 * **Thème d'un monde** — sélection **déterministe** cyclique sur le pool curaté (WORLDGEN §4.1/§7 :
 * reproductibilité, même `world_index` ⇒ même thème). Le cycle `mod` sur ≥ 6 thèmes espace
 * naturellement les répétitions bien au-delà de la fenêtre de buffer (2) → aucun doublon adjacent
 * (le générateur rejette de toute façon un slug récent). Pure.
 */
export function themeForWorld(worldIndex: number): CuratedTheme {
  // `worldIndex` ≥ 0 (position sur la carte infinie) ; le double `% + %` reste correct même si un
  // appelant passait un index négatif (cycle stable, jamais d'index de tableau négatif).
  const i = ((worldIndex % CURATED_THEMES.length) + CURATED_THEMES.length) % CURATED_THEMES.length;
  return CURATED_THEMES[i];
}

/** Dépendances injectables du worker (tests → zéro appel réseau réel, horloge déterministe). */
export interface WorkerDeps {
  /**
   * Générateur de monde (défaut : `generateWorld` 6.3). **Mocké en test** (zéro appel réseau
   * réel, DoD). Reçoit la connexion, le thème, l'index, les thèmes récents.
   */
  generate: (
    db: AppDatabase,
    theme: string,
    worldIndex: number,
    recentThemeSlugs: readonly string[],
  ) => Promise<GeneratedWorld>;
  /** Horloge serveur injectée (jamais `Date.now()` interne, LEARNINGS #46). */
  now: () => Date;
  /** Config worldgen (défaut : config centrale). Injectée en test. */
  config: WorldGenConfig;
}

/** Résout les dépendances par défaut (prod), surchargées en test. */
export function resolveWorkerDeps(overrides?: Partial<WorkerDeps>): WorkerDeps {
  return {
    generate:
      overrides?.generate ??
      ((db, theme, worldIndex, recent) => generateWorld(db, theme, worldIndex, recent)),
    now: overrides?.now ?? (() => new Date()),
    config: overrides?.config ?? getWorldGenConfig(),
  };
}

/**
 * **Bornes du mois courant** (epoch ms) `[début, débutMoisSuivant[` en **UTC** — le plafond
 * budgétaire est **mensuel** (WORLDGEN §2). UTC (pas l'heure locale du serveur) = frontière de
 * mois **déterministe** et indépendante du fuseau du VPS (reproductible en test/prod). Pure.
 */
export function monthBounds(now: Date): { start: number; end: number } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return { start, end };
}

/**
 * **Dépense estimée du mois courant** en euros (WORLDGEN §2), **dérivée des données existantes** :
 * nombre de mondes créés dans le mois × coût estimé prudent/monde. **Aucun** compteur persisté
 * (pas de changement de contrat data) : `worlds.createdAt` est la source. Un monde payé = un
 * `worlds` (cache permanent, WORLDGEN §1) → compter les lignes du mois estime la dépense engagée.
 */
export function currentMonthSpendEur(db: AppDatabase, now: Date): number {
  const { start, end } = monthBounds(now);
  // `count()` sur un agrégat renvoie TOUJOURS une ligne avec un entier ≥ 0 (jamais NULL, jamais
  // zéro-ligne) → pas de `?? 0` défensif (branche inatteignable = non testable, à ne pas poser —
  // rétro #143). `.get()` d'un agrégat est garanti défini.
  const worldsThisMonth = db
    .select({ n: count() })
    .from(worlds)
    .where(and(gte(worlds.createdAt, new Date(start)), lt(worlds.createdAt, new Date(end))))
    .get()!.n;
  return worldsThisMonth * ESTIMATED_EUR_PER_WORLD;
}

/**
 * Le plafond mensuel **autorise-t-il** un monde payant de plus, sachant une dépense **déjà
 * projetée** ? (garde budget WORLDGEN §2, rétro #155). `true` ⇔ `dépense + coût_prochain ≤
 * plafond`. Borne **inclusive** (`≤`) : atteindre pile le plafond est toléré, le **dépasser**
 * non. Pure.
 */
export function budgetAllowsNextWorld(spentEur: number, config: WorldGenConfig): boolean {
  return spentEur + ESTIMATED_EUR_PER_WORLD <= config.monthlyBudgetEur;
}

/** Un monde existe-t-il déjà à cet index ? (unicité `worlds.world_index`, WORLDGEN §5). */
export function worldExists(db: AppDatabase, worldIndex: number): boolean {
  const row = db
    .select({ index: worlds.index })
    .from(worlds)
    .where(eq(worlds.index, worldIndex))
    .get();
  return row !== undefined;
}

/**
 * Un job **actif** (`pending`/`running`) couvre-t-il déjà ce `world_index` ? (anti-doublon
 * d'enqueue, idempotence #82). Le `world_index` est encodé dans le `payload` json du job.
 */
export function hasActiveJobForWorld(db: AppDatabase, worldIndex: number): boolean {
  const rows = db
    .select({ payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.type, GENERATE_WORLD_JOB), inArray(jobs.status, [...ACTIVE_JOB_STATUSES])))
    .all();
  return rows.some((r) => parseWorldIndex(r.payload) === worldIndex);
}

/** Charge utile d'un job `generate_world` : l'index du monde à générer (WORLDGEN §3). */
export interface GenerateWorldPayload {
  readonly worldIndex: number;
}

/** Sérialise la charge utile d'un job `generate_world` (json stocké dans `jobs.payload`). */
export function serializeJobPayload(worldIndex: number): string {
  return JSON.stringify({ worldIndex } satisfies GenerateWorldPayload);
}

/**
 * Extrait le `worldIndex` d'un `payload` json de job, ou `null` si illisible/absent (garde de
 * forme : le payload est stocké en texte → un json corrompu ne doit pas planter le worker).
 */
export function parseWorldIndex(payload: string): number | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "worldIndex" in parsed &&
      typeof (parsed as { worldIndex: unknown }).worldIndex === "number" &&
      Number.isInteger((parsed as { worldIndex: number }).worldIndex)
    ) {
      return (parsed as { worldIndex: number }).worldIndex;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * **`world_index` courant de l'enfant** (buffer WORLDGEN §3) = **max** `world_index` **atteint**
 * dans `progress` (la progression est la trace des mondes joués). `-1` si aucune progression
 * (base neuve) → la fenêtre de buffer démarre alors au monde 0 (`currentIndex + 1 = 0`).
 *
 * Mondes **partagés** entre profils du foyer (WORLDGEN §1, pas de FK profil sur `worlds`) → le
 * buffer suit le **foyer** : max sur **tous** les profils (le plus avancé tire l'avance pour tous).
 * Lecture seule. C'est la **source de vérité** du `currentIndex` passé à `ensureBuffer` en prod
 * (le daemon appelle ce dérivateur) ; les tests peuvent passer un `currentIndex` explicite.
 */
export function currentWorldIndexFromProgress(db: AppDatabase): number {
  const row = db
    .select({ max: sql<number | null>`max(${progress.worldIndex})` })
    .from(progress)
    .get();
  // `MAX` renvoie NULL sur zéro ligne (aucune progression) → base neuve, index courant `-1`.
  return row?.max ?? -1;
}

/**
 * **Indices cibles du buffer** (géométrie **invariante**, rétro #123) : la fenêtre d'avance
 * `[currentIndex + 1 .. currentIndex + bufferAhead]`. Le **nombre** d'indices ne dépend QUE de
 * `bufferAhead` (config) — jamais d'un autre état runtime (dette, mondes déjà générés, budget) :
 * ces derniers filtrent **ensuite** ce qui est réellement enqueue, mais la **cible géométrique**
 * reste constante pour un `currentIndex` donné. Pure.
 *
 * @param currentIndex dernier `world_index` **atteint** par l'enfant (`-1` = base neuve).
 * @param bufferAhead nombre de mondes d'avance ⚙️ (`WorldGenConfig.bufferAhead`).
 */
export function bufferTargetIndices(currentIndex: number, bufferAhead: number): number[] {
  const targets: number[] = [];
  for (let offset = 1; offset <= bufferAhead; offset += 1) {
    const idx = currentIndex + offset;
    // Le buffer ne vise jamais un index négatif (`currentIndex ≥ -1`, `offset ≥ 1` ⇒ `idx ≥ 0`).
    // Borne défensive explicite (jamais de job pour un monde inexistant côté carte).
    if (idx >= 0) targets.push(idx);
  }
  return targets;
}

/** Résultat d'un `ensureBuffer` : les index effectivement enqueue + ceux sautés (budget/déjà pris). */
export interface EnsureBufferResult {
  /** Index pour lesquels un job `generate_world` `pending` a été inséré (ordre croissant). */
  readonly enqueued: number[];
  /** Index **cibles** sautés car un plafond budgétaire a été atteint (WORLDGEN §2). */
  readonly skippedForBudget: number[];
  /** Index **cibles** sautés car déjà couverts (monde existant ou job actif) — idempotence. */
  readonly skippedExisting: number[];
}

/**
 * **Garantit le buffer d'avance** (WORLDGEN §3) : pour chaque index cible de la fenêtre
 * `[currentIndex + 1 .. currentIndex + bufferAhead]`, si le monde n'existe pas **et** qu'aucun
 * job actif ne le couvre déjà, on **enqueue** un job `generate_world` `pending` — tant que le
 * **plafond budgétaire mensuel** l'autorise (WORLDGEN §2, rétro #155).
 *
 * **Budget qui AGIT** : dès qu'un enqueue ferait `dépense + coût_prochain > plafond`, on cesse
 * d'enqueue (les index restants → `skippedForBudget`). La dépense **projetée** cumule la dépense
 * déjà engagée ce mois (mondes générés) + le coût des jobs enqueue **dans cet appel**, pour ne
 * jamais franchir le plafond en une seule rafale. Sans compteur de coût persisté (pas de
 * changement de contrat data), le coût enqueue est estimé au coût prudent/monde.
 *
 * **Idempotence** (#82) : un index déjà couvert (monde existant OU job actif) est **sauté** — on
 * n'enqueue jamais deux fois le même monde. **Géométrie invariante** (#123) : la **cible**
 * (`bufferTargetIndices`) ne dépend que de `currentIndex + bufferAhead`.
 *
 * @param currentIndex dernier `world_index` **atteint** par l'enfant (`-1` = base neuve).
 * @param overrides dépendances injectées (horloge, config) — le générateur n'est PAS utilisé ici.
 */
export function ensureBuffer(
  db: AppDatabase,
  currentIndex: number,
  overrides?: Partial<WorkerDeps>,
): EnsureBufferResult {
  const deps = resolveWorkerDeps(overrides);
  const { config } = deps;
  const now = deps.now();

  const targets = bufferTargetIndices(currentIndex, config.bufferAhead);
  const enqueued: number[] = [];
  const skippedForBudget: number[] = [];
  const skippedExisting: number[] = [];

  // Dépense déjà engagée ce mois (mondes générés). On y ajoute le coût des jobs qu'on enqueue
  // dans cet appel pour ne jamais franchir le plafond en une seule rafale d'enqueue.
  let projectedSpend = currentMonthSpendEur(db, now);

  for (const worldIndex of targets) {
    // Idempotence : ne jamais ré-enqueue un monde déjà présent ou déjà en file active (#82).
    if (worldExists(db, worldIndex) || hasActiveJobForWorld(db, worldIndex)) {
      skippedExisting.push(worldIndex);
      continue;
    }
    // Budget qui AGIT (WORLDGEN §2, rétro #155) : refuser d'enqueue si le prochain monde
    // dépasserait le plafond mensuel. Garde stricte sur le dépassement (`≤` toléré).
    if (!budgetAllowsNextWorld(projectedSpend, config)) {
      skippedForBudget.push(worldIndex);
      continue;
    }
    db.insert(jobs)
      .values({
        type: GENERATE_WORLD_JOB,
        payload: serializeJobPayload(worldIndex),
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    projectedSpend += ESTIMATED_EUR_PER_WORLD;
    enqueued.push(worldIndex);
  }

  return { enqueued, skippedForBudget, skippedExisting };
}

/** Résultat de `processNextJob` : le job traité + son issue (aucun job → `idle`). */
export type ProcessResult =
  | { readonly outcome: "idle" }
  | { readonly outcome: "done"; readonly jobId: number; readonly worldIndex: number }
  | {
      readonly outcome: "retry";
      readonly jobId: number;
      readonly worldIndex: number;
      readonly attempts: number;
    }
  | {
      readonly outcome: "failed";
      readonly jobId: number;
      readonly worldIndex: number;
      readonly attempts: number;
    };

/**
 * Prend le **prochain job `pending`** (FIFO par `id`), le passe `running`, appelle le générateur
 * (6.3, injecté → **zéro appel réseau réel** en test), puis persiste **atomiquement** le monde
 * `buffered` + le job `done`. Sur échec du générateur : `attempts += 1` + `last_error` ; le job
 * repasse `pending` (re-tentable) tant que `attempts ≤ maxRetries`, sinon `failed` (le monde
 * reste sur le fallback 6.6). Aucun job → `{ outcome: "idle" }`.
 *
 * **Transaction multi-écritures** (#122/#124) : la génération (async) tourne **hors** transaction
 * (better-sqlite3 n'accepte pas d'`await` dans `db.transaction`) ; le générateur persiste déjà le
 * monde `worlds`/`characters` (6.3). La transaction du worker enveloppe les **≥2 écritures** de
 * **finalisation** : (1) mise à jour du monde en `status = buffered` (garantie explicite) puis
 * (2) mise à jour du job en `status = done`. Si la 2ᵉ (job `done`) échoue **après** la 1ʳᵉ, tout
 * rollback (ni le monde `buffered` ni le job `done` ne persistent) → pas d'état partiel « monde
 * livré mais job jamais fermé » qui re-générerait à l'infini. Mutation-prouvé (test dédié).
 *
 * **Marquage `running` séparé** (avant l'await) : un job pris est immédiatement `running` (visible
 * par la reprise après crash) — cette écriture est **distincte** de la transaction de finalisation.
 */
export async function processNextJob(
  db: AppDatabase,
  overrides?: Partial<WorkerDeps>,
): Promise<ProcessResult> {
  const deps = resolveWorkerDeps(overrides);
  const now = deps.now();

  // ── Prendre le prochain job pending (FIFO par id) ──
  // On ne lit QUE les colonnes consommées (`id`/`payload`/`attempts`) — pas `status`/`updated_at`
  // (déjà connus/réécrits). Sélection explicite (pas `.select()` global) : garde la lecture amont
  // découplée des colonnes que la finalisation ÉCRIT, ce qui permet un test de rollback non-vacuous
  // (la panne frappe l'écriture gardée, jamais cette lecture — règle #122).
  const job = db
    .select({ id: jobs.id, payload: jobs.payload, attempts: jobs.attempts })
    .from(jobs)
    .where(and(eq(jobs.type, GENERATE_WORLD_JOB), eq(jobs.status, "pending")))
    .orderBy(jobs.id)
    .limit(1)
    .get();
  if (job === undefined) return { outcome: "idle" };

  const worldIndex = parseWorldIndex(job.payload);
  if (worldIndex === null) {
    // Payload corrompu = job non traitable → `failed` immédiat (jamais de boucle infinie sur un
    // job illisible). Écriture unique (pas d'état partiel à annuler) → pas de transaction.
    db.update(jobs)
      .set({
        status: "failed",
        lastError: "payload illisible (worldIndex manquant)",
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id))
      .run();
    return { outcome: "failed", jobId: job.id, worldIndex: -1, attempts: job.attempts };
  }

  // ── Marquer `running` (écriture distincte, visible par la reprise après crash) ──
  db.update(jobs).set({ status: "running", updatedAt: now }).where(eq(jobs.id, job.id)).run();

  // ── Générer (async, HORS transaction — zéro appel réseau réel en test via override) ──
  try {
    await deps.generate(db, themeForWorld(worldIndex).slug, worldIndex, []);
  } catch (error) {
    // Échec : incrémenter le compteur d'essais + tracer l'erreur. Écriture unique par branche
    // (pas d'état partiel à annuler → pas de transaction, LEARNINGS #124).
    const attempts = job.attempts + 1;
    const lastError = error instanceof Error ? error.message : String(error);
    // `attempts` compte les essais CONSOMMÉS ; on tolère jusqu'à `maxRetries` **ré-essais** au-delà
    // du 1er → `failed` dès que `attempts > maxRetries` (1er essai = attempts 1, puis maxRetries
    // ré-essais → seuil `1 + maxRetries`). Le monde reste sur fallback 6.6 (`failed`).
    const nextStatus: JobStatus = attempts > deps.config.maxRetries ? "failed" : "pending";
    db.update(jobs)
      .set({ status: nextStatus, attempts, lastError, updatedAt: now })
      .where(eq(jobs.id, job.id))
      .run();
    return {
      outcome: nextStatus === "failed" ? "failed" : "retry",
      jobId: job.id,
      worldIndex,
      attempts,
    };
  }

  // ── Succès : finaliser ATOMIQUEMENT (monde `buffered` PUIS job `done`) ──
  // Transaction multi-écritures (#122) : la 2ᵉ écriture (job `done`) protégée derrière la 1ʳᵉ
  // (monde `buffered`). Une panne de la 2ᵉ rollback la 1ʳᵉ → jamais « monde livré, job ouvert ».
  db.transaction((tx) => {
    // 1ʳᵉ écriture : garantir le statut `buffered` du monde généré (WORLDGEN §3, avant QA 6.5).
    tx.update(worlds).set({ status: "buffered" }).where(eq(worlds.index, worldIndex)).run();
    // 2ᵉ écriture (gardée) : fermer le job. Si elle échoue APRÈS la 1ʳᵉ → rollback complet.
    tx.update(jobs).set({ status: "done", updatedAt: now }).where(eq(jobs.id, job.id)).run();
  });

  return { outcome: "done", jobId: job.id, worldIndex };
}

/**
 * **Reprise après crash** (WORLDGEN §3, DoD 6.4) : au **boot** du worker, tout job resté `running`
 * est **orphelin** (le worker précédent est mort avant de le fermer — mono-worker, STACK.md : un
 * seul daemon consomme la file, donc aucun `running` n'est légitimement « en cours » au boot). On
 * les remet `pending` → **re-tentables**, sans perte (le job repart) ni double (l'idempotence de
 * `processNextJob`/`generateWorld` par `world_index` empêche un 2ᵉ monde). Renvoie le nombre de
 * jobs récupérés.
 *
 * **Écriture unique** (un seul `UPDATE … WHERE status = 'running'`) → aucun état partiel à annuler
 * ⇒ **pas de transaction** (un test de rollback serait vacuous, interdit — rétro #124).
 */
export function recoverStaleJobs(db: AppDatabase, overrides?: Partial<WorkerDeps>): number {
  const deps = resolveWorkerDeps(overrides);
  const now = deps.now();
  const result = db
    .update(jobs)
    .set({ status: "pending", updatedAt: now })
    .where(eq(jobs.status, "running"))
    .run();
  return result.changes;
}

/** Résultat d'un tick de daemon : la reprise (au 1er tick) + le buffer + le traitement du job. */
export interface WorkerTickResult {
  /** Jobs orphelins récupérés (seulement au tick de boot, si `recover` demandé). */
  readonly recovered: number;
  /** Buffer garanti pour le `currentIndex` fourni (index enqueue / sautés). */
  readonly buffer: EnsureBufferResult;
  /** Issue du traitement d'un job (au plus un par tick). */
  readonly processed: ProcessResult;
}

/**
 * **Un tick de la boucle daemon** (orchestration fine, testable) : (0) au boot, récupère les jobs
 * orphelins (`recover`) ; (1) garantit le buffer d'avance pour `currentIndex` ; (2) traite **un**
 * job `pending`. Le daemon Forge appelle `runWorkerTick` en boucle (avec `recover: true` au 1er
 * tick seulement). Le générateur reste injecté → zéro appel réseau réel en test.
 *
 * @param currentIndex dernier `world_index` atteint par l'enfant (dérivé de `progress` par l'appelant).
 * @param options `recover` = exécuter la reprise après crash avant ce tick (boot).
 */
export async function runWorkerTick(
  db: AppDatabase,
  currentIndex: number,
  options: { readonly recover?: boolean } = {},
  overrides?: Partial<WorkerDeps>,
): Promise<WorkerTickResult> {
  const recovered = options.recover === true ? recoverStaleJobs(db, overrides) : 0;
  const buffer = ensureBuffer(db, currentIndex, overrides);
  const processed = await processNextJob(db, overrides);
  return { recovered, buffer, processed };
}
