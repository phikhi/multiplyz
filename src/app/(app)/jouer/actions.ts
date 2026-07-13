"use server";

import { getDb } from "@/lib/db";
import {
  getEconomyConfig,
  getEngineConfig,
  getMapConfig,
  getRegularityConfig,
  type EngineConfig,
} from "@/config/server-config";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import {
  isRecalibrationRequested,
  needsDiagnostic,
  seedDiagnostic,
  seedRecalibration,
  startLevel,
  submitAttempt,
  type Level,
  type RawDiagnosticResponse,
  type SubmitAttemptInput,
} from "@/lib/engine/service";
import { selectDiagnostic, type DiagnosticItem } from "@/lib/engine/diagnostic";
import { LEVEL_SIZE } from "@/lib/engine/level";
import { finishLevel, type FinishLevelError, type GrantedLegendary } from "@/lib/game/finish-level";
import { baseNodeTypeAt } from "@/lib/game/map";
import type { RewardBreakdown } from "@/lib/game/reward";
import { getUnlockedWorldCount, resolveCurrentLevelTarget } from "@/lib/game/unlock";
import { evaluateScreenTimeLock } from "@/lib/parent/screen-time-lock";
import { readHouseholdSettings, writeHouseholdSettings } from "@/lib/parent/settings";

/**
 * Server actions du jeu (ENGINE §3/§4/§10, SYNC §1/§2). Adaptateurs **minces** au-dessus
 * de `@/lib/engine/service` : la logique (sélection/maîtrise/transaction/idempotence) vit
 * côté serveur (source de vérité). Le client ne fournit **jamais** le `profile_id` — il
 * vient toujours de la session enfant (`getCurrentChildProfileId`, filtre `kind`, #63/#42).
 *
 * Runtime **Node** (transaction better-sqlite3), pas edge. `runtime = "nodejs"` est déjà
 * imposé par la page du groupe `(app)`.
 *
 * Non authentifié (pas de session enfant valide) → `null`/`{ ok: false }` **générique**
 * (jamais de fuite, cohérent avec l'auth #2.3). L'horloge serveur (`Date.now()`) et le RNG
 * (`Math.random`) sont injectés **ici** (la frontière) → le cœur du service reste
 * déterministe/testable (LEARNINGS #46/aléa).
 */

/**
 * Réponse de démarrage de niveau : le niveau, ou `null` si non authentifié.
 *
 * `starThresholds` (ENGINE §5/§11, ⚙️) est renvoyé **avec** le niveau — le client
 * (#64) calcule les étoiles de fin de niveau **localement** (justesse de la 1ʳᵉ
 * réponse déjà connue côté client, ENGINE §5) sans aller-retour réseau bloquant ni
 * réimplémenter le seuil ; `getEngineConfig()` (server-only, lit l'env + des
 * secrets potentiels) ne doit **jamais** être importée côté client — seule cette
 * valeur ⚙️, déjà publique par nature (affichée à l'écran résultats), traverse la
 * frontière server action.
 */
export interface StartLevelActionResult {
  readonly level: Level | null;
  readonly starThresholds: EngineConfig["starThresholds"];
  /**
   * **Verrou dur temps d'écran** (DETAILS §27, story 7.8 #229) : `true` si l'entrée dans ce
   * NOUVEAU niveau est bloquée (parent l'a activé ET le temps joué aujourd'hui a atteint le
   * seuil ⚙️, `lib/parent/screen-time-lock.ts`). `level` est alors `null` sans qu'il s'agisse
   * d'une erreur d'authentification/réseau — le client (`PlayScreen`) distingue ce cas de
   * l'écran d'erreur générique et affiche l'écran de blocage doux (voix Teddy, jamais
   * punitif). La partie **en cours** n'est jamais concernée : ce garde ne s'exécute qu'ICI, au
   * démarrage d'un niveau — jamais dans `submitAttemptAction`/`finishLevelAction` (no-fail
   * préservé, ENGINE §9).
   */
  readonly locked: boolean;
}

