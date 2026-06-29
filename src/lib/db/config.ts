// Réglages SQLite centralisés (⚙️ — cf. STACK.md §Base de données, §Points à valider).
// Source unique pour la connexion applicative, le script de migration et drizzle-kit.

/**
 * `busy_timeout` (ms) : durée d'attente avant qu'une écriture concurrente
 * échoue en `SQLITE_BUSY`. Couvre la concurrence daemon web + worker IA sur la
 * même base WAL (cf. STACK.md §Points à valider). ⚙️ à calibrer au playtest.
 */
export const DB_BUSY_TIMEOUT_MS = 5000;

/** Chemin par défaut de la base locale (surchargé par l'env `DATABASE_PATH`). */
export const DEFAULT_DATABASE_PATH = "./data/multiplyz.sqlite";

/** Dossier des migrations versionnées (généré par drizzle-kit, joué en CI + deploy). */
export const MIGRATIONS_FOLDER = "drizzle";

/**
 * Résout le chemin du fichier SQLite : env `DATABASE_PATH` si défini et non vide,
 * sinon le défaut local. Le chemin est un secret d'environnement (jamais en dur).
 */
export function resolveDatabasePath(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.DATABASE_PATH?.trim();
  return fromEnv ? fromEnv : DEFAULT_DATABASE_PATH;
}
