/**
 * **Amorçage E2E d'une progression AVANCÉE sur la carte** (story #268, discovered
 * playtest-⚙️ « auto-scroll vers le nœud courant au montage »). Prouver l'ancrage E2E exige un
 * nœud **courant** qui n'est PAS le tout premier (`level_index=0`) — sinon la position initiale
 * (le nœud « départ » vit tout en BAS du chemin `column-reverse`, WIREFRAMES §2/§8) est déjà
 * proche du bord du document et le test ne distinguerait pas « auto-scroll fonctionne » de
 * « le nœud était déjà visible par hasard ». Jouer 6 niveaux en E2E pour y arriver serait lent et
 * hors-scope (le sujet est le SCROLL, pas la progression) — même patron que `seed-collection.ts`
 * (contourne un pré-requis de jeu long via une insertion **directe** en base, DANS la chaîne
 * `webServer`, cf. `seed-map-progress.cli.ts`, APRÈS `db:migrate` et AVANT `next dev`) → **même
 * contexte** (cwd + `DATABASE_PATH` via `resolveDatabasePath`) que le serveur qui lira la base.
 *
 * Profil **dédié** (`Milo`, distinct de `Léa`/`Zoé`/`Nino`) + session enfant amorcée directement :
 * le test injecte le cookie `mz_session` pour atteindre `/carte` sans dépendre de l'état
 * d'onboarding/progression des autres tests `describe.serial` (surface disjointe, zéro couplage
 * inter-tests, même garantie que `COLLECTION_SESSION_TOKEN`).
 *
 * **6 niveaux complétés** (`level_index` 0..5, `world_index=0`) → le prochain nœud non terminé
 * (`firstUnfinishedIndex`, `game/map.ts`) devient **courant** au `level_index=6` — le 7ᵉ nœud sur
 * 11 (⚙️ `levelsPerWorld=10` par défaut, non surchargé en E2E, MAP §6 : boss au dernier nœud) :
 * ni le tout premier nœud (au fond du chemin, potentiellement déjà visible) ni le boss (tout en
 * haut, potentiellement déjà visible sans scroll) — une position **médiane** qui EXIGE l'ancrage
 * pour être garantie visible au montage sur un viewport téléphone court (375×812).
 *
 * Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors résolveur de paths Next.
 * **Aucun effet de bord à l'import** (le CLI est séparé) : `e2e/auth.spec.ts` importe librement
 * les constantes.
 */
import Database from "better-sqlite3";
import { hash } from "@node-rs/argon2";
import { resolveDatabasePath } from "../src/lib/db/config";
import { nameKey } from "../src/lib/auth/validation";
import { progressKey } from "../src/lib/db/schema";

/** Prénom du profil dédié à la progression carte E2E (unique dans le foyer E2E). */
export const MAP_PROGRESS_PROFILE_NAME = "Milo";
/** PIN enfant du profil dédié (≠ Léa/Zoé/Nino/parent). */
export const MAP_PROGRESS_PROFILE_PIN = "5555";
/** Portrait (id valide du catalogue AVATARS). */
export const MAP_PROGRESS_PROFILE_AVATAR = "panda";
/** Token de session enfant amorcé pour ce profil. */
export const MAP_PROGRESS_SESSION_TOKEN = "e2e-268-map-progress-session-token";
/** Monde de la progression amorcée (le socle de secours, comme `Léa` — pas de collision : profil distinct). */
export const MAP_PROGRESS_WORLD_INDEX = 0;
/** Nombre de niveaux COMPLÉTÉS avant le nœud courant (cf. commentaire de tête : position médiane). */
export const MAP_PROGRESS_COMPLETED_LEVELS = 6;

/**
 * Insère le profil dédié + session + 6 lignes `progress` (niveaux 0..5 complétés, 2★ chacun).
 * **Idempotent** (`INSERT OR IGNORE` par PK, un rejeu de la chaîne `webServer` ne duplique rien).
 * `foreign_keys = ON` (comme `createDatabase`) : profil inséré AVANT session/progression (FK
 * honorées).
 */
export async function seedMapProgress(): Promise<number> {
  const pinHash = await hash(MAP_PROGRESS_PROFILE_PIN);
  const db = new Database(resolveDatabasePath());
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    const existing = db
      .prepare("SELECT id FROM profiles WHERE name = ?")
      .get(MAP_PROGRESS_PROFILE_NAME) as { id: number } | undefined;
    const profileId =
      existing?.id ??
      Number(
        db
          .prepare("INSERT INTO profiles (name, name_key, avatar, pin_hash) VALUES (?, ?, ?, ?)")
          .run(
            MAP_PROGRESS_PROFILE_NAME,
            nameKey(MAP_PROGRESS_PROFILE_NAME),
            MAP_PROGRESS_PROFILE_AVATAR,
            pinHash,
          ).lastInsertRowid,
      );

    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
    db.prepare(
      "INSERT OR IGNORE INTO sessions (token, profile_id, kind, expires_at) VALUES (?, ?, 'child', ?)",
    ).run(MAP_PROGRESS_SESSION_TOKEN, profileId, expiresAtSec);

    const insertProgress = db.prepare(
      `INSERT OR IGNORE INTO progress (id, profile_id, world_index, level_index, stars)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (let levelIndex = 0; levelIndex < MAP_PROGRESS_COMPLETED_LEVELS; levelIndex += 1) {
      insertProgress.run(
        progressKey(profileId, MAP_PROGRESS_WORLD_INDEX, levelIndex),
        profileId,
        MAP_PROGRESS_WORLD_INDEX,
        levelIndex,
        2, // 2★ (peu importe : le déblocage/statut courant ne dépend jamais des étoiles, MAP §1/§8)
      );
    }

    return profileId;
  } finally {
    db.close();
  }
}
