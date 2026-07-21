/**
 * **Amorçage E2E du profil dédié au canari « état jouable »** (issue #326, WORKFLOW §21.d) — la
 * sonde E2E full-loop (login→carte→niveau→résultats→carte→collection) qui garde le jeu **assemblé**
 * en continu, pas seulement chaque écran isolé (CLAUDE.md #180/#316).
 *
 * Profil **dédié** (`Nova`, distinct de Léa/Zoé/Milo/Nino/Timéo) — le canari se connecte via
 * l'écran de connexion **RÉEL** (nom + PIN, jamais une injection de cookie) : contrairement à
 * `seed-sibling`/`seed-map-progress`/`seed-collection`, **aucune session n'est pré-amorcée ici** —
 * la 1ʳᵉ jambe de la boucle (« login ») doit être **réellement exercée**, pas court-circuitée.
 *
 * **1 ligne `mastery` PAR compétence** (4 au total, via `seedDiagnosticMastery` — le moteur PUR
 * exporté par `src/lib/engine/diagnostic.ts`, JAMAIS un état inventé ici) → `needsDiagnostic`
 * (`service.ts`) devient `false` pour ce profil : taper le nœud courant atterrit directement sur
 * un **niveau normal** (~10 questions), jamais le diagnostic (~18 questions, déjà couvert par les
 * tests §2.2/§64 de ce même fichier) — le canari teste la boucle produit centrale (PRODUCT §1.3
 * « Carte → Niveau → Résultats → … »), pas l'onboarding pédagogique. Même patron que
 * `seed-collection.ts`/`seed-map-progress.ts` : contourne un pré-requis de jeu long via une
 * insertion **directe** en base, DANS la chaîne `webServer` (`seed-canari.cli.ts`, APRÈS
 * `db:migrate` et AVANT `next dev`) → **même contexte** (cwd + `DATABASE_PATH`) que le serveur.
 *
 * **AUCUNE ligne `progress`** : le nœud COURANT reste le tout PREMIER (`level_index=0`,
 * `world_index=0` — le monde socle partagé « Forêt enchantée », cf. `seed-world-assets.ts`) →
 * l'avatar Teddy per-monde (`CurrentNodeTeddy`) s'affiche dessus dès l'atterrissage (MAP §1).
 *
 * Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors résolveur de paths Next — même
 * contrainte que les autres seeds E2E. `server-config.ts`/`diagnostic.ts`/`mastery.ts`/`facts.ts`/
 * `domain.ts` sont tous des modules **purs** (aucun `server-only`/DB), import sûr ici.
 * **Aucun effet de bord à l'import** (le CLI est séparé) : `e2e/auth.spec.ts` importe librement
 * les constantes.
 */
import Database from "better-sqlite3";
import { hash } from "@node-rs/argon2";
import { resolveDatabasePath } from "../src/lib/db/config";
import { nameKey } from "../src/lib/auth/validation";
import { masteryKey } from "../src/lib/db/schema";
import { loadEngineConfig } from "../src/config/server-config";
import { seedDiagnosticMastery, type DiagnosticResponse } from "../src/lib/engine/diagnostic";
import { generateFacts } from "../src/lib/engine/facts";
import { SKILLS } from "../src/lib/engine/domain";

/** Prénom du profil dédié au canari (unique dans le foyer E2E). */
export const CANARI_PROFILE_NAME = "Nova";
/** PIN enfant du profil dédié (≠ Léa 1234 / Zoé 2222 / Milo 5555 / Nino 6666 / Timéo 4242 / parent 9876). */
export const CANARI_PROFILE_PIN = "7171";
/** Portrait (id valide du catalogue AVATARS, distinct des autres profils seedés). */
export const CANARI_PROFILE_AVATAR = "cat";

/**
 * Insère le profil dédié + 1 ligne `mastery` par compétence (moteur pur, `seedDiagnosticMastery`)
 * — **idempotent** (`INSERT OR IGNORE` par PK, un rejeu de la chaîne `webServer` ne duplique rien).
 * `foreign_keys = ON` (comme `createDatabase`) : profil inséré AVANT `mastery` (FK honorées).
 */
export async function seedCanariProfile(): Promise<number> {
  const pinHash = await hash(CANARI_PROFILE_PIN);
  const db = new Database(resolveDatabasePath());
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    const existing = db
      .prepare("SELECT id FROM profiles WHERE name = ?")
      .get(CANARI_PROFILE_NAME) as { id: number } | undefined;
    const profileId =
      existing?.id ??
      Number(
        db
          .prepare("INSERT INTO profiles (name, name_key, avatar, pin_hash) VALUES (?, ?, ?, ?)")
          .run(CANARI_PROFILE_NAME, nameKey(CANARI_PROFILE_NAME), CANARI_PROFILE_AVATAR, pinHash)
          .lastInsertRowid,
      );

    // 1 réponse JUSTE par compétence sur son 1er fait canonique (ordre `SKILLS`, moteur pur) →
    // `seedDiagnosticMastery` calcule la MÊME forme de ligne qu'un VRAI diagnostic (boîte Leitner
    // amorcée, échéance dérivée, compteurs) — jamais un état inventé ici. `responseMs` modéré
    // (2000ms) : peu importe fluent/lent, seul compte `needsDiagnostic()===false` en sortie.
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
        // `expires_at` des autres seeds (`Math.floor(Date.now()/1000)`), l'état pur du moteur étant
        // en epoch **ms**.
        row.state.lastSeen === null ? null : Math.floor(row.state.lastSeen / 1000),
        row.state.nextDue === null ? null : Math.floor(row.state.nextDue / 1000),
      );
    }

    return profileId;
  } finally {
    db.close();
  }
}
