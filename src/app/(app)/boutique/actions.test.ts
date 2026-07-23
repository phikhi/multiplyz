import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentChildProfileId } from "@/lib/engine/current-profile";
import { buyEggAndDraw, type EggDrawResult } from "@/lib/game/egg-draw";
import { loadWallet } from "@/lib/game/wallet";
import { boutiqueStateAction, buyEggAction } from "./actions";

/**
 * Tests des **server actions Boutique / Œufs** (story R4.2 #393) — adaptateurs minces. Prouvent :
 * - le `profile_id` vient TOUJOURS de la session (jamais du client, #63/#42) ;
 * - **#282** : le `drawId` client est validé string bornée au bord ; `buyEggAndDraw` est appelé avec
 *   la config serveur (montant/monnaie/raison dérivés serveur), jamais un objet client ;
 * - **no-fail** : `BROKE`/`REPLAY`/`NO_POOL`/`INVALID`/`UNAUTHENTICATED` remontent en refus neutre.
 */

vi.mock("@/lib/engine/current-profile", () => ({ getCurrentChildProfileId: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => "DB") }));
vi.mock("@/lib/game/egg-draw", () => ({ buyEggAndDraw: vi.fn() }));
vi.mock("@/lib/game/wallet", () => ({ loadWallet: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const profileMock = vi.mocked(getCurrentChildProfileId);
const buyMock = vi.mocked(buyEggAndDraw);
const loadWalletMock = vi.mocked(loadWallet);

const OK_RESULT: EggDrawResult = {
  ok: true,
  creature: {
    characterId: "creature:0:0",
    displayName: "Goupil",
    rarity: "common",
    artRef: "socle/creature/creature_world_0_0.png",
    story: "Un ami.",
  },
  isNew: true,
  shardsAwarded: 0,
  pityApplied: false,
  balance: { coins: 0, shards: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("boutiqueStateAction", () => {
  it("non authentifié → ok:false, prix affiché quand même (config publique), soldes à 0", async () => {
    profileMock.mockResolvedValue(null);
    const result = await boutiqueStateAction();
    expect(result.ok).toBe(false);
    expect(result.eggPriceCoins).toBe(50); // ⚙️ eggPriceCoins par défaut.
    expect(result.coins).toBe(0);
    expect(loadWalletMock).not.toHaveBeenCalled();
  });

  it("authentifié → prix + solde du profil de session (jamais du client)", async () => {
    profileMock.mockResolvedValue(7);
    loadWalletMock.mockReturnValue({ coins: 120, shards: 40 });
    const result = await boutiqueStateAction();
    expect(result).toEqual({ ok: true, eggPriceCoins: 50, coins: 120, shards: 40 });
    expect(loadWalletMock).toHaveBeenCalledWith("DB", 7);
  });
});

describe("buyEggAction — validation d'entrée (#282)", () => {
  it("drawId non-string (objet client smuggé) → INVALID, aucun tirage", async () => {
    profileMock.mockResolvedValue(7);
    // Le server action reçoit l'input client BRUT : un objet posté à la place du drawId doit être
    // REJETÉ au bord (jamais transmis à la couche de tirage).
    const result = await buyEggAction({ drawId: "x", amount: 9999 } as unknown);
    expect(result).toEqual({ ok: false, error: "INVALID" });
    expect(buyMock).not.toHaveBeenCalled();
  });

  it("drawId vide ou trop long → INVALID, aucun tirage", async () => {
    profileMock.mockResolvedValue(7);
    expect(await buyEggAction("")).toEqual({ ok: false, error: "INVALID" });
    expect(await buyEggAction("x".repeat(65))).toEqual({ ok: false, error: "INVALID" });
    expect(buyMock).not.toHaveBeenCalled();
  });

  it("non authentifié → UNAUTHENTICATED, aucun tirage", async () => {
    profileMock.mockResolvedValue(null);
    expect(await buyEggAction("draw-1")).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    expect(buyMock).not.toHaveBeenCalled();
  });
});

describe("buyEggAction — délégation server-authoritative (#282)", () => {
  it("appelle buyEggAndDraw avec le profil de session + le drawId, jamais un montant client", async () => {
    profileMock.mockResolvedValue(7);
    buyMock.mockReturnValue(OK_RESULT);
    await buyEggAction("draw-abc");
    // Le montant/monnaie/raison ne sont PAS passés par l'action (dérivés serveur DANS buyEggAndDraw
    // depuis la config). L'action passe : db, profileId de session (7), config, config, drawId, now, rand.
    expect(buyMock).toHaveBeenCalledTimes(1);
    const call = buyMock.mock.calls[0];
    expect(call[0]).toBe("DB");
    expect(call[1]).toBe(7); // profil de SESSION, jamais du client.
    expect(call[4]).toBe("draw-abc"); // le drawId validé.
    expect(call[5]).toBeInstanceOf(Date); // horloge serveur injectée.
    expect(typeof call[6]).toBe("function"); // aléa injecté (Math.random).
  });

  it("succès → renvoie la créature + isNew + éclats + solde (miroir client, sans fuite)", async () => {
    profileMock.mockResolvedValue(7);
    buyMock.mockReturnValue(OK_RESULT);
    const result = await buyEggAction("draw-abc");
    expect(result).toEqual({
      ok: true,
      creature: OK_RESULT.creature,
      isNew: true,
      shardsAwarded: 0,
      pityApplied: false,
      coins: 0,
      shards: 0,
    });
  });

  it("solde insuffisant → BROKE remonté (no-fail, doux)", async () => {
    profileMock.mockResolvedValue(7);
    buyMock.mockReturnValue({ ok: false, error: "BROKE" });
    expect(await buyEggAction("draw-broke")).toEqual({ ok: false, error: "BROKE" });
  });

  it("rejeu même drawId → REPLAY remonté (idempotent)", async () => {
    profileMock.mockResolvedValue(7);
    buyMock.mockReturnValue({ ok: false, error: "REPLAY" });
    expect(await buyEggAction("draw-dup")).toEqual({ ok: false, error: "REPLAY" });
  });
});
