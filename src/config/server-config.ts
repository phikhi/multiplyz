/**
 * Configuration serveur centralisée (paramètres ⚙️ + secrets).
 *
 * - Source unique des paramètres réglables ⚙️ : jamais de constante magique en dur.
 * - L'environnement est lu et validé au BOOT (fail-fast) — cf. `src/instrumentation.ts`.
 * - SERVER-ONLY : contient des secrets (clé API). Ne jamais importer dans un composant
 *   client. En production, les valeurs viennent de Forge env / GitHub Secrets
 *   (cf. WORKFLOW.md §15).
 */

// Import RELATIF (pas l'alias `@`) : ce module est consommé HORS runtime Next
// (`db:migrate` tsx, drizzle-kit, vitest) où le résolveur de paths de Next
// n'existe pas. `domain.ts` est un module **pur** (aucun `server-only`/argon2/DB —
// LEARNINGS #34) → import sûr ici. On n'importe QUE le type `Skill` + la liste
// `SKILLS` (valeur pure), rien d'autre du moteur.
import { SKILLS, type Skill } from "../lib/engine/domain";

export type AppMode = "development" | "test" | "production";

export interface DatabaseConfig {
  /** Chemin du fichier SQLite local (`DATABASE_PATH`). */
  path: string;
  /** ⚙️ `busy_timeout` SQLite en ms (concurrence daemon web + worker). */
  busyTimeoutMs: number;
  /** ⚙️ mode journal SQLite. */
  journalMode: "WAL";
}

export interface ImageModelConfig {
  /** Clé API du modèle d'image (Gemini) — requise en production. */
  apiKey: string;
  /** ⚙️ identifiant du modèle d'image (Nano Banana / Gemini). */
  model: string;
}

/**
 * Paramètres ⚙️ argon2id (hash des PIN). Défauts alignés OWASP (argon2id, ~19 MiB,
 * t=2, p=1) — cf. AUTH.md §3. Centralisés ici : la couche auth ne fige rien.
 */
export interface Argon2Config {
  /** Mémoire en KiB. */
  memoryCost: number;
  /** Itérations. */
  timeCost: number;
  /** Parallélisme. */
  parallelism: number;
}

/**
 * Paramètres ⚙️ du rate-limit / backoff des tentatives de PIN (AUTH.md §4).
 * **Posés** ici en #2.1 ; **consommés** par la story #2.4. Backoff croissant,
 * jamais de verrou permanent (c'est un enfant).
 */
export interface RateLimitConfig {
  /** Échecs tolérés par profil avant backoff. */
  maxAttemptsPerProfile: number;
  /** Échecs tolérés par IP avant backoff. */
  maxAttemptsPerIp: number;
  /** Délai de base du backoff (ms), appliqué au 1ᵉʳ dépassement. */
  backoffBaseMs: number;
  /** Facteur multiplicatif du backoff à chaque échec supplémentaire. */
  backoffFactor: number;
  /** Plafond du délai de backoff (ms) — borne la croissance. */
  backoffMaxMs: number;
}

/**
 * Config ⚙️ de l'auth-lite (AUTH.md). Durées de session (enfant longue, parent
 * courte), coût de hash, seuils de rate-limit, GC des sessions. Aucune valeur en
 * dur ailleurs.
 */
export interface AuthConfig {
  /** Durée de la session enfant (ms) — confort multi-appareils (~30 j). */
  childSessionMs: number;
  /** Durée de la session parent (ms) — courte, re-demande le PIN (~15 min). */
  parentSessionMs: number;
  argon2: Argon2Config;
  rateLimit: RateLimitConfig;
  /**
   * ⚙️ **Déclencheur du GC des sessions expirées** (#44). `true` (défaut) =
   * purge **opportuniste au login** : chaque connexion réussie supprime au
   * passage les sessions périmées (`expires_at <= now`). Défaut retenu car v1
   * n'a **pas de cron ni de daemon supplémentaire** (STACK : un seul process
   * web). Basculer à `false` (env `AUTH_GC_SESSIONS_ON_LOGIN=false`) le jour où
   * un cron/backup (#9) prend le relais — le GC devient alors une tâche de fond
   * dédiée. La lecture des sessions filtre déjà l'expiration (`expires_at > now`)
   * → désactiver le GC ne compromet **jamais** la sécurité, seulement l'hygiène.
   */
  gcSessionsOnLogin: boolean;
}

/** Seuils de fluence ⚙️ (ms) par compétence — « rapide » = `response_ms ≤ seuil`. */
export type FluenceThresholdsMs = Record<Skill, number>;

/**
 * Config ⚙️ du **moteur pédagogique** (ENGINE.md §11). **Posée** ici (contrat
 * partagé de l'épic #3) ; **consommée** par les stories 3.3–3.7 (maîtrise,
 * sélection, composition de niveau, interleaving, étoiles) — pas ici. Source unique
 * de tous les paramètres à calibrer du moteur : aucune valeur en dur ailleurs.
 *
 * ⚠️ Les **bornes de domaine** des faits (opérandes, somme max…) restent dans
 * `src/lib/engine/domain.ts` (moteur pur) — elles ne migrent PAS ici.
 */
export interface EngineConfig {
  /**
   * Délais des boîtes Leitner **en jours**, indexés par la boîte 0..5 (ENGINE §2).
   * `[0, 1, 2, 4, 9, 21]` : boîte 0 = même session, boîte 5 = entretien (21 j).
   */
  leitnerDelaysDays: readonly number[];
  /** Seuils de fluence (ms) par compétence : « rapide » sous ce seuil (ENGINE §2). */
  fluenceThresholdsMs: FluenceThresholdsMs;
  /** Boîtes gagnées quand juste + rapide (promotion, ENGINE §2/§11). */
  promoteBoxes: number;
  /** Boîtes perdues quand faux / « je ne sais pas » (rétrograde, ENGINE §2/§11). */
  demoteBoxes: number;
  /** Boîte maximale (dernière boîte Leitner) — borne haute de la force. */
  maxBox: number;
  /** `NEW_MAX_PAR_NIVEAU` : nouveaux faits max introduits par niveau (ENGINE §7). */
  newMaxPerLevel: number;
  /** `NEW_MAX_PAR_JOUR` : nouveaux faits max introduits par jour (ENGINE §7). */
  newMaxPerDay: number;
  /** `SEUIL_CONSO` : si ≥ ce nb de facts à `box ≤ 1` → 0 nouveau (ENGINE §7). */
  consolidationThreshold: number;
  /** Boîte « fragile » : `box ≤ ce seuil` compte pour la consolidation (ENGINE §7). */
  consolidationMaxBox: number;
  /** Bascule interleaving : maîtrise ≥ ce ratio (facts à `box ≥ …`) → mélange (ENGINE §7). */
  interleaveThresholdRatio: number;
  /** Boîte plancher de la bascule interleaving (`box ≥ …`, ENGINE §7). */
  interleaveMinBox: number;
  /** Déclencheur Tier suivant : maîtrise ≥ ce ratio (facts à `box ≥ …`) (ENGINE §8/§11). */
  tierUnlockRatio: number;
  /** Boîte plancher du déclencheur de Tier (`box ≥ …`, ENGINE §11). */
  tierUnlockMinBox: number;
  /** Seuils d'étoiles (ratio de réussite d'un niveau) : 1★ / 2★ / 3★ (ENGINE §5/§11). */
  starThresholds: readonly [number, number, number];
  /** Anti-mash : réponse sous ce délai (ms) = ignorée (anti-triche, ENGINE §9/§11). */
  antiMashMs: number;
  /** Taille du diagnostic de départ (~nb de calculs, ENGINE §3/§11). */
  diagnosticSize: number;
  /**
   * **Seuil de dette de révision** (MAP §5) : au-delà de ce **nombre de faits DUE**
   * (« facts en retard », cf. `computeRevisionDebt`), la carte (5.2) **type en révision
   * le nœud courant** (prochain à jouer, jamais le boss) — un **overlay de type**, pas un
   * nœud ajouté : la géométrie du monde (nombre de nœuds, positions, `level_index`) reste
   * **inchangée** (remédiation immédiate + progression stable, MAP §4/§5). Borne stricte
   * `>` (MAP §5 `> 12 facts en retard`). Défaut `12`. Vit dans `EngineConfig` car c'est
   * un seuil **pédagogique** comparé à une quantité calculée par le moteur (dus/dette),
   * même famille que `consolidationThreshold` — pas de la géométrie de carte (`MapConfig`).
   */
  revisionDebtThreshold: number;
}

/**
 * ⚙️ **Structure de la carte** (MAP §3/§5/§6) — géométrie et cadence des nœuds d'un
 * monde, distinctes des seuils **pédagogiques** (`EngineConfig`). Consommé par la carte
 * procédurale (5.2, `game/map.ts`), fonction pure : ces valeurs cadrent la forme du
 * chemin (nb de niveaux, cadence des trésors, longueur du boss), pas la maîtrise.
 */
export interface MapConfig {
  /**
   * Nombre de **niveaux normaux** par monde, **avant** le boss (MAP §1/§6). Le monde
   * compte donc `levelsPerWorld + 1` nœuds (~11). Défaut `10` (MAP §1 « ~10 niveaux + 1
   * boss »).
   */
  levelsPerWorld: number;
  /**
   * **Cadence des trésors** (MAP §3) : un nœud **trésor** ~tous les N nœuds normaux.
   * Défaut `4` (MAP §3 « ~tous les 4 nœuds »). Le boss (dernier nœud) n'est jamais un
   * trésor (sa position prime).
   */
  treasureEvery: number;
  /**
   * Nombre de questions du **boss** de fin de monde (MAP §6 : « ~12-15 questions »).
   * Défaut `13` (milieu de fourchette). Exposé ici pour rester calibrable au playtest ;
   * la composition du contenu boss reste au moteur (hors 5.2 — la carte n'expose que la
   * **structure**).
   */
  bossQuestionCount: number;
}

