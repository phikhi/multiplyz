import { describe, expect, it } from "vitest";
import type { EconomyConfig } from "@/config/server-config";
import type { NodeType } from "./map";
import type { Stars } from "@/lib/db/schema";
import { computeLevelReward } from "./reward";

/**
 * Tests du **barème de gains** (ECONOMY §4.1/§5, story 5.6) — fonction pure. Prouvent à
 * effet observable : base + bonus par étoile, bonus trésor **uniquement** sur le nœud trésor,
 * **bonus boss uniquement** sur le nœud boss, lecture du barème depuis `EconomyConfig` (jamais
 * de valeur en dur), montant toujours ≥ 0.
 */

/** Barème ⚙️ de test (ECONOMY §5) : base 10, +5/étoile, +15 trésor, +50 boss. */
const CONFIG: EconomyConfig = {
  levelBaseCoins: 10,
  starBonusCoins: 5,
  treasureBonusCoins: 15,
  bossBonusCoins: 50,
};

describe("computeLevelReward — base + bonus par étoile (ECONOMY §5)", () => {
  // Test paramétré sur TOUTES les valeurs du domaine Stars (0..3, LEARNINGS #59) : le bonus
  // étoile est bien `starBonusCoins × stars`, et la base est TOUJOURS créditée (no-fail).
  it.each([
    [0, 10],
    [1, 15],
    [2, 20],
    [3, 25],
  ] as [Stars, number][])(
    "niveau normal à %i★ ⇒ total %i pièces (base 10 + 5×étoiles)",
    (stars, total) => {
      const reward = computeLevelReward("normal", stars, CONFIG);
      expect(reward.base).toBe(10);
      expect(reward.starBonus).toBe(5 * stars);
      expect(reward.treasureBonus).toBe(0);
      expect(reward.bossBonus).toBe(0);
      expect(reward.total).toBe(total);
    },
  );
});

describe("computeLevelReward — bonus TRÉSOR (PRODUCT §2.1, uniquement le nœud trésor)", () => {
  // GARDE « bonus trésor sur nœud trésor » : le type `treasure` ajoute `treasureBonusCoins`.
  it("nœud TRÉSOR à 1★ ⇒ base 10 + 1×5 + 15 trésor = 30 (aucun bonus boss)", () => {
    const reward = computeLevelReward("treasure", 1, CONFIG);
    expect(reward).toEqual({
      base: 10,
      starBonus: 5,
      treasureBonus: 15,
      bossBonus: 0,
      total: 30,
    });
  });

  // GARDE « PAS de bonus trésor hors nœud trésor » (effet observable, contraste) : chaque
  // autre type (normal/revision) ne reçoit AUCUN bonus trésor. Rouge si `hasTreasureBonus`
  // était mutée en `!== "normal"` ou en `true`. Le boss est testé séparément (il a SON bonus).
  it.each(["normal", "revision"] as NodeType[])(
    "nœud %s ⇒ AUCUN bonus trésor NI boss (treasureBonus 0, bossBonus 0)",
    (nodeType) => {
      const reward = computeLevelReward(nodeType, 2, CONFIG);
      expect(reward.treasureBonus).toBe(0);
      expect(reward.bossBonus).toBe(0);
      expect(reward.total).toBe(20); // 10 + 2×5, jamais +15 ni +50
    },
  );
});

describe("computeLevelReward — bonus BOSS (MAP §6 « gros lot », story 5.6)", () => {
  // GARDE « bonus boss sur nœud boss » (effet observable) : le type `boss` ajoute
  // `bossBonusCoins` (+50). À 3★ : 10 + 3×5 + 50 = 75. Rouge si le bonus boss cessait de
  // s'appliquer ou s'appliquait à un autre type.
  it("nœud BOSS à 3★ ⇒ base 10 + 3×5 + 50 boss = 75 (aucun bonus trésor)", () => {
    const reward = computeLevelReward("boss", 3, CONFIG);
    expect(reward).toEqual({
      base: 10,
      starBonus: 15,
      treasureBonus: 0,
      bossBonus: 50,
      total: 75,
    });
  });

  // GARDE « boss à 0★ crédite quand même base + gros lot » (no-fail : battre le boss rapporte
  // toujours le gros lot, même sans étoile).
  it("nœud BOSS à 0★ ⇒ base 10 + 0 + 50 boss = 60", () => {
    const reward = computeLevelReward("boss", 0, CONFIG);
    expect(reward.bossBonus).toBe(50);
    expect(reward.total).toBe(60);
  });

  // GARDE « PAS de bonus boss hors nœud boss » (effet observable, contraste) : les autres types
  // ne reçoivent JAMAIS le bonus boss. Rouge si `hasBossBonus` était mutée en `true`/`!== "x"`.
  it.each(["normal", "treasure", "revision"] as NodeType[])(
    "nœud %s ⇒ AUCUN bonus boss (bossBonus 0)",
    (nodeType) => {
      expect(computeLevelReward(nodeType, 1, CONFIG).bossBonus).toBe(0);
    },
  );

  // GARDE « boss et trésor exclusifs » : le boss n'est jamais un trésor (MAP §6) — les deux
  // bonus ne se cumulent jamais sur un même nœud (un seul terme non nul au plus).
  it("boss et trésor ne se cumulent jamais (au plus un bonus non nul)", () => {
    const boss = computeLevelReward("boss", 2, CONFIG);
    const treasure = computeLevelReward("treasure", 2, CONFIG);
    expect(boss.treasureBonus).toBe(0);
    expect(treasure.bossBonus).toBe(0);
  });
});

describe("computeLevelReward — barème = config versionnée (ECONOMY §3, jamais en dur)", () => {
  // GARDE « lit le barème, pas une constante » : un barème différent change chaque terme.
  it("barème alternatif ⇒ montants recalculés depuis EconomyConfig (trésor)", () => {
    const alt: EconomyConfig = {
      levelBaseCoins: 3,
      starBonusCoins: 7,
      treasureBonusCoins: 100,
      bossBonusCoins: 0,
    };
    expect(computeLevelReward("treasure", 3, alt)).toEqual({
      base: 3,
      starBonus: 21, // 7×3
      treasureBonus: 100,
      bossBonus: 0,
      total: 124,
    });
  });

  // GARDE « bonus boss lu depuis le barème » : un `bossBonusCoins` différent change le total boss.
  it("barème alternatif ⇒ bonus boss recalculé depuis EconomyConfig", () => {
    const alt: EconomyConfig = {
      levelBaseCoins: 3,
      starBonusCoins: 7,
      treasureBonusCoins: 0,
      bossBonusCoins: 200,
    };
    expect(computeLevelReward("boss", 3, alt)).toEqual({
      base: 3,
      starBonus: 21,
      treasureBonus: 0,
      bossBonus: 200,
      total: 224,
    });
  });

  // GARDE « barème nul ⇒ 0 (jamais négatif) » : un barème à 0 rapporte 0 (état légitime, éco
  // ne bloque jamais l'apprentissage — un total ≥ 0 est un invariant).
  it("barème entièrement nul ⇒ total 0 (jamais négatif, ECONOMY §1)", () => {
    const zero: EconomyConfig = {
      levelBaseCoins: 0,
      starBonusCoins: 0,
      treasureBonusCoins: 0,
      bossBonusCoins: 0,
    };
    expect(computeLevelReward("boss", 3, zero).total).toBe(0);
  });
});
