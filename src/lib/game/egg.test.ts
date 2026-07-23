import { describe, expect, it } from "vitest";
import { drawFromEggPool, duplicateShardsFor, isPityActive, type EggPoolCreature } from "./egg";

/**
 * Tests de la **logique PURE du tirage d'œuf** (story R4.2 #393, ECONOMY §4.2/§5/§7). Chaque garde du
 * modèle éco (odds **normalisées**, **pitié** anti-malchance, doublon→éclats) est prouvée **à effet
 * observable + mutation-prouvée** par un test NOMMÉ (jamais un cardinal agrégé, #173/#206).
 *
 * L'aléa est injecté déterministe (`seqRand`) : `drawFromEggPool` consomme **exactement deux** tirages
 * (rarity roll PUIS index roll), quelle que soit la composition (ordre invariant).
 */

/** Aléa déterministe : rend les valeurs fournies dans l'ordre (rarityRoll, indexRoll, …). */
function seqRand(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++];
}

const commonOwned = (id: string): EggPoolCreature => ({
  id,
  worldIndex: 0,
  rarity: "common",
  owned: true,
});
const commonNew = (id: string): EggPoolCreature => ({
  id,
  worldIndex: 0,
  rarity: "common",
  owned: false,
});
const rareOwned = (id: string): EggPoolCreature => ({
  id,
  worldIndex: 0,
  rarity: "rare",
  owned: true,
});
const rareNew = (id: string): EggPoolCreature => ({
  id,
  worldIndex: 0,
  rarity: "rare",
  owned: false,
});

describe("isPityActive (seuil de pitié, borne exacte — ECONOMY §4.2/§7)", () => {
  it("actif à seuil ATTEINT ou dépassé, inactif en dessous (mutation-prouvé sur `>=`)", () => {
    // Borne EXACTE : `threshold - 1` inactif, `threshold` actif. Un `>` au lieu de `>=` retarderait
    // la garantie (5 → inactif = frustration) → ce cas rougit ; un `<` la casserait → l'autre rougit.
    expect(isPityActive(4, 5)).toBe(false);
    expect(isPityActive(5, 5)).toBe(true);
    expect(isPityActive(6, 5)).toBe(true);
    expect(isPityActive(0, 5)).toBe(false);
  });
});

describe("duplicateShardsFor (doublon → éclats par rareté — ECONOMY §4.2/§5)", () => {
  it("commune → montant commune, rare → montant rare (mutation-prouvé : intervertir rougit)", () => {
    // Montants DISTINCTS (10 vs 25) → intervertir la map rareté↔montant rougit ce test.
    expect(duplicateShardsFor("common", 10, 25)).toBe(10);
    expect(duplicateShardsFor("rare", 10, 25)).toBe(25);
  });
});

describe("drawFromEggPool — garde de forme", () => {
  it("pool vide ⇒ null (aucune créature tirable)", () => {
    expect(drawFromEggPool([], 0.85, 0.15, false, seqRand([0, 0]))).toBeNull();
  });
});

describe("drawFromEggPool — odds NORMALISÉES dans le pool atteignable (R4.1 #164)", () => {
  // Le dénominateur de la sélection de rareté est `oddsCommon + oddsRare`, JAMAIS supposé = 1. On
  // choisit des odds dont la somme ≠ 1 (0.9 + 0.3 = 1.2) et un rarityRoll où la formule normalisée
  // DIVERGE de la formule naïve `rand < oddsCommon` : rarityRoll = 0.8 → normalisé 0.8×1.2 = 0.96 ≥ 0.9
  // ⇒ RARE ; naïf 0.8 < 0.9 ⇒ commune. Muter le facteur `(oddsCommon+oddsRare)` (supposer somme = 1)
  // rougit ce test.
  const pool = [commonNew("c"), rareNew("r")] as const;

  it("rarityRoll au-dessus de la frontière normalisée ⇒ RARE (diverge de la formule non normalisée)", () => {
    const out = drawFromEggPool(pool, 0.9, 0.3, false, seqRand([0.8, 0]));
    expect(out?.creature.rarity).toBe("rare");
  });

  it("rarityRoll sous la frontière normalisée ⇒ COMMUNE", () => {
    // 0.5 × 1.2 = 0.6 < 0.9 ⇒ commune.
    const out = drawFromEggPool(pool, 0.9, 0.3, false, seqRand([0.5, 0]));
    expect(out?.creature.rarity).toBe("common");
  });

  it("frontière symétrique (odds égales non normalisées 0.6+0.6=1.2) : 0.55 ⇒ RARE, 0.4 ⇒ COMMUNE", () => {
    // 0.55 × 1.2 = 0.66 ≥ 0.6 ⇒ rare (naïf 0.55 < 0.6 ⇒ commune : diverge). 0.4 × 1.2 = 0.48 < 0.6 ⇒ commune.
    expect(drawFromEggPool(pool, 0.6, 0.6, false, seqRand([0.55, 0]))?.creature.rarity).toBe(
      "rare",
    );
    expect(drawFromEggPool(pool, 0.6, 0.6, false, seqRand([0.4, 0]))?.creature.rarity).toBe(
      "common",
    );
  });
});