/**
 * ⚙️ **Barème économique** (ECONOMY §4.1/§5) — taux de gain de pièces en fin de niveau.
 * **Config versionnée** (ECONOMY §3 note : « taux, prix, odds = fichier de config
 * versionné, pas en DB ») : ces valeurs se calibrent au playtest sans migration ni
 * écriture DB. Consommé par la couche gains (`game/reward.ts`, fonction pure) — jamais
 * de montant en dur dans le crédit (le portefeuille `game/wallet.ts` écrit ce qu'on lui
 * donne, ECONOMY §4.1 : « aucune logique de barème dans le portefeuille »).
 *
 * **Périmètre 5.5** : gain de **fin de niveau** (base + bonus par étoile) + **bonus
 * trésor** (nœud trésor = « mini-défi court → pièces bonus », PRODUCT §2.1). **Périmètre
 * 5.6** : le **gros lot de pièces du boss** (`+50`, ECONOMY §5) s'ajoute au gain de niveau
 * standard sur un nœud **boss** (la **créature légendaire garantie** est gérée par la
 * couche collection, pas par le barème pièces).
 */
export interface EconomyConfig {
  /** Pièces de **base** par niveau terminé (ECONOMY §5, défaut `10`). Entier ≥ 0. */
  levelBaseCoins: number;
  /** Pièces **bonus par étoile** obtenue (ECONOMY §5, défaut `+5`/étoile). Entier ≥ 0. */
  starBonusCoins: number;
  /**
   * Pièces **bonus** additionnelles pour un nœud **trésor** (« mini-défi court → pièces
   * bonus », PRODUCT §2.1). S'ajoute au gain de niveau standard. ECONOMY §5 ne chiffre
   * pas le trésor séparément (le coffre **quotidien** = 20, distinct) → valeur de départ
   * ⚙️ prudente `15`, à calibrer au playtest. Entier ≥ 0.
   */
  treasureBonusCoins: number;
  /**
   * Pièces **bonus** additionnelles pour un nœud **boss** (« gros lot de pièces »,
   * MAP §6 / ECONOMY §4.1). S'ajoute au gain de niveau standard **uniquement** sur le
   * boss (dernier nœud). Valeur de départ ⚙️ `50` (ECONOMY §5 « Bonus boss +50 »). Entier
   * ≥ 0. Distinct du bonus trésor (un boss n'est jamais un trésor, MAP §6). La légendaire
   * garantie n'est **pas** un gain de pièces (couche collection, hors barème).
   */
  bossBonusCoins: number;
}

/**
 * ⚙️ **Prompts de base verrouillés** du pipeline de génération (charte ART §5). Constantes
 * (jamais de texte en dur ailleurs — CLAUDE.md « prompt de base verrouillé ») : `style` +
 * `negative` sont **constants** (« jamais modifié », ART §5) ; les trois gabarits (`teddy`,
 * `creature`, `background`) portent des **variables** `{…}` injectées par le worker (Stage
 * A/B, épic #6 — pas cette story). Regroupés dans `WorldGenConfig` pour rester **calibrables
 * ⚙️** au playtest (ADR 0008 contrainte 4 « ombrage calibrable ») via un override d'env, sans
 * les figer dans le code du client image.
 */
export interface WorldGenPrompts {
  /** STYLE DE BASE (constant, réinjecté tel quel à chaque génération — ART §5). */
  style: string;
  /** NEGATIVE (constant — ART §5). Inclut « text, letters » (ADR 0008 : Nano Banana rend du texte parasite). */
  negative: string;
  /** Gabarit Teddy (variables `{base_style}` / `{world_accessory}` — ART §5 ; « blank ear tag » ADR 0008 contrainte 2). */
  teddy: string;
  /** Gabarit créature (variables `{base_style}` / `{creature_concept}` / `{features}` / `{world_palette}` — ART §5). */
  creature: string;
  /** Gabarit fond de monde (variables `{base_style}` / `{world_theme}` / `{world_palette}` — ART §5). */
  background: string;
}

/**
 * **Stratégie de fond** des assets de personnage (Teddy/créatures), ⚙️ tranché story 6.2.
 *
 * ADR 0008 contrainte 3 : Nano Banana **ne garantit pas l'alpha** (rend un fond blanc plein).
 * Or ART §4 exige un **fond transparent** (1:1 WebP) pour l'affichage Pokédex/collection
 * (PRODUCT §2.3 — la créature détourée se pose proprement sur n'importe quel fond d'UI). Deux
 * options :
 * - `post-cutout` (**retenu par défaut**) : générer sur fond de matte plein (blanc), puis
 *   **détourer** en post-traitement → asset à fond transparent, lisible partout dans le Pokédex.
 * - `full-card` : garder la carte pleine (fond opaque) — plus simple mais casse la lisibilité
 *   Pokédex (chaque vignette porte son propre fond au lieu de se fondre dans l'UI).
 *
 * Consommé par l'outil Stage A (`lib/worldgen/stage-a.ts`) : la stratégie **change la sortie
 * observable** (asset détouré vs carte pleine + drapeau `transparent`). Calibrable au playtest.
 */
export type BackgroundStrategy = "post-cutout" | "full-card";

/** Stratégies de fond valides (source unique pour le parsing ⚙️). */
export const BACKGROUND_STRATEGIES = ["post-cutout", "full-card"] as const;

/**
 * Config ⚙️ de l'**outil Stage A** (WORLDGEN §8 — master Teddy + model sheet, story 6.2).
 * Outil **one-shot hors chemin runtime enfant** : lit les photos réelles **une seule fois**
 * (Stage A), produit le master + les 5 expressions, applique la stratégie de fond. `photosDir`
 * et `outputDir` sont gitignorés (photos privées + assets dérivés — cf. `.gitignore`).
 */
export interface StageAConfig {
  /**
   * Dossier des **photos réelles** de Teddy (Stage A **uniquement** — jamais relu après,
   * WORLDGEN §8). Gitignoré (`/docs/teddy/`). Défaut `docs/teddy`.
   */
  photosDir: string;
  /**
   * Dossier de **sortie** des assets de référence dérivés (master + expressions), servis
   * ensuite par Nginx (WORLDGEN §5). Gitignoré (`/storage/`). Défaut `storage/reference/teddy`.
   */
  outputDir: string;
  /**
   * Stratégie de fond ⚙️ (ADR 0008 contrainte 3). **Consommée** par l'outil Stage A :
   * `post-cutout` détoure (asset transparent, lisibilité Pokédex) ; `full-card` garde le fond
   * plein. Défaut `post-cutout`.
   */
  backgroundStrategy: BackgroundStrategy;
  /**
   * Couleur du **matte** de génération (fond plein sur lequel le modèle rend, à détourer en
   * `post-cutout`). Blanc par défaut (ADR 0008 : Nano Banana rend un fond blanc). Défaut `#ffffff`.
   */
  matteColor: string;
}

/**
 * Config ⚙️ de la **modération kid-safe + validation parent** (WORLDGEN §6, ART §6, story 6.5).
 *
 * **Consommée** par le worker (`processNextJob`) : après génération d'un monde, ses assets passent
 * à l'auto-filtre kid-safe (règles WORLDGEN §6). Chaque champ AGIT sur le chemin runtime :
 * - `parentValidationEnabled` : le worker choisit le statut du monde QA-validé (`buffered` en
 *   attente d'approbation parent si `true`, `active` auto si `false`) — cf. `moderatedStatusAfterQaPass`.
 * - `maxAttempts` : nombre de **régénérations** tolérées après un rejet QA avant que le monde reste
 *   sur le **fallback** (WORLDGEN §6 « jusqu'à N essais »). Même sémantique que `maxRetries` côté
 *   réseau (seuil `attempts > maxAttempts → failed`), mais compteur distinct d'un rejet QA.
 * - `unsafeMaxScore` / `styleMinScore` : **seuils** des règles `safe_content` / `style_coherence`
 *   (cf. `lib/worldgen/qa.ts`). Un asset dont le score dépasse/rate le seuil est **rejeté**.
 *
 * ⚠️ Les **signaux** que ces seuils comparent (texte OCR, score effrayant, score de style) sont
 * produits par un **inspecteur vision** injecté ; l'inspecteur par défaut échoue **closed** (jamais
 * de monde non-vérifié en `active`) tant qu'un classifieur réel n'est pas branché — cf. `qa.ts`.
 */
