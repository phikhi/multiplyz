import "server-only";
import type { QaConfig } from "@/config/server-config";
import type { WorldStatus } from "@/lib/db/schema";
import type { GeneratedWorld } from "./generate-world";

/**
 * **Auto-filtre kid-safe + résolution de modération** (WORLDGEN §6, ART §6, story 6.5, épic #6).
 *
 * Module **pur** (aucune I/O, aucune DB) : le **moteur de règles** kid-safe + la résolution du
 * statut de modération (toggle validation parent). Consommé par le worker (`processNextJob`) après
 * la génération d'un monde (6.3) : chaque asset généré est passé aux règles WORLDGEN §6 ; un asset
 * qui échoue une règle **rejette** le monde → régénération (jusqu'à `qa.maxAttempts`), sinon le
 * monde reste sur le **fallback** (jamais `active`).
 *
 * **Séparation des responsabilités** (comme le client image `deps.generate` : logique réelle, backend
 * réel injecté) :
 * - Le **moteur de règles** (`assessAsset`/`assessWorldAssets`) et ses **⚙️ seuils** (`QaConfig`)
 *   sont **réels et consommés** par le worker — mutation-prouvés (retirer/muter une règle ou un
 *   seuil ⇒ test rouge).
 * - L'**inspecteur vision** (`WorldInspector`) qui **produit les signaux** (texte OCR, score
 *   effrayant, score de style) est **injecté**. L'inspecteur par défaut (`defaultInspector`) échoue
 *   **CLOSED** : il lève `QaInspectionError` tant qu'aucun classifieur vision réel n'est branché →
 *   le monde reste sur le fallback, **jamais** actif (posture sûre pour un filtre de sécurité enfant,
 *   seam bruyant & actionnable — jamais de faux « safe » silencieux). En test, on injecte un
 *   inspecteur qui produit des signaux d'échec pour exercer chaque règle.
 *
 * **Données enfant** : la QA opère sur des assets **partagés du foyer** (`worlds`/`characters` n'ont
 * pas de `profile_id`) — aucune donnée perso enfant n'entre ici, ni dans les verdicts/refs d'assets.
 */

/** Nature d'un asset généré soumis à la QA (contexte pour un futur classifieur ciblé). */
export type AssetKind = "background" | "tiles" | "teddy" | "creature";

/** Un asset généré à inspecter : sa réf d'URL (servie par Nginx) + sa nature. */
export interface InspectableAsset {
  /** Réf d'URL de l'asset (`world/<index>/...`). Pas de donnée enfant. */
  readonly ref: string;
  /** Nature de l'asset (fond, tuiles, Teddy, créature). */
  readonly kind: AssetKind;
}

/**
 * **Signaux d'inspection** d'un asset (produits par le classifieur vision/OCR injecté). Chaque
 * signal alimente **une** règle kid-safe (WORLDGEN §6) :
 * - `detectedText` → règle `no_parasitic_text` (texte parasite, glitch étiquette ADR 0008).
 * - `unsafeScore` → règle `safe_content` (effrayant/inapproprié).
 * - `styleScore` → règle `style_coherence` (cohérence vs charte ART).
 */
export interface AssetInspection {
  /** Texte détecté (OCR). **Non vide** = texte parasite → rejet (règle `no_parasitic_text`). */
  readonly detectedText: string;
  /** Score « effrayant/inapproprié » `[0,1]` (0 sûr → 1 inapproprié) — règle `safe_content`. */
  readonly unsafeScore: number;
  /** Score de cohérence de style vs charte `[0,1]` (1 conforme → 0 hors-charte) — règle `style_coherence`. */
  readonly styleScore: number;
}

/** Inspecteur vision : produit les signaux kid-safe d'un asset (injecté ; défaut = fail-closed). */
export type WorldInspector = (asset: InspectableAsset) => AssetInspection;

/** Identifiants des **règles kid-safe** (WORLDGEN §6) — un asset rejeté nomme la règle qu'il rate. */
export type QaRuleId = "no_parasitic_text" | "safe_content" | "style_coherence";

/**
 * Erreur d'inspection QA : levée par `defaultInspector` tant qu'aucun classifieur vision réel n'est
 * branché (seam non-implémenté, échec **loud & actionnable** — jamais de faux no-op silencieux). Le
 * worker la traite comme un **rejet QA** (fail-closed) → le monde reste sur le fallback.
 */
export class QaInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QaInspectionError";
  }
}

/**
 * Inspecteur **par défaut** (prod) : **fail-closed**. Aucun classifieur vision réel n'est encore
 * branché (le pipeline image est mocké — même statut que le `fetch` Gemini, ADR 0008) → lever une
 * erreur actionnable plutôt que renvoyer un faux « asset propre » (qui certifierait un monde kid-safe
 * sans l'avoir vérifié — anti-pattern « faux no-op silencieux », rétro #157). Le worker traite cette
 * erreur comme un rejet QA → le monde reste sur le fallback, **jamais** actif.
 */
export const defaultInspector: WorldInspector = (asset) => {
  throw new QaInspectionError(
    `Inspecteur QA vision non branché (asset "${asset.ref}"). Injecte un classifieur vision/OCR ` +
      `réel (texte détecté + score effrayant + score de style), ou fournis un inspecteur en test. ` +
      `La QA échoue CLOSED tant qu'aucun inspecteur n'est branché : le monde reste sur le fallback, ` +
      `jamais actif (WORLDGEN §6).`,
  );
};

