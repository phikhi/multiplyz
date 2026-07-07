import { describe, expect, it } from "vitest";
import type { QaConfig } from "@/config/server-config";
import type { GeneratedWorld } from "./generate-world";
import {
  assessAsset,
  assessWorldAssets,
  collectInspectableAssets,
  defaultInspector,
  moderatedStatusAfterQaPass,
  QaInspectionError,
  type AssetInspection,
  type InspectableAsset,
  type WorldInspector,
} from "./qa";

/**
 * Tests du **moteur de règles kid-safe + résolution de modération** (WORLDGEN §6, ART §6, story 6.5).
 * Module **pur** → aucun DB, aucun réseau. Chaque **règle** est prouvée à **effet observable +
 * mutation-prouvée** : un asset qui échoue UNE règle est rejeté en la NOMMANT ; retirer/muter cette
 * règle (ou son seuil ⚙️) fait rougir son test dédié. L'inspecteur par défaut échoue **closed**.
 */

/** Config QA par défaut (⚙️ : auto, 3 essais, seuils 0.5 / 0.6), surchargeable. */
function qaCfg(overrides: Partial<QaConfig> = {}): QaConfig {
  return {
    parentValidationEnabled: false,
    maxAttempts: 3,
    unsafeMaxScore: 0.5,
    styleMinScore: 0.6,
    ...overrides,
  };
}

/** Une inspection **propre** : aucun texte, non effrayant, parfaitement dans la charte. */
const CLEAN: AssetInspection = { detectedText: "", unsafeScore: 0, styleScore: 1 };

/** Fabrique un `GeneratedWorld` minimal (assets + créatures) pour l'énumération/inspection. */
function makeWorld(creatureRefs: string[] = []): GeneratedWorld {
  return {
    worldId: "world:0",
    worldIndex: 0,
    themeSlug: "ocean",
    themeLabel: "Océan scintillant",
    palette: "{}",
    assetRefs: {
      background: "world/0/background.png",
      tiles: "world/0/tiles.png",
      teddy: "world/0/teddy.png",
    },
    creatures: creatureRefs.map((artRef, i) => ({
      id: `creature:0:${i}`,
      speciesKey: `creature_world_0_${i}`,
      nameDefault: "Bulle",
      rarity: "common" as const,
      inEggPool: true,
      artRef,
      story: "Une histoire douce.",
    })),
    seed: "ocean-0",
    status: "buffered",
    cost: { paidImageCalls: 5, estimatedEur: 0.18, monthlyBudgetEur: 20 },
  };
}

// ───────────────────────────── assessAsset — règles kid-safe (WORLDGEN §6) ─────────────────────────────

describe("assessAsset — règles kid-safe (chaque règle mutation-prouvée)", () => {
  it("un asset propre passe TOUTES les règles (contrôle négatif)", () => {
    expect(assessAsset(CLEAN, qaCfg())).toEqual({ ok: true });
  });

  it("MUTATION-PROUVÉ règle `no_parasitic_text` : texte détecté ⇒ rejet nommé (ADR 0008 glitch étiquette)", () => {
    // Seule règle échouée : du texte parasite. Retirer la règle `no_parasitic_text` ⇒ passerait ⇒ rouge.
    const withText: AssetInspection = {
      detectedText: "SOLDES -50%",
      unsafeScore: 0,
      styleScore: 1,
    };
    expect(assessAsset(withText, qaCfg())).toEqual({ ok: false, failedRule: "no_parasitic_text" });
  });

  it("`no_parasitic_text` : texte fait d'espaces seulement ⇒ passe (trim — jamais un faux rejet)", () => {
    // Mutation-prouve le `.trim()` : sans lui, "   ".length !== 0 rejetterait à tort ⇒ ce test rougirait.
    const spaces: AssetInspection = { detectedText: "   \n\t ", unsafeScore: 0, styleScore: 1 };
    expect(assessAsset(spaces, qaCfg())).toEqual({ ok: true });
  });

  it("MUTATION-PROUVÉ règle `safe_content` : score effrayant > seuil ⚙️ ⇒ rejet nommé", () => {
    const scary: AssetInspection = { detectedText: "", unsafeScore: 0.51, styleScore: 1 };
    expect(assessAsset(scary, qaCfg({ unsafeMaxScore: 0.5 }))).toEqual({
      ok: false,
      failedRule: "safe_content",
    });
  });

  it("`safe_content` : borne INCLUSIVE — score == seuil passe (muter `<=`→`<` rougit)", () => {
    const atCap: AssetInspection = { detectedText: "", unsafeScore: 0.5, styleScore: 1 };
    expect(assessAsset(atCap, qaCfg({ unsafeMaxScore: 0.5 }))).toEqual({ ok: true });
  });

  it("`safe_content` : seuil ⚙️ AGIT — le MÊME asset passe/échoue selon `unsafeMaxScore`", () => {
    // Preuve que le seuil est réellement consommé : score 0.4 accepté à 0.5, rejeté à 0.3.
    const mild: AssetInspection = { detectedText: "", unsafeScore: 0.4, styleScore: 1 };
    expect(assessAsset(mild, qaCfg({ unsafeMaxScore: 0.5 }))).toEqual({ ok: true });
    expect(assessAsset(mild, qaCfg({ unsafeMaxScore: 0.3 }))).toEqual({
      ok: false,
      failedRule: "safe_content",
    });
  });

  it("MUTATION-PROUVÉ règle `style_coherence` : score de style < seuil ⚙️ ⇒ rejet nommé (hors-charte)", () => {
    const offStyle: AssetInspection = { detectedText: "", unsafeScore: 0, styleScore: 0.59 };
    expect(assessAsset(offStyle, qaCfg({ styleMinScore: 0.6 }))).toEqual({
      ok: false,
      failedRule: "style_coherence",
    });
  });

  it("`style_coherence` : borne INCLUSIVE — score == seuil passe (muter `>=`→`>` rougit)", () => {
    const atFloor: AssetInspection = { detectedText: "", unsafeScore: 0, styleScore: 0.6 };
    expect(assessAsset(atFloor, qaCfg({ styleMinScore: 0.6 }))).toEqual({ ok: true });
  });

  it("`style_coherence` : seuil ⚙️ AGIT — le MÊME asset passe/échoue selon `styleMinScore`", () => {
    const mid: AssetInspection = { detectedText: "", unsafeScore: 0, styleScore: 0.7 };
    expect(assessAsset(mid, qaCfg({ styleMinScore: 0.6 }))).toEqual({ ok: true });
    expect(assessAsset(mid, qaCfg({ styleMinScore: 0.8 }))).toEqual({
      ok: false,
      failedRule: "style_coherence",
    });
  });

  it("ordre des règles : un asset échouant TOUT est rejeté par la 1ʳᵉ règle (`no_parasitic_text`)", () => {
    const allBad: AssetInspection = { detectedText: "BOO!", unsafeScore: 1, styleScore: 0 };
    expect(assessAsset(allBad, qaCfg())).toEqual({ ok: false, failedRule: "no_parasitic_text" });
  });
});

