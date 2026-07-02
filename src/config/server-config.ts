/**
 * Configuration serveur centralisée (paramètres ⚙️ + secrets).
 *
 * - Source unique des paramètres réglables ⚙️ : jamais de constante magique en dur.
 * - L'environnement est lu et validé au BOOT (fail-fast) — cf. `src/instrumentation.ts`.
 * - SERVER-ONLY : contient des secrets (clé API). Ne jamais importer dans un composant
 *   client. En production, les valeurs viennent de Forge env / GitHub Secrets
 *   (cf. WORKFLOW.md §15).
 */

// Import RELATIF (pas l'alias `@`) : ce module est consommé HORS runtime Next
// (`db:migrate` tsx, drizzle-kit, vitest) où le résolveur de paths de Next
// n'existe pas. `domain.ts` est un module **pur** (aucun `server-only`/argon2/DB —
// LEARNINGS #34) → import sûr ici. On n'importe QUE le type `Skill` + la liste
// `SKILLS` (valeur pure), rien d'autre du moteur.
import { SKILLS, type Skill } from "../lib/engine/domain";

export type AppMode = "development" | "test" | "production";

export interface DatabaseConfig {
  /** Chemin du fichier SQLite local (`DATABASE_PATH`). */
  path: string;
  /** ⚙️ `busy_timeout` SQLite en ms (concurrence daemon web + worker). */
  busyTimeoutMs: number;
  /** ⚙️ mode journal SQLite. */
  journalMode: "WAL";
}

export interface ImageModelConfig {
  /** Clé API du modèle d'image (Gemini) — requise en production. */
  apiKey: string;
  /** ⚙️ identifiant du modèle d'image (Nano Banana / Gemini). */
  model: string;
}

/**
 * Paramètres ⚙️ argon2id (hash des PIN). Défauts alignés OWASP (argon2id, ~19 MiB,
 * t=2, p=1) — cf. AUTH.md §3. Centralisés ici : la couche auth ne fige rien.
 */
export interface Argon2Config {
  /** Mémoire en KiB. */
  memoryCost: number;
  /** Itérations. */
  timeCost: number;
  /** Parallélisme. */
  parallelism: number;
}

/**
 * Paramètres ⚙️ du rate-limit / backoff des tentatives de PIN (AUTH.md §4).
 * **Posés** ici en #2.1 ; **consommés** par la story #2.4. Backoff croissant,
 * jamais de verrou permanent (c'est un enfant).
 */
export interface RateLimitConfig {
  /** Échecs tolérés par profil avant backoff. */
  maxAttemptsPerProfile: number;
  /** Échecs tolérés par IP avant backoff. */
  maxAttemptsPerIp: number;
  /** Délai de base du backoff (ms), appliqué au 1ᵉʳ dépassement. */
  backoffBaseMs: number;
  /** Facteur multiplicatif du backoff à chaque échec supplémentaire. */
  backoffFactor: number;
  /** Plafond du délai de backoff (ms) — borne la croissance. */
  backoffMaxMs: number;
}

/**
 * Config ⚙️ de l'auth-lite (AUTH.md). Durées de session (enfant longue, parent
 * courte), coût de hash, seuils de rate-limit. Aucune valeur en dur ailleurs.
 */
export interface AuthConfig {
  /** Durée de la session enfant (ms) — confort multi-appareils (~30 j). */
  childSessionMs: number;
  /** Durée de la session parent (ms) — courte, re-demande le PIN (~15 min). */
  parentSessionMs: number;
  argon2: Argon2Config;
  rateLimit: RateLimitConfig;
}

/** Seuils de fluence ⚙️ (ms) par compétence — « rapide » = `response_ms ≤ seuil`. */
export type FluenceThresholdsMs = Record<Skill, number>;

/**
 * Config ⚙️ du **moteur pédagogique** (ENGINE.md §11). **Posée** ici (contrat
 * partagé de l'épic #3) ; **consommée** par les stories 3.3–3.7 (maîtrise,
 * sélection, composition de niveau, interleaving, étoiles) — pas ici. Source unique
 * de tous les paramètres à calibrer du moteur : aucune valeur en dur ailleurs.
 *
 * ⚠️ Les **bornes de domaine** des faits (opérandes, somme max…) restent dans
 * `src/lib/engine/domain.ts` (moteur pur) — elles ne migrent PAS ici.
 */
