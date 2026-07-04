import { describe, expect, it } from "vitest";
import type { EconomyConfig } from "@/config/server-config";
import type { NodeType } from "./map";
import type { Stars } from "@/lib/db/schema";
import { computeLevelReward } from "./reward";

/**
 * Tests du **barème de gains** (ECONOMY §4.1/§5, story #126) — fonction pure. Prouvent à
 * effet observable : base + bonus par étoile, bonus trésor **uniquement** sur le nœud trésor,
 * lecture du barème depuis `EconomyConfig` (jamais de valeur en dur), montant toujours ≥ 0.
 */

/** Barème ⚙️ de test (ECONOMY §5) : base 10, +5/étoile, +15 trésor. */
const CONFIG: EconomyConfig = { levelBaseCoins: 10, starBonusCoins: 5, treasureBonusCoins: 15 };

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
      expect(reward.total).toBe(total);
    },
  );
});

describe("computeLevelReward — bonus TRÉSOR (PRODUCT §2.1, uniquement le nœud trésor)", () => {
  // GARDE « bonus trésor sur nœud trésor » : le type `treasure` ajoute `treasureBonusCoins`.
  it("nœud TRÉSOR à 1★ ⇒ base 10 + 1×5 + 15 trésor = 30", () => {
    const reward = computeLevelReward("treasure", 1, CONFIG);
    expect(reward).toEqual({ base: 10, starBonus: 5, treasureBonus: 15, total: 30 });
  });

  // GARDE « PAS de bonus trésor hors nœud trésor » (effet observable, contraste) : chaque
  // autre type (normal/boss/revision) ne reçoit AUCUN bonus trésor. Rouge si `hasTreasureBonus`
  // était mutée en `!== "normal"` ou en `true`.
  it.each(["normal", "boss", "revision"] as NodeType[])(
    "nœud %s ⇒ AUCUN bonus trésor (treasureBonus 0)",
    (nodeType) => {
      const reward = computeLevelReward(nodeType, 2, CONFIG);
      expect(reward.treasureBonus).toBe(0);
      expect(reward.total).toBe(20); // 10 + 2×5, jamais +15
    },
  );
});

describe("computeLevelReward — barème = config versionnée (ECONOMY §3, jamais en dur)", () => {
  // GARDE « lit le barème, pas une constante » : un barème différent change chaque terme.
  it("barème alternatif ⇒ montants recalculés depuis EconomyConfig", () => {
    const alt: EconomyConfig = { levelBaseCoins: 3, starBonusCoins: 7, treasureBonusCoins: 100 };
    expect(computeLevelReward("treasure", 3, alt)).toEqual({
      base: 3,
      starBonus: 21, // 7×3
      treasureBonus: 100,
      total: 124,
    });
  });

  // GARDE « barème nul ⇒ 0 (jamais négatif) » : un barème à 0 rapporte 0 (état légitime, éco
  // ne bloque jamais l'apprentissage — un total ≥ 0 est un invariant).
  it("barème entièrement nul ⇒ total 0 (jamais négatif, ECONOMY §1)", () => {
    const zero: EconomyConfig = { levelBaseCoins: 0, starBonusCoins: 0, treasureBonusCoins: 0 };
    expect(computeLevelReward("treasure", 3, zero).total).toBe(0);
  });
});
