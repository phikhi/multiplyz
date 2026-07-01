import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHouseholdAction } from "./actions";
import { createHousehold, OnboardingError } from "@/lib/auth/household";
import type { CreateHouseholdInput } from "@/lib/auth/household";

// L'adaptateur est mince : on stubbe la DB (non utilisée, `createHousehold` est
// mocké) et on pilote le cœur pour couvrir chaque branche de mapping.
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/auth/household", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth/household")>();
  return { ...actual, createHousehold: vi.fn() };
});

const createHouseholdMock = vi.mocked(createHousehold);

const INPUT: CreateHouseholdInput = {
  name: "Léa",
  avatar: "fox",
  childPin: "1234",
  parentPin: "9876",
};

beforeEach(() => {
  createHouseholdMock.mockReset();
});

describe("createHouseholdAction", () => {
  it("succès → renvoie le code de secours en clair", async () => {
    createHouseholdMock.mockResolvedValue({ created: true, recoveryCode: "ABCD2345" });
    await expect(createHouseholdAction(INPUT)).resolves.toEqual({
      ok: true,
      recoveryCode: "ABCD2345",
    });
  });

  it("foyer déjà configuré → alreadyConfigured (rejeu idempotent)", async () => {
    createHouseholdMock.mockResolvedValue({ created: false });
    await expect(createHouseholdAction(INPUT)).resolves.toEqual({
      ok: true,
      alreadyConfigured: true,
    });
  });

  it("erreur métier → { ok:false, code } (mappable vers strings)", async () => {
    createHouseholdMock.mockRejectedValue(new OnboardingError("PARENT_PIN_SAME"));
    await expect(createHouseholdAction(INPUT)).resolves.toEqual({
      ok: false,
      code: "PARENT_PIN_SAME",
    });
  });

  it("erreur inattendue (non métier) → propagée (pas avalée)", async () => {
    createHouseholdMock.mockRejectedValue(new Error("db down"));
    await expect(createHouseholdAction(INPUT)).rejects.toThrow("db down");
  });
});
