/**
 * **Amorçage E2E d'un historique de justesse QUOTIDIENNE** (issue #241, ADR 0018). La sparkline de
 * justesse (`AccuracySparkline`, `ParentDashboard.tsx`) n'affiche une FORME qu'à partir de ≥2 jours
 * calendaires DISTINCTS de 1ʳᵉˢ réponses — hors d'atteinte d'un parcours de jeu E2E réel en un seul
 * run (dans la séquence `auth.spec.ts`, Léa ne joue qu'AUJOURD'HUI). Même patron que
 * `seed-collection.ts` (story 8.2b #266, boss hors d'atteinte en E2E) : profil **dédié**, disjoint
 * de la séquence Léa, + `attempts` **backdatés** insérés DIRECTEMENT en base, **DANS la chaîne
 * `webServer`** (`seed-accuracy-history.cli.ts`, APRÈS `db:migrate` et AVANT `next dev`) → **même
 * contexte** (cwd + `DATABASE_PATH`) que le serveur qui lira la base.
 *
 * **Session `kind = 'parent'` injectée DIRECTEMENT** (même patron que `COLLECTION_SESSION_TOKEN`,
 * qui injecte une session `kind = 'child'`) : le garde `(espace)/layout.tsx` ne filtre QUE
 * `kind === "parent"` (`current-session.ts`), aucune vérification d'« owner » — le seul owner réel
 * du foyer E2E reste Léa (`parent_pin_hash` posé à SON onboarding), cette session amorcée n'y
 * touche jamais (surface strictement disjointe, `/parent` affiche les stats du `profileId` porté
 * par LA session, jamais celles de l'owner par défaut).
 *
 * **6 jours calendaires DISTINCTS** (fuseau `Europe/Paris` ⚙️ défaut, `RegularityConfig.
 * dayTimeZone`), horodatés à **midi UTC** (~13h/14h Paris, loin de la frontière de minuit dans tous
 * les fuseaux plausibles) pour rester **DÉTERMINISTES quelle que soit l'heure du run CI** — un
 * horodatage ancré sur l'heure D'EXÉCUTION du seed (pas une date en dur) aurait pu tomber sur une
 * frontière de jour selon l'heure du run. Ratios **VOLONTAIREMENT distincts et connus**
 * (20 % / 40 % / 100 % / 0 % / 80 % / 60 %, 5 réponses/jour) — le jour à 0 % exerce le **plancher
 * 4 %** (#170, jamais une barre invisible) et le jour à 100 % la **hauteur pleine**, sans ambiguïté
 * d'arrondi (`correctCount = ratio * 5`, toujours un entier exact pour ces 6 valeurs).
 *
 * Import **relatif** (jamais l'alias `@`) : tourne sous `tsx`, hors résolveur de paths Next.
 * **Aucun effet de bord à l'import** (le CLI est séparé) : `e2e/auth.spec.ts` importe librement les
 * constantes.
 */
import Database from "better-sqlite3";
import { hash } from "@node-rs/argon2";
import { resolveDatabasePath } from "../src/lib/db/config";
import { nameKey } from "../src/lib/auth/validation";

/** Prénom du profil dédié à l'historique de justesse E2E (unique dans le foyer E2E). */
export const ACCURACY_HISTORY_PROFILE_NAME = "Timéo";
/** PIN enfant du profil (jamais utilisé — la session `kind='parent'` est injectée directement). */
export const ACCURACY_HISTORY_PROFILE_PIN = "4242";
/** Portrait (id du catalogue AVATARS — non rendu par le dashboard, valeur arbitraire valide). */
export const ACCURACY_HISTORY_PROFILE_AVATAR = "owl";
/** Token de session **parent** amorcé pour ce profil (bypass du PIN parent, patron collection). */
export const ACCURACY_HISTORY_SESSION_TOKEN = "e2e-241-accuracy-history-session-token";

/**
 * Justesse EXACTE attendue par jour, ordre chronologique CROISSANT (le plus ANCIEN en premier —
 * même ordre que `computeAccuracyDailySeries`, triée par ordinal croissant). Réutilisée telle
 * quelle par l'assertion E2E : hauteur de barre attendue = `Math.max(accuracy * 100, 4)` %.
 */
export const ACCURACY_HISTORY_DAILY_RATIOS = [0.2, 0.4, 1, 0, 0.8, 0.6] as const;