export interface EngineConfig {
  /**
   * Délais des boîtes Leitner **en jours**, indexés par la boîte 0..5 (ENGINE §2).
   * `[0, 1, 2, 4, 9, 21]` : boîte 0 = même session, boîte 5 = entretien (21 j).
   */
  leitnerDelaysDays: readonly number[];
  /** Seuils de fluence (ms) par compétence : « rapide » sous ce seuil (ENGINE §2). */
  fluenceThresholdsMs: FluenceThresholdsMs;
  /** Boîtes gagnées quand juste + rapide (promotion, ENGINE §2/§11). */
  promoteBoxes: number;
  /** Boîtes perdues quand faux / « je ne sais pas » (rétrograde, ENGINE §2/§11). */
  demoteBoxes: number;
  /** Boîte maximale (dernière boîte Leitner) — borne haute de la force. */
  maxBox: number;
  /** `NEW_MAX_PAR_NIVEAU` : nouveaux faits max introduits par niveau (ENGINE §7). */
  newMaxPerLevel: number;
  /** `NEW_MAX_PAR_JOUR` : nouveaux faits max introduits par jour (ENGINE §7). */
  newMaxPerDay: number;
  /** `SEUIL_CONSO` : si ≥ ce nb de facts à `box ≤ 1` → 0 nouveau (ENGINE §7). */
  consolidationThreshold: number;
  /** Boîte « fragile » : `box ≤ ce seuil` compte pour la consolidation (ENGINE §7). */
  consolidationMaxBox: number;
  /** Bascule interleaving : maîtrise ≥ ce ratio (facts à `box ≥ …`) → mélange (ENGINE §7). */
  interleaveThresholdRatio: number;
  /** Boîte plancher de la bascule interleaving (`box ≥ …`, ENGINE §7). */
  interleaveMinBox: number;
  /** Déclencheur Tier suivant : maîtrise ≥ ce ratio (facts à `box ≥ …`) (ENGINE §8/§11). */
  tierUnlockRatio: number;
  /** Boîte plancher du déclencheur de Tier (`box ≥ …`, ENGINE §11). */
  tierUnlockMinBox: number;
  /** Seuils d'étoiles (ratio de réussite d'un niveau) : 1★ / 2★ / 3★ (ENGINE §5/§11). */
  starThresholds: readonly [number, number, number];
  /** Anti-mash : réponse sous ce délai (ms) = ignorée (anti-triche, ENGINE §9/§11). */
  antiMashMs: number;
  /** Taille du diagnostic de départ (~nb de calculs, ENGINE §3/§11). */
  diagnosticSize: number;
}

export interface AppConfig {
  mode: AppMode;
  database: DatabaseConfig;
  imageModel: ImageModelConfig;
  auth: AuthConfig;
  engine: EngineConfig;
}