/**
 * Démarre un niveau pour la session enfant courante. Lecture seule (aucune écriture au
 * démarrage). `level: null` si pas de session enfant valide (`starThresholds` renvoyé
 * quand même — valeur ⚙️ publique, pas liée à l'auth — pour un contrat de retour stable).
 *
 * **Verrou dur temps d'écran (DETAILS §27, story 7.8 #229)** : AVANT toute résolution de
 * cible/niveau, la garde `evaluateScreenTimeLock` (foyer + temps joué aujourd'hui dérivé de
 * `lib/parent/regularity.ts`, 7.4) tranche si l'entrée dans un NOUVEAU niveau doit être
 * bloquée. Court-circuite au cas commun (verrou désactivé, défaut) sans lecture DB
 * supplémentaire. Bloqué ⇒ `{ level: null, locked: true }`, **aucun** appel à
 * `resolveCurrentLevelTarget`/`startLevel` (le serveur ne résout/ne compose jamais un niveau
 * qu'il s'apprête à refuser).
 *
 * **Boss = niveau plus long (MAP §6)** : le serveur résout — **sans faire confiance au
 * client** (SYNC §1) — le nœud courant (`resolveCurrentLevelTarget`) et **dérive son type**
 * de la géométrie de carte (`baseNodeTypeAt`, même source de vérité serveur que le barème de
 * fin de niveau). Si c'est le **boss**, le niveau compose `bossQuestionCount` (~12-15 ⚙️)
 * questions au lieu de `LEVEL_SIZE` (10) — via `options.size`. Le **modèle de sélection est
 * inchangé** (mêmes pools/mix/ordre), seule la taille varie (« un peu plus long, mix des
 * compétences du moment », MAP §6). Un profil vierge (avant diagnostic) n'atteint pas ce
 * chemin : `diagnosticPlanAction` intercepte la 1ʳᵉ session en amont.
 */
export async function startLevelAction(): Promise<StartLevelActionResult> {
  const config = getEngineConfig();
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { level: null, starThresholds: config.starThresholds, locked: false };
  }
  const db = getDb();
  const mapConfig = getMapConfig();

  // Verrou dur temps d'écran (DETAILS §27, story 7.8 #229) : bloque l'ENTRÉE dans ce nouveau
  // niveau si le parent l'a activé ET le temps joué aujourd'hui a atteint le seuil ⚙️. Posé
  // AVANT toute résolution de cible — la partie en cours n'est jamais concernée (no-fail).
  const householdSettings = readHouseholdSettings(db);
  if (evaluateScreenTimeLock(db, profileId, householdSettings, getRegularityConfig(), Date.now())) {
    return { level: null, starThresholds: config.starThresholds, locked: true };
  }

  // Cible **résolue serveur** (jamais transmise par le client, SYNC §1) : dernier monde
  // débloqué + nœud courant → type de nœud dérivé de la géométrie (source de vérité serveur,
  // même dérivation que `finishLevelAction`). Boss ⇒ taille `bossQuestionCount`.
  const target = resolveCurrentLevelTarget(db, profileId, mapConfig.levelsPerWorld);
  const isBoss = baseNodeTypeAt(target.levelIndex, mapConfig) === "boss";
  const size = isBoss ? mapConfig.bossQuestionCount : LEVEL_SIZE;
  const level = startLevel(db, profileId, config, Date.now(), Math.random, { size });
  return { level, starThresholds: config.starThresholds, locked: false };
}

/** Réponse de soumission — neutre : succès/échec + maîtrise à jour du fait (ou `null`). */
export interface SubmitAttemptActionResult {
  readonly ok: boolean;
  /** Nouvelle maîtrise du fait (box), ou `null` (re-essai / non authentifié / invalide). */
  readonly box: number | null;
}

/**
 * Soumet une réponse pour la session enfant courante. Le `profile_id` vient de la session
 * (jamais du client). Payload validé côté service (forme + domaine, #36). `{ ok: false }`
 * si non authentifié ou payload invalide (pas de 500). L'idempotence (rejeu via
 * `clientAttemptId`, SYNC §2) et l'atomicité (transaction sync) sont portées par le service.
 */
export async function submitAttemptAction(
  input: SubmitAttemptInput,
): Promise<SubmitAttemptActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { ok: false, box: null };
  }
  const result = submitAttempt(getDb(), profileId, input, getEngineConfig(), Date.now());
  if (!result.ok) {
    return { ok: false, box: null };
  }
  return { ok: true, box: result.state === null ? null : result.state.box };
}

/** Réponse de sélection du diagnostic : les items à poser (ou `null` si non authentifié). */
export interface DiagnosticPlanActionResult {
  readonly items: readonly DiagnosticItem[] | null;
}

