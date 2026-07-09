/**
 * **Amorçage E2E d'un profil frère/sœur** (story 7.5). La **création** de profils frères/sœurs est
 * v2 (pas d'UI en v1, PRODUCT §1.5) — mais la story 7.5 doit prouver **bout-en-bout** la
 * suppression = purge + révocation de session sur un profil **non-propriétaire** (le propriétaire
 * est indestructible). On amorce donc un frère/sœur (`Zoé`) + une **session enfant** directement en
 * base, **dans la chaîne `webServer`** (cf. `seed-sibling.cli.ts` lancé par `playwright.config`,
 * APRÈS `db:migrate` et AVANT `next dev`) → **même contexte** (cwd + `DATABASE_PATH` via
 * `resolveDatabasePath`) que le serveur, exactement comme `seed-world-assets.ts`. Toute la
 * vérification côté test passe ensuite par le serveur (UI + cookie) — jamais par un accès fichier
 * concurrent (fragile en WAL + worktree symlinké).
 *
 * Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors résolveur de paths Next.
 * `resolveDatabasePath`/`nameKey`/`validation` sont purs (aucun secret). Le hash argon2id est
 * produit **directement** par `@node-rs/argon2` (params encodés DANS le hash → `verifyPin` du login
 * les relit ; inutile de recharger la config auth). **Aucun effet de bord à l'import** (le CLI est
 * séparé) : `e2e/auth.spec.ts` importe librement les constantes.
 */
import Database from "better-sqlite3";
import { hash } from "@node-rs/argon2";
import { resolveDatabasePath } from "../src/lib/db/config";
import { nameKey } from "../src/lib/auth/validation";

/** Prénom du frère/sœur amorcé (unique dans le foyer E2E). */
export const SIBLING_NAME = "Zoé";
/** PIN enfant initial du frère/sœur (≠ PIN enfant/parent du propriétaire). */
export const SIBLING_PIN = "2222";
/** Portrait (id valide du catalogue AVATARS). */
export const SIBLING_AVATAR = "rabbit";
/** Token de session enfant amorcé pour ce frère/sœur (preuve de révocation à la suppression). */
export const SIBLING_SESSION_TOKEN = "e2e-7dot5-sibling-session-token";

/**
 * Insère le profil frère/sœur + une session enfant valide (1 h). **Idempotent** : si `Zoé` existe
 * déjà (ré-exécution de la chaîne), on ne ré-insère pas (le prénom est UNIQUE). `foreign_keys = ON`
 * (comme `createDatabase`) : la FK `sessions.profile_id` est honorée (profil inséré AVANT la
 * session). `expires_at` en **secondes epoch** (drizzle `mode: "timestamp"`).
 */
export async function seedSibling(): Promise<number> {
  const pinHash = await hash(SIBLING_PIN);
  const db = new Database(resolveDatabasePath());
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    const existing = db.prepare("SELECT id FROM profiles WHERE name = ?").get(SIBLING_NAME) as
      { id: number } | undefined;
    const id =
      existing?.id ??
      Number(
        db
          .prepare("INSERT INTO profiles (name, name_key, avatar, pin_hash) VALUES (?, ?, ?, ?)")
          .run(SIBLING_NAME, nameKey(SIBLING_NAME), SIBLING_AVATAR, pinHash).lastInsertRowid,
      );
    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
    db.prepare(
      "INSERT OR IGNORE INTO sessions (token, profile_id, kind, expires_at) VALUES (?, ?, 'child', ?)",
    ).run(SIBLING_SESSION_TOKEN, id, expiresAtSec);
    return id;
  } finally {
    db.close();
  }
}