/** Valeurs par défaut ⚙️ centralisées (surchargées par l'environnement). */
export const CONFIG_DEFAULTS = {
  database: {
    path: "./data/multiplyz.sqlite",
    busyTimeoutMs: 5000,
    journalMode: "WAL",
  },
  imageModel: {
    model: "gemini-2.5-flash-image",
  },
  auth: {
    // 30 j (confort) / 15 min (parent, re-PIN) — cf. AUTH.md §3.
    childSessionMs: 30 * 24 * 60 * 60 * 1000,
    parentSessionMs: 15 * 60 * 1000,
    argon2: {
      // OWASP argon2id : 19 MiB, t=2, p=1.
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    },
    rateLimit: {
      maxAttemptsPerProfile: 5,
      maxAttemptsPerIp: 15,
      backoffBaseMs: 1_000,
      backoffFactor: 2,
      backoffMaxMs: 5 * 60 * 1000,
    },
  },
  engine: {
    // Délais boîtes Leitner (j) : 0 · 1 · 2 · 4 · 9 · 21 (ENGINE §2/§11).
    leitnerDelaysDays: [0, 1, 2, 4, 9, 21],
    // Seuils fluence (ms) : compléments/add 3 s, sous/mult 4 s (ENGINE §2/§11).
    fluenceThresholdsMs: {
      comp10: 3_000,
      add: 3_000,
      sub: 4_000,
      mult: 4_000,
    },
    // Promotion juste+rapide → +1 ; faux → −2 (ENGINE §2/§11).
    promoteBoxes: 1,
    demoteBoxes: 2,
    // Boîte max = dernière boîte Leitner (6 boîtes 0..5 → max 5).
    maxBox: 5,
    // Rythme prudent (ENGINE §7/§11).
    newMaxPerLevel: 2,
    newMaxPerDay: 5,
    consolidationThreshold: 8,
    consolidationMaxBox: 1,
    // Bascule interleaving : 40 % à box≥3 (ENGINE §7/§11).
    interleaveThresholdRatio: 0.4,
    interleaveMinBox: 3,
    // Déclencheur Tier suivant : 85 % à box≥4 (ENGINE §8/§11).
    tierUnlockRatio: 0.85,
    tierUnlockMinBox: 4,
    // Seuils étoiles : 60 / 85 / 100 % (ENGINE §5/§11).
    starThresholds: [0.6, 0.85, 1.0],
    // Anti-mash : < 600 ms (ENGINE §9/§11).
    antiMashMs: 600,
    // Diagnostic : ~18 calculs (ENGINE §3/§11).
    diagnosticSize: 18,
  },
} as const;

/** Variables d'environnement requises en production (fail-fast si absentes). */
export const REQUIRED_IN_PRODUCTION = ["GEMINI_API_KEY"] as const;

/** Erreur de configuration au démarrage (message explicite). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function resolveMode(nodeEnv: string | undefined): AppMode {
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "test";
  return "development";
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Parse un entier **≥ 0** (accepte 0, contrairement à `parsePositiveInt`).
 * Utilisé pour les paramètres du moteur où 0 est légitime (ex. `promoteBoxes`,
 * délai de la boîte 0).
 */
function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * Parse un **ratio** dans `]0, 1]` (seuils de maîtrise / étoiles, ENGINE §5/§7/§8).
 * Hors intervalle ou non numérique → défaut. Borne haute inclusive (1 = 100 %).
 */
