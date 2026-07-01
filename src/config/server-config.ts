/**
 * Configuration serveur centralisée (paramètres ⚙️ + secrets).
 *
 * - Source unique des paramètres réglables ⚙️ : jamais de constante magique en dur.
 * - L'environnement est lu et validé au BOOT (fail-fast) — cf. `src/instrumentation.ts`.
 * - SERVER-ONLY : contient des secrets (clé API). Ne jamais importer dans un composant
 *   client. En production, les valeurs viennent de Forge env / GitHub Secrets
 *   (cf. WORKFLOW.md §15).
 */

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

export interface AppConfig {
  mode: AppMode;
  database: DatabaseConfig;
  imageModel: ImageModelConfig;
  auth: AuthConfig;
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

/** Réinitialise le cache de config (tests / hot-reload). */
export function resetConfigCache(): void {
  cached = null;
}
