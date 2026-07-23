/**
 * **Amorçage E2E de la boutique / œufs** (story R4.2 #393) — un profil dédié **avec des pièces** pour
 * exercer la boucle de DÉPENSE (acheter un œuf → tirage → ouverture). Le **catalogue** de créatures
 * (communes/rares du pool d'œufs) est déjà amorcé par `db:migrate` (`runMigrations` →
 * `seedSocleCreatures`, câblage #382) : rien à seeder côté catalogue. Ici on pose seulement le
 * **profil + session + portefeuille garni** (comme `seed-collection.ts`/`seed-sibling.ts`) →
 * insertion directe en base, DANS la chaîne `webServer` (APRÈS `db:migrate`, AVANT `next dev`),
 * **même contexte** (cwd + `DATABASE_PATH`) que le serveur.
 *
 * Profil **dédié** (`Pixie`, distinct des autres profils E2E) + session enfant injectée : le test
 * atteint `/boutique` sans dépendre de la progression des autres tests `describe.serial` (surface
 * disjointe). Le profil **ne possède aucune créature** → tout tirage du monde 0 est une **nouveauté**
 * au **VRAI art committé** (`creature_world_0_*.png`, servis par `seed-creature-sprites`) : la
 * révélation rend une image réelle (`data-asset-state="rendered"`) — preuve #180 bout-en-bout.
 *
 * Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors résolveur de paths Next. **Aucun
 * effet de bord à l'import** (le CLI est séparé) : `e2e/auth.spec.ts` importe librement les constantes.
 */
import Database from "better-sqlite3";
import { hash } from "@node-rs/argon2";
import { resolveDatabasePath } from "../src/lib/db/config";
import { nameKey } from "../src/lib/auth/validation";

/** Prénom du profil dédié à la boutique E2E (unique dans le foyer E2E). */
export const BOUTIQUE_PROFILE_NAME = "Pixie";
/** PIN enfant du profil dédié (≠ autres profils E2E). */
export const BOUTIQUE_PROFILE_PIN = "7777";
/** Portrait (id valide du catalogue AVATARS). */
export const BOUTIQUE_PROFILE_AVATAR = "cat";
/** Token de session enfant amorcé pour ce profil (injecté par le test comme cookie `mz_session`). */
export const BOUTIQUE_SESSION_TOKEN = "e2e-393-boutique-session-token";
/** Pièces de départ — large (l'œuf coûte 50) pour supporter plusieurs tirages/relances locales. */
export const BOUTIQUE_START_COINS = 500;

/**
 * Insère le profil dédié + session + portefeuille garni (**idempotent** — profil réutilisé par nom,
 * `INSERT OR IGNORE` sur la session, upsert du portefeuille qui **réinitialise** le solde à chaque
 * amorçage). `foreign_keys = ON` : profil AVANT session/portefeuille (FK honorées).
 */
export async function seedBoutique(): Promise<number> {
  const pinHash = await hash(BOUTIQUE_PROFILE_PIN);
  const db = new Database(resolveDatabasePath());
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    const existing = db
      .prepare("SELECT id FROM profiles WHERE name = ?")
      .get(BOUTIQUE_PROFILE_NAME) as { id: number } | undefined;
    const profileId =
      existing?.id ??
      Number(
        db
          .prepare("INSERT INTO profiles (name, name_key, avatar, pin_hash) VALUES (?, ?, ?, ?)")
          .run(
            BOUTIQUE_PROFILE_NAME,
            nameKey(BOUTIQUE_PROFILE_NAME),
            BOUTIQUE_PROFILE_AVATAR,
            pinHash,
          ).lastInsertRowid,
      );

    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
    db.prepare(
      "INSERT OR IGNORE INTO sessions (token, profile_id, kind, expires_at) VALUES (?, ?, 'child', ?)",
    ).run(BOUTIQUE_SESSION_TOKEN, profileId, expiresAtSec);

    // Portefeuille garni — upsert qui RÉINITIALISE le solde à chaque amorçage (un run précédent a pu
    // dépenser des pièces ; le test doit toujours pouvoir acheter). `updated_at` = maintenant.
    db.prepare(
      `INSERT INTO wallet (profile_id, coins, shards, updated_at)
         VALUES (?, ?, 0, ?)
       ON CONFLICT(profile_id) DO UPDATE SET coins = excluded.coins, updated_at = excluded.updated_at`,
    ).run(profileId, BOUTIQUE_START_COINS, Math.floor(Date.now() / 1000));

    return profileId;
  } finally {
    db.close();
  }
}