/**
 * Renvoie le plan de diagnostic (~18 faits, ENGINE §3) à poser, **ou une liste vide** si aucun
 * diagnostic n'est dû. Lecture seule (aucune écriture) — l'amorçage/la fusion se fait ensuite via
 * `seedDiagnosticAction`. `null` si pas de session enfant valide.
 *
 * **Deux déclencheurs** (même plan `selectDiagnostic`, ENGINE §3, ADR 0016) :
 * - **1ʳᵉ session** : profil vierge (`needsDiagnostic`, `mastery` vide → amorçage initial) ;
 * - **recalibrage** : le parent a armé `recalibration_requested` (`isRecalibrationRequested`, story
 *   7.6) → on re-présente le diagnostic MÊME si `mastery` est non vide (fusion monotone au seed).
 * Le même plan déterministe est posé dans les deux cas ; c'est `seedDiagnosticAction` qui route
 * entre amorçage initial et fusion monotone selon le drapeau.
 */
export async function diagnosticPlanAction(): Promise<DiagnosticPlanActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { items: null };
  }
  const db = getDb();
  // Diagnostic dû ssi : profil vierge (1ʳᵉ session) OU recalibrage armé par le parent (7.6).
  // Un profil déjà amorcé ET non armé n'en rejoue pas (cohérent avec l'idempotence des deux seeds).
  if (!needsDiagnostic(db, profileId) && !isRecalibrationRequested(db, profileId)) {
    return { items: [] };
  }
  return { items: selectDiagnostic(getEngineConfig()) };
}

/** Réponse d'amorçage du diagnostic : nb de faits amorcés (0 si déjà fait / non auth). */
export interface SeedDiagnosticActionResult {
  readonly ok: boolean;
  readonly seededCount: number;
}

/**
 * Amorce **ou recalibre** la maîtrise du profil de session à partir des réponses du diagnostic
 * (ENGINE §3, ADR 0016). **Route selon le drapeau de recalibrage** (`isRecalibrationRequested`) :
 * - **armé** (parent a demandé un recalibrage, 7.6) → `seedRecalibration` : fusion **monotone**
 *   (max-merge) — relève les faits sous-amorcés / crée les faits neufs, **jamais** de rétrograde,
 *   puis **efface le drapeau** dans la même transaction ;
 * - **non armé** (1ʳᵉ session) → `seedDiagnostic` : amorçage initial (idempotent, n'écrit que sur un
 *   profil vierge, SYNC §5).
 *
 * `{ ok: false }` si non authentifié ; `seededCount` = nombre de lignes de maîtrise **effectivement**
 * écrites (0 si déjà amorcé/non armé, ou aucune réponse valide, ou aucun relèvement). Écriture
 * atomique (transaction sync) portée par le service. **N'écrit jamais `attempts`** (sonde de
 * calibrage hors comptage de justesse, ADR 0012/0014), dans les deux branches.
 */
export async function seedDiagnosticAction(
  responses: readonly RawDiagnosticResponse[],
): Promise<SeedDiagnosticActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { ok: false, seededCount: 0 };
  }
  const db = getDb();
  const config = getEngineConfig();
  const now = Date.now();
  // Recalibrage armé → fusion monotone (consomme le drapeau) ; sinon amorçage initial.
  const written = isRecalibrationRequested(db, profileId)
    ? seedRecalibration(db, profileId, responses, config, now)
    : seedDiagnostic(db, profileId, responses, config, now);
  return { ok: true, seededCount: written.length };
}

// ============================================================================
// Fin de niveau : progression + gains de pièces + déblocage linéaire
// (MAP §1/§4/§6, ECONOMY §4.1, story #126, ferme #136)
// ============================================================================

/**
 * Réponse de fin de niveau — **discriminée par `ok`** (contrat de forme fixe côté client) :
 * - **succès** (`ok: true`) ⇒ `error: null`, `stars` = étoiles **effectivement stockées**
 *   (le max monotone), `unlockedNextWorld` = ce niveau était le **boss**, `reward` = la
 *   décomposition du gain de pièces (base + étoiles + trésor), `coins`/`shards` = **solde**
 *   après crédit, `coinsApplied` = `false` si c'était un rejeu (aucun 2ᵉ crédit) ;
 * - **refus** (`ok: false`) ⇒ tous les champs de gain à `null`/`false`, `error` = motif
 *   **neutre** (non authentifié, ou — cas résiduel improbable puisque le serveur résout
 *   lui-même la cible — verrouillé/invalide).
 *
 * Contrat volontairement « plat » (mêmes champs dans les deux cas, `null` en refus) pour
 * rester trivial à consommer côté client sans narrowing — les corrélations sont **garanties
 * par les sites de retour** (ci-dessous).
 */
