/**
 * **Amorçage E2E d'une collection possédée** (story 8.2b, #266) — la collection (Pokédex) ne se
 * peuple qu'au boss (`grantLegendaryInTx`, hors œufs — la boutique/gacha n'existe pas encore,
 * cf. issue `discovered` #269) : jouer jusqu'au boss en E2E serait lent et hors-scope d'un test
 * de REFLOW responsive (le sujet est la géométrie de grille, pas la progression). Même patron que
 * `seed-sibling.ts`/`seed-pending-worlds.ts` : insertion **directe** en base, **DANS la chaîne
 * `webServer`** (`seed-collection.cli.ts`, APRÈS `db:migrate` et AVANT `next dev`) → **même
 * contexte** (cwd + `DATABASE_PATH` via `resolveDatabasePath`) que le serveur qui lira la base.
 *
 * Profil **dédié** (`Nino`, distinct de `Léa`/`Zoé`) + session enfant amorcée directement (comme
 * `SIBLING_SESSION_TOKEN`) : le test injecte le cookie `mz_session` pour atteindre `/collection`
 * sans dépendre de l'état d'onboarding/progression des autres tests `describe.serial` (surface
 * disjointe, zéro couplage inter-tests).
 *
 * **5 créatures** (3 communes + 1 rare + 1 légendaire) : row 1 = 3 cartes, row 2 = 2 cartes sous
 * la grille 3-colonnes → prouve un compte de colonnes **exactement 3** (ni 1, ni 2, ni 4/5 en une
 * seule ligne) à la garde E2E `boundingClientRect` (#127). `world_index` **hors de la fenêtre
 * réelle** (9997, sous 9998/9999 déjà réservés par `seed-pending-worlds.ts`) : zéro collision avec
 * le monde socle/carte de `Léa` ni les mondes en attente.
 *
 * Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors résolveur de paths Next.
 * **Aucun effet de bord à l'import** (le CLI est séparé) : `e2e/auth.spec.ts` importe librement
 * les constantes.
 */
import Database from "better-sqlite3";
import { hash } from "@node-rs/argon2";
import { resolveDatabasePath } from "../src/lib/db/config";
import { nameKey } from "../src/lib/auth/validation";

/** Prénom du profil dédié à la collection E2E (unique dans le foyer E2E). */
export const COLLECTION_PROFILE_NAME = "Nino";
/** PIN enfant du profil dédié (≠ Léa/Zoé/parent). */
export const COLLECTION_PROFILE_PIN = "6666";
/** Portrait (id valide du catalogue AVATARS). */
export const COLLECTION_PROFILE_AVATAR = "owl";
/** Token de session enfant amorcé pour ce profil. */
export const COLLECTION_SESSION_TOKEN = "e2e-266-collection-session-token";

/** Créature possédée amorcée pour la garde E2E de grille (nom + rareté visibles à l'écran). */
interface SeededOwnedCreature {
  readonly id: string;
  readonly nameDefault: string;
  readonly rarity: "common" | "rare" | "legendary";
  readonly story: string;
}

/** 5 créatures (3 communes + 1 rare + 1 légendaire) : row1=3, row2=2 sous la grille 3-colonnes. */
export const COLLECTION_CREATURES: readonly SeededOwnedCreature[] = [
  {
    id: "e2e:collection:1",
    nameDefault: "Griffonne",
    rarity: "common",
    story: "Une petite curieuse.",
  },
  { id: "e2e:collection:2", nameDefault: "Bulline", rarity: "common", story: "Adore les bulles." },
  {
    id: "e2e:collection:3",
    nameDefault: "Feuillette",
    rarity: "common",
    story: "Douce comme une feuille.",
  },
  {
    id: "e2e:collection:4",
    nameDefault: "Cristalline",
    rarity: "rare",
    story: "Brille au soleil.",
  },
  {
    id: "e2e:collection:5",
    nameDefault: "Astréa",
    rarity: "legendary",
    story: "La gardienne des étoiles.",
  },
];

const COLLECTION_WORLD_INDEX = 9997;

/**
 * Insère le profil dédié + session + catalogue/possessions (**idempotent** — `INSERT OR IGNORE`
 * par PK, un rejeu de la chaîne `webServer` ne duplique rien). `foreign_keys = ON` (comme
 * `createDatabase`) : profil inséré AVANT session/possessions (FK honorées).
 */
export async function seedCollection(): Promise<number> {
  const pinHash = await hash(COLLECTION_PROFILE_PIN);
  const db = new Database(resolveDatabasePath());
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    const existing = db
      .prepare("SELECT id FROM profiles WHERE name = ?")
      .get(COLLECTION_PROFILE_NAME) as { id: number } | undefined;
    const profileId =
      existing?.id ??
      Number(
        db
          .prepare("INSERT INTO profiles (name, name_key, avatar, pin_hash) VALUES (?, ?, ?, ?)")
          .run(
            COLLECTION_PROFILE_NAME,
            nameKey(COLLECTION_PROFILE_NAME),
            COLLECTION_PROFILE_AVATAR,
            pinHash,
          ).lastInsertRowid,
      );

    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
    db.prepare(
      "INSERT OR IGNORE INTO sessions (token, profile_id, kind, expires_at) VALUES (?, ?, 'child', ?)",
    ).run(COLLECTION_SESSION_TOKEN, profileId, expiresAtSec);

    const insertCharacter = db.prepare(
      `INSERT OR IGNORE INTO characters
         (id, world_index, species_key, name_default, rarity, in_egg_pool, art_ref, story)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertCollection = db.prepare(
      `INSERT OR IGNORE INTO collection
         (id, profile_id, character_id, count, stage, unlocked_at)
       VALUES (?, ?, ?, 1, 1, ?)`,
    );
    // Instants croissants (unixepoch + offset) → tri stable par ordre d'obtention (`loadCollection`),
    // jamais dépendant de l'horloge réelle au moment du run.
    const baseEpoch = Math.floor(Date.now() / 1000) - COLLECTION_CREATURES.length;
    COLLECTION_CREATURES.forEach((creature, index) => {
      insertCharacter.run(
        creature.id,
        COLLECTION_WORLD_INDEX,
        `e2e_collection_species_${index}`,
        creature.nameDefault,
        creature.rarity,
        // better-sqlite3 (raw SQL, sans le mode `boolean` de Drizzle) ne bind QUE
        // number/string/bigint/buffer/null — jamais un booléen JS brut : 0/1 explicite.
        creature.rarity === "legendary" ? 0 : 1, // légendaire hors œufs (ECONOMY §4.2)
        `placeholder://e2e/collection/${index}`,
        creature.story,
      );
      const key = `${profileId}:${creature.id}`;
      insertCollection.run(key, profileId, creature.id, baseEpoch + index);
    });

    return profileId;
  } finally {
    db.close();
  }
}