export interface QaConfig {
  /**
   * ⚙️ **Toggle validation parent** (WORLDGEN §6, validation parent **optionnelle**). `true` → un
   * monde QA-validé reste `buffered` jusqu'à l'approbation parent (`approvedBy`) ; `false` (défaut)
   * → il passe `active` **auto** après QA. L'UI d'approbation est l'espace parent (épic #7) — ici
   * seul le **mécanisme** de transition d'état est posé. Défaut `false` (auto : ADR 0008 « aucune
   * sur-censure observée » ; le proprio l'active via env s'il veut valider chaque monde à la main).
   */
  readonly parentValidationEnabled: boolean;
  /**
   * ⚙️ **Régénérations** après un rejet QA avant de rester sur le **fallback** (WORLDGEN §6 « jusqu'à
   * N essais »). Nombre de **ré-essais** au-delà de la 1ʳᵉ tentative (`0` = aucun ré-essai : 1er rejet
   * QA → fallback). Compteur distinct du retry réseau (`maxRetries`). Défaut `3`.
   */
  readonly maxAttempts: number;
  /**
   * ⚙️ Seuil **max** du score « effrayant/inapproprié » `[0,1]` toléré (règle `safe_content`,
   * WORLDGEN §6) — un asset dont le score **dépasse** ce seuil est rejeté. `0` = tolérance nulle,
   * `1` = tout accepté. Défaut `0.5` (filet ⚙️, à calibrer au playtest avec le classifieur réel).
   */
  readonly unsafeMaxScore: number;
  /**
   * ⚙️ Seuil **min** de cohérence de style vs charte `[0,1]` exigé (règle `style_coherence`, ART §6)
   * — un asset dont le score **rate** ce seuil est rejeté (hors-charte). `0` = style non gardé,
   * `1` = conformité parfaite exigée. Défaut `0.6` (filet ⚙️, à calibrer au playtest).
   */
  readonly styleMinScore: number;
}

/**
 * Config ⚙️ du **pipeline de génération de mondes** (WORLDGEN.md §2/§3/§5/§6, ADR 0008).
 * **Posée** ici (contrat épic #6, story 6.1) ; **consommée** par le worker/buffer + le client
 * image + la QA kid-safe (stories 6.x). Source unique des ⚙️ du pipeline (garde-fou budget, buffer,
 * retry, prompts de base, modération kid-safe) : aucune valeur en dur ailleurs. Mêmes conventions
 * que `loadEngineConfig`.
 */
export interface WorldGenConfig {
  /**
   * **Plafond budgétaire mensuel** en euros (WORLDGEN §2 « alerte/plafond mensuel ⚙️ »,
   * plafond proprio ~20 €/mois — ADR 0008). Garde-fou coût : le worker cesse d'enqueue une
   * génération payante une fois le plafond atteint (consommé par le worker, story 6.x).
   * Défaut `20`.
   */
  monthlyBudgetEur: number;
  /** Mondes d'avance maintenus sur le `world_index` courant (buffer, WORLDGEN §3). Défaut `2`. */
  bufferAhead: number;
  /**
   * Essais **supplémentaires** du retry réseau transitoire du client image (HTTP 500/503/429
   * → backoff, ADR 0008 contrainte 1). C'est le nombre de **ré-essais** au-delà de la 1ʳᵉ
   * tentative (0 = aucun retry). Défaut `3`.
   */
  maxRetries: number;
  /**
   * ⚙️ Délai de base du backoff (ms) entre deux essais du retry transitoire — croissance **linéaire**
   * (`retryBackoffMs × n° d'essai`). Défaut `500`.
   *
   * **État de consommation (honnête, #165/#155)** : ce ⚙️ **est consommé** par la boucle de retry de
   * `generateImage` (`lib/worldgen/image-client.ts` : `sleep(retryBackoffMs × attempt)` sur 429/500/503).
   * Son effet sur le **timing du backoff** est **unit-testé** avec un `fetch` **mocké** (statuts
   * transitoires simulés) + un `sleep` **espionné** (`image-client.test.ts`) — **aucun appel réseau
   * réel** en CI. Ce qui reste **owner-gated** : l'exercice contre un **vrai endpoint** flaky (Gemini
   * live, clé owner) n'est **jamais** joué en CI (le worker ne tourne pas contre le réseau réel ici).
   * Donc : « backoff **posé + validé + testé sur fetch mocké** ; calibrage sur endpoint réel à
   * l'intégration réseau owner » — **jamais** « prouvé contre le réseau réel ».
   *
   * **Validé** : `parsePositiveInt` (un backoff `0`/négatif n'a pas de sens → retombe au défaut).
   */
  retryBackoffMs: number;
  /** Prompts de base verrouillés (charte ART §5). Constantes ⚙️ (cf. `WorldGenPrompts`). */
  prompts: WorldGenPrompts;
  /** ⚙️ Outil Stage A (master Teddy + model sheet, WORLDGEN §8) — consommé par `stage-a.ts` (story 6.2). */
  stageA: StageAConfig;
  /** ⚙️ Modération kid-safe + validation parent (WORLDGEN §6) — consommée par le worker (story 6.5). */
  qa: QaConfig;
}

/**
 * ⚙️ **Sémantiques de reporting de l'espace parent** (PLAN §Espace parent :79-84, story 7.2,
 * ADR 0012). **Posés ET consommés** par les agrégats read-only `lib/parent/stats.ts` (justesse,
 * rapidité/fluence, carte de maîtrise, à revoir) — chaque valeur AGIT sur un agrégat testé.
 *
 * ⚠️ Ce sont des **définitions de reporting DÉRIVÉES** : elles décrivent COMMENT présenter au
 * parent l'état du moteur, **sans changer aucune décision ENGINE verrouillée**. La **maîtrise
 * reste `box ≥ 4`** (`isFactMastered`/`skillMasteryRatio`, ENGINE §2), la **justesse reste la
 * correction et non la vitesse** (PRODUCT §5 :138, ENGINE §5). Les seuils de **fluence** (« lent »
 * au niveau d'un fait) restent ceux d'`EngineConfig.fluenceThresholdsMs` — jamais redéfinis ici.
 * Distinct d'`EngineConfig` (seuils **pédagogiques** qui pilotent le jeu de l'enfant) : ces ⚙️ ne
 * pilotent **que** l'affichage parent.
 */
export interface ReportingConfig {
  /**
   * **Fenêtre « semaine glissante »** en jours (PLAN §Espace parent « tendance dans le temps »).
   * La tendance compare la fenêtre **courante** `(now − N j, now]` à la fenêtre **précédente**
   * `(now − 2N j, now − N j]`. Défaut `7` (semaine). ≥ 1 (une fenêtre nulle n'a pas de sens).
   */
  trendWindowDays: number;
  /**
   * **Zone morte** de la tendance de **justesse** (ratio `[0,1]`) : un écart de justesse entre
   * fenêtres `≤ ce seuil` (en valeur absolue) est rapporté **stable** (ni amélioration ni
   * régression), pour ne pas sur-interpréter le bruit. Défaut `0.05` (5 points). `0` légitime
   * (aucune zone morte : le moindre écart fait tendance).
   */
  trendAccuracyDelta: number;
  /**
   * **Zone morte** de la tendance de **rapidité** (ms) : un écart de temps de réponse moyen entre
   * fenêtres `≤ ce seuil` est rapporté **stable**. Pour la rapidité, **baisser = s'améliorer**
   * (automatisation) — la direction est calculée en conséquence (`lowerIsBetter`). Défaut `300` ms.
   * `0` légitime (aucune zone morte).
   */
  trendSpeedDeltaMs: number;
  /**
   * **Seuil « maîtrisé »** de la carte de maîtrise (ratio `]0,1]`) : une compétence dont le ratio
   * `skillMasteryRatio` (proportion de ses faits Tier 1 à `box ≥ 4`, ENGINE §2) est `≥ ce seuil`
   * est classée **maîtrisée**. Défaut `0.85` — écho **exact** du déclencheur de Tier
   * (`tierUnlockRatio`, ENGINE §8) : même ratio ET **même computation** (proportion à `box ≥ 4`).
   * Réglage **d'affichage**, calibrable indépendamment du gate moteur.
   */
  masteredMinRatio: number;
  /**
   * **Seuil « en cours »** de la carte de maîtrise (ratio `]0,1]`) : ratio `≥ ce seuil` (et
   * `< masteredMinRatio`) → **en cours** ; en dessous → **faible**. Défaut `0.4` — valeur
   * **empruntée** à la bascule interleaving (ENGINE §7) mais appliquée à une **computation
   * différente** : la carte classe sur `box ≥ 4` (comme tout le reporting), tandis que
   * l'interleaving mesure sur `box ≥ 3` (`interleaveMinBox`). Emprunt **numérique**, pas un écho
   * exact (contrairement à `masteredMinRatio`) → **calibrable indépendamment**. Attendu
   * `< masteredMinRatio` (ordre de classement), mais la classification reste déterministe même si
   * l'env les inverse (« maîtrisé » testé en premier).
   */
  inProgressMinRatio: number;
  /**
   * **Taille max de la liste « à revoir »** (top N calculs ratés/lents, PLAN §Espace parent). La
   * liste est **bornée** à ce nombre après tri par priorité de remédiation. Défaut `5`. ≥ 1.
   */
  reviewListSize: number;
}

/**
 * ⚙️ **Sémantiques de régularité de l'espace parent** (PLAN §Espace parent :83, WIREFRAMES §7,
 * story 7.4, ADR 0014). **Posés ET consommés** par les agrégats read-only `lib/parent/regularity.ts`
 * (jours joués, temps de jeu/jour, série de jours, respect des 15-20 min) — chaque valeur AGIT sur
 * un agrégat testé.
 *
 * ⚠️ Ce sont des **définitions de reporting DÉRIVÉES** de `attempts.createdAt` (aucune table de
 * sessions, aucune écriture runtime — ADR 0014, Option A). Elles décrivent COMMENT présenter au
 * parent la régularité **observée** de l'enfant, **sans changer aucune décision ENGINE/PLAN/SYNC
 * verrouillée** et **sans rien enforcer** : le respect des 15-20 min et le temps/jour sont un
 * **repère de reporting**, pas un plafond. Le nudge/verrou de temps d'écran (`ParentControlsConfig`,
 * stocké par foyer en 7.3) et son **enforcement** (story 7.8 #229) sont un **axe distinct** — ces
 * ⚙️ ne pilotent **que** l'affichage parent.
 */