export interface FinishLevelActionResult {
  /** `true` = fin persistée ; `false` = refus (voir `error`). Discriminant du contrat. */
  readonly ok: boolean;
  /** Étoiles stockées après l'écriture monotone (`number` si `ok`, `null` en refus). */
  readonly stars: number | null;
  /** Monde suivant débloqué (boss complété) ? `false` en refus ou sur un niveau non-boss. */
  readonly unlockedNextWorld: boolean;
  /** Décomposition du gain de pièces (base + étoiles + trésor), `null` en refus. */
  readonly reward: RewardBreakdown | null;
  /** Solde de **pièces** après la fin de niveau (`number` si `ok`, `null` en refus). */
  readonly coins: number | null;
  /** `false` si le crédit était un **rejeu** déjà journalisé (aucun 2ᵉ crédit). */
  readonly coinsApplied: boolean;
  /**
   * **Légendaire garantie** du boss (MAP §6, story 5.6), ou `null` (niveau non-boss / refus).
   * Toujours présente sur un boss (même au rejeu — décrit ce que le monde donne).
   */
  readonly legendary: GrantedLegendary | null;
  /**
   * `true` si la légendaire vient d'être **ajoutée** (1ʳᵉ victoire du boss) ; `false` sinon
   * (niveau non-boss, rejeu d'un boss déjà battu — aucun doublon parasite).
   */
  readonly legendaryAdded: boolean;
  /** Motif de refus **neutre** si `!ok`, `null` si `ok`. */
  readonly error: FinishLevelError | "UNAUTHENTICATED" | null;
}

/** Refus **neutre** (contrat plat) : tous les champs de gain à `null`/`false` (pas de fuite). */
function finishLevelRefusal(error: FinishLevelError | "UNAUTHENTICATED"): FinishLevelActionResult {
  return {
    ok: false,
    stars: null,
    unlockedNextWorld: false,
    reward: null,
    coins: null,
    coinsApplied: false,
    legendary: null,
    legendaryAdded: false,
    error,
  };
}

/**
 * Persiste la **fin du niveau courant** pour la session enfant + **crédite les pièces**
 * (MAP §1/§4/§6, ECONOMY §4.1, PRODUCT §2.2/§2.3, ferme #136).
 *
 * **Source de vérité serveur (SYNC §1)** : le client n'envoie **que ses étoiles** (calculées
 * localement, ENGINE §5) — **jamais** de `world_index`/`level_index`. Le serveur **résout
 * lui-même** la cible (`resolveCurrentLevelTarget` : dernier monde débloqué + nœud courant),
 * dérive le **type de nœud** (bonus trésor) de la géométrie, et écrit progression + crédit +
 * ledger dans **une transaction atomique** (`finishLevel`). Rejeu (retry réseau) ⇒ **aucun
 * double effet** : progression monotone + crédit idempotent (`ref_id = level:<world>:<level>`).
 *
 * Le **déblocage** (monde suivant) est **dérivé du progress** — jamais conditionné aux étoiles
 * (MAP §1/§8). Barème = **config versionnée** (`EconomyConfig`), jamais en dur. `{ ok: false }`
 * **neutre** si non authentifié (pas de 500). Horloge serveur injectée (`new Date()`).
 *
 * @param stars étoiles obtenues (0..3) — **seule** entrée client, validée par `finishLevel`.
 */
export async function finishLevelAction(stars: unknown): Promise<FinishLevelActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return finishLevelRefusal("UNAUTHENTICATED");
  }
  const db = getDb();
  const mapConfig = getMapConfig();
  // Cible résolue **serveur** (jamais transmise par le client) : dernier monde débloqué +
  // nœud courant. `finishLevel` re-garde le déblocage dans sa propre transaction.
  const target = resolveCurrentLevelTarget(db, profileId, mapConfig.levelsPerWorld);
  const result = finishLevel(
    db,
    profileId,
    { worldIndex: target.worldIndex, levelIndex: target.levelIndex, stars },
    mapConfig,
    getEconomyConfig(),
    new Date(),
  );
  if (!result.ok) {
    return finishLevelRefusal(result.error);
  }
  return {
    ok: true,
    stars: result.stars,
    unlockedNextWorld: result.unlockedNextWorld,
    reward: result.reward,
    coins: result.balance.coins,
    coinsApplied: result.coinsApplied,
    legendary: result.legendary,
    legendaryAdded: result.legendaryAdded,
    error: null,
  };
}