function parseRatio(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

/**
 * Parse une **liste d'entiers ≥ 0** séparés par virgule (ex. délais des boîtes
 * `"0,1,2,4,9,21"`). Tout élément invalide (non entier / négatif), une longueur
 * différente du défaut, ou une liste vide → défaut (contrat = 6 boîtes, ENGINE §2).
 */
function parseIntList(raw: string | undefined, fallback: readonly number[]): number[] {
  if (raw === undefined) return [...fallback];
  const parts = raw.split(",");
  if (parts.length !== fallback.length) return [...fallback];
  const parsed = parts.map((p) => Number.parseInt(p.trim(), 10));
  return parsed.every((n) => Number.isInteger(n) && n >= 0) ? parsed : [...fallback];
}

/**
 * Parse un **triplet de ratios croissants** `]0,1]` (seuils d'étoiles 1★/2★/3★,
 * ENGINE §5). Exactement 3 valeurs, chacune un ratio valide, strictement
 * croissantes (`s1 < s2 < s3`) — sinon défaut. Le tri croissant est un invariant
 * du contrat (une 3ᵉ étoile est plus dure qu'une 1ʳᵉ).
 */
function parseStarThresholds(
  raw: string | undefined,
  fallback: readonly [number, number, number],
): [number, number, number] {
  if (raw === undefined) return [...fallback];
  const parts = raw.split(",");
  if (parts.length !== 3) return [...fallback];
  const [s1, s2, s3] = parts.map((p) => Number.parseFloat(p.trim()));
  const valid = [s1, s2, s3].every((n) => Number.isFinite(n) && n > 0 && n <= 1);
  return valid && s1 < s2 && s2 < s3 ? [s1, s2, s3] : [...fallback];
}

/**
 * Bloc auth de la config, isolé en fonction pure. Source unique des ⚙️ auth
 * (durées de session, coût argon2id, seuils de rate-limit). Les secrets ne sont
 * pas requis ici : les tokens de session sont **opaques** (aléa CSPRNG stocké
 * serveur), pas de secret de signature à valider — cf. AUTH.md §3.
 */
export function loadAuthConfig(env: Env): AuthConfig {
  const d = CONFIG_DEFAULTS.auth;
  return {
    childSessionMs: parsePositiveInt(env.AUTH_CHILD_SESSION_MS, d.childSessionMs),
    parentSessionMs: parsePositiveInt(env.AUTH_PARENT_SESSION_MS, d.parentSessionMs),
    argon2: {
      memoryCost: parsePositiveInt(env.AUTH_ARGON2_MEMORY_KIB, d.argon2.memoryCost),
      timeCost: parsePositiveInt(env.AUTH_ARGON2_TIME_COST, d.argon2.timeCost),
      parallelism: parsePositiveInt(env.AUTH_ARGON2_PARALLELISM, d.argon2.parallelism),
    },
    rateLimit: {
      maxAttemptsPerProfile: parsePositiveInt(
        env.AUTH_MAX_PIN_ATTEMPTS,
        d.rateLimit.maxAttemptsPerProfile,
      ),
      maxAttemptsPerIp: parsePositiveInt(
        env.AUTH_IP_MAX_PIN_ATTEMPTS,
        d.rateLimit.maxAttemptsPerIp,
      ),
      backoffBaseMs: parsePositiveInt(env.AUTH_BACKOFF_BASE_MS, d.rateLimit.backoffBaseMs),
      backoffFactor: parsePositiveNumber(env.AUTH_BACKOFF_FACTOR, d.rateLimit.backoffFactor),
      backoffMaxMs: parsePositiveInt(env.AUTH_BACKOFF_MAX_MS, d.rateLimit.backoffMaxMs),
    },
  };
}

/**
 * Bloc DB de la config, isolé en fonction pure. Source unique des ⚙️ DB
 * (`DATABASE_PATH`, `SQLITE_BUSY_TIMEOUT_MS`, `journalMode`) — cf. ADR 0002.
 *
 * Volontairement SANS la validation des secrets (`GEMINI_API_KEY`) : la couche
 * SQLite, le script de migration et drizzle-kit tournent HORS runtime Next et
 * ne doivent pas exiger la clé image pour lire le chemin / le busy_timeout.
 */
export function loadDatabaseConfig(env: Env): DatabaseConfig {
  return {
    path: env.DATABASE_PATH?.trim() || CONFIG_DEFAULTS.database.path,
    busyTimeoutMs: parsePositiveInt(
      env.SQLITE_BUSY_TIMEOUT_MS,
      CONFIG_DEFAULTS.database.busyTimeoutMs,
    ),
    journalMode: CONFIG_DEFAULTS.database.journalMode,
  };
}

/**
 * Bloc **moteur pédagogique** de la config, isolé en fonction pure (ENGINE §11).
 * Source unique des ⚙️ du moteur, tous surchargeables par l'environnement (mêmes
 * conventions que `loadAuthConfig`). Défauts = valeurs de départ d'ENGINE §11.
 *
 * **Posé** ici (contrat épic #3) ; **consommé** par 3.3–3.7 — pas dans cette story.
 * Comme `loadDatabaseConfig`, sans validation de secrets : réglages purs, pas de clé.
 */
export function loadEngineConfig(env: Env): EngineConfig {
  const d = CONFIG_DEFAULTS.engine;
  // Seuils de fluence par compétence : surcharge par `ENGINE_FLUENCE_MS_<SKILL>`
  // (ex. `ENGINE_FLUENCE_MS_MULT`). Itère sur SKILLS (source unique, ENGINE §1)
  // pour n'oublier aucune compétence.
  const fluenceThresholdsMs = {} as Record<Skill, number>;
  for (const skill of SKILLS) {
    fluenceThresholdsMs[skill] = parsePositiveInt(
      env[`ENGINE_FLUENCE_MS_${skill.toUpperCase()}`],
      d.fluenceThresholdsMs[skill],
    );
  }
  return {
    leitnerDelaysDays: parseIntList(env.ENGINE_LEITNER_DELAYS_DAYS, d.leitnerDelaysDays),
    fluenceThresholdsMs,
    promoteBoxes: parseNonNegativeInt(env.ENGINE_PROMOTE_BOXES, d.promoteBoxes),
    demoteBoxes: parseNonNegativeInt(env.ENGINE_DEMOTE_BOXES, d.demoteBoxes),
    maxBox: parseNonNegativeInt(env.ENGINE_MAX_BOX, d.maxBox),
    newMaxPerLevel: parseNonNegativeInt(env.ENGINE_NEW_MAX_PER_LEVEL, d.newMaxPerLevel),
    newMaxPerDay: parseNonNegativeInt(env.ENGINE_NEW_MAX_PER_DAY, d.newMaxPerDay),
    consolidationThreshold: parsePositiveInt(
      env.ENGINE_CONSOLIDATION_THRESHOLD,
      d.consolidationThreshold,
    ),
    consolidationMaxBox: parseNonNegativeInt(
      env.ENGINE_CONSOLIDATION_MAX_BOX,
      d.consolidationMaxBox,
    ),
    interleaveThresholdRatio: parseRatio(
      env.ENGINE_INTERLEAVE_THRESHOLD_RATIO,
      d.interleaveThresholdRatio,
    ),
    interleaveMinBox: parseNonNegativeInt(env.ENGINE_INTERLEAVE_MIN_BOX, d.interleaveMinBox),
    tierUnlockRatio: parseRatio(env.ENGINE_TIER_UNLOCK_RATIO, d.tierUnlockRatio),
    tierUnlockMinBox: parseNonNegativeInt(env.ENGINE_TIER_UNLOCK_MIN_BOX, d.tierUnlockMinBox),
    starThresholds: parseStarThresholds(env.ENGINE_STAR_THRESHOLDS, d.starThresholds),
    antiMashMs: parsePositiveInt(env.ENGINE_ANTI_MASH_MS, d.antiMashMs),
    diagnosticSize: parsePositiveInt(env.ENGINE_DIAGNOSTIC_SIZE, d.diagnosticSize),
  };
}

/**
 * Construit la config typée depuis un environnement. Fonction pure (testable).
 * En mode `production`, lève `ConfigError` si une variable requise manque (fail-fast).
 */
export function loadConfig(env: Env): AppConfig {
  const mode = resolveMode(env.NODE_ENV);

  if (mode === "production") {
    const missing = REQUIRED_IN_PRODUCTION.filter((key) => {
      const value = env[key];
      return value === undefined || value.trim() === "";
    });
    if (missing.length > 0) {
      throw new ConfigError(
        `Configuration invalide au démarrage : variable(s) d'environnement requise(s) ` +
          `manquante(s) — ${missing.join(", ")}. Copie .env.example vers .env ` +
          `(ou configure Forge env) et renseigne ces clés.`,
      );
    }
  }

  return {
    mode,
    database: loadDatabaseConfig(env),
    imageModel: {
      apiKey: env.GEMINI_API_KEY ?? "",
      model: env.IMAGE_MODEL?.trim() || CONFIG_DEFAULTS.imageModel.model,
    },
    auth: loadAuthConfig(env),
    engine: loadEngineConfig(env),
  };
}

let cached: AppConfig | null = null;

/** Config applicative (mémoïsée) lue depuis `process.env`. */
export function getConfig(): AppConfig {
  cached ??= loadConfig(process.env);
  return cached;
}

/**
 * Bloc auth de la config applicative (mémoïsé). Consommé par la couche auth
 * (hash, sessions, rate-limit) qui tourne DANS le runtime Next.
 */
export function getAuthConfig(): AuthConfig {
  return getConfig().auth;
}

/**
 * Bloc moteur de la config applicative (mémoïsé). Consommé par les stories du
 * moteur (maîtrise, sélection, composition de niveau, interleaving, étoiles) qui
 * tournent DANS le runtime Next.
 */
export function getEngineConfig(): EngineConfig {
  return getConfig().engine;
}

/** Réinitialise le cache de config (tests / hot-reload). */
export function resetConfigCache(): void {
  cached = null;
}