/** Nombre de 1ʳᵉˢ réponses par jour — dénominateur commun (5) aux ratios ci-dessus (tous des
 * multiples exacts de 1/5, aucun arrondi ambigu). */
const ATTEMPTS_PER_DAY = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Horodatage « midi UTC » du jour `k` jours avant AUJOURD'HUI (0 = aujourd'hui) — épinglé sur le
 * jour calendaire UTC courant à l'exécution du seed, jamais une date en dur, mais toujours à midi
 * (loin de toute frontière de minuit locale, DST-safe, déterministe quelle que soit l'heure du run
 * CI qui exécute la chaîne `webServer`). */
function noonUtc(k: number): number {
  const todayMidnightUtc = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  return todayMidnightUtc + 12 * 60 * 60 * 1000 - k * DAY_MS;
}

/** `total` 1ʳᵉˢ réponses au jour `k`, dont EXACTEMENT `correctCount` justes (déterministe, jamais
 * aléatoire) — espacées de quelques minutes dans le MÊME jour (sans effet sur l'agrégat testé, seul
 * le jour d'appartenance + le ratio comptent). */
function dayAttempts(
  k: number,
  correctCount: number,
  total: number,
): ReadonlyArray<{ readonly correct: boolean; readonly createdAtSec: number }> {
  const base = noonUtc(k);
  return Array.from({ length: total }, (_, i) => ({
    correct: i < correctCount,
    createdAtSec: Math.floor((base + i * 60_000) / 1000),
  }));
}

/**
 * Insère le profil dédié + session `kind='parent'` + 6 jours d'`attempts` backdatés (**idempotent**
 * : purge les `attempts` du profil AVANT de ré-insérer — un rejeu de la chaîne `webServer` ne
 * duplique jamais les 1ʳᵉˢ réponses). `foreign_keys = ON` (comme `createDatabase`) : profil inséré
 * AVANT session/attempts (FK honorées).
 */
export async function seedAccuracyHistory(): Promise<number> {
  const pinHash = await hash(ACCURACY_HISTORY_PROFILE_PIN);
  const db = new Database(resolveDatabasePath());
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    const existing = db
      .prepare("SELECT id FROM profiles WHERE name = ?")
      .get(ACCURACY_HISTORY_PROFILE_NAME) as { id: number } | undefined;
    const profileId =
      existing?.id ??
      Number(
        db
          .prepare("INSERT INTO profiles (name, name_key, avatar, pin_hash) VALUES (?, ?, ?, ?)")
          .run(
            ACCURACY_HISTORY_PROFILE_NAME,
            nameKey(ACCURACY_HISTORY_PROFILE_NAME),
            ACCURACY_HISTORY_PROFILE_AVATAR,
            pinHash,
          ).lastInsertRowid,
      );

    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
    db.prepare(
      "INSERT OR IGNORE INTO sessions (token, profile_id, kind, expires_at) VALUES (?, ?, 'parent', ?)",
    ).run(ACCURACY_HISTORY_SESSION_TOKEN, profileId, expiresAtSec);

    // Idempotence des `attempts` : purge d'abord (pas d'`INSERT OR IGNORE` naturel possible ici,
    // `attempts` n'a pas de clé métier stable hors `client_attempt_id` — DELETE explicite avant
    // ré-insertion, un rejeu de la chaîne `webServer` ne duplique donc jamais les 1ʳᵉˢ réponses).
    db.prepare("DELETE FROM attempts WHERE profile_id = ?").run(profileId);
    const insertAttempt = db.prepare(
      `INSERT INTO attempts (profile_id, fact_id, skill, correct, response_ms, is_retry, created_at)
       VALUES (?, 'add_2+3', 'add', ?, 1200, 0, ?)`,
    );
    ACCURACY_HISTORY_DAILY_RATIOS.forEach((ratio, index) => {
      // index 0 = le plus ANCIEN → k le plus grand (dernier index = aujourd'hui, k = 0).
      const k = ACCURACY_HISTORY_DAILY_RATIOS.length - 1 - index;
      const correctCount = Math.round(ratio * ATTEMPTS_PER_DAY);
      for (const a of dayAttempts(k, correctCount, ATTEMPTS_PER_DAY)) {
        insertAttempt.run(profileId, a.correct ? 1 : 0, a.createdAtSec);
      }
    });

    return profileId;
  } finally {
    db.close();
  }
}