/** Réponse de lecture du nombre de mondes débloqués (`null` si non authentifié). */
export interface UnlockedWorldCountActionResult {
  /** Nombre de mondes débloqués (≥ 1), ou `null` si pas de session enfant valide. */
  readonly count: number | null;
}

/**
 * Nombre de **mondes débloqués** pour la session enfant courante (déblocage linéaire dérivé du
 * progress, MAP §1/§6). Lecture seule. Le monde 0 est toujours ouvert ; chaque monde suivant
 * est ouvert **ssi le boss du monde précédent est complété** — **jamais** un seuil d'étoiles.
 * `null` si pas de session enfant valide (générique, pas de fuite).
 */
export async function unlockedWorldCountAction(): Promise<UnlockedWorldCountActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { count: null };
  }
  const count = getUnlockedWorldCount(getDb(), profileId, getMapConfig().levelsPerWorld);
  return { count };
}

// ============================================================================
// Quick-mute enfant NO-PIN (story 8.6, #282, DETAILS §3, ADR 0017)
// ============================================================================

/** Résultat neutre : succès, ou refus (session enfant absente — jamais de 500/fuite). */
export interface ChildQuickMuteActionResult {
  readonly ok: boolean;
}

/**
 * **Quick-mute enfant NO-PIN** (story 8.6, #282, DETAILS §3 « accès enfant, rapide, sans PIN :
 * son on/off » ; ADR 0017 « une seule valeur `household_settings`, parent = source de vérité,
 * surfacée à 2 endroits »). Ces DEUX actions (`setChildSoundEnabledAction`/
 * `setChildMusicEnabledAction`) sont la surface **NARROW** dédiée au contrôle enfant — **jamais**
 * `saveSettingsAction` (parent, PIN, `(espace)/reglages/actions.ts`), qui accepte un patch
 * ARBITRAIRE (`HouseholdSettingsPatch`) et reste réservée à une session **parent**.
 *
 * **SÉCURITÉ (SCOPING NARROW, AC #282)** : chaque action construit elle-même un patch **littéral
 * à 1 CHAMP** (`{ soundEnabled: … }` / `{ musicEnabled: … }`) — jamais un patch reçu du client.
 * Le paramètre `enabled` est un booléen isolé (pas un objet), donc **aucune escalade de
 * privilège n'est possible** même avec un payload hostile côté transport : il n'existe
 * structurellement AUCUN moyen d'atteindre `volume`/`theme`/`screenTime*`/profils/PIN via ces
 * deux fonctions, contrairement à `saveSettingsAction` (patch large côté PARENT, jamais exposé
 * ici). `writeHouseholdSettings` (même moteur d'upsert/validation que l'écran parent, source de
 * vérité UNIQUE, ADR 0017) reste réutilisé — pas de doublon d'état — mais **jamais** avec un
 * patch fourni par l'appelant.
 *
 * **NO-PIN, gardé par session ENFANT** (`getCurrentChildProfileId`, même garde que le reste de ce
 * fichier) — **c'est le point** : DETAILS §3 exige un accès enfant SANS PIN pour muter vite dans
 * une pièce calme. Non authentifié (aucune session enfant valide) → `{ ok: false }` neutre,
 * **aucune écriture** (même contrat que `submitAttemptAction`/`finishLevelAction` ci-dessus).
 * Idempotent (upsert `onConflictDoUpdate` sur la ligne singleton, `writeHouseholdSettings`).
 */
export async function setChildSoundEnabledAction(
  enabled: boolean,
): Promise<ChildQuickMuteActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { ok: false };
  }
  writeHouseholdSettings(getDb(), { soundEnabled: enabled === true });
  return { ok: true };
}

/** Voir `setChildSoundEnabledAction` — même contrat SÉCU/no-PIN, champ `musicEnabled` seul. */
export async function setChildMusicEnabledAction(
  enabled: boolean,
): Promise<ChildQuickMuteActionResult> {
  const profileId = await getCurrentChildProfileId();
  if (profileId === null) {
    return { ok: false };
  }
  writeHouseholdSettings(getDb(), { musicEnabled: enabled === true });
  return { ok: true };
}