/** Une règle kid-safe : son id + son prédicat (asset conforme ? `true` = passe). */
interface QaRule {
  readonly id: QaRuleId;
  readonly passes: (inspection: AssetInspection, config: QaConfig) => boolean;
}

/** Règle `no_parasitic_text` : aucun texte détecté dans l'image (ADR 0008 : glitch étiquette). */
function passesNoParasiticText(inspection: AssetInspection): boolean {
  return inspection.detectedText.trim().length === 0;
}

/** Règle `safe_content` : score « effrayant/inapproprié » **≤** seuil ⚙️ toléré (WORLDGEN §6). */
function passesSafeContent(inspection: AssetInspection, config: QaConfig): boolean {
  return inspection.unsafeScore <= config.unsafeMaxScore;
}

/** Règle `style_coherence` : score de cohérence de style **≥** seuil ⚙️ exigé (ART §6). */
function passesStyleCoherence(inspection: AssetInspection, config: QaConfig): boolean {
  return inspection.styleScore >= config.styleMinScore;
}

/**
 * **Registre des règles kid-safe** (WORLDGEN §6), évaluées dans l'ordre. Source unique : `assessAsset`
 * itère dessus. Retirer une règle d'ici (ou muter son prédicat/son seuil) fait rougir le test à effet
 * observable dédié à cette règle (chaque règle = ≥1 test qui échoue si elle est retirée).
 */
const QA_RULES: readonly QaRule[] = [
  { id: "no_parasitic_text", passes: (inspection) => passesNoParasiticText(inspection) },
  { id: "safe_content", passes: passesSafeContent },
  { id: "style_coherence", passes: passesStyleCoherence },
];

/** Verdict QA d'**un** asset : conforme, ou la 1ʳᵉ règle échouée. */
export type AssetQaVerdict =
  { readonly ok: true } | { readonly ok: false; readonly failedRule: QaRuleId };

/**
 * Évalue les règles kid-safe sur **un** asset (WORLDGEN §6). Retourne la **1ʳᵉ** règle échouée
 * (rejet) ou `{ ok: true }`. Pur (règles + seuils ⚙️, aucun signal produit ici — l'inspection est
 * fournie par l'appelant).
 */
export function assessAsset(inspection: AssetInspection, config: QaConfig): AssetQaVerdict {
  for (const rule of QA_RULES) {
    if (!rule.passes(inspection, config)) {
      return { ok: false, failedRule: rule.id };
    }
  }
  return { ok: true };
}

/**
 * Énumère **tous** les assets générés d'un monde à soumettre à la QA (fond + tuiles + variante Teddy
 * + chaque créature, WORLDGEN §4). Pur. Garantit qu'aucun asset généré n'échappe au filtre kid-safe.
 */
export function collectInspectableAssets(world: GeneratedWorld): InspectableAsset[] {
  return [
    { ref: world.assetRefs.background, kind: "background" },
    { ref: world.assetRefs.tiles, kind: "tiles" },
    { ref: world.assetRefs.teddy, kind: "teddy" },
    ...world.creatures.map((c): InspectableAsset => ({ ref: c.artRef, kind: "creature" })),
  ];
}

/** Verdict QA d'un **monde** : conforme, ou le 1er asset rejeté + la règle échouée. */
export type WorldQaVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly failedRule: QaRuleId; readonly failedAssetRef: string };

/**
 * Passe **tous** les assets d'un monde à l'auto-filtre kid-safe (WORLDGEN §6) via l'`inspect`eur
 * injecté, et retourne le **1er** asset qui échoue une règle (rejet du monde) ou `{ ok: true }`. Le
 * monde n'est conforme que si **tous** ses assets passent **toutes** les règles.
 *
 * L'inspecteur peut **lever** (`defaultInspector` fail-closed) : cette exception se propage à
 * l'appelant (le worker la traite comme un rejet QA — jamais de monde non-vérifié en `active`).
 */
export function assessWorldAssets(
  world: GeneratedWorld,
  inspect: WorldInspector,
  config: QaConfig,
): WorldQaVerdict {
  for (const asset of collectInspectableAssets(world)) {
    const verdict = assessAsset(inspect(asset), config);
    if (!verdict.ok) {
      return { ok: false, failedRule: verdict.failedRule, failedAssetRef: asset.ref };
    }
  }
  return { ok: true };
}

/**
 * **Statut cible d'un monde QA-validé** selon la **validation parent** (WORLDGEN §6). C'est la
 * consommation à effet observable du réglage par le worker :
 * - `parentValidationEnabled = true` → le monde reste `buffered` (attend l'approbation parent
 *   `approvedBy` — cf. `approveWorld`) ;
 * - `parentValidationEnabled = false` → le monde passe `active` **auto** après QA.
 *
 * Prend un **booléen** (pas la `QaConfig`) : depuis la story 7.3, la **source de vérité** est le
 * réglage parent persisté (`household_settings.parent_world_validation`, lu par le worker via
 * `readHouseholdSettings`), et non plus l'env `qa.parentValidationEnabled` seul (qui reste le
 * **défaut d'amorçage** d'un foyer neuf, cf. `resolveSettingsDefaults`). Muter/inverser l'argument
 * change le statut observable en base (test aux deux états).
 */
export function moderatedStatusAfterQaPass(parentValidationEnabled: boolean): WorldStatus {
  return parentValidationEnabled ? "buffered" : "active";
}
