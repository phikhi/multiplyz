/**
 * **Amorçage E2E d'une progression AU BOSS** (story R3.3, #381) — prouver que la révélation du
 * boss rend le VRAI art légendaire (`characters.art_ref`, R3.1 #378) exige d'ATTEINDRE le nœud
 * boss (`level_index = levelsPerWorld`, MAP §6) sans rejouer les `levelsPerWorld` niveaux normaux
 * qui précèdent en E2E (lent, hors-scope — le sujet ici est la RÉVÉLATION, pas la progression).
 * Même patron que `seed-map-progress.ts`/`seed-collection.ts` : insertion **directe** en base,
 * **DANS la chaîne `webServer`** (`seed-boss-progress.cli.ts`, APRÈS `db:migrate` et AVANT
 * `next dev`) → **même contexte** (cwd + `DATABASE_PATH` via `resolveDatabasePath`) que le serveur
 * qui lira la base.
 *
 * Profil **dédié** (`Iris`, distinct de `Léa`/`Zoé`/`Nino`/`Milo`/`Timéo`/`Nova`) + session enfant
 * amorcée directement (comme `MAP_PROGRESS_SESSION_TOKEN`) : le test injecte le cookie
 * `mz_session` pour atteindre `/carte` sans dépendre de l'état d'onboarding/progression des
 * autres tests `describe.serial` (surface disjointe, zéro couplage inter-tests).
 *
 * **`levelsPerWorld` niveaux COMPLÉTÉS** (`level_index` 0..`levelsPerWorld-1`, `world_index=0`,
 * le socle de secours partagé « Forêt enchantée » — même monde que `Léa`, pas de collision : profil
 * distinct) → le prochain nœud non terminé (`firstUnfinishedIndex`) devient **courant** au
 * `level_index = levelsPerWorld` = **le boss** (dernier nœud, MAP §6). Le test joue alors CE SEUL
 * niveau (le boss, `bossQuestionCount` ⚙️ questions) pour atteindre la révélation — jamais les
 * niveaux normaux qui précèdent.
 *
 * **AUCUNE possession en collection** (contrairement à `seed-collection.ts`) : la légendaire doit
 * être gagnée RÉELLEMENT en battant le boss pendant le test (c'est le SUJET de la story), jamais
 * pré-amorcée.
 *
 * **1 ligne `mastery` PAR compétence** (comme `seed-canari.ts`) → `needsDiagnostic` (`service.ts`)
 * devient `false` pour ce profil : taper le nœud boss atterrit directement sur le NIVEAU boss,
 * jamais l'écran diagnostic (~18 questions, hors-sujet ici — sans ce seed, un profil FRAIS sans
 * `mastery` retombe systématiquement sur le diagnostic AVANT tout niveau, y compris le boss).
 *
 * Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors résolveur de paths Next.
 * **Aucun effet de bord à l'import** (le CLI est séparé) : `e2e/auth.spec.ts` importe librement
 * les constantes.
 */
import Database from "better-sqlite3";
import { hash } from "@node-rs/argon2";
import { resolveDatabasePath } from "../src/lib/db/config";
import { nameKey } from "../src/lib/auth/validation";
import { progressKey, masteryKey } from "../src/lib/db/schema";
import { loadEngineConfig } from "../src/config/server-config";
import { seedDiagnosticMastery, type DiagnosticResponse } from "../src/lib/engine/diagnostic";
import { generateFacts } from "../src/lib/engine/facts";
import { SKILLS } from "../src/lib/engine/domain";

/** Prénom du profil dédié à la révélation boss E2E (unique dans le foyer E2E). */
export const BOSS_PROGRESS_PROFILE_NAME = "Iris";
/** PIN enfant du profil dédié (≠ Léa/Zoé/Nino/Milo/Timéo/Nova/parent). */
export const BOSS_PROGRESS_PROFILE_PIN = "3939";
/** Portrait (id valide du catalogue AVATARS). */
export const BOSS_PROGRESS_PROFILE_AVATAR = "rabbit";
/** Token de session enfant amorcé pour ce profil. */
export const BOSS_PROGRESS_SESSION_TOKEN = "e2e-381-boss-reveal-session-token";
/** Monde de la progression amorcée (le socle de secours, comme `Léa` — légendaire réelle committée). */
export const BOSS_PROGRESS_WORLD_INDEX = 0;
/**
 * Nombre de niveaux COMPLÉTÉS avant le nœud boss (⚙️ `levelsPerWorld`, non surchargé en E2E,
 * défaut 10 — cf. `MapConfig`/`CONFIG_DEFAULTS.map`, `server-config.ts`). Le nœud courant résultant
 * (`level_index = 10`) EST le boss (dernier nœud, `bossIndex = levelsPerWorld`, MAP §6).
 */