describe("drawFromEggPool — normalisation par COMPOSITION (rareté absente du pool atteignable)", () => {
  it("pool SANS rare ⇒ commune à coup sûr, quel que soit le rarityRoll (poids rare = 0)", () => {
    const pool = [commonNew("c0"), commonNew("c1")] as const;
    // rarityRoll = 0.99 (favoriserait la rare si elle existait) → mais aucune rare atteignable ⇒ commune.
    const out = drawFromEggPool(pool, 0.85, 0.15, false, seqRand([0.99, 0]));
    expect(out?.creature.rarity).toBe("common");
  });

  it("pool SANS commune ⇒ rare à coup sûr, quel que soit le rarityRoll (poids commune = 0)", () => {
    const pool = [rareNew("r0")] as const;
    const out = drawFromEggPool(pool, 0.85, 0.15, false, seqRand([0.01, 0]));
    expect(out?.creature.rarity).toBe("rare");
  });

  it("odds DÉGÉNÉRÉES (somme 0, calibration extrême) ⇒ repli commune (garde de forme, jamais division par 0)", () => {
    // `oddsCommon + oddsRare = 0` : garde `total > 0 ? … : true` → repli déterministe sur la commune
    // (jamais un biais silencieux ni une division par zéro). Config réelle borne les odds `]0,1]`.
    const pool = [commonNew("c"), rareNew("r")] as const;
    const out = drawFromEggPool(pool, 0, 0, false, seqRand([0.5, 0]));
    expect(out?.creature.rarity).toBe("common");
  });
});

describe("drawFromEggPool — tirage UNIFORME dans la rareté choisie (index roll)", () => {
  it("indexRoll balaie la liste (0 → 1ʳᵉ, milieu → 2ᵉ, ~1 → dernière, borne clampée)", () => {
    const pool = [commonNew("c0"), commonNew("c1"), commonNew("c2")] as const;
    // Une seule rareté → rarityRoll sans effet ; indexRoll = floor(roll × 3).
    expect(drawFromEggPool(pool, 0.85, 0.15, false, seqRand([0, 0]))?.creature.id).toBe("c0");
    expect(drawFromEggPool(pool, 0.85, 0.15, false, seqRand([0, 0.5]))?.creature.id).toBe("c1");
    // indexRoll → 1 : clamp à la dernière (jamais hors borne).
    expect(drawFromEggPool(pool, 0.85, 0.15, false, seqRand([0, 0.999999]))?.creature.id).toBe(
      "c2",
    );
  });
});

describe("drawFromEggPool — PITIÉ anti-malchance (ECONOMY §4.2/§7)", () => {
  it("pitié active + une nouveauté existe ⇒ créature GARANTIE nouvelle (mutation-prouvé : sans la pitié, doublon)", () => {
    // Pool = [A possédée, B nouvelle], MÊME rareté. Sans pitié, indexRoll = 0 tomberait sur A (doublon).
    // Avec pitié active, les candidates sont RESTREINTES aux non-possédées → B, garantie nouvelle.
    const pool = [commonOwned("A"), commonNew("B")] as const;
    const out = drawFromEggPool(pool, 0.85, 0.15, true, seqRand([0, 0]));
    expect(out?.creature.id).toBe("B");
    expect(out?.isNew).toBe(true);
    expect(out?.pityApplied).toBe(true);
    // Contrôle : SANS pitié (active=false), le MÊME aléa retombe sur A (doublon) → prouve que c'est
    // bien la branche pitié qui a changé la sortie (retirer la restriction rougit le cas ci-dessus).
    const control = drawFromEggPool(pool, 0.85, 0.15, false, seqRand([0, 0]));
    expect(control?.creature.id).toBe("A");
    expect(control?.isNew).toBe(false);
    expect(control?.pityApplied).toBe(false);
  });

  it("pitié active mais AUCUNE nouveauté (tout possédé) ⇒ retombe sur un doublon utile (ECONOMY §7 « si une existe »)", () => {
    const pool = [commonOwned("A"), rareOwned("B")] as const;
    const out = drawFromEggPool(pool, 0.85, 0.15, true, seqRand([0, 0]));
    expect(out?.isNew).toBe(false);
    // Complétude atteinte → la pitié ne peut garantir une nouveauté inexistante (jamais bloquant).
    expect(out?.pityApplied).toBe(false);
  });

  it("pitié active restreint aux non-possédées MAIS respecte les odds (nouvelle rare vs nouvelle commune)", () => {
    // Candidates non-possédées = [commune nouvelle, rare nouvelle] → la rareté suit toujours les odds.
    const pool = [commonOwned("owned"), commonNew("cNew"), rareNew("rNew")] as const;
    // rarityRoll 0.99 × (0.85+0.15)=0.99 ≥ 0.85 ⇒ rare ; la rare nouvelle est choisie (jamais l'owned).
    const out = drawFromEggPool(pool, 0.85, 0.15, true, seqRand([0.99, 0]));
    expect(out?.creature.id).toBe("rNew");
    expect(out?.isNew).toBe(true);
    expect(out?.pityApplied).toBe(true);
  });
});