export interface RegularityConfig {
  /**
   * **Fuseau horaire IANA** définissant le **jour calendaire** (jours joués + séries). Un instant est
   * rattaché à sa date **locale** dans ce fuseau (jamais UTC brut), fidèle au vrai jour vécu de
   * l'enfant (famille française). Défaut `"Europe/Paris"`. Une valeur non reconnue par `Intl`
   * retombe sur le défaut (jamais de fuseau invalide propagé au calcul).
   */
  dayTimeZone: string;
  /**
   * **Plafond d'amplitude** du temps de jeu **par jour**, en minutes (ADR 0014 : temps/jour ≈
   * `min(dernier − premier attempt du jour, ce plafond)`). Borne l'approximation par amplitude pour
   * qu'une réponse isolée du matin + une du soir ne gonfle pas le temps mesuré. Défaut `240` (4 h).
   * ≥ 1 (`parsePositiveInt`) — un plafond `0` mesurerait toujours 0 (dégénéré → retombe sur le défaut).
   */
  maxDayAmplitudeMinutes: number;
  /**
   * **Écart (en jours calendaires) qui ROMPT une série** : deux jours joués appartiennent à la même
   * série si leur écart est **strictement inférieur** à ce seuil ; un écart `≥ ce seuil` la rompt.
   * Défaut `2` (jours **consécutifs** stricts : écart 1 continue, écart 2 rompt). ≥ 1 (`parsePositiveInt`)
   * — une valeur `1` est dégénérée (aucune série > 1 jour possible) mais non fatale → à garder ≥ 2.
   */
  streakBreakGapDays: number;
  /**
   * **Borne basse** (min) de la fenêtre saine de temps de jeu quotidien (« respect des 15-20 min »,
   * PLAN §Espace parent :83, DETAILS §27). Un jour dont le temps mesuré est `< ce seuil` est classé
   * **en-dessous**. Défaut `15`. ≥ 1 (`parsePositiveInt`).
   */
  respectWindowMinMinutes: number;
  /**
   * **Borne haute** (max) de la fenêtre saine de temps de jeu quotidien. Un jour dont le temps
   * mesuré est `> ce seuil` est classé **au-dessus** ; entre les deux bornes **incluses** → **dans la
   * fenêtre**. Défaut `20`. ≥ 1 (`parsePositiveInt`). Attendu `≥ respectWindowMinMinutes`, mais la
   * classification reste déterministe même si l'env les inverse.
   */
  respectWindowMaxMinutes: number;
}

/**
 * ⚙️ **Contrôles parentaux — temps d'écran** (DETAILS §27, PRODUCT §1.4, story 7.3). Source unique
 * des **défauts + bornes** ⚙️ des réglages de temps d'écran que le parent calibre depuis l'espace
 * parent (persistés par foyer dans `household_settings`, `lib/parent/settings.ts`).
 *
 * ⚠️ **État de consommation (honnête, #127/#155)** : ces ⚙️ sont **POSÉS + VALIDÉS + STOCKÉS** en
 * 7.3 (défauts d'un foyer neuf + bornes de validation `writeHouseholdSettings`). Ils ne sont **PAS
 * ENFORCÉS** ici : l'enforcement runtime (nudge de session + verrou dur qui bloque l'app) dépend du
 * **temps-joué persisté** (story 7.4 #217, inexistant) et vit dans la **story 7.8 #229**. Décrire
 * « borne posée + validée + stockée, consommée en 7.8 », **jamais** « agit / bloque ».
 *
 * `parsePositiveInt` partout (≥ 1) : une durée `0`/négative n'a pas de sens (min de session, min/jour).
 */
export interface ParentControlsConfig {
  /** Nudge doux — durée de session par **défaut** avant « fais une pause » (min, DETAILS §27 « 15-20 »). */
  screenTimeNudgeDefaultMinutes: number;
  /** Nudge doux — borne **min** admissible (min) — validation de `writeHouseholdSettings`. */
  screenTimeNudgeMinMinutes: number;
  /** Nudge doux — borne **max** admissible (min) — validation de `writeHouseholdSettings`. */
  screenTimeNudgeMaxMinutes: number;
  /** Verrou dur — seuil quotidien par **défaut** (min/jour, DETAILS §27) — opt-in parent. */
  screenTimeHardLockDefaultMinutes: number;
  /** Verrou dur — borne **min** admissible (min/jour) — validation de `writeHouseholdSettings`. */
  screenTimeHardLockMinMinutes: number;
  /** Verrou dur — borne **max** admissible (min/jour) — validation de `writeHouseholdSettings`. */
  screenTimeHardLockMaxMinutes: number;
}

/**
 * ⚙️ **Réglages son** (DETAILS §22 « son on/off, musique on/off + volume », PRODUCT §2/§137, story
 * 8.3). Source unique des **défauts** ⚙️ d'un foyer neuf pour `soundEnabled`/`musicEnabled`/`volume`
 * (persistés par foyer dans `household_settings`, `lib/parent/settings.ts`). Contrairement au temps
 * d'écran (`ParentControlsConfig`), les **bornes de validation** ne sont PAS calibrables : `volume`
 * est un pourcentage à bornes naturelles fixes `[0, 100]` (mêmes conventions que `THEME_PREFERENCES`,
 * bornes non-⚙️ — seul le point de repli est calibrable).
 *
 * ⚠️ **État de consommation (honnête, #127/#155)** : ces ⚙️ sont **POSÉS + VALIDÉS + STOCKÉS** en
 * 8.3 (défauts d'un foyer neuf + bornes de validation `writeHouseholdSettings`). Ils ne sont **PAS
 * ENFORCÉS** ici : aucun moteur audio n'existe encore — la lecture/coupure réelle du son/musique au
 * volume réglé dépend du **moteur sonore** (story 8.4, inexistant). Décrire « déclaré + validé +
 * stocké, consommé en 8.4 », **jamais** « agit / joue / coupe ».
 */
export interface SoundConfig {
  /** Bruitages activés par **défaut** pour un foyer neuf (DETAILS §22). */
  soundEnabledDefault: boolean;
  /** Musique activée par **défaut** pour un foyer neuf (DETAILS §22). */
  musicEnabledDefault: boolean;
  /** Volume par **défaut** pour un foyer neuf, en pourcentage `[0, 100]` (DETAILS §22 « + volume »). */
  volumeDefault: number;
}

/** Bornes **fixes** (non-⚙️) du volume — pourcentage entier, source unique pour parsing + validation. */
export const SOUND_VOLUME_MIN = 0;
export const SOUND_VOLUME_MAX = 100;

export interface AppConfig {
  mode: AppMode;
  database: DatabaseConfig;
  imageModel: ImageModelConfig;
  auth: AuthConfig;
  engine: EngineConfig;
  map: MapConfig;
  economy: EconomyConfig;
  worldgen: WorldGenConfig;
  reporting: ReportingConfig;
  regularity: RegularityConfig;
  parentControls: ParentControlsConfig;
  sound: SoundConfig;
}

