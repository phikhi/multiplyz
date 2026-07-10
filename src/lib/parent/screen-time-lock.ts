import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { attempts } from "@/lib/db/schema";
import type { RegularityConfig } from "@/config/server-config";
import { computeRegularityStats } from "./regularity";
import type { HouseholdSettings } from "./settings";

/**
 * **Enforcement — verrou dur du temps d'écran** (DETAILS §25-32, story 7.8 #229). Câble
 * l'ENFORCEMENT runtime du réglage **stocké** par 7.3 (`ParentControlsConfig`/`HouseholdSettings`,
 * `lib/parent/settings.ts`, jamais enforcé par ce module-là) sur le **temps joué du jour** dérivé
 * par 7.4 (`regularity.today.activeMinutes`, `lib/parent/regularity.ts`) — rend le réglage parent
 * VÉCU par l'enfant (#180 câblage consommateur : un réglage stocké mais jamais lu par le jeu reste
 * une promesse creuse au parent).
 *
 * **Portée EXACTE (issue #229 AC 1/2)** :
 * - bloque l'**ENTRÉE** dans un **NOUVEAU niveau** — le seul appelant est `startLevelAction`
 *   (`app/(app)/jouer/actions.ts`), qui exécute cette garde AVANT toute résolution de cible/niveau ;
 * - ne touche **jamais** la partie **en cours** (no-fail préservé, ENGINE §9/PRODUCT §5 : aucune
 *   interruption mid-niveau — `submitAttemptAction`/`finishLevelAction` n'appellent jamais ce module) ;
 * - le **nudge doux** (15-20 min, rappel non bloquant) reste un axe **distinct**, explicitement hors
 *   scope de la story 7.8 (issue #229 AC 2) — ce module ne le lit ni ne l'écrit.
 *
 * Garde-fou **bien-être opt-in parent** (DETAILS §7 « Temps d'écran : nudge doux + verrou dur
 * optionnel (parent) » — décision **verrouillée**) — **jamais** punitif (COPY §1/§3 : posture
 * croissance, voix Teddy douce « on reprend demain », jamais « faux »). Désactivé par défaut
 * (`screenTimeHardLockEnabled: false`, opt-in explicite du parent, `resolveSettingsDefaults`) :
 * un foyer qui n'active jamais ce réglage n'est **jamais** concerné par ce module.
 *
 * Distinct de l'**économie** (ECONOMY §3 « jamais sur le chemin de l'apprentissage ») : cette règle
 * verrouillée porte sur les dépenses/l'économie du jeu, pas sur ce garde-fou de bien-être temporel —
 * les deux ne sont pas en tension (DETAILS §7 sanctionne explicitement le verrou dur).
 */

/** Handle DB lecture seule (mêmes conventions que `stats-source.ts` : ce module n'écrit jamais). */
type ReadonlyLockDb = Pick<AppDatabase, "select">;

/**
 * Charge les seuls **horodatages** des réponses du profil — lecture **allégée** (ni
 * skill/correct/responseMs/isRetry, inutiles au verrou) car appelée à **CHAQUE** entrée de niveau
 * (chemin **chaud** du jeu enfant), contrairement à `stats-source.ts` (chemin **froid** du tableau
 * de bord parent, qui charge le journal complet). Convertit `created_at` (`Date`) en epoch ms
 * (format de l'horloge du moteur, comme `stats-source.ts`).
 */
function loadAttemptTimestamps(
  db: ReadonlyLockDb,
  profileId: number,
): { readonly createdAt: number }[] {
  return db
    .select({ createdAt: attempts.createdAt })
    .from(attempts)
    .where(eq(attempts.profileId, profileId))
    .all()
    .map((row) => ({ createdAt: row.createdAt.getTime() }));
}

/**
 * **Minutes jouées aujourd'hui** — réutilise EXACTEMENT `computeRegularityStats` (7.4,
 * `today.activeMinutes`, approximation amplitude bornée ⚙️ `maxDayAmplitudeMinutes`) : jamais une
 * seconde définition du temps de jeu (CLAUDE.md : la logique n'est jamais dupliquée). `0` si
 * l'enfant n'a pas encore joué aujourd'hui (`today: null`) — jamais bloquant tant que rien n'a
 * été joué.
 */
export function loadTodayActiveMinutes(
  db: ReadonlyLockDb,
  profileId: number,
  regularityConfig: RegularityConfig,
  now: number,
): number {
  const timestamps = loadAttemptTimestamps(db, profileId);
  const stats = computeRegularityStats(timestamps, regularityConfig, now);
  return stats.today?.activeMinutes ?? 0;
}

/**
 * **Garde pure** (mutation-testable, bornée) : le verrou dur bloque ssi (a) le parent l'a **activé**
 * ET (b) le temps joué aujourd'hui a **atteint ou dépassé** le seuil ⚙️ — borne **inclusive** `>=`
 * (DETAILS §27 « X min/jour » : le seuil ATTEINT verrouille, pas seulement dépassé). Désactivé
 * (défaut) → jamais bloquant, quel que soit le temps joué (opt-in strict).
 */
export function isScreenTimeHardLocked(
  settings: Pick<HouseholdSettings, "screenTimeHardLockEnabled" | "screenTimeHardLockMinutes">,
  todayActiveMinutes: number,
): boolean {
  return (
    settings.screenTimeHardLockEnabled && todayActiveMinutes >= settings.screenTimeHardLockMinutes
  );
}

/**
 * **Évalue le verrou** pour une entrée de niveau (pont DB + garde pure) — point d'entrée unique
 * consommé par `startLevelAction`. Court-circuite AVANT toute lecture DB si le verrou est
 * **désactivé** (chemin chaud majoritaire : la plupart des foyers n'activent jamais cet opt-in,
 * DETAILS §27/§7 — défaut `false`) : la lecture des horodatages ne coûte rien au cas commun.
 */
export function evaluateScreenTimeLock(
  db: ReadonlyLockDb,
  profileId: number,
  settings: HouseholdSettings,
  regularityConfig: RegularityConfig,
  now: number,
): boolean {
  if (!settings.screenTimeHardLockEnabled) {
    return false;
  }
  const todayActiveMinutes = loadTodayActiveMinutes(db, profileId, regularityConfig, now);
  return isScreenTimeHardLocked(settings, todayActiveMinutes);
}