export const BOSS_PROGRESS_COMPLETED_LEVELS = 10;

/**
 * Insère le profil dédié + session + `BOSS_PROGRESS_COMPLETED_LEVELS` lignes `progress`
 * (niveaux 0..9 complétés, 2★ chacun) + 1 ligne `mastery` par compétence (saute le diagnostic)
 * — le nœud boss (10) reste NON complété (le test le joue). **Idempotent** (`INSERT OR IGNORE`
 * par PK, un rejeu de la chaîne `webServer` ne duplique rien). `foreign_keys = ON` (comme
 * `createDatabase`) : profil inséré AVANT session/progression/mastery (FK honorées).
 */
export async function seedBossProgress(): Promise<number> {
  const pinHash = await hash(BOSS_PROGRESS_PROFILE_PIN);
  const db = new Database(resolveDatabasePath());
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    const existing = db
      .prepare("SELECT id FROM profiles WHERE name = ?")
      .get(BOSS_PROGRESS_PROFILE_NAME) as { id: number } | undefined;
    const profileId =
      existing?.id ??
      Number(
        db
          .prepare("INSERT INTO profiles (name, name_key, avatar, pin_hash) VALUES (?, ?, ?, ?)")
          .run(
            BOSS_PROGRESS_PROFILE_NAME,
            nameKey(BOSS_PROGRESS_PROFILE_NAME),
            BOSS_PROGRESS_PROFILE_AVATAR,
            pinHash,
          ).lastInsertRowid,
      );

    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
    db.prepare(
      "INSERT OR IGNORE INTO sessions (token, profile_id, kind, expires_at) VALUES (?, ?, 'child', ?)",
    ).run(BOSS_PROGRESS_SESSION_TOKEN, profileId, expiresAtSec);

    const insertProgress = db.prepare(
      `INSERT OR IGNORE INTO progress (id, profile_id, world_index, level_index, stars)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (let levelIndex = 0; levelIndex < BOSS_PROGRESS_COMPLETED_LEVELS; levelIndex += 1) {
      insertProgress.run(
        progressKey(profileId, BOSS_PROGRESS_WORLD_INDEX, levelIndex),
        profileId,
        BOSS_PROGRESS_WORLD_INDEX,
        levelIndex,
        2, // 2★ (peu importe : le déblocage/statut courant ne dépend jamais des étoiles, MAP §1/§8)
      );
    }

    // 1 réponse JUSTE par compétence sur son 1er fait canonique (ordre `SKILLS`, moteur pur, même
    // patron que `seed-canari.ts`) → `seedDiagnosticMastery` calcule la MÊME forme de ligne qu'un
    // VRAI diagnostic (boîte Leitner amorcée) → `needsDiagnostic()===false` : le nœud boss saute
    // directement au niveau, jamais l'écran diagnostic.
    const now = Date.now();
    const responses: DiagnosticResponse[] = SKILLS.map((skill) => ({
      factKey: generateFacts(skill)[0].key,
      skill,
      correct: true,
      responseMs: 2000,
    }));
    const config = loadEngineConfig(process.env);
    const seeded = seedDiagnosticMastery(responses, config, now);

    const insertMastery = db.prepare(
      `INSERT OR IGNORE INTO mastery
         (id, profile_id, fact_id, skill, strength, correct_count, wrong_count, avg_response_ms, last_seen, next_due)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of seeded) {
      const response = responses.find((r) => r.factKey === row.factKey)!;
      insertMastery.run(
        masteryKey(profileId, row.factKey),
        profileId,
        row.factKey,
        response.skill,
        row.state.box,
        row.state.correctCount,
        row.state.wrongCount,
        row.state.avgResponseMs,
        // Colonnes `mode:"timestamp"` (Drizzle sqlite) = secondes epoch — même conversion que
        // `seed-canari.ts` (l'état pur du moteur étant en epoch **ms**).
        row.state.lastSeen === null ? null : Math.floor(row.state.lastSeen / 1000),
        row.state.nextDue === null ? null : Math.floor(row.state.nextDue / 1000),
      );
    }

    return profileId;
  } finally {
    db.close();
  }
}