/** Valeurs par défaut ⚙️ centralisées (surchargées par l'environnement). */
export const CONFIG_DEFAULTS = {
  database: {
    path: "./data/multiplyz.sqlite",
    busyTimeoutMs: 5000,
    journalMode: "WAL",
  },
  imageModel: {
    model: "gemini-2.5-flash-image",
  },
  auth: {
    // 30 j (confort) / 15 min (parent, re-PIN) — cf. AUTH.md §3.
    childSessionMs: 30 * 24 * 60 * 60 * 1000,
    parentSessionMs: 15 * 60 * 1000,
    argon2: {
      // OWASP argon2id : 19 MiB, t=2, p=1.
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    },
    rateLimit: {
      maxAttemptsPerProfile: 5,
      maxAttemptsPerIp: 15,
      backoffBaseMs: 1_000,
      backoffFactor: 2,
      backoffMaxMs: 5 * 60 * 1000,
    },
    // GC des sessions expirées : opportuniste au login (pas de cron en v1, #44).
    gcSessionsOnLogin: true,
  },
  engine: {
    // Délais boîtes Leitner (j) : 0 · 1 · 2 · 4 · 9 · 21 (ENGINE §2/§11).
    leitnerDelaysDays: [0, 1, 2, 4, 9, 21],
    // Seuils fluence (ms) : compléments/add 3 s, sous/mult 4 s (ENGINE §2/§11).
    fluenceThresholdsMs: {
      comp10: 3_000,
      add: 3_000,
      sub: 4_000,
      mult: 4_000,
    },
    // Promotion juste+rapide → +1 ; faux → −2 (ENGINE §2/§11).
    promoteBoxes: 1,
    demoteBoxes: 2,
    // Boîte max = dernière boîte Leitner (6 boîtes 0..5 → max 5).
    maxBox: 5,
    // Rythme prudent (ENGINE §7/§11).
    newMaxPerLevel: 2,
    newMaxPerDay: 5,
    consolidationThreshold: 8,
    consolidationMaxBox: 1,
    // Bascule interleaving : 40 % à box≥3 (ENGINE §7/§11).
    interleaveThresholdRatio: 0.4,
    interleaveMinBox: 3,
    // Déclencheur Tier suivant : 85 % à box≥4 (ENGINE §8/§11).
    tierUnlockRatio: 0.85,
    tierUnlockMinBox: 4,
    // Seuils étoiles : 60 / 85 / 100 % (ENGINE §5/§11).
    starThresholds: [0.6, 0.85, 1.0],
    // Anti-mash : < 600 ms (ENGINE §9/§11).
    antiMashMs: 600,
    // Diagnostic : ~18 calculs (ENGINE §3/§11).
    diagnosticSize: 18,
    // Seuil dette de révision : > 12 facts en retard → nœud révision (MAP §5).
    revisionDebtThreshold: 12,
  },
  map: {
    // Monde = ~10 niveaux + 1 boss (MAP §1/§6).
    levelsPerWorld: 10,
    // Trésor ~tous les 4 nœuds (MAP §3).
    treasureEvery: 4,
    // Boss : ~12-15 questions → 13 par défaut (MAP §6).
    bossQuestionCount: 13,
  },
  economy: {
    // Fin de niveau : base 10 + 5/étoile (ECONOMY §5).
    levelBaseCoins: 10,
    starBonusCoins: 5,
    // Bonus trésor (mini-défi court, PRODUCT §2.1) — départ prudent, à calibrer.
    treasureBonusCoins: 15,
    // Gros lot du boss (ECONOMY §5 « Bonus boss +50 », MAP §6).
    bossBonusCoins: 50,
  },
  worldgen: {
    // Plafond éco ~20 €/mois (WORLDGEN §2, ADR 0008 : ~45 mondes/mois sous plafond).
    monthlyBudgetEur: 20,
    // Buffer de 2 mondes d'avance (WORLDGEN §3).
    bufferAhead: 2,
    // Retry transitoire : 3 ré-essais + backoff 500 ms de base (ADR 0008 contrainte 1).
    maxRetries: 3,
    retryBackoffMs: 500,
    // Prompts de base verrouillés — copie VERBATIM de la charte ART §5 (jamais en dur ailleurs).
    prompts: {
      // STYLE DE BASE (ART §5) — enrichi une fois par ADR 0009 (direction owner, #160) :
      // flat kawaii 2D CONSERVÉ + AJOUT cel-shading léger + poils tuftés légers (fidèle au
      // master validé #158). GÉNÉRIQUE : partagé par teddy/creature/background via {base_style}.
      // = tokens VERBATIM du master figé, MOINS le torse crème (→ `teddy`) et le fond blanc
      // (« isolated on white background » = détail d'exécution Stage A / cutout, pas du style).
      style:
        "flat 2D kawaii vector illustration, soft rounded shapes, cute chibi proportions, " +
        "big shiny friendly eyes, gentle minimal cel shading, lightly fluffy fur with a few " +
        "soft clean fur tufts along the silhouette edge, tidy smooth even fur, not blotchy, " +
        "no random dark spots or dirty marks, soft pastel palette with bright accent " +
        "highlights, clean simple background, children's app art, high quality, " +
        "consistent art style",
      negative:
        "photorealistic, 3d render, realistic, scary, creepy, dark, gore, text, letters, " +
        "watermark, signature, extra limbs, deformed, busy cluttered details, harsh shadows, " +
        "gradient noise, low quality",
      teddy:
        '{base_style}, "Teddy" a cute vintage 1980s Steiff teddy bear, golden mohair fur, ' +
        "soft lighter cream-colored fluffy chest and belly patch, stitched snout, round dark " +
        "eyes, rounded ears, classic jointed teddy with a slightly humped back, small yellow " +
        "blank ear tag with no text, wearing {world_accessory}, faithful to the reference " +
        "photos, centered, transparent background --ar 1:1",
      creature:
        "{base_style}, a cute round collectible creature: {creature_concept}, " +
        "1-2 distinctive features: {features}, color palette: {world_palette}, " +
        "centered, full body, transparent background --ar 1:1",
      background:
        "{base_style}, a {world_theme} world background landscape, palette: {world_palette}, " +
        "calm uncluttered composition with open space in the lower-center for UI, " +
        "no characters, no text --ar 16:9",
    },
    // Outil Stage A (WORLDGEN §8) — photos gitignorées → sortie gitignorée (storage).
    stageA: {
      // Photos réelles de Teddy (Stage A uniquement) — dossier gitignoré (`/docs/teddy/`).
      photosDir: "docs/teddy",
      // Assets de référence dérivés (master + expressions) — dossier gitignoré (`/storage/`).
      outputDir: "storage/reference/teddy",
      // ADR 0008 contrainte 3 : pas d'alpha fiable → détourage post pour la lisibilité Pokédex.
      backgroundStrategy: "post-cutout",
      // Fond plein rendu par Nano Banana (blanc) — matte à détourer en `post-cutout`.
      matteColor: "#ffffff",
    },
    // Modération kid-safe + validation parent (WORLDGEN §6) — consommée par le worker (story 6.5).
    qa: {
      // Validation parent OPTIONNELLE : défaut auto (ADR 0008 « aucune sur-censure »). Le proprio
      // l'active via `WORLDGEN_QA_PARENT_VALIDATION=true` pour valider chaque monde à la main.
      parentValidationEnabled: false,
      // Jusqu'à 3 régénérations après rejet QA, sinon fallback (WORLDGEN §6 « jusqu'à N essais »).
      maxAttempts: 3,
      // Seuils ⚙️ des règles safe_content / style_coherence — filets à calibrer au playtest.
      unsafeMaxScore: 0.5,
      styleMinScore: 0.6,
    },
  },
  reporting: {
    // Semaine glissante (PLAN §Espace parent « tendance dans le temps »).
    trendWindowDays: 7,
    // Zones mortes de tendance : 5 points de justesse / 300 ms de rapidité (bruit ignoré).
    trendAccuracyDelta: 0.05,
    trendSpeedDeltaMs: 300,
    // Carte de maîtrise (classée sur box≥4) : maîtrisé ≥ 85 % (écho EXACT tier ENGINE §8, box≥4) ·
    // en cours ≥ 40 % (valeur EMPRUNTÉE à §7 mais §7 mesure box≥3 → emprunt numérique, pas écho).
    masteredMinRatio: 0.85,
    inProgressMinRatio: 0.4,
    // Top 5 calculs « à revoir » (PLAN §Espace parent).
    reviewListSize: 5,
  },
  regularity: {
    // Jour calendaire dans le fuseau de la famille (français) — jamais UTC brut (ADR 0014).
    dayTimeZone: "Europe/Paris",
    // Plafond d'amplitude du temps/jour : 4 h (borne l'approximation par amplitude).
    maxDayAmplitudeMinutes: 240,
    // Série rompue dès un écart de 2 jours calendaires (jours consécutifs stricts).
    streakBreakGapDays: 2,
    // Fenêtre saine de temps de jeu quotidien : 15-20 min (PLAN §Espace parent, DETAILS §27).
    respectWindowMinMinutes: 15,
    respectWindowMaxMinutes: 20,
  },
  parentControls: {
    // Temps d'écran (DETAILS §27) — défauts + bornes ⚙️. STOCKÉS/validés en 7.3, ENFORCÉS en 7.8 #229.
    // Nudge doux : défaut 20 min (fourchette 15-20), plage admissible 5..60.
    screenTimeNudgeDefaultMinutes: 20,
    screenTimeNudgeMinMinutes: 5,
    screenTimeNudgeMaxMinutes: 60,
    // Verrou dur optionnel : défaut 45 min/jour, plage admissible 10..240.
    screenTimeHardLockDefaultMinutes: 45,
    screenTimeHardLockMinMinutes: 10,
    screenTimeHardLockMaxMinutes: 240,
  },
  sound: {
    // Réglages son (DETAILS §22) — défauts ⚙️ d'un foyer neuf. STOCKÉS/validés en 8.3, ENFORCÉS
    // (moteur audio réel) en 8.4. Audio v1 = bruitages + musique activés par défaut (opt-out).
    soundEnabledDefault: true,
    musicEnabledDefault: true,
    // Volume par défaut 70 % (repère raisonnable ni silencieux ni saturé, à calibrer au playtest).
    volumeDefault: 70,
  },
} as const;

/** Variables d'environnement requises en production (fail-fast si absentes). */
export const REQUIRED_IN_PRODUCTION = ["GEMINI_API_KEY"] as const;

/** Erreur de configuration au démarrage (message explicite). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function resolveMode(nodeEnv: string | undefined): AppMode {
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "test";
  return "development";
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Parse un **booléen** de configuration (drapeau ⚙️). Accepte `"true"`/`"false"`
 * (insensible à la casse et aux espaces) ; toute autre valeur → défaut. Retenu
 * pour les bascules d'infrastructure (ex. GC des sessions au login, #44).
 */
function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

/**
 * Parse un entier **≥ 0** (accepte 0, contrairement à `parsePositiveInt`).
 * Utilisé pour les paramètres du moteur où 0 est légitime (ex. `promoteBoxes`,
 * délai de la boîte 0).
 */
function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * Parse un **ratio** dans `]0, 1]` (seuils de maîtrise / étoiles, ENGINE §5/§7/§8).
 * Hors intervalle ou non numérique → défaut. Borne haute inclusive (1 = 100 %).
 */