// ───────────────────────────── collectInspectableAssets ─────────────────────────────

describe("collectInspectableAssets — énumère TOUS les assets générés (aucun n'échappe à la QA)", () => {
  it("fond + tuiles + Teddy + chaque créature, avec leur nature", () => {
    const assets = collectInspectableAssets(
      makeWorld(["world/0/creature-0.png", "world/0/creature-1.png"]),
    );
    expect(assets).toEqual<InspectableAsset[]>([
      { ref: "world/0/background.png", kind: "background" },
      { ref: "world/0/tiles.png", kind: "tiles" },
      { ref: "world/0/teddy.png", kind: "teddy" },
      { ref: "world/0/creature-0.png", kind: "creature" },
      { ref: "world/0/creature-1.png", kind: "creature" },
    ]);
  });

  it("un monde sans créature ⇒ 3 assets (fond + tuiles + Teddy)", () => {
    expect(collectInspectableAssets(makeWorld())).toHaveLength(3);
  });
});

// ───────────────────────────── assessWorldAssets ─────────────────────────────

describe("assessWorldAssets — le monde n'est conforme que si TOUS ses assets passent", () => {
  const passAll: WorldInspector = () => CLEAN;

  it("tous les assets propres ⇒ monde conforme", () => {
    expect(assessWorldAssets(makeWorld(["world/0/creature-0.png"]), passAll, qaCfg())).toEqual({
      ok: true,
    });
  });

  it("MUTATION-PROUVÉ : UN asset hors-charte (la créature) ⇒ monde rejeté en nommant l'asset + la règle", () => {
    const world = makeWorld(["world/0/creature-0.png"]);
    // Inspecteur : propre partout SAUF sur l'art de la créature (style raté).
    const inspect: WorldInspector = (asset) =>
      asset.ref === "world/0/creature-0.png"
        ? { detectedText: "", unsafeScore: 0, styleScore: 0.1 }
        : CLEAN;
    expect(assessWorldAssets(world, inspect, qaCfg())).toEqual({
      ok: false,
      failedRule: "style_coherence",
      failedAssetRef: "world/0/creature-0.png",
    });
  });

  it("propage l'exception de l'inspecteur (fail-closed) — jamais un faux verdict conforme", () => {
    expect(() => assessWorldAssets(makeWorld(), defaultInspector, qaCfg())).toThrow(
      QaInspectionError,
    );
  });
});

// ───────────────────────────── defaultInspector (fail-closed) ─────────────────────────────

describe("defaultInspector — fail-closed (seam non branché, échec loud & actionnable, #157)", () => {
  it("lève `QaInspectionError` avec un message actionnable (jamais un faux « asset propre »)", () => {
    const asset: InspectableAsset = { ref: "world/0/teddy.png", kind: "teddy" };
    expect(() => defaultInspector(asset)).toThrow(QaInspectionError);
    try {
      defaultInspector(asset);
    } catch (e) {
      expect((e as Error).message).toContain("Inspecteur QA vision non branché");
      expect((e as Error).message).toContain("world/0/teddy.png");
    }
  });
});

// ───────────────────────────── moderatedStatusAfterQaPass (toggle validation parent) ─────────────────────────────

describe("moderatedStatusAfterQaPass — toggle validation parent ⚙️ (WORLDGEN §6)", () => {
  it("toggle OFF ⇒ `active` auto après QA (muter le toggle rougit)", () => {
    expect(moderatedStatusAfterQaPass(qaCfg({ parentValidationEnabled: false }))).toBe("active");
  });

  it("toggle ON ⇒ reste `buffered` (attend l'approbation parent)", () => {
    expect(moderatedStatusAfterQaPass(qaCfg({ parentValidationEnabled: true }))).toBe("buffered");
  });
});