function parseRatio(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

/**
 * Parse une **liste d'entiers ≥ 0** séparés par virgule (ex. délais des boîtes
 * `"0,1,2,4,9,21"`). Tout élément invalide (non entier / négatif), une longueur
 * différente du défaut, ou une liste vide → défaut (contrat = 6 boîtes, ENGINE §2).
 */
function parseIntList(raw: string | undefined, fallback: readonly number[]): number[] {
  if (raw === undefined) return [...fallback];
  const parts = raw.split(",");
  if (parts.length !== fallback.length) return [...fallback];
  const parsed = parts.map((p) => Number.parseInt(p.trim(), 10));
  return parsed.every((n) => Number.isInteger(n) && n >= 0) ? parsed : [...fallback];
}

/**
 * Parse un **triplet de ratios croissants** `]0,1]` (seuils d'étoiles 1★/2★/3★,
 * ENGINE §5). Exactement 3 valeurs, chacune un ratio valide, strictement
 * croissantes (`s1 < s2 < s3`) — sinon défaut. Le tri croissant est un invariant
 * du contrat (une 3ᵉ étoile est plus dure qu'une 1ʳᵉ).
 */
function parseStarThresholds(
  raw: string | undefined,
  fallback: readonly [number, number, number],
): [number, number, number] {
  if (raw === undefined) return [...fallback];
  const parts = raw.split(",");
  if (parts.length !== 3) return [...fallback];
  const [s1, s2, s3] = parts.map((p) => Number.parseFloat(p.trim()));
  const valid = [s1, s2, s3].every((n) => Number.isFinite(n) && n > 0 && n <= 1);
  return valid && s1 < s2 && s2 < s3 ? [s1, s2, s3] : [...fallback];
}

/**
 * Bloc auth de la config, isolé en fonction pure. Source unique des ⚙️ auth
 * (durées de session, coût argon2id, seuils de rate-limit). Les secrets ne sont
 * pas requis ici : les tokens de session sont **opaques** (aléa CSPRNG stocké
 * serveur), pas de secret de signature à valider — cf. AUTH.md §3.
 */
export function loadAuthConfig(env: Env): AuthConfig {
  const d = CONFIG_DEFAULTS.auth;
  return {
    childSessionMs: parsePositiveInt(env.AUTH_CHILD_SESSION_MS, d.childSessionMs),
    parentSessionMs: parsePositiveInt(env.AUTH_PARENT_SESSION_MS, d.parentSessionMs),
    argon2: {
      memoryCost: parsePositiveInt(env.AUTH_ARGON2_MEMORY_KIB, d.argon2.memoryCost),
      timeCost: parsePositiveInt(env.AUTH_ARGON2_TIME_COST, d.argon2.timeCost),
      parallelism: parsePositiveInt(env.AUTH_ARGON2_PARALLELISM, d.argon2.parallelism),
    },
    rateLimit: {
      maxAttemptsPerProfile: parsePositiveInt(
        env.AUTH_MAX_PIN_ATTEMPTS,
        d.rateLimit.maxAttemptsPerProfile,
      ),
      maxAttemptsPerIp: parsePositiveInt(
        env.AUTH_IP_MAX_PIN_ATTEMPTS,
        d.rateLimit.maxAttemptsPerIp,
      ),
      backoffBaseMs: parsePositiveInt(env.AUTH_BACKOFF_BASE_MS, d.rateLimit.backoffBaseMs),
      backoffFactor: parsePositiveNumber(env.AUTH_BACKOFF_FACTOR, d.rateLimit.backoffFactor),
      backoffMaxMs: parsePositiveInt(env.AUTH_BACKOFF_MAX_MS, d.rateLimit.backoffMaxMs),
    },
    gcSessionsOnLogin: parseBoolean(env.AUTH_GC_SESSIONS_ON_LOGIN, d.gcSessionsOnLogin),
  };
}

/**
 * Bloc DB de la config, isolé en fonction pure. Source unique des ⚙️ DB
 * (`DATABASE_PATH`, `SQLITE_BUSY_TIMEOUT_MS`, `journalMode`) — cf. ADR 0002.
 *
 * Volontairement SANS la validation des secrets (`GEMINI_API_KEY`) : la couche
 * SQLite, le script de migration et drizzle-kit tournent HORS runtime Next et
 * ne doivent pas exiger la clé image pour lire le chemin / le busy_timeout.
 */
export function loadDatabaseConfig(env: Env): DatabaseConfig {
  return {
    path: env.DATABASE_PATH?.trim() || CONFIG_DEFAULTS.database.path,
    busyTimeoutMs: parsePositiveInt(
      env.SQLITE_BUSY_TIMEOUT_MS,
      CONFIG_DEFAULTS.database.busyTimeoutMs,
    ),
    journalMode: CONFIG_DEFAULTS.database.journalMode,
  };
}

/**
 * Bloc **moteur pédagogique** de la config, isolé en fonction pure (ENGINE §11).
 * Source unique des ⚙️ du moteur, tous surchargeables par l'environnement (mêmes
 * conventions que `loadAuthConfig`). Défauts = valeurs de départ d'ENGINE §11.
 *
 * **Posé** ici (contrat épic #3) ; **consommé** par 3.3–3.7 — pas dans cette story.
 * Comme `loadDatabaseConfig`, sans validation de secrets : réglages purs, pas de clé.
 */
export function loadEngineConfig(env: Env): EngineConfig {
  const d = CONFIG_DEFAULTS.engine;
  // Seuils de fluence par compétence : surcharge par `ENGINE_FLUENCE_MS_<SKILL>`
  // (ex. `ENGINE_FLUENCE_MS_MULT`). Itère sur SKILLS (source unique, ENGINE §1)
  // pour n'oublier aucune compétence.
  const fluenceThresholdsMs = {} as Record<Skill, number>;
  for (const skill of SKILLS) {
    fluenceThresholdsMs[skill] = parsePositiveInt(
      env[`ENGINE_FLUENCE_MS_${skill.toUpperCase()}`],
      d.fluenceThresholdsMs[skill],
    );
  }
  return {
    leitnerDelaysDays: parseIntList(env.ENGINE_LEITNER_DELAYS_DAYS, d.leitnerDelaysDays),
    fluenceThresholdsMs,
    promoteBoxes: parseNonNegativeInt(env.ENGINE_PROMOTE_BOXES, d.promoteBoxes),
    demoteBoxes: parseNonNegativeInt(env.ENGINE_DEMOTE_BOXES, d.demoteBoxes),
    maxBox: parseNonNegativeInt(env.ENGINE_MAX_BOX, d.maxBox),
    newMaxPerLevel: parseNonNegativeInt(env.ENGINE_NEW_MAX_PER_LEVEL, d.newMaxPerLevel),
    newMaxPerDay: parseNonNegativeInt(env.ENGINE_NEW_MAX_PER_DAY, d.newMaxPerDay),
    consolidationThreshold: parsePositiveInt(
      env.ENGINE_CONSOLIDATION_THRESHOLD,
      d.consolidationThreshold,
    ),
    consolidationMaxBox: parseNonNegativeInt(
      env.ENGINE_CONSOLIDATION_MAX_BOX,
      d.consolidationMaxBox,
    ),
    interleaveThresholdRatio: parseRatio(
      env.ENGINE_INTERLEAVE_THRESHOLD_RATIO,
      d.interleaveThresholdRatio,
    ),
    interleaveMinBox: parseNonNegativeInt(env.ENGINE_INTERLEAVE_MIN_BOX, d.interleaveMinBox),
    tierUnlockRatio: parseRatio(env.ENGINE_TIER_UNLOCK_RATIO, d.tierUnlockRatio),
    tierUnlockMinBox: parseNonNegativeInt(env.ENGINE_TIER_UNLOCK_MIN_BOX, d.tierUnlockMinBox),
    starThresholds: parseStarThresholds(env.ENGINE_STAR_THRESHOLDS, d.starThresholds),
    antiMashMs: parsePositiveInt(env.ENGINE_ANTI_MASH_MS, d.antiMashMs),
    diagnosticSize: parsePositiveInt(env.ENGINE_DIAGNOSTIC_SIZE, d.diagnosticSize),
    // `parseNonNegativeInt` : un seuil `0` est légitime (chaque nœud normal serait
    // révision — extrême de calibration), et évite une insertion révision permanente
    // par accident si l'env fournit une valeur négative (retombe sur le défaut).
    revisionDebtThreshold: parseNonNegativeInt(
      env.ENGINE_REVISION_DEBT_THRESHOLD,
      d.revisionDebtThreshold,
    ),
  };
}

/**
 * Bloc **carte** de la config (MAP §3/§5/§6), isolé en fonction pure. Source unique des
 * ⚙️ de **structure** de carte (nb de niveaux/monde, cadence des trésors, longueur du
 * boss). `parsePositiveInt` : ces trois valeurs doivent être `≥ 1` (un monde a au moins
 * un niveau ; une cadence de trésor `0`/négative n'a pas de sens — division/modulo ;
 * un boss a au moins une question) → une valeur invalide retombe sur le défaut.
 */
export function loadMapConfig(env: Env): MapConfig {
  const d = CONFIG_DEFAULTS.map;
  return {
    levelsPerWorld: parsePositiveInt(env.MAP_LEVELS_PER_WORLD, d.levelsPerWorld),
    treasureEvery: parsePositiveInt(env.MAP_TREASURE_EVERY, d.treasureEvery),
    bossQuestionCount: parsePositiveInt(env.MAP_BOSS_QUESTION_COUNT, d.bossQuestionCount),
  };
}

/**
 * Bloc **économie** de la config (ECONOMY §4.1/§5), isolé en fonction pure. Source unique
 * du **barème** de gains ⚙️ (base niveau, bonus par étoile, bonus trésor) — jamais de
 * montant en dur dans le crédit (`game/wallet.ts` écrit ce qu'on lui donne, la logique de
 * barème vit ici + `game/reward.ts`). Barème **versionné** (fichier de config, pas en DB —
 * ECONOMY §3) pour un calibrage playtest sans migration.
 *
 * `parseNonNegativeInt` : un barème `0` est légitime (désactive une source de gain — ex.
 * `treasureBonusCoins = 0` fait retomber le trésor sur le gain de niveau standard), et une
 * valeur négative (aberrante pour un gain) retombe sur le défaut. Comme `loadMapConfig`,
 * sans validation de secrets : réglages purs, pas de clé.
 */
export function loadEconomyConfig(env: Env): EconomyConfig {
  const d = CONFIG_DEFAULTS.economy;
  return {
    levelBaseCoins: parseNonNegativeInt(env.ECONOMY_LEVEL_BASE_COINS, d.levelBaseCoins),
    starBonusCoins: parseNonNegativeInt(env.ECONOMY_STAR_BONUS_COINS, d.starBonusCoins),
    treasureBonusCoins: parseNonNegativeInt(env.ECONOMY_TREASURE_BONUS_COINS, d.treasureBonusCoins),
    bossBonusCoins: parseNonNegativeInt(env.ECONOMY_BOSS_BONUS_COINS, d.bossBonusCoins),
  };
}

/**
 * Bloc **reporting espace parent** de la config (PLAN §Espace parent :79-84, ADR 0012), isolé en
 * fonction pure (mêmes conventions que `loadEngineConfig`). Source unique des ⚙️ de **sémantique
 * de reporting** — fenêtre de tendance, zones mortes, seuils de la carte de maîtrise, taille de la
 * liste « à revoir » — **consommés** par `lib/parent/stats.ts`. Aucun secret : réglages purs.
 *
 * Choix des parseurs par borne légitime :
 * - `parsePositiveInt` (≥ 1) pour `trendWindowDays` / `reviewListSize` : une fenêtre ou une liste
 *   de taille `0`/négative n'a pas de sens.
 * - `parseUnitInterval` (`[0,1]`) pour `trendAccuracyDelta` : `0` est une zone morte nulle légitime.
 * - `parseNonNegativeInt` (≥ 0) pour `trendSpeedDeltaMs` : `0` = zone morte nulle légitime.
 * - `parseRatio` (`]0,1]`) pour les seuils de la carte de maîtrise : un ratio `0` ne classerait
 *   jamais « faible » (dégénéré) → exclu.
 */
export function loadReportingConfig(env: Env): ReportingConfig {
  const d = CONFIG_DEFAULTS.reporting;
  return {
    trendWindowDays: parsePositiveInt(env.REPORTING_TREND_WINDOW_DAYS, d.trendWindowDays),
    trendAccuracyDelta: parseUnitInterval(env.REPORTING_TREND_ACCURACY_DELTA, d.trendAccuracyDelta),
    trendSpeedDeltaMs: parseNonNegativeInt(env.REPORTING_TREND_SPEED_DELTA_MS, d.trendSpeedDeltaMs),
    masteredMinRatio: parseRatio(env.REPORTING_MASTERED_MIN_RATIO, d.masteredMinRatio),
    inProgressMinRatio: parseRatio(env.REPORTING_IN_PROGRESS_MIN_RATIO, d.inProgressMinRatio),
    reviewListSize: parsePositiveInt(env.REPORTING_REVIEW_LIST_SIZE, d.reviewListSize),
  };
}

/**
 * Parse un **fuseau horaire IANA** (⚙️ régularité). Une valeur reconnue par `Intl` (ex.
 * `"Europe/Paris"`, `"UTC"`) est retenue ; toute valeur non reconnue (typo, fuseau inexistant) fait
 * lever `Intl.DateTimeFormat` (`RangeError`) → **retombe sur le défaut** (jamais de fuseau invalide
 * propagé au calcul de jour, qui le consomme réellement — `lib/parent/regularity.ts`).
 */
function parseTimeZone(raw: string | undefined, fallback: string): string {
  const v = raw?.trim();
  if (!v) return fallback;
  try {
    // Construit un formateur avec ce fuseau : lève RangeError si le fuseau est inconnu.
    new Intl.DateTimeFormat("en-CA", { timeZone: v });
    return v;
  } catch {
    return fallback;
  }
}

/**
 * Bloc **régularité espace parent** de la config (PLAN §Espace parent :83, ADR 0014), isolé en
 * fonction pure (mêmes conventions que `loadReportingConfig`). Source unique des ⚙️ de **sémantique
 * de régularité** — fuseau du jour calendaire, plafond d'amplitude du temps/jour, écart de rupture
 * de série, fenêtre saine de temps de jeu — **consommés** par `lib/parent/regularity.ts`. Aucun
 * secret : réglages purs.
 *
 * `parsePositiveInt` (≥ 1) pour les quatre valeurs numériques : un plafond d'amplitude, un écart de
 * rupture ou une borne de fenêtre `0`/négatif n'a pas de sens (retombe sur le défaut). `parseTimeZone`
 * valide le fuseau via `Intl` (un fuseau inconnu retombe sur `"Europe/Paris"`).
 */
export function loadRegularityConfig(env: Env): RegularityConfig {
  const d = CONFIG_DEFAULTS.regularity;
  return {
    dayTimeZone: parseTimeZone(env.REGULARITY_DAY_TIME_ZONE, d.dayTimeZone),
    maxDayAmplitudeMinutes: parsePositiveInt(
      env.REGULARITY_MAX_DAY_AMPLITUDE_MIN,
      d.maxDayAmplitudeMinutes,
    ),
    streakBreakGapDays: parsePositiveInt(
      env.REGULARITY_STREAK_BREAK_GAP_DAYS,
      d.streakBreakGapDays,
    ),
    respectWindowMinMinutes: parsePositiveInt(
      env.REGULARITY_RESPECT_WINDOW_MIN_MIN,
      d.respectWindowMinMinutes,
    ),
    respectWindowMaxMinutes: parsePositiveInt(
      env.REGULARITY_RESPECT_WINDOW_MAX_MIN,
      d.respectWindowMaxMinutes,
    ),
  };
}

/**
 * Bloc **contrôles parentaux** de la config (DETAILS §27, story 7.3), isolé en fonction pure (mêmes
 * conventions que `loadEngineConfig`). Source unique des ⚙️ **défauts + bornes** de temps d'écran —
 * **consommés** par `lib/parent/settings.ts` (défauts d'un foyer neuf + validation de borne). Aucun
 * secret : réglages purs. `parsePositiveInt` (≥ 1) : une durée `0`/négative est invalide → défaut.
 */
export function loadParentControlsConfig(env: Env): ParentControlsConfig {
  const d = CONFIG_DEFAULTS.parentControls;
  return {
    screenTimeNudgeDefaultMinutes: parsePositiveInt(
      env.PARENT_SCREEN_TIME_NUDGE_DEFAULT_MIN,
      d.screenTimeNudgeDefaultMinutes,
    ),
    screenTimeNudgeMinMinutes: parsePositiveInt(
      env.PARENT_SCREEN_TIME_NUDGE_MIN,
      d.screenTimeNudgeMinMinutes,
    ),
    screenTimeNudgeMaxMinutes: parsePositiveInt(
      env.PARENT_SCREEN_TIME_NUDGE_MAX,
      d.screenTimeNudgeMaxMinutes,
    ),
    screenTimeHardLockDefaultMinutes: parsePositiveInt(
      env.PARENT_SCREEN_TIME_HARD_LOCK_DEFAULT_MIN,
      d.screenTimeHardLockDefaultMinutes,
    ),
    screenTimeHardLockMinMinutes: parsePositiveInt(
      env.PARENT_SCREEN_TIME_HARD_LOCK_MIN,
      d.screenTimeHardLockMinMinutes,
    ),
    screenTimeHardLockMaxMinutes: parsePositiveInt(
      env.PARENT_SCREEN_TIME_HARD_LOCK_MAX,
      d.screenTimeHardLockMaxMinutes,
    ),
  };
}

/**
 * Bloc **réglages son** de la config (DETAILS §22, story 8.3), isolé en fonction pure (mêmes
 * conventions que `loadParentControlsConfig`). Source unique des ⚙️ **défauts** son/musique/volume —
 * **consommés** par `lib/parent/settings.ts` (défauts d'un foyer neuf). Aucun secret : réglages
 * purs. `parseIntInRange` borne `volumeDefault` à `[SOUND_VOLUME_MIN, SOUND_VOLUME_MAX]` (fixe).
 */
export function loadSoundConfig(env: Env): SoundConfig {
  const d = CONFIG_DEFAULTS.sound;
  return {
    soundEnabledDefault: parseBoolean(env.SOUND_ENABLED_DEFAULT, d.soundEnabledDefault),
    musicEnabledDefault: parseBoolean(env.MUSIC_ENABLED_DEFAULT, d.musicEnabledDefault),
    volumeDefault: parseIntInRange(
      env.SOUND_VOLUME_DEFAULT,
      SOUND_VOLUME_MIN,
      SOUND_VOLUME_MAX,
      d.volumeDefault,
    ),
  };
}

/**
 * Parse une **chaîne** de configuration : valeur d'env **non vide** (espaces compactés à ses
 * extrémités) sinon défaut. Retenu pour les prompts de base ⚙️ (override d'un gabarit ART §5
 * au playtest) — une valeur vide/espaces retombe sur la charte verrouillée (jamais de prompt
 * vide envoyé au modèle).
 */
function parseString(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Parse un score dans l'**intervalle unité** `[0, 1]` (bornes incluses — contrairement à
 * `parseRatio` qui exclut `0`). Retenu pour les **seuils de règles QA** (⚙️ WORLDGEN §6) où `0`
 * est une borne légitime (`unsafeMaxScore = 0` = tolérance nulle ; `styleMinScore = 0` = style non
 * gardé). Hors intervalle ou non numérique → défaut.
 */
function parseUnitInterval(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/**
 * Parse un **entier borné** dans `[min, max]` (bornes incluses). Retenu pour le volume par défaut
 * (DETAILS §22, `[0, 100]`) — bornes **fixes** (non-⚙️, contrairement à `parsePositiveInt` des
 * durées de temps d'écran dont les bornes elles-mêmes sont calibrables). Hors intervalle, non
 * entier ou non numérique → défaut.
 */
function parseIntInRange(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/**
 * Parse la **stratégie de fond** ⚙️ (Stage A). Accepte l'une des valeurs de
 * `BACKGROUND_STRATEGIES` (insensible aux espaces) ; toute autre valeur → défaut (jamais de
 * stratégie invalide propagée à l'outil, qui la consomme réellement).
 */
function parseBackgroundStrategy(
  raw: string | undefined,
  fallback: BackgroundStrategy,
): BackgroundStrategy {
  const v = raw?.trim();
  return BACKGROUND_STRATEGIES.find((s) => s === v) ?? fallback;
}

/**
 * Bloc **pipeline mondes IA** de la config (WORLDGEN §2/§3/§5, ADR 0008), isolé en fonction
 * pure (mêmes conventions que `loadEngineConfig`). Source unique des ⚙️ du pipeline : plafond
 * budgétaire (garde-fou coût WORLDGEN §2), buffer d'avance, retry réseau transitoire (ADR 0008
 * contrainte 1), et **prompts de base verrouillés** (charte ART §5, calibrables ⚙️ au playtest).
 *
 * `parsePositiveInt` pour budget/buffer (≥ 1 : un plafond `0` bloquerait toute génération, un
 * buffer `0` ne maintiendrait aucune avance — invalide → défaut). `parseNonNegativeInt` pour
 * `maxRetries` (0 = « aucun ré-essai » légitime, désactive le retry) + `retryBackoffMs` via
 * `parsePositiveInt` (un backoff `0`/négatif n'a pas de sens → défaut). Comme `loadMapConfig`,
 * sans validation de secrets : réglages purs, pas de clé (la clé Gemini reste dans `imageModel`).
 */
export function loadWorldGenConfig(env: Env): WorldGenConfig {
  const d = CONFIG_DEFAULTS.worldgen;
  const p = d.prompts;
  return {
    monthlyBudgetEur: parsePositiveInt(env.WORLDGEN_MONTHLY_BUDGET_EUR, d.monthlyBudgetEur),
    bufferAhead: parsePositiveInt(env.WORLDGEN_BUFFER_AHEAD, d.bufferAhead),
    maxRetries: parseNonNegativeInt(env.WORLDGEN_MAX_RETRIES, d.maxRetries),
    retryBackoffMs: parsePositiveInt(env.WORLDGEN_RETRY_BACKOFF_MS, d.retryBackoffMs),
    prompts: {
      style: parseString(env.WORLDGEN_PROMPT_STYLE, p.style),
      negative: parseString(env.WORLDGEN_PROMPT_NEGATIVE, p.negative),
      teddy: parseString(env.WORLDGEN_PROMPT_TEDDY, p.teddy),
      creature: parseString(env.WORLDGEN_PROMPT_CREATURE, p.creature),
      background: parseString(env.WORLDGEN_PROMPT_BACKGROUND, p.background),
    },
    stageA: {
      photosDir: parseString(env.WORLDGEN_STAGE_A_PHOTOS_DIR, d.stageA.photosDir),
      outputDir: parseString(env.WORLDGEN_STAGE_A_OUTPUT_DIR, d.stageA.outputDir),
      backgroundStrategy: parseBackgroundStrategy(
        env.WORLDGEN_STAGE_A_BACKGROUND_STRATEGY,
        d.stageA.backgroundStrategy,
      ),
      matteColor: parseString(env.WORLDGEN_STAGE_A_MATTE_COLOR, d.stageA.matteColor),
    },
    qa: {
      // `parseBoolean` : `"true"`/`"false"` (insensible casse/espaces), sinon défaut.
      parentValidationEnabled: parseBoolean(
        env.WORLDGEN_QA_PARENT_VALIDATION,
        d.qa.parentValidationEnabled,
      ),
      // `parseNonNegativeInt` : `0` légitime (aucune régénération QA → 1er rejet = fallback).
      maxAttempts: parseNonNegativeInt(env.WORLDGEN_QA_MAX_ATTEMPTS, d.qa.maxAttempts),
      // `parseUnitInterval` : seuils de règles dans `[0,1]` (0 = borne stricte légitime).
      unsafeMaxScore: parseUnitInterval(env.WORLDGEN_QA_UNSAFE_MAX_SCORE, d.qa.unsafeMaxScore),
      styleMinScore: parseUnitInterval(env.WORLDGEN_QA_STYLE_MIN_SCORE, d.qa.styleMinScore),
    },
  };
}

/**
 * Construit la config typée depuis un environnement. Fonction pure (testable).
 * En mode `production`, lève `ConfigError` si une variable requise manque (fail-fast).
 */
export function loadConfig(env: Env): AppConfig {
  const mode = resolveMode(env.NODE_ENV);

  if (mode === "production") {
    const missing = REQUIRED_IN_PRODUCTION.filter((key) => {
      const value = env[key];
      return value === undefined || value.trim() === "";
    });
    if (missing.length > 0) {
      throw new ConfigError(
        `Configuration invalide au démarrage : variable(s) d'environnement requise(s) ` +
          `manquante(s) — ${missing.join(", ")}. Copie .env.example vers .env ` +
          `(ou configure Forge env) et renseigne ces clés.`,
      );
    }
  }

  return {
    mode,
    database: loadDatabaseConfig(env),
    imageModel: {
      apiKey: env.GEMINI_API_KEY ?? "",
      model: env.IMAGE_MODEL?.trim() || CONFIG_DEFAULTS.imageModel.model,
    },
    auth: loadAuthConfig(env),
    engine: loadEngineConfig(env),
    map: loadMapConfig(env),
    economy: loadEconomyConfig(env),
    worldgen: loadWorldGenConfig(env),
    reporting: loadReportingConfig(env),
    regularity: loadRegularityConfig(env),
    parentControls: loadParentControlsConfig(env),
    sound: loadSoundConfig(env),
  };
}

let cached: AppConfig | null = null;

/** Config applicative (mémoïsée) lue depuis `process.env`. */
export function getConfig(): AppConfig {
  cached ??= loadConfig(process.env);
  return cached;
}

/**
 * Bloc auth de la config applicative (mémoïsé). Consommé par la couche auth
 * (hash, sessions, rate-limit) qui tourne DANS le runtime Next.
 */
export function getAuthConfig(): AuthConfig {
  return getConfig().auth;
}

/**
 * Bloc moteur de la config applicative (mémoïsé). Consommé par les stories du
 * moteur (maîtrise, sélection, composition de niveau, interleaving, étoiles) qui
 * tournent DANS le runtime Next.
 */
export function getEngineConfig(): EngineConfig {
  return getConfig().engine;
}

/**
 * Bloc **carte** de la config applicative (mémoïsé). Consommé par la carte procédurale
 * (5.2) qui compose la structure d'un monde (géométrie + types de nœuds).
 */
export function getMapConfig(): MapConfig {
  return getConfig().map;
}

/**
 * Bloc **économie** de la config applicative (mémoïsé). Consommé par la couche gains de
 * fin de niveau (5.5, `game/reward.ts` + `game/finish-level.ts`) qui tourne DANS le
 * runtime Next. Source unique du barème ⚙️ (base/étoile/trésor).
 */
export function getEconomyConfig(): EconomyConfig {
  return getConfig().economy;
}

/**
 * Bloc **pipeline mondes IA** de la config applicative (mémoïsé). Consommé par le client
 * image (`lib/worldgen/image-client.ts`, retry) et le worker/buffer (stories 6.x) qui
 * tournent DANS le runtime Node. Source unique des ⚙️ du pipeline (budget/buffer/retry/prompts).
 */
export function getWorldGenConfig(): WorldGenConfig {
  return getConfig().worldgen;
}

/**
 * Bloc **reporting espace parent** de la config applicative (mémoïsé). Consommé par les agrégats
 * read-only de l'espace parent (`lib/parent/stats.ts`, story 7.2) — justesse, rapidité, carte de
 * maîtrise, à revoir. Source unique des ⚙️ de sémantique de reporting (ADR 0012).
 */
export function getReportingConfig(): ReportingConfig {
  return getConfig().reporting;
}

/**
 * Bloc **régularité espace parent** de la config applicative (mémoïsé). Consommé par les agrégats
 * read-only de régularité (`lib/parent/regularity.ts`, story 7.4) — jours joués, temps de jeu/jour,
 * série de jours, respect des 15-20 min. Source unique des ⚙️ de sémantique de régularité (ADR 0014).
 */
export function getRegularityConfig(): RegularityConfig {
  return getConfig().regularity;
}

/**
 * Bloc **contrôles parentaux** de la config applicative (mémoïsé). Consommé par les réglages du
 * foyer (`lib/parent/settings.ts`, story 7.3) — défauts d'un foyer neuf + bornes de validation du
 * temps d'écran. Source unique des ⚙️ de temps d'écran (STOCKÉS/validés en 7.3, ENFORCÉS en 7.8 #229).
 */
export function getParentControlsConfig(): ParentControlsConfig {
  return getConfig().parentControls;
}

/**
 * Bloc **réglages son** de la config applicative (mémoïsé). Consommé par les réglages du foyer
 * (`lib/parent/settings.ts`, story 8.3) — défauts d'un foyer neuf (son/musique/volume). Source
 * unique des ⚙️ son (STOCKÉS/validés en 8.3, ENFORCÉS par le moteur audio en 8.4).
 */
export function getSoundConfig(): SoundConfig {
  return getConfig().sound;
}

/** Réinitialise le cache de config (tests / hot-reload). */
export function resetConfigCache(): void {
  cached = null;
}
